const STORAGE_KEY = 'le-cahier:v1';

const DEFAULT_SETTINGS = {
  newCardsPerDay: 12,
  conditionnelEnabled: false,
  ttsEnabled: true,
  accentHelperOnTouch: false,
  // Sync is off until both of these are filled in. The anon key is meant to be
  // public; row level security is what protects the row.
  syncUrl: '',
  syncAnonKey: '',
};

function defaultState() {
  return { cards: {}, settings: { ...DEFAULT_SETTINGS }, history: {} };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return {
      cards: parsed.cards ?? {},
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      history: parsed.history ?? {},
    };
  } catch {
    return defaultState();
  }
}

let state = loadState();

const watchers = new Set();

/**
 * Called after any change that came from this device. Sync uses it to debounce
 * a push; a merge applied from the server deliberately does not fire it.
 */
export function onLocalChange(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

function persist({ notify = true } = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!notify) return;
  for (const fn of watchers) {
    try { fn(); } catch { /* a broken watcher must not break a review */ }
  }
}

export function getState() {
  return structuredClone(state);
}

/**
 * Replaces progress with a merged document. Settings are left alone, and
 * watchers stay quiet so applying a pull cannot trigger another push.
 */
export function replaceProgress({ cards, history }) {
  state.cards = cards ?? {};
  state.history = history ?? {};
  persist({ notify: false });
}

export function getCard(id) {
  return state.cards[id] ?? null;
}

export function putCard(card) {
  state.cards[card.id] = card;
  persist();
}

export function allCards() {
  return { ...state.cards };
}

export function getSettings() {
  return { ...state.settings };
}

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  persist();
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function recordReview(mode, outcome, { introduced = false } = {}) {
  const day = todayISO();
  const dayStats = state.history[day] ?? { total: 0, correct: 0, byMode: {}, introducedByMode: {} };
  dayStats.byMode ??= {};
  dayStats.introducedByMode ??= {}; // days recorded before the cap was tracked
  dayStats.total += 1;
  if (outcome === 'good' || outcome === 'easy' || outcome === 'almost') dayStats.correct += 1;
  dayStats.byMode[mode] = (dayStats.byMode[mode] ?? 0) + 1;
  if (introduced) {
    dayStats.introducedByMode[mode] = (dayStats.introducedByMode[mode] ?? 0) + 1;
  }
  state.history[day] = dayStats;
  persist();
}

/**
 * How many new cards this mode may still introduce today.
 *
 * Counting cards still in the 'new' state is not enough: once a card is graded
 * it leaves that state, so rebuilding the queue after a break would hand out a
 * fresh full batch. The cap is a daily budget, so it is spent, not recomputed.
 */
export function newCardAllowance(mode, limit) {
  const used = state.history[todayISO()]?.introducedByMode?.[mode] ?? 0;
  return Math.max(0, limit - used);
}

export function introducedToday(mode) {
  return state.history[todayISO()]?.introducedByMode?.[mode] ?? 0;
}

export function getHistory() {
  return { ...state.history };
}

export function exportData() {
  return JSON.stringify(state, null, 2);
}

export async function fetchJSON(path) {
  let res;
  try {
    res = await fetch(path);
  } catch (err) {
    throw new Error(
      `Could not load ${path}. If you opened index.html directly from disk, ` +
      `run "npm start" instead and open the address it prints.`
    );
  }
  if (!res.ok) {
    throw new Error(`Could not load ${path} (HTTP ${res.status}).`);
  }
  return res.json();
}
