import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeAnswer } from '../src/grade.js';

test('mange for mangé is almost, not again', () => {
  assert.equal(gradeAnswer('mange', 'mangé').grade, 'almost');
});

test('le voiture for la voiture is again, not almost', () => {
  assert.equal(gradeAnswer('le voiture', 'la voiture').grade, 'again');
});

test('mangions for mangeions is again: a different fact, not a typo', () => {
  assert.equal(gradeAnswer('mangions', 'mangeions').grade, 'again');
});

test('an exact match is good', () => {
  assert.equal(gradeAnswer('la voiture', 'la voiture').grade, 'good');
});

test('case and surrounding whitespace are ignored', () => {
  assert.equal(gradeAnswer('  La Voiture  ', 'la voiture').grade, 'good');
});

test('a leading subject pronoun is stripped before comparing', () => {
  assert.equal(gradeAnswer('je mange', 'mange').grade, 'good');
});

test('an article typo is not ignored the way a pronoun is', () => {
  const result = gradeAnswer('un voiture', 'une voiture');
  assert.equal(result.grade, 'again');
});

test('either of several comma separated accepted senses is accepted', () => {
  assert.equal(gradeAnswer('geluk', 'boom, geluk').grade, 'good');
});

test('a wrong answer returns the first accepted form as the correction', () => {
  const result = gradeAnswer('xyz', 'mangé');
  assert.equal(result.grade, 'again');
  assert.equal(result.correction, 'mangé');
});
