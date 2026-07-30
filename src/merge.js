// The merge that keeps two devices honest.
//
// Whole document last write wins silently throws away a phone session, which is
// the sync bug that actually bites (BRIEF.md section 13). So cards merge one at
// a time: the later review wins the card body, and reps and lapses take the
// higher of the two because both devices really did that work.
//
// This file imports nothing and touches no browser API, so the rules can be
// unit tested directly. See scripts/merge.test.mjs.

/**
 * Merges one card. Either side may be undefined, which means that device has
 * never seen the card.
 */
export function mergeCard(local, remote) {
  if (!remote) return local;
  if (!local) return remote;

  // An ISO date sorts correctly as a string. null means never reviewed, so it
  // loses to any real date.
  const localAt = local.lastReviewed ?? '';
  const remoteAt = remote.lastReviewed ?? '';

  let base;
  if (localAt > remoteAt) base = local;
  else if (remoteAt > localAt) base = remote;
  // Reviewed on the same day, or never on either. More reps means more work,
  // and local breaks a genuine tie so a pull cannot rewrite the card you hold.
  else base = remote.reps > local.reps ? remote : local;

  return {
    ...base,
    reps: Math.max(local.reps ?? 0, remote.reps ?? 0),
    lapses: Math.max(local.lapses ?? 0, remote.lapses ?? 0),
  };
}

function maxPerKey(local = {}, remote = {}) {
  const out = {};
  for (const key of new Set([...Object.keys(local ?? {}), ...Object.keys(remote ?? {})])) {
    out[key] = Math.max(local?.[key] ?? 0, remote?.[key] ?? 0);
  }
  return out;
}

/**
 * History is a date to counts map, so every count takes the max for that date.
 */
export function mergeHistory(local = {}, remote = {}) {
  const out = {};
  for (const day of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = local[day];
    const r = remote[day];
    if (!r) { out[day] = l; continue; }
    if (!l) { out[day] = r; continue; }

    out[day] = {
      total: Math.max(l.total ?? 0, r.total ?? 0),
      correct: Math.max(l.correct ?? 0, r.correct ?? 0),
      byMode: maxPerKey(l.byMode, r.byMode),
      // Also a max, so two devices cannot each grant a full daily batch of new
      // cards for the same day.
      introducedByMode: maxPerKey(l.introducedByMode, r.introducedByMode),
    };
  }
  return out;
}

/**
 * Merges a whole progress document, card by card.
 */
export function mergeStates(local, remote) {
  const localCards = local?.cards ?? {};
  const remoteCards = remote?.cards ?? {};

  const cards = {};
  for (const id of new Set([...Object.keys(localCards), ...Object.keys(remoteCards)])) {
    cards[id] = mergeCard(localCards[id], remoteCards[id]);
  }

  return {
    cards,
    history: mergeHistory(local?.history, remote?.history),
    // Settings stay on the device. They are preferences rather than progress,
    // and a phone set to six new words a day should not be overruled by a
    // laptop set to twelve.
    settings: local?.settings,
  };
}
