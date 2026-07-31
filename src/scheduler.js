export const EASE_START = 2.3;
export const EASE_MIN = 1.3;
export const EASE_MAX = 2.8;
export const GRADUATING_INTERVAL = 2;
export const FAMILIAR_INTERVAL = 12;
export const LEARNED_THRESHOLD = 30;
export const LEECH_THRESHOLD = 6;

function pad(n) {
  return String(n).padStart(2, '0');
}

function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function today() {
  return toISO(new Date());
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return toISO(date);
}

function clampEase(ease) {
  return Math.min(EASE_MAX, Math.max(EASE_MIN, ease));
}

function graduatingInterval(card) {
  return card.familiar ? FAMILIAR_INTERVAL : GRADUATING_INTERVAL;
}

// 'learning' covers the first two ladder rungs (2, 5), 'review' is the third
// (12) and beyond, 'learned' is 30+. Nothing here removes a card from
// scheduling; the labels are informational (progress screen, leech list).
function deriveState(card) {
  if (card.lapses >= LEECH_THRESHOLD) return 'leech';
  if (card.reps === 0) return 'new';
  if (card.interval >= LEARNED_THRESHOLD) return 'learned';
  if (card.interval < FAMILIAR_INTERVAL) return 'learning';
  return 'review';
}

/**
 * A card counts as due once it has been seen at least once and its due date has
 * arrived. New cards are not due; they are introduced under the daily cap.
 */
export function isDue(card, day = today()) {
  return card.state !== 'new' && card.due <= day;
}

export function newCard(id, { familiar = false, due = today() } = {}) {
  return {
    id,
    interval: 0,
    ease: EASE_START,
    due,
    reps: 0,
    lapses: 0,
    state: 'new',
    lastReviewed: null,
    familiar,
  };
}

/**
 * Pure: returns a new card, does not mutate the one passed in.
 * outcome is one of 'again' | 'almost' | 'good' | 'easy'.
 */
export function grade(card, outcome) {
  const now = today();
  // Not card.reps === 0: an 'almost' grade bumps reps without moving interval
  // off its starting 0, so a card that ever got "almost" on its first attempt
  // would look graduated (reps > 0) on every later grade while still computing
  // round(0 * ease) = 0, permanently stuck at "due today". interval only ever
  // leaves 0 via a real graduation, so that is the correct new-card test.
  const isNew = card.interval === 0;

  if (outcome === 'almost') {
    // Interval, ease and due stay put, so the card is still "due" and
    // resurfaces later in the same session instead of moving in the ladder.
    const next = { ...card, reps: card.reps + 1, lastReviewed: now };
    return { ...next, state: deriveState(next) };
  }

  let interval;
  let ease = card.ease;
  let lapses = card.lapses;

  switch (outcome) {
    case 'again':
      // Halve, never reset to day one: a mature card you just missed is
      // not a new card.
      interval = Math.max(1, Math.round(card.interval * 0.5));
      ease = clampEase(card.ease - 0.2);
      lapses = card.lapses + 1;
      break;
    case 'good':
      interval = isNew ? graduatingInterval(card) : Math.round(card.interval * card.ease);
      break;
    case 'easy':
      interval = isNew
        ? Math.round(graduatingInterval(card) * 1.3)
        : Math.round(card.interval * card.ease * 1.3);
      ease = clampEase(card.ease + 0.15);
      break;
    default:
      throw new Error(`Unknown grade: ${outcome}`);
  }

  const next = {
    ...card,
    interval,
    ease,
    lapses,
    due: addDays(now, interval),
    reps: card.reps + 1,
    lastReviewed: now,
  };
  return { ...next, state: deriveState(next) };
}
