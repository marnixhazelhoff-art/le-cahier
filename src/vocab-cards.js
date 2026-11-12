// Builds the vocabulary card deck from data/vocab.json. Nouns are always
// drilled with the article attached (section 5.2) since gender learned as a
// separate fact does not survive contact with speech.
import { conjugate, subject } from './conjugate.js';

// The key a word's cards hang off. A verb gets its own, because several
// infinitives are also nouns already in the bank (le devoir, le pouvoir, le
// savoir) and the two must never share progress.
export function entryKey(entry) {
  return entry.pos === 'verb' ? `${entry.fr}_verb` : entry.fr;
}

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
  const verb = entry.pos === 'verb';
  return String(entry.nl).split(/[,;]/).map(parseSense).filter((s) => s.base)
    .map((s) => ({ ...s, verb }));
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
  return a.base === b.base && a.noun === b.noun && a.verb === b.verb
    && meaningQualifier(a) === meaningQualifier(b);
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

// --- Verbs -------------------------------------------------------------------
//
// A vocabulary verb carries the same conjugation data data/verbs.json uses
// (entry.verb), so every form comes from src/conjugate.js. The Dutch side of
// each tense (entry.nlForms) is written by scripts/enrich.mjs.

const TENSE_LABELS = { 'passe-compose': 'passé composé', futur: 'futur', imparfait: 'imparfait' };
const NL_FORM_KEYS = { 'passe-compose': 'pc', futur: 'futur', imparfait: 'imparfait' };

// je, or il for a verb that only has a third person (il faut, il pleut) or is
// almost only used in it (ça coûte, ça dure: verb.thirdPerson, whose Dutch
// forms are "het kost" rather than "ik kost").
function personOf(verb) {
  return verb.impersonal || verb.thirdPerson ? 2 : 0;
}

// One tense, with its subject: the form to show and every form to accept.
// conjugate() marks être agreement as "(e)" for display; both genders are
// accepted when grading. A thirdPerson verb also accepts ça, which is how
// "het kost" is usually said.
function tenseForms(verb, tense) {
  const person = personOf(verb);
  const form = conjugate(verb, tense)[person];
  const firstWord = form.split(' ')[0];
  const display = `${subject(person, firstWord)}${form}`;
  const genders = display.includes('(e)')
    ? [display.replace('(e)', ''), display.replace('(e)', 'e')]
    : [display];
  const accepted = verb.thirdPerson && !verb.impersonal
    ? [...genders, ...genders.map((f) => f.replace(/^il /, 'ça '))]
    : genders;
  return { display, accepted };
}

// Shown with the answer on a verb's recall card: what kind of verb it is and
// its three tenses. Information only, never graded.
function verbInfo(verb) {
  const kind = verb.irregular ? 'Irregular' : 'Regular';
  const tenses = ['passe-compose', 'futur', 'imparfait']
    .map((tense) => `${TENSE_LABELS[tense]}: ${tenseForms(verb, tense).display}`);
  return [kind, ...tenses].join(' · ');
}

// Writing cards per tense. Irregular verbs get all three; a regular verb
// only gets the passé composé, where the avoir/être choice lives, because
// its futur and imparfait follow the rule with nothing new to learn. The
// 50 verbs of data/verbs.json get none: Verbs mode already drills them.
function tensesToDrill(entry) {
  if (entry.verb.inVerbsMode) return [];
  return entry.verb.irregular ? ['passe-compose', 'futur', 'imparfait'] : ['passe-compose'];
}

export function buildVocabCardDeck(vocab) {
  const sorted = [...vocab].sort((a, b) => a.rank - b.rank);
  const synonyms = synonymForms(sorted);
  const cards = [];

  sorted.forEach((entry, i) => {
    const key = entryKey(entry);
    const form = surfaceForm(entry);
    const recallId = `v:${key}:recall`;
    const produceId = `v:${key}:produce`;
    const isVerb = entry.pos === 'verb' && entry.verb;

    cards.push({
      id: recallId,
      kind: 'recall',
      lemma: key,
      familiar: entry.familiar,
      prompt: form,
      answer: entry.nl,
      verbInfo: isVerb ? verbInfo(entry.verb) : null,
      example: entry.example,
      exampleNl: entry.exampleNl,
      falseFriend: entry.falseFriend,
      note: entry.note,
    });

    cards.push({
      id: produceId,
      kind: 'produce',
      lemma: key,
      familiar: entry.familiar,
      requiresCardId: recallId,
      prompt: producePrompt(entry),
      expected: producibleForms(entry),
      synonyms: synonyms[i],
      example: entry.example,
      exampleNl: entry.exampleNl,
      note: entry.note,
    });

    if (!isVerb) return;

    // Each tense unlocks once the infinitive writing card has matured, the
    // same staging as recall to produce, so a new verb never arrives as four
    // cards at once.
    for (const tense of tensesToDrill(entry)) {
      const { display, accepted } = tenseForms(entry.verb, tense);
      cards.push({
        id: `v:${key}:${tense}`,
        kind: 'produce',
        tense,
        lemma: key,
        familiar: false,
        requiresCardId: produceId,
        prompt: `${entry.nlForms[NL_FORM_KEYS[tense]]} (${TENSE_LABELS[tense]})`,
        expected: accepted,
        display,
        synonyms: [],
        example: null,
        exampleNl: null,
        note: null,
      });
    }
  });

  return cards;
}
