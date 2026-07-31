import { newCard, grade } from '../scheduler.js';
import { getCard, putCard, getSettings, recordReview, newCardAllowance } from '../store.js';
import { groupChooserCategories, statsFor } from '../modules.js';
import { h, clear, shuffle } from '../dom.js';

const PRACTICE_MORE_BATCH = 10;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildQueue(items, settings, extraNew = 0) {
  const withState = items.map((item) => ({
    item,
    id: `ch:${item.id}`,
    card: getCard(`ch:${item.id}`) ?? newCard(`ch:${item.id}`),
  }));
  const due = withState.filter((c) => c.card.state !== 'new' && c.card.due <= today());
  // Unlike vocab, chooser items carry no required introduction order, so
  // which items become new today is itself shuffled, not just their
  // presentation order. The source data alternates imparfait/passé composé
  // answers in id order by construction, so sorting by id and shuffling only
  // the slice kept surfacing that same alternating pattern.
  const fresh = shuffle(withState.filter((c) => c.card.state === 'new'))
    .slice(0, newCardAllowance('chooser', settings.newCardsPerDay + extraNew));
  return [...shuffle(due), ...fresh];
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
    // card is the pre-grade state, so reps 0 means this review introduced it.
    recordReview('chooser', correct ? 'good' : 'again', { introduced: card.reps === 0 });

    clear(feedback);
    feedback.append(
      h('p', { class: correct ? 'correct' : 'incorrect' },
        correct ? 'Correct.' : `Not quite: ${item.answer}`),
      h('p', {}, item.why),
    );
    const next = h('button', { type: 'button', onclick: () => renderCard(container, queue, index + 1, onDone) }, 'Next');
    clear(actions);
    actions.append(next);
    next.focus();
  };

  const buttons = item.options.map((option) => h('button', { type: 'button' }, option));
  buttons.forEach((button, i) => {
    button.addEventListener('click', () => choose(item.options[i], button, buttons));
  });

  // The two options are the whole interaction here, so they take the thumb zone
  // and hand it over to Next once the justification is on screen.
  const actions = h('div', { class: 'actions choices' }, buttons);

  container.append(
    h('p', {}, `${remaining} card${remaining === 1 ? '' : 's'} left`),
    h('h2', { class: 'mono' }, [before, h('span', { class: 'ending' }, '___'), after]),
    feedback,
    actions,
  );
}

function runSession(container, items, extraNew, onBack) {
  clear(container);
  if (onBack) container.append(h('p', {}, h('button', { type: 'button', onclick: onBack }, '← Back')));
  const settings = getSettings();
  const queue = buildQueue(items, settings, extraNew);
  const session = h('div', { class: 'drill' });
  container.append(session);
  renderCard(session, queue, 0, () => {});
}

function statLine(stats) {
  const introduced = stats.total - stats.states.new;
  const parts = [`${introduced}/${stats.total} introduced`];
  if (stats.due) parts.push(`${stats.due} due today`);
  if (stats.states.learned) parts.push(`${stats.states.learned} learned`);
  if (stats.states.leech) parts.push(`${stats.states.leech} leech${stats.states.leech === 1 ? '' : 'es'}`);
  return parts.join(', ');
}

function renderCategories(container, chooser) {
  const categories = groupChooserCategories(chooser);
  const t = today();

  function backHere() { clear(container); renderCategories(container, chooser); }

  container.append(h('p', {}, 'Every item has two grammatically valid answers: only one fits the meaning. These are the five contrasts from BRIEF.md section 9.'));

  for (const cat of categories) {
    const stats = statsFor(cat.ids, t);
    // native Element.append coerces a null argument to the text "null"
    // instead of skipping it, unlike this file's h() helper — filter first.
    container.append(...[
      h('h3', {}, cat.label),
      h('p', { class: 'gloss' }, statLine(stats)),
      h('div', { class: 'button-row' }, [
        h('button', { type: 'button', onclick: () => runSession(container, cat.items, 0, backHere) }, "Continue today's session"),
        h('button', { type: 'button', onclick: () => runSession(container, cat.items, PRACTICE_MORE_BATCH, backHere) }, `Practice ${PRACTICE_MORE_BATCH} more today`),
      ]),
    ].filter(Boolean));
  }
}

export function renderChooserView(container, { chooser }) {
  clear(container);
  container.append(h('h1', {}, 'Imparfait or passé composé'));

  if (!chooser || chooser.length === 0) {
    container.append(h('p', {}, 'This drill needs 100 written contrast items, reviewed before they enter the deck. It arrives once the vocabulary bank exists.'));
    return;
  }

  const tabs = h('div', { class: 'subtabs' });
  const body = h('div', {});

  const showToday = () => runSession(body, chooser, 0, null);
  const showCategories = () => { clear(body); renderCategories(body, chooser); };

  tabs.append(
    h('button', { type: 'button', onclick: showToday }, "Today's session"),
    h('button', { type: 'button', onclick: showCategories }, 'Categories'),
  );

  container.append(tabs, body);
  showToday();
}
