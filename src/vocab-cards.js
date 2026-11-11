// Builds the vocabulary card deck from data/vocab.json. Nouns are always
// drilled with the article attached (section 5.2) since gender learned as a
// separate fact does not survive contact with speech.
function surfaceForm(entry) {
  return entry.pos === 'noun' && entry.article ? `${entry.article} ${entry.fr}` : entry.fr;
}

// le/un and la/une are both correct as long as the gender is: definite vs
// indefinite is a real but separate choice from the fact this drill is
// actually testing. Grading only the stored article as correct meant typing
// "un cinéma" for "le cinéma" failed despite the gender being right.
//
// l' is never stored (data/vocab.json only ever holds le/la/un/une): real
// elision hides the gender it takes a beginner years to stop needing to see,
// so every vowel-initial noun is kept as "le hôpital"/"une eau" here even
// though no French speaker would ever write it that way.
const ARTICLE_SWAP = { le: 'un', un: 'le', la: 'une', une: 'la' };

function alternateArticle(entry) {
  return ARTICLE_SWAP[entry.article] ?? null;
}

function producibleForms(entry) {
  const form = surfaceForm(entry);
  if (entry.pos !== 'noun') return [form];
  const alt = alternateArticle(entry);
  return alt ? [form, `${alt} ${entry.fr}`] : [form];
}

// A handful of Dutch glosses are shared by two entries (an/année both gloss
// "jaar"). Without a hint the produce prompt gives no way to know which
// French word is wanted, so those entries carry a short promptHint to show
// alongside the gloss.
function producePrompt(entry) {
  return entry.promptHint ? `${entry.nl} (${entry.promptHint})` : entry.nl;
}

// One Dutch sense, split into a base, an optional qualifier and whether it
// carries a noun article: "de bank (geld)" becomes
// { base: 'bank', qualifier: 'geld', noun: true }. Every Dutch noun gloss
// carries de/het, so the article tells "het gelijk" (raison) apart from the
// adjective "gelijk" (égal).
function parseSense(raw) {
  const text = raw.trim().toLowerCase();
  const match = text.match(/\(([^)]*)\)/);
  const qualifier = match ? match[1].trim() : null;
  const stripped = text.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const noun = /^(de|het)\s/.test(stripped);
  const base = stripped.replace(/^(de|het|een)\s+/, '').trim();
  return { base, qualifier, noun };
}

function sensesOf(entry) {
  return String(entry.nl).split(/[,;]/).map(parseSense).filter((s) => s.base);
}

// A register qualifier says how a word sounds, not what it means.
const REGISTER = new Set(['informeel', 'formeel', 'spreektaal', 'plat']);

function meaningQualifier(sense) {
  return sense.qualifier && !REGISTER.has(sense.qualifier) ? sense.qualifier : null;
}

// Same base, same word class and the same meaning qualifier. "de bank
// (geld)" and "de bank" (the sofa) are different words that share a Dutch
// spelling; "de vrouw" and "de vrouw (informeel)" are real synonyms.
function sameSense(a, b) {
  return a.base === b.base && a.noun === b.noun && meaningQualifier(a) === meaningQualifier(b);
}

// For every entry, the French forms of the other entries that share at least
// one Dutch sense with it. A produce card uses this to tell a wrong answer
// apart from a right word in another context: difficile for "hard, moeilijk"
// (which wants dur) is not a mistake.
function synonymForms(sorted) {
  const senses = sorted.map(sensesOf);
  const byBase = new Map();
  senses.forEach((list, i) => {
    for (const sense of list) {
      if (!byBase.has(sense.base)) byBase.set(sense.base, []);
      byBase.get(sense.base).push(i);
    }
  });

  return sorted.map((entry, i) => {
    const others = new Set();
    for (const sense of senses[i]) {
      for (const j of byBase.get(sense.base)) {
        if (j === i || others.has(j)) continue;
        if (senses[j].some((other) => sameSense(sense, other))) others.add(j);
      }
    }
    const own = new Set(producibleForms(entry));
    return [...others]
      .flatMap((j) => producibleForms(sorted[j]))
      .filter((form) => !own.has(form));
  });
}

export function buildVocabCardDeck(vocab) {
  const sorted = [...vocab].sort((a, b) => a.rank - b.rank);
  const synonyms = synonymForms(sorted);
  const cards = [];

  sorted.forEach((entry, i) => {
    const form = surfaceForm(entry);
    const recallId = `v:${entry.fr}:recall`;

    cards.push({
      id: recallId,
      kind: 'recall',
      lemma: entry.fr,
      familiar: entry.familiar,
      prompt: form,
      answer: entry.nl,
      example: entry.example,
      exampleNl: entry.exampleNl,
      falseFriend: entry.falseFriend,
      note: entry.note,
    });

    cards.push({
      id: `v:${entry.fr}:produce`,
      kind: 'produce',
      lemma: entry.fr,
      familiar: entry.familiar,
      requiresCardId: recallId,
      prompt: producePrompt(entry),
      expected: producibleForms(entry),
      synonyms: synonyms[i],
      example: entry.example,
      exampleNl: entry.exampleNl,
      note: entry.note,
    });
  });

  return cards;
}
