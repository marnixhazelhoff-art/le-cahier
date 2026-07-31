import { fullTable, splitEnding, CORE_TENSES, ALL_TENSES, SUBJECTS } from '../conjugate.js';
import { newCard, grade } from '../scheduler.js';
import { gradeAnswer } from '../grade.js';
import { getCard, putCard, getSettings, recordReview } from '../store.js';
import { buildVerbCardDeck } from '../verb-cards.js';
import { groupVerbExercises, statsFor, idsOf } from '../modules.js';
import { h, clear, shuffle } from '../dom.js';
import { speak } from '../tts.js';
import { attachAccentHelper } from '../accent-helper.js';

const BATCH_SIZE = 10;

const TENSE_LABEL = {
  present: 'présent',
  imparfait: 'imparfait',
  futur: 'futur',
  'passe-compose': 'passé composé',
  conditionnel: 'conditionnel',
};

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Everything due, plus everything never seen. No daily cap: practicing a
// deck to the end just means nothing here is eligible again until a due
// date genuinely arrives tomorrow.
function eligiblePool(deck) {
  const t = today();
  return deck
    .map((spec) => ({ spec, card: getCard(spec.id) ?? newCard(spec.id) }))
    .filter(({ card }) => card.state === 'new' || card.due <= t);
}

function nextBatch(deck) {
  return shuffle(eligiblePool(deck)).slice(0, BATCH_SIZE);
}

// index >= queue.length just means this batch is done; the caller (runLoop)
// decides what that means (more available, or nothing left today).
function renderCard(container, queue, index, verbs, onDone) {
  clear(container);

  if (index >= queue.length) {
    onDone();
    return;
  }

  const { spec, card } = queue[index];
  const remaining = queue.length - index;

  const input = h('input', {
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    'aria-label': 'Your answer',
  });

  const feedback = h('div', { class: 'feedback', 'aria-live': 'polite' });
  const actions = h('div', { class: 'actions' }, h('button', { type: 'submit' }, 'Check'));

  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const typed = input.value;
      if (!typed.trim()) return;
      const result = gradeAnswer(typed, spec.expected);
      const graded = grade(card, result.grade);
      putCard(graded);
      // card is the pre-grade state, so reps 0 means this review introduced it.
      recordReview('verbs', result.grade, { introduced: card.reps === 0 });

      // expected is usually one string, but a card can offer several accepted
      // answers (je suis allé / je suis allée) — speak and show the display
      // form (which keeps the (e) notation) rather than stringifying an array.
      const spoken = Array.isArray(spec.expected) ? spec.expected[0] : spec.expected;
      const correctionText = spec.display ?? spoken;
      speak(spoken);

      clear(feedback);
      feedback.append(
        h('p', { class: result.grade === 'again' ? 'incorrect' : 'correct' },
          result.grade === 'good' ? 'Correct.'
            : result.grade === 'almost' ? `Almost: ${correctionText}`
              : correctionText),
      );
      if (spec.note) feedback.append(h('p', { class: 'mono' }, spec.note));

      input.disabled = true;
      const next = h('button', { type: 'button', onclick: () => {
        const nextQueue = result.grade === 'almost'
          ? [...queue.slice(0, index), ...queue.slice(index + 1, index + 6), queue[index], ...queue.slice(index + 6)]
          : queue;
        renderCard(container, nextQueue, index + 1, verbs, onDone);
      } }, 'Next');
      clear(actions);
      actions.append(next);
      next.focus();
    },
  });

  const accentRow = attachAccentHelper(input);

  form.append(...[
    h('p', {}, `${remaining} card${remaining === 1 ? '' : 's'} left in this batch`),
    h('h2', {}, spec.prompt),
    input,
    accentRow,
    feedback,
    actions,
  ].filter(Boolean));

  container.append(form);
  input.focus();
}

function showExhausted(container, onBack) {
  clear(container);
  container.append(...[
    h('p', {}, 'Nothing left here for today. Come back tomorrow, or try something else.'),
    onBack ? h('div', { class: 'button-row' }, h('button', { type: 'button', onclick: onBack }, '← Back to exercises')) : null,
  ].filter(Boolean));
}

function runLoop(container, verbs, deck, onBack) {
  const batch = nextBatch(deck);
  if (batch.length === 0) { showExhausted(container, onBack); return; }

  clear(container);
  const session = h('div', { class: 'drill' });
  container.append(session);
  renderCard(session, batch, 0, verbs, () => {
    const remaining = eligiblePool(deck).length;
    clear(container);
    if (remaining === 0) { showExhausted(container, onBack); return; }
    container.append(...[
      h('p', {}, 'Batch done.'),
      h('div', { class: 'button-row' }, [
        h('button', {
          type: 'button',
          onclick: () => runLoop(container, verbs, deck, onBack),
        }, `Practice ${Math.min(BATCH_SIZE, remaining)} more`),
        onBack ? h('button', { type: 'button', onclick: onBack }, '← Back to exercises') : null,
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

function renderExercises(container, verbs) {
  const deck = buildVerbCardDeck(verbs);
  const exercises = groupVerbExercises(deck);
  const t = today();

  function backHere() { clear(container); renderExercises(container, verbs); }

  const allRemaining = eligiblePool(deck).length;
  container.append(...[
    h('h3', {}, 'All verbs, mixed'),
    allRemaining > 0
      ? h('div', { class: 'button-row' }, h('button', {
        type: 'button',
        onclick: () => runLoop(container, verbs, deck, backHere),
      }, `Practice ${Math.min(BATCH_SIZE, allRemaining)}`))
      : h('p', { class: 'gloss' }, 'Nothing to practice right now.'),
  ].filter(Boolean));

  for (const ex of exercises) {
    if (ex.cards.length === 0) continue;
    const stats = statsFor(idsOf(ex.cards), t);
    const remaining = eligiblePool(ex.cards).length;
    container.append(
      h('h3', {}, ex.label),
      h('p', { class: 'gloss' }, statLine(stats)),
      remaining > 0
        ? h('div', { class: 'button-row' }, h('button', {
          type: 'button',
          onclick: () => runLoop(container, verbs, ex.cards, backHere),
        }, `Practice ${Math.min(BATCH_SIZE, remaining)}`))
        : h('p', { class: 'gloss' }, 'Nothing to practice here right now.'),
    );
  }
}

function renderBrowse(container, verbs) {
  const sorted = [...verbs].sort((a, b) => a.rank - b.rank);
  const settings = getSettings();
  const tenses = settings.conditionnelEnabled ? ALL_TENSES : CORE_TENSES;

  const select = h('select', { 'aria-label': 'Choose a verb' },
    sorted.map((v) => h('option', { value: v.infinitive }, `${v.infinitive} (${v.en})`)));

  const table = h('div', { class: 'paradigm-table' });

  function draw() {
    clear(table);
    const verb = verbs.find((v) => v.infinitive === select.value);
    const t = fullTable(verb, tenses);
    const grid = h('table', {},
      h('thead', {}, h('tr', {}, [h('th', {}, ''), ...tenses.map((tense) => h('th', {}, TENSE_LABEL[tense]))])),
      h('tbody', {}, [0, 1, 2, 3, 4, 5].map((person) => h('tr', {}, [
        h('th', {}, SUBJECTS[person]),
        ...tenses.map((tense) => {
          const form = t[tense][person];
          if (!form) return h('td', {}, '—');
          const [stem, ending] = splitEnding(form, tense, verb);
          const gap = tense === 'passe-compose' ? ' ' : '';
          return h('td', { class: 'mono' }, [stem, gap, h('span', { class: 'ending' }, ending)]);
        }),
      ]))),
    );
    table.append(grid);
  }

  select.addEventListener('change', draw);
  container.append(h('p', {}, 'Reference only. Browsing never creates or schedules cards.'), select, table);
  draw();
}

export function renderVerbsView(container, { verbs }) {
  clear(container);
  const tabs = h('div', { class: 'subtabs' });
  const body = h('div', {});

  const showExercises = () => { clear(body); renderExercises(body, verbs); };
  const showBrowse = () => { clear(body); renderBrowse(body, verbs); };

  tabs.append(
    h('button', { type: 'button', onclick: showExercises }, 'Exercises'),
    h('button', { type: 'button', onclick: showBrowse }, 'Browse'),
  );

  container.append(h('h1', {}, 'Verbs'), tabs, body);
  showExercises();
}
