import { newCard, grade } from '../scheduler.js';
import { getCard, putCard, recordReview } from '../store.js';
import { groupChooserCategories, statsFor } from '../modules.js';
import { h, clear, shuffle } from '../dom.js';

// There is no daily cap on any mode. Practice always comes in batches of
// this size instead, repeated on request until nothing is eligible left.
const BATCH_SIZE = 10;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Everything due, plus everything never seen. No daily cap, and no ordering
// requirement either (unlike vocab, chooser items carry no frequency rank),
// so which items are eligible is simply due-or-new.
function eligiblePool(items) {
  const t = today();
  return items
    .map((item) => ({ item, id: `ch:${item.id}`, card: getCard(`ch:${item.id}`) ?? newCard(`ch:${item.id}`) }))
    .filter(({ card }) => card.state === 'new' || card.due <= t);
}

function nextBatch(items) {
  return shuffle(eligiblePool(items)).slice(0, BATCH_SIZE);
}

// index >= queue.length just means this batch is done; the caller (runLoop)
// decides what that means (more available, or nothing left today).
function renderCard(container, queue, index, onDone) {
  clear(container);

  if (index >= queue.length) {
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
    // native Element.append coerces a null argument to the text "null"
    // instead of skipping it, unlike this file's h() helper — filter first.
    feedback.append(...[
      h('p', { class: correct ? 'correct' : 'incorrect' },
        correct ? 'Correct.' : `Not quite: ${item.answer}`),
      h('p', {}, item.why),
      item.sentenceNl ? h('p', { class: 'gloss' }, item.sentenceNl) : null,
      item.note ? h('p', { class: 'gloss' }, item.note) : null,
    ].filter(Boolean));
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
    h('p', {}, `${remaining} card${remaining === 1 ? '' : 's'} left in this batch`),
    h('h2', { class: 'mono' }, [before, h('span', { class: 'ending' }, '___'), after]),
    feedback,
    actions,
  );
}

function showExhausted(container, onBack) {
  clear(container);
  container.append(...[
    h('p', {}, 'Nothing left here for today. Come back tomorrow, or try something else.'),
    onBack ? h('div', { class: 'button-row' }, h('button', { type: 'button', onclick: onBack }, '← Back to categories')) : null,
  ].filter(Boolean));
}

function runLoop(container, items, onBack) {
  const batch = nextBatch(items);
  if (batch.length === 0) { showExhausted(container, onBack); return; }

  clear(container);
  const session = h('div', { class: 'drill' });
  container.append(session);
  renderCard(session, batch, 0, () => {
    const remaining = eligiblePool(items).length;
    clear(container);
    if (remaining === 0) { showExhausted(container, onBack); return; }
    container.append(...[
      h('p', {}, 'Batch done.'),
      h('div', { class: 'button-row' }, [
        h('button', {
          type: 'button',
          onclick: () => runLoop(container, items, onBack),
        }, `Practice ${Math.min(BATCH_SIZE, remaining)} more`),
        onBack ? h('button', { type: 'button', onclick: onBack }, '← Back to categories') : null,
      ].filter(Boolean)),
    ]);
  });
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

  container.append(h('p', {}, 'Every item has two grammatically valid answers: only one fits the meaning. These are the five contrasts from BRIEF.md section 9. Picking a category here just narrows which items come up, same as everywhere else in the app: the item itself never announces which grammar point it is testing.'));

  for (const cat of categories) {
    const stats = statsFor(cat.ids, t);
    const remaining = eligiblePool(cat.items).length;
    // native Element.append coerces a null argument to the text "null"
    // instead of skipping it, unlike this file's h() helper — filter first.
    container.append(...[
      h('h3', {}, cat.label),
      h('p', { class: 'gloss' }, statLine(stats)),
      remaining > 0
        ? h('div', { class: 'button-row' }, h('button', {
          type: 'button',
          onclick: () => runLoop(container, cat.items, backHere),
        }, `Practice ${Math.min(BATCH_SIZE, remaining)}`))
        : h('p', { class: 'gloss' }, 'Nothing to practice here right now.'),
    ].filter(Boolean));
  }
}

export function renderChooserView(container, { chooser }) {
  clear(container);
  // Not "imparfait or passé composé": that title alone would give away the
  // answer pair on every single item, in every mode, before the sentence is
  // even read.
  container.append(h('h1', {}, 'Chooser'));

  if (!chooser || chooser.length === 0) {
    container.append(h('p', {}, 'This drill needs 100 written contrast items, reviewed before they enter the deck. It arrives once the vocabulary bank exists.'));
    return;
  }

  const tabs = h('div', { class: 'subtabs' });
  const body = h('div', {});

  // The tab bar above stays the way back out, so the loop itself does not
  // need its own back button here.
  const showToday = () => { clear(body); runLoop(body, chooser, null); };
  const showCategories = () => { clear(body); renderCategories(body, chooser); };

  tabs.append(
    h('button', { type: 'button', onclick: showToday }, "Today's session"),
    h('button', { type: 'button', onclick: showCategories }, 'Categories'),
  );

  container.append(tabs, body);
  showToday();
}
