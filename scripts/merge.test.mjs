import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCard, mergeHistory, mergeStates } from '../src/merge.js';

function card(over = {}) {
  return {
    id: 'c:parler:present:je',
    interval: 5, ease: 2.3, due: '2026-08-04',
    reps: 3, lapses: 0, state: 'learning',
    lastReviewed: '2026-07-30', familiar: false,
    ...over,
  };
}

test('a card only one device has survives the merge', () => {
  const mine = card();
  assert.deepEqual(mergeCard(mine, undefined), mine);
  assert.deepEqual(mergeCard(undefined, mine), mine);
});

test('the later review wins the interval and the due date', () => {
  const older = card({ lastReviewed: '2026-07-20', interval: 5, due: '2026-07-25' });
  const newer = card({ lastReviewed: '2026-07-29', interval: 12, due: '2026-08-10' });
  assert.equal(mergeCard(older, newer).interval, 12);
  assert.equal(mergeCard(older, newer).due, '2026-08-10');
  assert.equal(mergeCard(newer, older).interval, 12, 'argument order must not matter');
});

test('a never reviewed card loses to a reviewed one', () => {
  const fresh = card({ lastReviewed: null, reps: 0, interval: 0 });
  const done = card({ lastReviewed: '2026-07-29', reps: 1, interval: 2 });
  assert.equal(mergeCard(fresh, done).interval, 2);
  assert.equal(mergeCard(done, fresh).interval, 2);
});

test('reps and lapses take the higher of the two, whichever side won', () => {
  const phone = card({ lastReviewed: '2026-07-29', reps: 9, lapses: 4, interval: 12 });
  const laptop = card({ lastReviewed: '2026-07-30', reps: 5, lapses: 1, interval: 30 });
  const merged = mergeCard(phone, laptop);
  assert.equal(merged.interval, 30, 'body comes from the later review');
  assert.equal(merged.reps, 9, 'but the work done on the phone is not thrown away');
  assert.equal(merged.lapses, 4);
});

test('a same day tie keeps the card with more reps', () => {
  const fewer = card({ lastReviewed: '2026-07-30', reps: 2, interval: 5 });
  const more = card({ lastReviewed: '2026-07-30', reps: 7, interval: 12 });
  assert.equal(mergeCard(fewer, more).interval, 12);
  assert.equal(mergeCard(more, fewer).interval, 12);
});

test('an exact tie keeps the local card, so a pull cannot rewrite what you hold', () => {
  const local = card({ lastReviewed: '2026-07-30', reps: 4, ease: 2.5 });
  const remote = card({ lastReviewed: '2026-07-30', reps: 4, ease: 1.9 });
  assert.equal(mergeCard(local, remote).ease, 2.5);
});

test('history takes the max per date, never the sum', () => {
  const local = { '2026-07-29': { total: 40, correct: 30, byMode: { verbs: 40 } } };
  const remote = { '2026-07-29': { total: 55, correct: 20, byMode: { verbs: 10, vocab: 45 } } };
  const merged = mergeHistory(local, remote);
  assert.equal(merged['2026-07-29'].total, 55);
  assert.equal(merged['2026-07-29'].correct, 30);
  assert.deepEqual(merged['2026-07-29'].byMode, { verbs: 40, vocab: 45 });
});

test('introductions take the max, so two devices cannot each grant a full batch', () => {
  const merged = mergeHistory(
    { '2026-07-30': { total: 12, correct: 10, byMode: { vocab: 12 }, introducedByMode: { vocab: 12 } } },
    { '2026-07-30': { total: 5, correct: 5, byMode: { vocab: 5 }, introducedByMode: { vocab: 5 } } },
  );
  assert.equal(merged['2026-07-30'].introducedByMode.vocab, 12);
});

test('history from before introductions were tracked still merges', () => {
  const merged = mergeHistory(
    { '2026-07-28': { total: 10, correct: 9, byMode: { verbs: 10 } } },
    { '2026-07-28': { total: 12, correct: 8, byMode: { verbs: 12 } } },
  );
  assert.equal(merged['2026-07-28'].total, 12);
  assert.deepEqual(merged['2026-07-28'].introducedByMode, {});
});

test('a date only one device has is kept', () => {
  const merged = mergeHistory(
    { '2026-07-28': { total: 10, correct: 9, byMode: {} } },
    { '2026-07-29': { total: 20, correct: 11, byMode: {} } },
  );
  assert.deepEqual(Object.keys(merged).sort(), ['2026-07-28', '2026-07-29']);
});

test('a whole document merge keeps every card from both devices', () => {
  const local = {
    cards: { a: card({ id: 'a' }), b: card({ id: 'b' }) },
    history: { '2026-07-30': { total: 5, correct: 5, byMode: {} } },
    settings: { newCardsPerDay: 6 },
  };
  const remote = {
    cards: { b: card({ id: 'b', lastReviewed: '2026-07-31', interval: 30 }), c: card({ id: 'c' }) },
    history: { '2026-07-30': { total: 9, correct: 4, byMode: {} } },
    settings: { newCardsPerDay: 12 },
  };
  const merged = mergeStates(local, remote);
  assert.deepEqual(Object.keys(merged.cards).sort(), ['a', 'b', 'c']);
  assert.equal(merged.cards.b.interval, 30);
  assert.equal(merged.history['2026-07-30'].total, 9);
  assert.equal(merged.settings.newCardsPerDay, 6, 'settings stay on the device');
});

test('a first sync against an empty remote changes nothing', () => {
  const local = { cards: { a: card({ id: 'a' }) }, history: {}, settings: {} };
  const merged = mergeStates(local, null);
  assert.deepEqual(merged.cards, local.cards);
});

test('a phone session is not lost when the remote is stale', () => {
  // The exact scenario section 13 warns about: laptop pushed yesterday, phone
  // studied today offline, then the phone pulls.
  const phone = {
    cards: { x: card({ id: 'x', lastReviewed: '2026-07-30', reps: 8, interval: 12 }) },
    history: { '2026-07-30': { total: 100, correct: 90, byMode: { vocab: 100 } } },
    settings: {},
  };
  const stale = {
    cards: { x: card({ id: 'x', lastReviewed: '2026-07-29', reps: 7, interval: 5 }) },
    history: { '2026-07-29': { total: 80, correct: 70, byMode: { vocab: 80 } } },
    settings: {},
  };
  const merged = mergeStates(phone, stale);
  assert.equal(merged.cards.x.interval, 12, "today's session wins");
  assert.equal(merged.cards.x.reps, 8);
  assert.equal(merged.history['2026-07-30'].total, 100);
  assert.equal(merged.history['2026-07-29'].total, 80, 'and yesterday is still there');
});
