// Builds conjugation data for vocabulary verbs from Lexique 3's inflected
// rows, in the same shape data/verbs.json uses, so src/conjugate.js can
// conjugate them without a second code path. Node only, used by
// scripts/fetch-frequency.mjs and scripts/enrich.mjs.
//
// Lexique tags every inflected form with its slots (infover), for example
// "ind:fut:1s;" or "imp:pre:2p;ind:pre:2p;". A slot can have more than one
// candidate form because Lexique has the odd stray homograph (allier is
// listed as an ind:pre:2p of aller), so each slot takes its most frequent
// form.

const PERSONS = ['1s', '2s', '3s', '1p', '2p', '3p'];

// Endings a form in that person can actually have, in the tenses used here.
// Lexique mislabels a handful of rows (donnes as a nous form, porter as a
// vous form); a form whose ending is impossible for its slot is dropped.
const PERSON_ENDINGS = {
  '1s': /(s|x|e|ai)$/,
  '2s': /(s|x)$/,
  '3s': /(t|d|e|a|c|ît)$/,
  '1p': /(ons|mes)$/,
  '2p': /(ez|tes)$/,
  '3p': /(ent|ont)$/,
};

// Verbs that only exist in the third person singular. Explicit, because a
// verb like sembler or plaire shows up almost only as il semble, il plaît in
// subtitles without being impersonal.
const IMPERSONAL_VERBS = new Set(['falloir', 'pleuvoir', 'neiger', 'grêler']);

// The forms the three regular models predict, or null for an infinitive that
// fits none of them. Used only to fill slots Lexique has no row for, and only
// when every slot Lexique does have agrees with the model.
function regularModel(inf) {
  const stem = inf.slice(0, -2);
  if (inf.endsWith('er')) {
    const nous = stem.endsWith('g') ? `${stem}eons` : stem.endsWith('c') ? `${stem.slice(0, -1)}çons` : `${stem}ons`;
    const impStem = stem.endsWith('g') ? `${stem}e` : stem.endsWith('c') ? `${stem.slice(0, -1)}ç` : stem;
    return {
      present: [`${stem}e`, `${stem}es`, `${stem}e`, nous, `${stem}ez`, `${stem}ent`],
      futur1: `${inf}ai`, participle: `${stem}é`, imparfait1: `${impStem}ais`,
    };
  }
  if (inf.endsWith('ir')) {
    return {
      present: [`${stem}is`, `${stem}is`, `${stem}it`, `${stem}issons`, `${stem}issez`, `${stem}issent`],
      futur1: `${inf}ai`, participle: `${stem}i`, imparfait1: `${stem}issais`,
    };
  }
  if (inf.endsWith('re')) {
    return {
      present: [`${stem}s`, `${stem}s`, stem, `${stem}ons`, `${stem}ez`, `${stem}ent`],
      futur1: `${inf.slice(0, -1)}ai`, participle: `${stem}u`, imparfait1: `${stem}ais`,
    };
  }
  return null;
}

// Fills the gaps of a regular verb from its model. Needs at least three real
// forms as evidence, and every one of them has to match the model exactly;
// otherwise the verb stays incomplete and is left out rather than guessed.
function fillFromModel(lemma, found) {
  const model = regularModel(lemma);
  if (!model) return found;
  const pairs = [
    ...found.present.map((form, i) => [form, model.present[i]]),
    [found.futur1, model.futur1], [found.participle, model.participle], [found.imparfait1, model.imparfait1],
  ];
  const evidence = pairs.filter(([form]) => form !== null);
  if (evidence.length < 3 || !evidence.every(([form, predicted]) => form === predicted)) return found;
  return {
    present: found.present.map((form, i) => form ?? model.present[i]),
    futur1: found.futur1 ?? model.futur1,
    participle: found.participle ?? model.participle,
    imparfait1: found.imparfait1 ?? model.imparfait1,
  };
}

function pickForm(tag, candidates) {
  if (!candidates || candidates.length === 0) return null;
  const person = tag.split(':')[2];
  const pattern = PERSON_ENDINGS[person];
  const plausible = pattern ? candidates.filter((c) => pattern.test(c.form)) : candidates;
  if (plausible.length === 0) return null;
  return plausible.reduce((best, c) => (c.freq > best.freq ? c : best)).form;
}

// Intransitive verbs that build the passé composé with être. The list is a
// closed class, so it lives here rather than in a lexical database. Verbs
// like passer, monter or sortir also take avoir when they have an object;
// the être reading is the one a learner meets first.
export const ETRE_VERBS = new Set([
  'aller', 'venir', 'arriver', 'partir', 'entrer', 'sortir', 'monter',
  'descendre', 'naître', 'mourir', 'rester', 'tomber', 'retourner',
  'devenir', 'revenir', 'rentrer', 'repartir', 'ressortir', 'remonter',
  'redescendre', 'retomber', 'parvenir', 'intervenir', 'survenir',
  'redevenir', 'décéder', 'apparaître', 'disparaître',
]);

// disparaître takes avoir in modern French; apparaître takes être.
ETRE_VERBS.delete('disparaître');

/**
 * rows: parsed Lexique rows with ortho, lemme, cgram, genre, nombre,
 * freqfilms2 and infover. Returns { [infinitive]: verbData } for every
 * lemma in `lemmas` that has a complete present, a futur and a participle.
 */
export function extractVerbForms(rows, lemmas) {
  const wanted = new Set(lemmas);
  const slots = new Map(); // lemma -> Map(slot -> [{ form, freq }])

  for (const row of rows) {
    if (row.cgram !== 'VER' || !wanted.has(row.lemme)) continue;
    const freq = Number.parseFloat(row.freqfilms2) || 0;
    const tags = new Set(String(row.infover ?? '').split(';').filter(Boolean));
    if (!slots.has(row.lemme)) slots.set(row.lemme, new Map());
    const bySlot = slots.get(row.lemme);
    for (const tag of tags) {
      // The participle slot holds up to four forms (allé, allée, allés,
      // allées); only the masculine singular is the citation form. pris
      // carries no number at all, since singular and plural are the same.
      if (tag === 'par:pas' && row.genre && !(row.genre === 'm' && row.nombre !== 'p')) continue;
      if (!bySlot.has(tag)) bySlot.set(tag, []);
      bySlot.get(tag).push({ form: row.ortho, freq });
    }
  }

  const out = {};
  for (const [lemma, bySlot] of slots) {
    const get = (tag) => pickForm(tag, bySlot.get(tag));
    const present = PERSONS.map((p) => get(`ind:pre:${p}`));
    // Lexique sometimes tags tu suis only as an imperative. Where je ends in
    // -s or -x, tu is the same form in every French verb, so fill that gap.
    if (!present[1] && present[0] && /[sx]$/.test(present[0])) present[1] = present[0];
    if (!present[0] && present[1] && /[sx]$/.test(present[1]) && !lemma.endsWith('er')) present[0] = present[1];
    const impersonal = IMPERSONAL_VERBS.has(lemma);
    let found = {
      present,
      futur1: impersonal ? get('ind:fut:3s') : get('ind:fut:1s'),
      participle: get('par:pas'),
      imparfait1: impersonal ? get('ind:imp:3s') : get('ind:imp:1s'),
    };
    if (impersonal) found.present = present.map((form, i) => (i === 2 ? form : null));
    else found = fillFromModel(lemma, found);
    const { futur1, participle, imparfait1 } = found;
    present.splice(0, 6, ...found.present);
    const complete = impersonal ? present[2] : present.every(Boolean);
    if (!complete || !futur1 || !participle || !imparfait1) continue;

    const futureStem = futur1.replace(impersonal ? /a$/ : /ai$/, '');
    const verb = {
      infinitive: lemma,
      aux: ETRE_VERBS.has(lemma) ? 'être' : 'avoir',
      participle,
      present,
      futureStem,
    };
    if (impersonal) verb.impersonal = true;

    // conjugate.js derives the imparfait stem from the nous present. Where
    // Lexique's own imparfait disagrees (être), store the real stem as an
    // override, exactly as data/verbs.json does.
    const derived = impersonal ? null : present[3].replace(/ons$/, '');
    const actual = imparfait1.replace(impersonal ? /ait$/ : /ais$/, '');
    if (impersonal || derived !== actual) verb.imperfectStem = actual;

    out[lemma] = verb;
  }
  return out;
}

function sameForms(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * True unless the verb follows one of the three regular models exactly:
 * parler (-er, with the mangeons/commençons spelling guard), finir (-ir with
 * -iss-) or vendre (-re). Stem-changing -er verbs (appeler, acheter) count
 * as irregular, since their present and often their futur change.
 */
export function isIrregular(verb) {
  if (verb.impersonal || verb.imperfectStem) return true;
  const inf = verb.infinitive;
  const stem = inf.slice(0, -2);

  if (inf.endsWith('er')) {
    const nous = stem.endsWith('g') ? `${stem}eons` : stem.endsWith('c') ? `${stem.slice(0, -1)}çons` : `${stem}ons`;
    return !(sameForms(verb.present, [`${stem}e`, `${stem}es`, `${stem}e`, nous, `${stem}ez`, `${stem}ent`])
      && verb.futureStem === inf && verb.participle === `${stem}é`);
  }
  if (inf.endsWith('ir')) {
    return !(sameForms(verb.present, [`${stem}is`, `${stem}is`, `${stem}it`, `${stem}issons`, `${stem}issez`, `${stem}issent`])
      && verb.futureStem === inf && verb.participle === `${stem}i`);
  }
  if (inf.endsWith('re')) {
    return !(sameForms(verb.present, [`${stem}s`, `${stem}s`, stem, `${stem}ons`, `${stem}ez`, `${stem}ent`])
      && verb.futureStem === inf.slice(0, -1) && verb.participle === `${stem}u`);
  }
  return true;
}
