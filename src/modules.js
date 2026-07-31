// Groups each mode's deck into practiceable sub-units: fixed 50-word
// frequency blocks for vocabulary, the card kinds verb-cards.js already
// produces for verbs, and the five BRIEF section 9 contrast categories for
// chooser. Grouping is always a static fact about the content itself, never
// about how or when a card was practiced, so a module stays correct whether
// its cards were last reviewed here or from a random/mixed session.
//
// statsFor reuses deck-stats.js's tally/withState, so a module or exercise
// tile can never disagree with what Home or Progress already show for the
// same cards.
import { tally, withState } from './deck-stats.js';

export const VOCAB_MODULE_SIZE = 50;

export function vocabModuleId(rank) {
  return Math.floor((rank - 1) / VOCAB_MODULE_SIZE) + 1;
}

// New words still enter the deck one at a time, in rank order, exactly as
// before (section 8.7). A module is only ever a window onto that same
// frequency-ordered queue, never a way to pick words out of order — it just
// fills in as the existing queue reaches it.
export function groupVocabModules(vocab, vocabCards) {
  const cardsByLemma = new Map();
  for (const card of vocabCards) {
    if (!cardsByLemma.has(card.lemma)) cardsByLemma.set(card.lemma, []);
    cardsByLemma.get(card.lemma).push(card);
  }

  const byModule = new Map();
  for (const entry of vocab) {
    const id = vocabModuleId(entry.rank);
    if (!byModule.has(id)) byModule.set(id, []);
    byModule.get(id).push(entry);
  }

  return [...byModule.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, rawEntries]) => {
      const entries = rawEntries.sort((a, b) => a.rank - b.rank);
      const cardsOfKind = (kind) => entries.flatMap(
        (e) => (cardsByLemma.get(e.fr) ?? []).filter((c) => c.kind === kind)
      );
      return {
        id,
        rankStart: (id - 1) * VOCAB_MODULE_SIZE + 1,
        rankEnd: id * VOCAB_MODULE_SIZE,
        entries,
        recallCards: cardsOfKind('recall'),
        produceCards: cardsOfKind('produce'),
      };
    });
}

const VERB_EXERCISE_IDS = ['present', 'passe-compose', 'futur', 'imparfait'];

const VERB_EXERCISE_LABELS = {
  present: 'Present',
  'passe-compose': 'Passé composé',
  futur: 'Futur simple',
  imparfait: 'Imparfait',
};

function verbExerciseId(cardKind) {
  if (cardKind === 'present-stem' || cardKind === 'present-pattern') return 'present';
  if (cardKind === 'passe-compose-produce') return 'passe-compose';
  if (cardKind === 'futur-stem') return 'futur';
  if (cardKind === 'imparfait-rule') return 'imparfait';
  return null;
}

// Verbs are a fixed 50-verb set, never modules to unlock. The "exercises"
// are just the card kinds buildVerbCardDeck already produces, grouped here
// for display and for filtering a drill session to one of them.
export function groupVerbExercises(verbCards) {
  const byId = new Map(VERB_EXERCISE_IDS.map((id) => [id, []]));
  for (const card of verbCards) {
    const id = verbExerciseId(card.kind);
    if (id) byId.get(id).push(card);
  }
  return VERB_EXERCISE_IDS.map((id) => ({ id, label: VERB_EXERCISE_LABELS[id], cards: byId.get(id) }));
}

// The five BRIEF section 9 contrast types (background/habit/state/duration/
// meaning) are all still imparfait-vs-passé-composé to a learner picking a
// category to practice — they exist as separate tags for generation
// coverage, not as separate skills, so they group into one category here.
const TENSE_CATEGORIES = new Set(['background', 'habit', 'state', 'duration', 'meaning']);

const CHOOSER_CATEGORY_LABELS = {
  tense: 'Imparfait vs passé composé',
  agreement: 'Adjective agreement',
  confusable: 'Best word fits',
};

export function groupChooserCategories(chooser) {
  const byCategory = new Map();
  for (const item of chooser) {
    const raw = item.category ?? 'other';
    const category = TENSE_CATEGORIES.has(raw) ? 'tense' : raw;
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(item);
  }
  return [...byCategory.entries()].map(([id, items]) => ({
    id,
    label: CHOOSER_CATEGORY_LABELS[id] ?? id,
    items,
    ids: items.map((item) => `ch:${item.id}`),
  }));
}

export function idsOf(cards) {
  return cards.map((c) => c.id);
}

// Coverage, not completion: nothing here is ever "done". The counts move in
// both directions for as long as the cards stay in use.
export function statsFor(ids, day) {
  return tally(withState(ids), day);
}

// The ladder from BRIEF.md section 8.2: 2, 5, 12, 30, 75, 180 days. A card's
// interval rarely lands exactly on a rung once ease has moved it, so this
// buckets by the highest rung reached so far, same idea as "learned" already
// meaning interval >= 30 rather than interval === 30.
export const INTERVAL_RUNGS = [2, 5, 12, 30, 75, 180];

export function intervalBuckets(ids, getCard) {
  const counts = { new: 0 };
  for (const rung of INTERVAL_RUNGS) counts[rung] = 0;
  for (const id of ids) {
    const card = getCard(id);
    if (!card || card.state === 'new') {
      counts.new += 1;
      continue;
    }
    let rung = INTERVAL_RUNGS[0];
    for (const r of INTERVAL_RUNGS) {
      if (card.interval >= r) rung = r;
    }
    counts[rung] += 1;
  }
  return counts;
}
