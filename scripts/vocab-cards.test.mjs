import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVocabCardDeck } from '../src/vocab-cards.js';

const entry = (fr, nl, extra = {}) => ({ fr, nl, pos: 'adj', article: null, rank: 1, ...extra });
const produce = (deck, fr) => deck.find((c) => c.id === `v:${fr}:produce`);

test('a word sharing a Dutch sense is a synonym', () => {
  const deck = buildVocabCardDeck([entry('dur', 'hard, moeilijk'), entry('difficile', 'moeilijk', { rank: 2 })]);
  assert.deepEqual(produce(deck, 'dur').synonyms, ['difficile']);
  assert.deepEqual(produce(deck, 'difficile').synonyms, ['dur']);
});

test('a meaning qualifier separates words with the same Dutch spelling', () => {
  const deck = buildVocabCardDeck([
    entry('banque', 'de bank (geld)', { pos: 'noun', article: 'la' }),
    entry('canapé', 'de bank', { pos: 'noun', article: 'le', rank: 2 }),
  ]);
  assert.deepEqual(produce(deck, 'banque').synonyms, []);
});

test('a register qualifier does not', () => {
  const deck = buildVocabCardDeck([
    entry('femme', 'de vrouw', { pos: 'noun', article: 'une' }),
    entry('nana', 'de vrouw (informeel)', { pos: 'noun', article: 'une', rank: 2 }),
  ]);
  assert.deepEqual(produce(deck, 'femme').synonyms, ['une nana', 'la nana']);
});

test('a noun sense is never a synonym of an adjective with the same spelling', () => {
  const deck = buildVocabCardDeck([
    entry('raison', 'het gelijk, de reden', { pos: 'noun', article: 'la' }),
    entry('égal', 'gelijk', { rank: 2 }),
  ]);
  assert.deepEqual(produce(deck, 'raison').synonyms, []);
});

// --- Verbs -------------------------------------------------------------------

const verbEntry = (fr, nl, verb, nlForms, rank = 1) => ({
  fr, nl, pos: 'verb', article: null, rank, verb: { infinitive: fr, ...verb }, nlForms,
});

const venir = verbEntry('venir', 'komen', {
  aux: 'être', participle: 'venu', futureStem: 'viendr', irregular: true,
  present: ['viens', 'viens', 'vient', 'venons', 'venez', 'viennent'],
}, { pc: 'ik ben gekomen', futur: 'ik zal komen', imparfait: 'ik kwam' });

const tuer = verbEntry('tuer', 'doden', {
  aux: 'avoir', participle: 'tué', futureStem: 'tuer', irregular: false,
  present: ['tue', 'tues', 'tue', 'tuons', 'tuez', 'tuent'],
}, { pc: 'ik heb gedood', futur: 'ik zal doden', imparfait: 'ik doodde' }, 2);

test('an irregular verb gets recall, infinitive and three tense cards, staged', () => {
  const deck = buildVocabCardDeck([venir]);
  assert.deepEqual(deck.map((c) => c.id), [
    'v:venir_verb:recall', 'v:venir_verb:produce',
    'v:venir_verb:passe-compose', 'v:venir_verb:futur', 'v:venir_verb:imparfait',
  ]);
  const [, produceCard, pc, futur, imparfait] = deck;
  assert.equal(produceCard.requiresCardId, 'v:venir_verb:recall');
  for (const c of [pc, futur, imparfait]) assert.equal(c.requiresCardId, 'v:venir_verb:produce');
  assert.equal(pc.prompt, 'ik ben gekomen (passé composé)');
  assert.deepEqual(pc.expected, ['je suis venu', 'je suis venue']);
  assert.equal(pc.display, 'je suis venu(e)');
  assert.deepEqual(futur.expected, ['je viendrai']);
  assert.deepEqual(imparfait.expected, ['je venais']);
});

test('the recall card shows the kind of verb and its tenses', () => {
  const [recall] = buildVocabCardDeck([venir]);
  assert.equal(recall.verbInfo,
    'Irregular · passé composé: je suis venu(e) · futur: je viendrai · imparfait: je venais');
});

test('a regular verb only gets the passé composé tense card', () => {
  const deck = buildVocabCardDeck([tuer]);
  assert.deepEqual(deck.map((c) => c.id), ['v:tuer_verb:recall', 'v:tuer_verb:produce', 'v:tuer_verb:passe-compose']);
  assert.deepEqual(deck[2].expected, ["j'ai tué"]);
});

test('a verb already drilled in Verbs mode stops at the infinitive', () => {
  const aller = verbEntry('aller', 'gaan', {
    aux: 'être', participle: 'allé', futureStem: 'ir', irregular: true, inVerbsMode: true,
    present: ['vais', 'vas', 'va', 'allons', 'allez', 'vont'],
  }, { pc: 'ik ben gegaan', futur: 'ik zal gaan', imparfait: 'ik ging' });
  assert.deepEqual(buildVocabCardDeck([aller]).map((c) => c.id), ['v:aller_verb:recall', 'v:aller_verb:produce']);
});

test('a verb never shares cards with a noun spelled the same', () => {
  const deck = buildVocabCardDeck([
    entry('devoir', 'de plicht', { pos: 'noun', article: 'le' }),
    verbEntry('devoir', 'moeten', {
      aux: 'avoir', participle: 'dû', futureStem: 'devr', irregular: true,
      present: ['dois', 'dois', 'doit', 'devons', 'devez', 'doivent'],
    }, { pc: 'ik heb gemoeten', futur: 'ik zal moeten', imparfait: 'ik moest' }, 2),
  ]);
  const ids = deck.map((c) => c.id);
  assert.ok(ids.includes('v:devoir:recall') && ids.includes('v:devoir_verb:recall'));
  assert.equal(new Set(ids).size, ids.length);
});

test('an impersonal verb is drilled in the il form', () => {
  const falloir = verbEntry('falloir', 'moeten (onpersoonlijk)', {
    aux: 'avoir', participle: 'fallu', futureStem: 'faudr', irregular: true, impersonal: true,
    imperfectStem: 'fall', present: [null, null, 'faut', null, null, null],
  }, { pc: 'het heeft gemoeten', futur: 'het zal moeten', imparfait: 'het moest' });
  const deck = buildVocabCardDeck([falloir]);
  assert.deepEqual(deck.find((c) => c.tense === 'futur').expected, ['il faudra']);
  assert.deepEqual(deck.find((c) => c.tense === 'passe-compose').expected, ['il a fallu']);
});

test('a verb gloss is never a synonym of a non-verb gloss', () => {
  const deck = buildVocabCardDeck([
    entry('son', 'zijn'),
    verbEntry('être', 'zijn', {
      aux: 'avoir', participle: 'été', futureStem: 'ser', irregular: true, imperfectStem: 'ét',
      present: ['suis', 'es', 'est', 'sommes', 'êtes', 'sont'],
    }, { pc: 'ik ben geweest', futur: 'ik zal zijn', imparfait: 'ik was' }, 2),
  ]);
  assert.deepEqual(produce(deck, 'être_verb').synonyms, []);
});
