import { newCard, grade } from '../scheduler.js';
import { getCard, putCard, getSettings, recordReview } from '../store.js';
import { h, clear, shuffle } from '../dom.js';

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildQueue(items, settings) {
  const withState = items.map((item) => ({
    item,
    id: `ch:${item.id}`,
    card: getCard(`ch:${item.id}`) ?? newCard(`ch:${item.id}`),
  }));
  const due = withState.filter((c) => c.card.state !== 'new' && c.card.due <= today());
  const fresh = withState
    .filter((c) => c.card.state === 'new')
    .sort((a, b) => a.item.id.localeCompare(b.item.id))
    .slice(0, settings.newCardsPerDay);
  return [...shuffle(due), ...shuffle(fresh)];
}

function renderCard(container, queue, index, onDone) {
  clear(container);

  if (index >= queue.length) {
    container.append(h('p', {}, 'Session complete for today. Come back tomorrow for more.'));
    onDone();
    return;
  }

  const { item, card } = queue[index];
  const remaining = queue.length - index;
  const [before, after] = item.sentence.split('___');

  const feedback = h('div', { class: 'feedback' });
  let answered = false;

  const choose = (choice, button, buttons) => {
    if (answered) return;
    answered = true;
    const correct = choice === item.answer;
    for (const b of buttons) b.disabled = true;
    button.classList.add(correct ? 'correct' : 'incorrect');

    const graded = grade(card, correct ? 'good' : 'again');
    putCard(graded);
    recordReview('chooser', correct ? 'good' : 'again');

    clear(feedback);
    feedback.append(
      h('p', { class: correct ? 'correct' : 'incorrect' },
        correct ? 'Correct.' : `Not quite: ${item.answer}`),
      h('p', {}, item.why),
    );
    const next = h('button', { type: 'button', onclick: () => renderCard(container, queue, index + 1, onDone) }, 'Next');
    feedback.append(next);
    next.focus();
  };

  const buttons = item.options.map((option) => h('button', { type: 'button' }, option));
  buttons.forEach((button, i) => {
    button.addEventListener('click', () => choose(item.options[i], button, buttons));
  });

  container.append(
    h('p', {}, `${remaining} card${remaining === 1 ? '' : 's'} left`),
    h('h2', { class: 'mono' }, [before, h('span', { class: 'ending' }, '___'), after]),
    h('div', { class: 'choices' }, buttons),
    feedback,
  );
}

export function renderChooserView(container, { chooser }) {
  clear(container);
  container.append(h('h1', {}, 'Imparfait or passé composé'));

  if (!chooser || chooser.length === 0) {
    container.append(h('p', {}, 'This drill needs 100 written contrast items, reviewed before they enter the deck. It arrives once the vocabulary bank exists.'));
    return;
  }

  const settings = getSettings();
  const queue = buildQueue(chooser, settings);
  const session = h('div', { class: 'drill' });
  container.append(session);
  renderCard(session, queue, 0, () => {});
}
