// What is outstanding, per mode. Home and Progress both read this so they can
// never disagree about how much is left today.

import { buildVerbCardDeck } from './verb-cards.js';
import { buildVocabCardDeck } from './vocab-cards.js';
import { getCard } from './store.js';
import { newCard, isDue, today, PRODUCE_UNLOCK_INTERVAL } from './scheduler.js';

// Exported so src/modules.js can build per-module and per-exercise stats
// from the same two functions Home and Progress use, and never disagree.
export function withState(ids, familiarById = {}) {
  return ids.map((id) => getCard(id) ?? newCard(id, { familiar: familiarById[id] ?? false }));
}

export function tally(cards, day) {
  const states = { new: 0, learning: 0, review: 0, learned: 0, leech: 0 };
  let due = 0;
  for (const card of cards) {
    states[card.state] = (states[card.state] ?? 0) + 1;
    if (isDue(card, day)) due += 1;
  }
  return { total: cards.length, due, states };
}

// There is no daily cap on any mode: newAvailable is the true count of
// not-yet-introduced cards, not a preview truncated by a per-day budget.
function verbSummary(verbs, day) {
  if (!verbs || verbs.length === 0) return null;
  const cards = withState(buildVerbCardDeck(verbs).map((s) => s.id));
  const base = tally(cards, day);
  return { ...base, newAvailable: base.states.new };
}

function vocabSummary(vocab, day) {
  if (!vocab || vocab.length === 0) return null;
  const deck = buildVocabCardDeck(vocab);
  const cards = deck.map((spec) => getCard(spec.id) ?? newCard(spec.id, { familiar: spec.familiar }));
  const base = tally(cards, day);

  const newRecall = deck.filter((spec, i) => spec.kind === 'recall' && cards[i].state === 'new').length;
  // Production is gated by the 21-day unlock (section 8.5), never by a daily
  // cap: it is a harder stage of a word already known, not a new word.
  const unlockedProduce = deck.filter((spec, i) => {
    if (spec.kind !== 'produce' || cards[i].state !== 'new') return false;
    const recall = getCard(spec.requiresCardId);
    return recall && recall.interval >= PRODUCE_UNLOCK_INTERVAL;
  }).length;

  return { ...base, newAvailable: newRecall + unlockedProduce };
}

function chooserSummary(chooser, day) {
  if (!chooser || chooser.length === 0) return null;
  const cards = withState(chooser.map((item) => `ch:${item.id}`));
  const base = tally(cards, day);
  return { ...base, newAvailable: base.states.new };
}

/**
 * Returns one entry per mode that has data, each with what is left today.
 */
export function summarise({ verbs, vocab, chooser }) {
  const day = today();

  const modes = [
    { key: 'verbs', label: 'Verbs', route: '#/verbs', summary: verbSummary(verbs, day) },
    { key: 'vocab', label: 'Vocabulary', route: '#/vocab', summary: vocabSummary(vocab, day) },
    { key: 'chooser', label: 'Chooser', route: '#/chooser', summary: chooserSummary(chooser, day) },
  ];

  return modes
    .filter((m) => m.summary)
    .map((m) => ({ ...m, ...m.summary, waiting: m.summary.due + m.summary.newAvailable }));
}
