import { newCard, grade } from '../scheduler.js';
import { gradeAnswer } from '../grade.js';
import { getCard, putCard, getSettings, recordReview, newCardAllowance } from '../store.js';
import { buildVocabCardDeck } from '../vocab-cards.js';
import { groupVocabModules, statsFor, idsOf } from '../modules.js';
import { h, clear, shuffle } from '../dom.js';
import { speak } from '../tts.js';
import { attachAccentHelper } from '../accent-helper.js';

const PRODUCE_UNLOCK_INTERVAL = 21;
const PRACTICE_MORE_BATCH = 10;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function cardState(spec) {
  return getCard(spec.id) ?? newCard(spec.id, { familiar: spec.familiar });
}

function buildQueue(deck, settings, extraNew = 0) {
  const byId = new Map(deck.map((spec) => [spec.id, spec]));
  const withState = deck.map((spec) => ({ spec, card: cardState(spec) }));

  const due = withState.filter((c) => c.card.state !== 'new' && c.card.due <= today());

  // Deck order is rank order, and filter preserves it, so slicing takes the
  // most frequent unseen words. Do not sort this: sorting by lemma introduces
  // words alphabetically, which is exactly the grouping section 8.7 forbids.
  // extraNew only ever widens today's allowance for this one session build;
  // it never touches the stored daily setting.
  const newRecall = withState
    .filter((c) => c.spec.kind === 'recall' && c.card.state === 'new')
    .slice(0, newCardAllowance('vocab', settings.newCardsPerDay + extraNew));

  // Production unlocks once the matching receptive card has matured to a
  // 21+ day interval (section 8.5) — not gated by the daily new-word cap,
  // since it is not a new word, just a harder stage of one already known.
  const newProduce = withState.filter((c) => {
    if (c.spec.kind !== 'produce' || c.card.state !== 'new') return false;
    const recall = getCard(c.spec.requiresCardId);
    return recall && recall.interval >= PRODUCE_UNLOCK_INTERVAL;
  });

  return { queue: [...shuffle(due), ...shuffle([...newRecall, ...newProduce])], byId };
}

function renderRecallCard(container, spec, card, onGraded) {
  const revealed = h('div', {});
  const showButton = h('button', { type: 'button' }, 'Show answer');
  const playButton = h('button', { type: 'button', onclick: () => speak(spec.prompt) }, 'Play');

  const actions = h('div', { class: 'actions' }, showButton);
  showButton.addEventListener('click', () => {
    clear(revealed);
    // native Element.append coerces null/undefined arguments to the text
    // "null" instead of skipping them, unlike this file's h() helper — filter first.
    revealed.append(...[
      h('p', { class: 'correct' }, spec.answer),
      spec.example ? h('p', { class: 'mono' }, spec.example) : null,
      spec.exampleNl ? h('p', { class: 'mono gloss' }, spec.exampleNl) : null,
      spec.falseFriend ? h('p', {}, `Let op: ${spec.falseFriend}`) : null,
      spec.note ? h('p', {}, spec.note) : null,
    ].filter(Boolean));
    clear(actions);
    actions.append(
      h('button', { type: 'button', onclick: () => onGraded('again') }, 'Again'),
      h('button', { type: 'button', onclick: () => onGraded('good') }, 'Good'),
      h('button', { type: 'button', onclick: () => onGraded('easy') }, 'Easy'),
    );
  });

  container.append(
    h('h2', {}, spec.prompt),
    playButton,
    revealed,
    actions,
  );
}

function renderProduceCard(container, spec, card, onGraded) {
  const input = h('input', {
    type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    'aria-label': 'Type the French word, with its article if it is a noun',
  });
  const feedback = h('div', { class: 'feedback' });
  const actions = h('div', { class: 'actions' }, h('button', { type: 'submit' }, 'Check'));

  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const typed = input.value;
      if (!typed.trim()) return;
      const result = gradeAnswer(typed, spec.expected);
      speak(spec.expected);
      input.disabled = true;
      clear(feedback);
      feedback.append(
        h('p', { class: result.grade === 'again' ? 'incorrect' : 'correct' },
          result.grade === 'good' ? 'Correct.' : `${spec.expected}`),
      );
      if (spec.note) feedback.append(h('p', {}, spec.note));
      const next = h('button', { type: 'button', onclick: () => onGraded(result.grade) }, 'Next');
      clear(actions);
      actions.append(next);
      next.focus();
    },
  });

  const accentRow = attachAccentHelper(input);
  form.append(...[
    h('h2', {}, spec.prompt),
    input,
    accentRow,
    feedback,
    actions,
  ].filter(Boolean));
  container.append(form);
  input.focus();
}

function renderCard(container, queue, index, mode, onDone) {
  clear(container);

  if (index >= queue.length) {
    container.append(h('p', {}, 'Session complete for today. Come back tomorrow for more.'));
    onDone();
    return;
  }

  const { spec, card } = queue[index];
  const remaining = queue.length - index;
  const body = h('div', {});
  container.append(h('p', {}, `${remaining} card${remaining === 1 ? '' : 's'} left`), body);

  const onGraded = (outcome) => {
    const graded = grade(card, outcome);
    putCard(graded);
    // card is the pre-grade state, so reps 0 means this review introduced it.
    recordReview('vocab', outcome, { introduced: card.reps === 0 });
    renderCard(container, queue, index + 1, mode, onDone);
  };

  if (spec.kind === 'recall') renderRecallCard(body, spec, card, onGraded);
  else renderProduceCard(body, spec, card, onGraded);
}

function runSession(container, deck, extraNew, onBack) {
  clear(container);
  if (onBack) container.append(h('p', {}, h('button', { type: 'button', onclick: onBack }, '← Back')));
  const settings = getSettings();
  const { queue } = buildQueue(deck, settings, extraNew);
  const session = h('div', { class: 'drill' });
  container.append(session);
  renderCard(session, queue, 0, 'vocab', () => {});
}

function statLine(stats) {
  const introduced = stats.total - stats.states.new;
  const parts = [`${introduced}/${stats.total} introduced`];
  if (stats.due) parts.push(`${stats.due} due today`);
  if (stats.states.learned) parts.push(`${stats.states.learned} learned`);
  if (stats.states.leech) parts.push(`${stats.states.leech} leech${stats.states.leech === 1 ? '' : 'es'}`);
  return parts.join(', ');
}

function exerciseTile({ title, stats, note, onStart }) {
  return h('div', {}, [
    h('h3', {}, title),
    h('p', { class: 'gloss' }, statLine(stats)),
    h('div', { class: 'button-row' }, [
      h('button', { type: 'button', onclick: () => onStart(0) }, "Continue today's session"),
      h('button', { type: 'button', onclick: () => onStart(PRACTICE_MORE_BATCH) }, `Practice ${PRACTICE_MORE_BATCH} more today`),
    ]),
    note ? h('p', { class: 'gloss' }, note) : null,
  ].filter(Boolean));
}

function table(head, rows) {
  return h('div', { class: 'paradigm-table' },
    h('table', {}, [
      h('thead', {}, h('tr', {}, head.map((label) => h('th', {}, label)))),
      h('tbody', {}, rows.map((cells) => h('tr', {},
        cells.map((cell, i) => (i === 0 ? h('th', {}, cell) : h('td', {}, cell)))))),
    ]));
}

function renderModuleDetail(container, vocab, moduleId, onBack) {
  const allDeck = buildVocabCardDeck(vocab);
  const modules = groupVocabModules(vocab, allDeck);
  const mod = modules.find((m) => m.id === moduleId);

  function showOverview() {
    clear(container);
    const t = today();
    container.append(
      h('p', {}, h('button', { type: 'button', onclick: onBack }, '← Vocabulary modules')),
      h('h1', {}, `Module ${mod.id}: ranks ${mod.rankStart}–${mod.rankEnd}`),
      exerciseTile({
        title: 'Receptive: see French, know the Dutch',
        stats: statsFor(idsOf(mod.recallCards), t),
        onStart: (extra) => runSession(container, mod.recallCards, extra, showOverview),
      }),
      exerciseTile({
        title: 'Productive: see Dutch, write the French',
        stats: statsFor(idsOf(mod.produceCards), t),
        note: 'Unlocks per word once its receptive card reaches a 21-day interval. Production is roughly three times harder than recognition, so it trails behind word by word, not module by module.',
        onStart: (extra) => runSession(container, mod.produceCards, extra, showOverview),
      }),
      h('p', { class: 'gloss' }, "Finishing this module once does not mark it done. These words stay in rotation like everything else: the counts above keep moving, in both directions, for as long as you use the app."),
    );
  }

  showOverview();
}

function renderModuleList(container, vocab, onOpenModule) {
  const deck = buildVocabCardDeck(vocab);
  const modules = groupVocabModules(vocab, deck);
  const t = today();

  container.append(h('p', {}, `${vocab.length} words banked so far. Modules are fixed 50-word blocks in frequency order: a module only fills in as the words before it are already in your deck. New words still enter one at a time, in rank order, same as always.`));

  const rows = modules.map((mod) => {
    const stats = statsFor(idsOf(mod.recallCards), t);
    const introduced = stats.total - stats.states.new;
    return [
      h('button', { type: 'button', onclick: () => onOpenModule(mod.id) }, `Module ${mod.id}`),
      `${mod.rankStart}–${mod.rankEnd}`,
      introduced > 0 ? `${introduced}/${stats.total}` : 'not reached yet',
      String(stats.due),
      String(stats.states.learned),
    ];
  });

  container.append(table(['Module', 'Ranks', 'Introduced', 'Due', 'Learned'], rows));
}

export function renderVocabView(container, { vocab }) {
  clear(container);
  container.append(h('h1', {}, 'Vocabulary'));

  if (!vocab || vocab.length === 0) {
    container.append(h('p', {}, 'The word list is built next, from Lexique frequency data plus Dutch glosses. Once it exists, receptive and productive drilling appears here.'));
    return;
  }

  const tabs = h('div', { class: 'subtabs' });
  const body = h('div', {});

  const showToday = () => runSession(body, buildVocabCardDeck(vocab), 0, null);
  const showModuleList = () => { clear(body); renderModuleList(body, vocab, showModule); };
  const showModule = (moduleId) => { clear(body); renderModuleDetail(body, vocab, moduleId, showModuleList); };

  tabs.append(
    h('button', { type: 'button', onclick: showToday }, "Today's session"),
    h('button', { type: 'button', onclick: showModuleList }, 'Modules'),
  );

  container.append(tabs, body);
  showToday();
}
