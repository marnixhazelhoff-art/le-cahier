import { newCard, grade, PRODUCE_UNLOCK_INTERVAL } from '../scheduler.js';
import { gradeAnswer } from '../grade.js';
import { getCard, putCard, recordReview } from '../store.js';
import { buildVocabCardDeck } from '../vocab-cards.js';
import { groupVocabModules, statsFor, idsOf, intervalBuckets, produceBuckets, INTERVAL_RUNGS } from '../modules.js';
import { h, clear, shuffle } from '../dom.js';
import { speak } from '../tts.js';
import { attachAccentHelper } from '../accent-helper.js';

const BATCH_SIZE = 10;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function cardState(spec) {
  return getCard(spec.id) ?? newCard(spec.id, { familiar: spec.familiar });
}

// Everything due, plus everything not yet seen (recall always, produce only
// once its matching receptive card has matured to PRODUCE_UNLOCK_INTERVAL
// days, section 8.5). No daily cap: practicing a deck to the end just means
// nothing here is eligible again until a due date or an unlock genuinely
// arrives tomorrow.
function eligiblePool(deck) {
  const t = today();
  return deck
    .map((spec) => ({ spec, card: cardState(spec) }))
    .filter(({ spec, card }) => {
      if (card.state !== 'new') return card.due <= t;
      if (spec.kind !== 'produce') return true;
      const recall = getCard(spec.requiresCardId);
      return recall && recall.interval >= PRODUCE_UNLOCK_INTERVAL;
    });
}

// Shuffling the whole eligible pool before slicing would let the batch pick
// *any* new word, not just the next ones in line — silently breaking the
// frequency-order rule (section 8.7) the moment a session had more eligible
// words than BATCH_SIZE. Due cards are shuffled freely; the new pool is
// only ever sliced from the front, since the deck is already rank order.
// The combined result is shuffled once more purely for presentation.
function nextBatch(deck) {
  const t = today();
  const withState = deck.map((spec) => ({ spec, card: cardState(spec) }));
  const due = withState.filter(({ card }) => card.state !== 'new' && card.due <= t);
  const newEligible = withState.filter(({ spec, card }) => {
    if (card.state !== 'new') return false;
    if (spec.kind !== 'produce') return true;
    const recall = getCard(spec.requiresCardId);
    return recall && recall.interval >= PRODUCE_UNLOCK_INTERVAL;
  });
  const duePicked = due.slice(0, BATCH_SIZE);
  const newPicked = newEligible.slice(0, Math.max(0, BATCH_SIZE - duePicked.length));
  return shuffle([...duePicked, ...newPicked]);
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
      // expected is usually one string, but a noun accepts two articles for
      // the same gender (le cinéma / un cinéma) — speak and show the first.
      const spoken = Array.isArray(spec.expected) ? spec.expected[0] : spec.expected;
      speak(spoken);
      input.disabled = true;
      clear(feedback);
      feedback.append(
        h('p', { class: result.grade === 'again' ? 'incorrect' : 'correct' },
          result.grade === 'good' ? 'Correct.' : spoken),
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

// index >= queue.length just means this batch is done; the caller (runLoop)
// decides what that means (more available, or nothing left today).
function renderCard(container, queue, index, mode, onDone) {
  clear(container);

  if (index >= queue.length) {
    onDone();
    return;
  }

  const { spec, card } = queue[index];
  const remaining = queue.length - index;
  const body = h('div', {});
  container.append(h('p', {}, `${remaining} card${remaining === 1 ? '' : 's'} left in this batch`), body);

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

function showExhausted(container, onBack) {
  clear(container);
  container.append(...[
    h('p', {}, 'Nothing left here for today. Come back tomorrow, or try something else.'),
    onBack ? h('div', { class: 'button-row' }, h('button', { type: 'button', onclick: onBack }, '← Back')) : null,
  ].filter(Boolean));
}

function runLoop(container, deck, onBack) {
  const batch = nextBatch(deck);
  if (batch.length === 0) { showExhausted(container, onBack); return; }

  clear(container);
  const session = h('div', { class: 'drill' });
  container.append(session);
  renderCard(session, batch, 0, 'vocab', () => {
    const remaining = eligiblePool(deck).length;
    clear(container);
    if (remaining === 0) { showExhausted(container, onBack); return; }
    container.append(...[
      h('p', {}, 'Batch done.'),
      h('div', { class: 'button-row' }, [
        h('button', {
          type: 'button',
          onclick: () => runLoop(container, deck, onBack),
        }, `Practice ${Math.min(BATCH_SIZE, remaining)} more`),
        onBack ? h('button', { type: 'button', onclick: onBack }, '← Back') : null,
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

// Appends directly to container (rather than returning a wrapped node) so
// each tile's h3 is a plain sibling of the others: CSS :first-of-type then
// correctly finds the one true first heading on the page, not one per tile.
function exerciseTile(container, { title, deck, onBack }) {
  const stats = statsFor(idsOf(deck), today());
  const remaining = eligiblePool(deck).length;

  container.append(
    h('h3', {}, title),
    h('p', { class: 'gloss' }, statLine(stats)),
    remaining > 0
      ? h('div', { class: 'button-row' }, h('button', {
        type: 'button',
        onclick: () => runLoop(container, deck, onBack),
      }, `Practice ${Math.min(BATCH_SIZE, remaining)}`))
      : h('p', { class: 'gloss' }, 'Nothing to practice here right now.'),
  );
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
    container.append(
      h('p', {}, h('button', { type: 'button', onclick: onBack }, '← Vocabulary modules')),
      h('h1', {}, `Module ${mod.id}: ranks ${mod.rankStart}–${mod.rankEnd}`),
    );
    exerciseTile(container, {
      title: 'Receptive: see French, know the Dutch',
      deck: mod.recallCards,
      onBack: showOverview,
    });
    exerciseTile(container, {
      title: 'Productive: see Dutch, write the French',
      deck: mod.produceCards,
      onBack: showOverview,
    });
  }

  showOverview();
}

function renderModuleList(container, vocab, onOpenModule) {
  const deck = buildVocabCardDeck(vocab);
  const modules = groupVocabModules(vocab, deck);
  const t = today();

  const recallIds = deck.filter((c) => c.kind === 'recall').map((c) => c.id);
  const produceSpecs = deck.filter((c) => c.kind === 'produce');
  const recall = intervalBuckets(recallIds, getCard);
  const produce = produceBuckets(produceSpecs, getCard, t);
  const recallDue = statsFor(recallIds, t).due;

  container.append(
    h('h2', {}, 'Where your words are'),
    table(
      ['', 'Locked', 'New', 'Due', ...INTERVAL_RUNGS.map((r) => `${r}d`)],
      [
        ['Recall', '—', String(recall.new), String(recallDue), ...INTERVAL_RUNGS.map((r) => String(recall[r]))],
        ['Writing', String(produce.locked), String(produce.new), String(produce.due), ...INTERVAL_RUNGS.map((r) => String(produce[r]))],
      ],
    ),
  );

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

  container.append(
    h('h2', {}, 'Modules'),
    table(['Module', 'Ranks', 'Introduced', 'Due', 'Learned'], rows),
  );
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

  // The tab bar above stays the way back out, so the loop itself does not
  // need its own back button here.
  const showToday = () => { clear(body); runLoop(body, buildVocabCardDeck(vocab), null); };
  const showModuleList = () => { clear(body); renderModuleList(body, vocab, showModule); };
  const showModule = (moduleId) => { clear(body); renderModuleDetail(body, vocab, moduleId, showModuleList); };

  tabs.append(
    h('button', { type: 'button', onclick: showToday }, "Today's session"),
    h('button', { type: 'button', onclick: showModuleList }, 'Modules'),
  );

  container.append(tabs, body);
  showToday();
}
