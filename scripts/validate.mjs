import { readFile } from 'node:fs/promises';
import { conjugate, subject } from '../src/conjugate.js';

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

// --- Summary ---------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
