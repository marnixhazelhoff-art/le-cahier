export const SUBJECTS = ['je', 'tu', 'il', 'nous', 'vous', 'ils'];

export const IMPARFAIT_ENDINGS = ['ais', 'ais', 'ait', 'ions', 'iez', 'aient'];
export const FUTUR_ENDINGS = ['ai', 'as', 'a', 'ons', 'ez', 'ont'];

export const CORE_TENSES = ['present', 'imparfait', 'futur', 'passe-compose'];
export const ALL_TENSES = [...CORE_TENSES, 'conditionnel'];

// Auxiliary present tense is grammatical machinery every compound tense needs,
// not per-verb study data (avoir/être are drilled separately as vocabulary).
const AVOIR_PRESENT = ['ai', 'as', 'a', 'avons', 'avez', 'ont'];
const ETRE_PRESENT = ['suis', 'es', 'est', 'sommes', 'êtes', 'sont'];

// être agrees with the subject in gender and number. The learner sees the
// rule, not one arbitrarily chosen gender: je suis allé(e), nous sommes allé(e)s.
const AGREEMENT_SUFFIX = ['(e)', '(e)', '(e)', '(e)s', '(e)(s)', '(e)s'];

const VOWEL_OR_MUTE_H = /^[aeiouyâàéèêëîïôûùh]/i;

function fixStem(stem, ending) {
  // The nous-form guard (soft g's e, soft c's cedilla) exists only to protect
  // the sound before a/o. Before an i-initial ending the guard is redundant
  // and must be dropped: mange+ions -> mangions, not mangeions.
  if (!ending.startsWith('i')) return stem;
  if (stem.endsWith('ge')) return stem.slice(0, -1);
  if (stem.endsWith('ç')) return stem.slice(0, -1) + 'c';
  return stem;
}

function imparfaitStem(verb) {
  if (verb.imperfectStem) return verb.imperfectStem;
  const nous = verb.present[3];
  if (nous) return nous.replace(/ons$/, '');
  // Impersonal verbs have no nous form to derive from (falloir: il faut).
  // The participle is the only remaining source for the stem: fallu -> fall-.
  return verb.participle.replace(/[aeiouéèêîï]+$/i, '');
}

function buildFromStemAndEndings(stem, endings, verb) {
  return endings.map((ending, i) => {
    if (verb.impersonal && i !== 2) return null;
    return fixStem(stem, ending) + ending;
  });
}

export function conjugate(verb, tense) {
  switch (tense) {
    case 'present':
      return verb.present;
    case 'imparfait':
      return buildFromStemAndEndings(imparfaitStem(verb), IMPARFAIT_ENDINGS, verb);
    case 'futur':
      return buildFromStemAndEndings(verb.futureStem, FUTUR_ENDINGS, verb);
    case 'conditionnel':
      return buildFromStemAndEndings(verb.futureStem, IMPARFAIT_ENDINGS, verb);
    case 'passe-compose': {
      const auxPresent = verb.aux === 'être' ? ETRE_PRESENT : AVOIR_PRESENT;
      return auxPresent.map((aux, i) => {
        if (verb.impersonal && i !== 2) return null;
        const suffix = verb.aux === 'être' ? AGREEMENT_SUFFIX[i] : '';
        return `${aux} ${verb.participle}${suffix}`;
      });
    }
    default:
      throw new Error(`Unknown tense: ${tense}`);
  }
}

export function fullTable(verb, tenses = CORE_TENSES) {
  const table = {};
  for (const tense of tenses) {
    table[tense] = conjugate(verb, tense);
  }
  return table;
}

function longestCommonPrefix(strings) {
  if (strings.length === 0) return '';
  let prefix = strings[0];
  for (const s of strings.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < s.length && prefix[i] === s[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix;
}

export function splitEnding(form, tense, verb) {
  if (tense === 'passe-compose') {
    const space = form.indexOf(' ');
    return [form.slice(0, space), form.slice(space + 1)];
  }
  if (tense === 'present') {
    const prefix = longestCommonPrefix(verb.present.filter(Boolean));
    return [prefix, form.slice(prefix.length)];
  }
  const endings = tense === 'futur' ? FUTUR_ENDINGS : IMPARFAIT_ENDINGS;
  const ending = [...endings].sort((a, b) => b.length - a.length).find((e) => form.endsWith(e));
  return ending ? [form.slice(0, -ending.length), ending] : [form, ''];
}

export function subject(person, form) {
  const index = typeof person === 'number' ? person : SUBJECTS.indexOf(person);
  const base = SUBJECTS[index];
  if (base === 'je' && form && VOWEL_OR_MUTE_H.test(form)) {
    return "j'";
  }
  return base + ' ';
}
