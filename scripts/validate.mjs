import { readFile } from 'node:fs/promises';
import { conjugate, subject } from '../src/conjugate.js';
import { buildVerbCardDeck } from '../src/verb-cards.js';

const raw = await readFile(new URL('../data/verbs.json', import.meta.url), 'utf8');
const { verbs } = JSON.parse(raw);

const byName = Object.fromEntries(verbs.map((v) => [v.infinitive, v]));

let failed = 0;
let passed = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL  ${label}`);
    console.log(`      expected ${e}`);
    console.log(`      actual   ${a}`);
  }
}

function ok(label, condition) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL  ${label}`);
  }
}

// --- Imparfait: the soft consonant guard --------------------------------

check('imparfait manger', conjugate(byName.manger, 'imparfait'),
  ['mangeais', 'mangeais', 'mangeait', 'mangions', 'mangiez', 'mangeaient']);

check('imparfait commencer', conjugate(byName.commencer, 'imparfait'),
  ['commençais', 'commençais', 'commençait', 'commencions', 'commenciez', 'commençaient']);

check('imparfait être', conjugate(byName.être, 'imparfait'),
  ['étais', 'étais', 'était', 'étions', 'étiez', 'étaient']);

// --- Futur simple: irregular stems ---------------------------------------

check('futur aller', conjugate(byName.aller, 'futur'),
  ['irai', 'iras', 'ira', 'irons', 'irez', 'iront']);

const futurJe = {
  pouvoir: 'pourrai', voir: 'verrai', venir: 'viendrai', tenir: 'tiendrai',
  appeler: 'appellerai', faire: 'ferai', savoir: 'saurai', devoir: 'devrai',
  recevoir: 'recevrai',
};
for (const [infinitive, je] of Object.entries(futurJe)) {
  check(`futur ${infinitive} (je)`, conjugate(byName[infinitive], 'futur')[0], je);
}
check('futur falloir (il only)', conjugate(byName.falloir, 'futur'),
  [null, null, 'faudra', null, null, null]);

// --- Présent: multiple stems ----------------------------------------------

const presentForms = {
  boire: ['bois', 'bois', 'boit', 'buvons', 'buvez', 'boivent'],
  recevoir: ['reçois', 'reçois', 'reçoit', 'recevons', 'recevez', 'reçoivent'],
  connaître: ['connais', 'connais', 'connaît', 'connaissons', 'connaissez', 'connaissent'],
  prendre: ['prends', 'prends', 'prend', 'prenons', 'prenez', 'prennent'],
  vivre: ['vis', 'vis', 'vit', 'vivons', 'vivez', 'vivent'],
  ouvrir: ['ouvre', 'ouvres', 'ouvre', 'ouvrons', 'ouvrez', 'ouvrent'],
  finir: ['finis', 'finis', 'finit', 'finissons', 'finissez', 'finissent'],
  faire: ['fais', 'fais', 'fait', 'faisons', 'faites', 'font'],
  dire: ['dis', 'dis', 'dit', 'disons', 'dites', 'disent'],
};
for (const [infinitive, expected] of Object.entries(presentForms)) {
  check(`present ${infinitive}`, conjugate(byName[infinitive], 'present'), expected);
}

// --- Auxiliary, participle, agreement --------------------------------------

const etreAux = ['aller', 'venir', 'rester', 'arriver', 'devenir', 'tomber', 'sortir', 'partir'];
for (const infinitive of etreAux) {
  ok(`${infinitive} takes être`, byName[infinitive].aux === 'être');
}

const allerPC = conjugate(byName.aller, 'passe-compose');
check('je suis allé(e)', subject(0, allerPC[0]) + allerPC[0], "je suis allé(e)");
check('nous sommes allé(e)s', subject(3, allerPC[3]) + allerPC[3], "nous sommes allé(e)s");

const avoirForms = {
  être: 'été', avoir: 'eu', devoir: 'dû', vivre: 'vécu',
  ouvrir: 'ouvert', écrire: 'écrit', recevoir: 'reçu',
};
for (const [infinitive, participle] of Object.entries(avoirForms)) {
  const pc = conjugate(byName[infinitive], 'passe-compose')[0];
  check(`j'ai ${participle}`, subject(0, pc) + pc, `j'ai ${participle}`);
}

ok('passer takes avoir', byName.passer.aux === 'avoir');
ok('passer note documents the être exception', /être/.test(byName.passer.note ?? ''));

check('falloir: il a fallu, null elsewhere', conjugate(byName.falloir, 'passe-compose'),
  [null, null, 'a fallu', null, null, null]);

// --- Elision -----------------------------------------------------------

check("j'ai", subject(0, byName.avoir.present[0]) + byName.avoir.present[0], "j'ai");
const etreImparfait = conjugate(byName.être, 'imparfait');
check("j'étais", subject(0, etreImparfait[0]) + etreImparfait[0], "j'étais");
check("j'ouvre", subject(0, byName.ouvrir.present[0]) + byName.ouvrir.present[0], "j'ouvre");
const allerFutur = conjugate(byName.aller, 'futur');
check("j'irai", subject(0, allerFutur[0]) + allerFutur[0], "j'irai");
check('je vais', subject(0, byName.aller.present[0]) + byName.aller.present[0], 'je vais');

// --- Structural ----------------------------------------------------------

ok('exactly 50 verbs', verbs.length === 50);
for (const v of verbs) {
  ok(`${v.infinitive} has present/futureStem/participle/aux`,
    Array.isArray(v.present) && v.present.length === 6 &&
    typeof v.futureStem === 'string' &&
    typeof v.participle === 'string' &&
    (v.aux === 'avoir' || v.aux === 'être'));
  ok(`${v.infinitive} futureStem ends in r`, v.futureStem.endsWith('r'));
  // être is the one verb in the set whose nous form (sommes) is not -ons,
  // the same irregularity that makes its imparfait stem an override above.
  if (!v.impersonal && v.infinitive !== 'être') {
    ok(`${v.infinitive} present[3] (nous) ends in ons`, v.present[3].endsWith('ons'));
  }
}

// --- Verb card deck --------------------------------------------------------

const deck = buildVerbCardDeck(verbs);
ok('verb card deck is non-empty', deck.length > 0);
ok('verb card deck stays well under the full 1200 cell grid', deck.length < 300);

const ids = new Set();
for (const card of deck) {
  ok(`card ${card.id} has a unique id`, !ids.has(card.id));
  ids.add(card.id);
  ok(`card ${card.id} references a real verb`, card.infinitive in byName || card.infinitive === 'être');
  // expected is usually a single string, but a card can offer several
  // accepted answers (e.g. je suis allé / je suis allée) — gradeAnswer in
  // src/grade.js has always accepted an array here, see its docstring.
  ok(`card ${card.id} has a non-empty expected answer`,
    Array.isArray(card.expected)
      ? card.expected.length > 0 && card.expected.every((e) => typeof e === 'string' && e.length > 0)
      : typeof card.expected === 'string' && card.expected.length > 0);
}

// --- Vocabulary bank (if it exists yet) -------------------------------------

const VALID_POS = new Set(['noun', 'adj', 'adv', 'prep', 'conj', 'expr']);
let vocab = [];
try {
  vocab = JSON.parse(await readFile(new URL('../data/vocab.json', import.meta.url), 'utf8'));
} catch {
  // not built yet
}

if (vocab.length > 0) {
  const seenFr = new Set();
  for (const entry of vocab) {
    const label = `${entry.fr} (rank ${entry.rank})`;
    ok(`${label}: fr is unique`, !seenFr.has(entry.fr));
    seenFr.add(entry.fr);
    ok(`${label}: pos is valid`, VALID_POS.has(entry.pos));
    if (entry.pos === 'noun') {
      ok(`${label}: noun has gender`, entry.gender === 'm' || entry.gender === 'f' || entry.gender === 'mf');
      ok(`${label}: noun has article`, ['le', 'la', 'un', 'une', "l'"].includes(entry.article));
    }
    ok(`${label}: example and exampleNl are both present or both absent`,
      Boolean(entry.example) === Boolean(entry.exampleNl));
    ok(`${label}: has a non-empty nl gloss`, typeof entry.nl === 'string' && entry.nl.trim().length > 0);
  }
  console.log(`\nvocab.json: ${vocab.length} entries checked`);
}

// --- Chooser (if it exists yet) ---------------------------------------------

let chooser = [];
try {
  chooser = JSON.parse(await readFile(new URL('../data/chooser.json', import.meta.url), 'utf8'));
} catch {
  // not built yet
}

if (chooser.length > 0) {
  const seenId = new Set();
  for (const item of chooser) {
    const label = item.id;
    ok(`${label}: id is unique`, !seenId.has(item.id));
    seenId.add(item.id);
    ok(`${label}: sentence has exactly one blank`, (item.sentence.match(/___/g) ?? []).length === 1);
    // Two options today (imparfait vs passé composé); a future category (e.g.
    // adjective agreement: beau/belle/beaux/belles) may offer more, so this
    // checks "at least two, all distinct", not "exactly two".
    ok(`${label}: has at least two options`, Array.isArray(item.options) && item.options.length >= 2);
    ok(`${label}: answer is one of the options`, item.options.includes(item.answer));
    ok(`${label}: options are distinct`, new Set(item.options).size === item.options.length);
    ok(`${label}: has a non-empty why`, typeof item.why === 'string' && item.why.trim().length > 0);
    // Only the tense-contrast items are keyed to a verb; the agreement
    // category (noun + adjective) has no verb at all.
    if (item.verb != null) {
      ok(`${label}: verb exists in verbs.json`, item.verb in byName);
    }
    if (item.sentenceNl !== undefined) {
      ok(`${label}: sentenceNl is a non-empty string`, typeof item.sentenceNl === 'string' && item.sentenceNl.trim().length > 0);
    }
  }
  console.log(`\nchooser.json: ${chooser.length} items checked`);
}

// --- Summary ---------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
