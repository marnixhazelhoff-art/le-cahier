import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCard, grade, EASE_MIN, EASE_MAX } from '../src/scheduler.js';

test('graduating interval is 2 days for a new card', () => {
  const card = grade(newCard('v:test:recall'), 'good');
  assert.equal(card.interval, 2);
});

test('familiar words graduate at 12 days instead of 2', () => {
  const card = grade(newCard('v:test:recall', { familiar: true }), 'good');
  assert.equal(card.interval, 12);
  assert.equal(card.state, 'review');
});

test('ease 2.3 from a 2 day interval produces roughly 2, 5, 12, 28, 64', () => {
  let card = newCard('v:test:recall');
  const seq = [];
  for (let i = 0; i < 5; i++) {
    card = grade(card, 'good');
    seq.push(card.interval);
  }
  assert.deepEqual(seq, [2, 5, 12, 28, 64]);
});

test('a lapse at interval 30 gives 15, not 1', () => {
  const card = { ...newCard('v:test:recall'), interval: 30, reps: 5 };
  const graded = grade(card, 'again');
  assert.equal(graded.interval, 15);
});

test('failure halves the interval even from a fresh card, never resets to zero', () => {
  const card = grade(newCard('v:test:recall'), 'again');
  assert.equal(card.interval, 1);
});

test('six lapses sets the leech state', () => {
  const card = { ...newCard('v:test:recall'), interval: 10, reps: 5, lapses: 5 };
  const graded = grade(card, 'again');
  assert.equal(graded.lapses, 6);
  assert.equal(graded.state, 'leech');
});

test('interval reaching 30 marks the card learned', () => {
  const card = { ...newCard('v:test:recall'), interval: 13, ease: 2.3, reps: 3 };
  const graded = grade(card, 'good');
  assert.ok(graded.interval >= 30);
  assert.equal(graded.state, 'learned');
});

test('almost leaves interval, ease and due untouched', () => {
  const card = { ...newCard('v:test:recall'), interval: 12, ease: 2.1, due: '2020-01-01', reps: 2 };
  const graded = grade(card, 'almost');
  assert.equal(graded.interval, 12);
  assert.equal(graded.ease, 2.1);
  assert.equal(graded.due, '2020-01-01');
  assert.equal(graded.reps, 3);
});

test('ease is clamped to [1.3, 2.8]', () => {
  let card = { ...newCard('v:test:recall'), ease: EASE_MAX, interval: 10, reps: 3 };
  card = grade(card, 'easy');
  assert.ok(card.ease <= EASE_MAX);

  card = { ...newCard('v:test:recall'), ease: EASE_MIN, interval: 10, reps: 3 };
  for (let i = 0; i < 5; i++) card = grade(card, 'again');
  assert.ok(card.ease >= EASE_MIN);
});

test('easy grows the interval further than good and bumps ease up', () => {
  const card = { ...newCard('v:test:recall'), interval: 10, ease: 2.3, reps: 3 };
  const graded = grade(card, 'easy');
  assert.ok(graded.interval > Math.round(10 * 2.3));
  assert.ok(graded.ease > 2.3);
});
