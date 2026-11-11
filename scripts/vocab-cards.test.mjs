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
