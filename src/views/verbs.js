import { fullTable, splitEnding, CORE_TENSES, ALL_TENSES, SUBJECTS } from '../conjugate.js';
import { newCard, grade } from '../scheduler.js';
import { gradeAnswer } from '../grade.js';
import { getCard, putCard, getSettings, recordReview, newCardAllowance } from '../store.js';
import { buildVerbCardDeck } from '../verb-cards.js';
import { groupVerbExercises, statsFor, idsOf } from '../modules.js';
import { h, clear, shuffle } from '../dom.js';
import { speak } from '../tts.js';
import { attachAccentHelper } from '../accent-helper.js';

const PRACTICE_MORE_BATCH = 10;

const EXERCISE_NOTES = {
  'passe-compose': "Redesigned: one card asks for the whole form, j'ai mangé or je suis allé(e), not the auxiliary by itself. Choosing avoir or être happens as part of producing the real answer.",
  imparfait: 'Only two cards, on purpose: the soft-consonant rule, plus être, the one verb that breaks it. Every other person in every other verb is just the présent nous stem minus -ons, already drilled inside Present.',
};

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

function buildQueue(deck, settings, extraNew = 0) {
  const withState = deck.map((spec) => ({ spec, card: getCard(spec.id) ?? newCard(spec.id) }));
  const due = withState.filter((c) => c.card.state !== 'new' && c.card.due <= today());
  const fresh = withState
    .filter((c) => c.card.state === 'new')
    .sort((a, b) => a.spec.id.localeCompare(b.spec.id))
    .slice(0, newCardAllowance('verbs', settings.newCardsPerDay + extraNew));
  return [...shuffle(due), ...shuffle(fresh)];
}

function renderCard(container, queue, index, verbs, onDone) {
  clear(container);

  if (index >= queue.length) {
    container.append(h('p', {}, 'Session complete for today. Come back tomorrow, or switch to Browse to look up any verb.'));
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
    h('p', {}, `${remaining} card${remaining === 1 ? '' : 's'} left`),
    h('h2', {}, spec.prompt),
    input,
    accentRow,
    feedback,
    actions,
  ].filter(Boolean));

  container.append(form);
  input.focus();
}

function runDrill(container, verbs, deck, extraNew, onBack) {
  clear(container);
  container.append(h('p', {}, h('button', { type: 'button', onclick: onBack }, '← Back to exercises')));
  const settings = getSettings();
  const queue = buildQueue(deck, settings, extraNew);
  const session = h('div', { class: 'drill' });
  container.append(session);
  renderCard(session, queue, 0, verbs, () => {});
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

  container.append(
    h('p', {}, 'The same fixed 50 verbs as always: no modules to unlock here, just a few kinds of practice, plus Browse for reference.'),
    h('div', { class: 'button-row' }, h('button', {
      type: 'button',
      onclick: () => runDrill(container, verbs, deck, 0, backHere),
    }, "Start today's session (all verbs, mixed)")),
  );

  for (const ex of exercises) {
    if (ex.cards.length === 0) continue;
    const stats = statsFor(idsOf(ex.cards), t);
    // native Element.append coerces a null argument to the text "null"
    // instead of skipping it, unlike this file's h() helper — filter first.
    container.append(...[
      h('h3', {}, ex.label),
      h('p', { class: 'gloss' }, statLine(stats)),
      h('div', { class: 'button-row' }, [
        h('button', { type: 'button', onclick: () => runDrill(container, verbs, ex.cards, 0, backHere) }, "Continue today's session"),
        h('button', { type: 'button', onclick: () => runDrill(container, verbs, ex.cards, PRACTICE_MORE_BATCH, backHere) }, `Practice ${PRACTICE_MORE_BATCH} more today`),
      ]),
      EXERCISE_NOTES[ex.id] ? h('p', { class: 'gloss' }, EXERCISE_NOTES[ex.id]) : null,
    ].filter(Boolean));
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
