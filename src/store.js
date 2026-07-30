const STORAGE_KEY = 'le-cahier:v1';

const DEFAULT_SETTINGS = {
  newCardsPerDay: 12,
  conditionnelEnabled: false,
  ttsEnabled: true,
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

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

export function recordReview(mode, outcome) {
  const day = todayISO();
  const dayStats = state.history[day] ?? { total: 0, correct: 0, byMode: {} };
  dayStats.total += 1;
  if (outcome === 'good' || outcome === 'easy' || outcome === 'almost') dayStats.correct += 1;
  dayStats.byMode[mode] = (dayStats.byMode[mode] ?? 0) + 1;
  state.history[day] = dayStats;
  persist();
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
