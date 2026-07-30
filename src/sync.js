// Supabase sync, built last and never load bearing.
//
// The app has no runtime dependencies, so this speaks the auth and REST
// endpoints directly with fetch rather than pulling in the Supabase SDK.
// Every path through here either sets a status or stays quiet. Nothing in this
// file is allowed to throw into the app: offline is the default and sync is an
// enhancement (BRIEF.md section 13).

import { getState, replaceProgress, getSettings, onLocalChange } from './store.js';
import { mergeStates } from './merge.js';

const SESSION_KEY = 'le-cahier:session';
const PUSH_DEBOUNCE_MS = 4000;
const REFRESH_MARGIN_MS = 60_000;

const OFF = 'Sync is off. Add a Supabase URL and anon key below to turn it on.';
const SIGNED_OUT = 'Not signed in. Progress stays on this device, so keep exporting it.';

let status = { state: 'off', message: OFF };
const watchers = new Set();
let pushTimer = null;
let listening = false;

function setStatus(state, message) {
  status = { state, message };
  for (const fn of watchers) {
    try { fn(status); } catch { /* a broken watcher must not break sync */ }
  }
}

export function getSyncStatus() {
  return status;
}

export function onSyncStatus(fn) {
  watchers.add(fn);
  fn(status);
  return () => watchers.delete(fn);
}

function config() {
  const { syncUrl, syncAnonKey } = getSettings();
  const url = (syncUrl ?? '').trim().replace(/\/+$/, '');
  const key = (syncAnonKey ?? '').trim();
  if (!url || !key) return null;
  return { url, key };
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function isSignedIn() {
  return Boolean(loadSession());
}

async function reasonFrom(res, fallback) {
  try {
    const body = await res.json();
    return body.error_description || body.msg || body.message || body.error || fallback;
  } catch {
    return fallback;
  }
}

function clockLabel() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Asks Supabase to email a sign in link. Throws so the settings view can show
 * the reason next to the field the learner just used.
 */
export async function sendMagicLink(email) {
  const cfg = config();
  if (!cfg) throw new Error('Sync has no Supabase URL or anon key yet. Fill both in, then ask for the link again.');
  if (!email || !email.includes('@')) throw new Error('That does not look like an email address. Check it and try again.');

  // Strip the hash: the router owns it, and Supabase appends its own.
  const redirect = location.href.split('#')[0];
  let res;
  try {
    res = await fetch(`${cfg.url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, {
      method: 'POST',
      headers: { apikey: cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, create_user: true }),
    });
  } catch {
    throw new Error('Could not reach Supabase. Check the URL and your connection, then try again.');
  }
  if (!res.ok) {
    throw new Error(await reasonFrom(res, `Supabase refused the sign in request (HTTP ${res.status}).`));
  }
  setStatus('link-sent', `Sign in link sent to ${email}. Open it on this device.`);
}

/**
 * A magic link comes back as #access_token=..., which would otherwise land in
 * the router as an unknown route. Call this before the router reads the hash.
 * Returns true when the URL carried an auth result.
 */
export function captureSessionFromUrl() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw.includes('access_token=') && !raw.includes('error_description=')) return false;

  const params = new URLSearchParams(raw);
  const handBackToRouter = () => {
    history.replaceState(null, '', `${location.pathname}${location.search}#/settings`);
  };

  const failure = params.get('error_description');
  if (failure) {
    handBackToRouter();
    setStatus('error', `Signing in failed: ${failure}. Ask for a new link in settings.`);
    return true;
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return false;

  saveSession({
    accessToken,
    refreshToken,
    expiresAt: Date.now() + Number(params.get('expires_in') ?? 3600) * 1000,
    userId: null, // resolved on first use
  });
  handBackToRouter();
  return true;
}

async function refreshSession(cfg, session) {
  let res;
  try {
    res = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
  } catch {
    throw new Error('Could not reach Supabase to renew the sign in. Reviews are saved on this device meanwhile.');
  }
  if (!res.ok) {
    clearSession();
    throw new Error('The sign in expired and could not be renewed. Sign in again below.');
  }
  const body = await res.json();
  const next = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000,
    userId: body.user?.id ?? session.userId,
  };
  saveSession(next);
  return next;
}

async function ensureSession(cfg) {
  let session = loadSession();
  if (!session) return null;

  if (Date.now() > session.expiresAt - REFRESH_MARGIN_MS) {
    session = await refreshSession(cfg, session);
  }

  if (!session.userId) {
    let res;
    try {
      res = await fetch(`${cfg.url}/auth/v1/user`, {
        headers: { apikey: cfg.key, Authorization: `Bearer ${session.accessToken}` },
      });
    } catch {
      throw new Error('Could not reach Supabase. Reviews are saved on this device meanwhile.');
    }
    if (!res.ok) {
      clearSession();
      throw new Error('Supabase rejected the saved sign in. Sign in again below.');
    }
    const user = await res.json();
    session = { ...session, userId: user.id };
    saveSession(session);
  }

  return session;
}

function authHeaders(cfg, session) {
  return { apikey: cfg.key, Authorization: `Bearer ${session.accessToken}` };
}

async function pull(cfg, session) {
  let res;
  try {
    res = await fetch(
      `${cfg.url}/rest/v1/progress?select=data&user_id=eq.${encodeURIComponent(session.userId)}`,
      { headers: authHeaders(cfg, session) },
    );
  } catch {
    throw new Error('Could not reach Supabase to pull progress. Reviews are saved on this device meanwhile.');
  }
  if (!res.ok) {
    throw new Error(await reasonFrom(res, `Pulling progress failed (HTTP ${res.status}). Check that the progress table exists.`));
  }
  const rows = await res.json();
  return rows[0]?.data ?? null;
}

async function push(cfg, session, data) {
  let res;
  try {
    res = await fetch(`${cfg.url}/rest/v1/progress`, {
      method: 'POST',
      headers: {
        ...authHeaders(cfg, session),
        'Content-Type': 'application/json',
        // user_id is the primary key, so this upserts the single row.
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        user_id: session.userId,
        data,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch {
    throw new Error('Could not reach Supabase to save progress. It is still on this device.');
  }
  if (!res.ok) {
    throw new Error(await reasonFrom(res, `Saving progress failed (HTTP ${res.status}).`));
  }
}

/**
 * Pull, merge per card, then push the merged result back. Never throws.
 */
export async function syncNow() {
  const cfg = config();
  if (!cfg) {
    setStatus('off', OFF);
    return;
  }

  let session;
  try {
    session = await ensureSession(cfg);
  } catch (err) {
    setStatus('error', err.message);
    return;
  }
  if (!session) {
    setStatus('signed-out', SIGNED_OUT);
    return;
  }

  setStatus('syncing', 'Syncing.');
  try {
    const remote = await pull(cfg, session);
    const merged = mergeStates(getState(), remote);
    replaceProgress(merged);
    await push(cfg, session, { cards: merged.cards, history: merged.history });
    const count = Object.keys(merged.cards).length;
    setStatus('synced', `Synced at ${clockLabel()}, ${count} card${count === 1 ? '' : 's'}.`);
  } catch (err) {
    setStatus('error', err.message);
  }
}

// After a review, push without pulling. Pulling every few seconds would cost
// far more than it catches, and the next load pulls anyway.
async function pushOnly() {
  const cfg = config();
  if (!cfg) return;
  try {
    const session = await ensureSession(cfg);
    if (!session) return;
    const state = getState();
    await push(cfg, session, { cards: state.cards, history: state.history });
    setStatus('synced', `Synced at ${clockLabel()}.`);
  } catch (err) {
    setStatus('error', err.message);
  }
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushOnly();
  }, PUSH_DEBOUNCE_MS);
}

// A backgrounded phone may never come back, so do not sit on a pending push.
function flushPush() {
  if (!pushTimer) return;
  clearTimeout(pushTimer);
  pushTimer = null;
  pushOnly();
}

/**
 * Starts sync if it is configured. Safe to call again after the settings change.
 */
export function initSync() {
  if (!listening) {
    listening = true;
    onLocalChange(schedulePush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPush();
    });
  }

  if (!config()) {
    setStatus('off', OFF);
    return;
  }
  if (!isSignedIn()) {
    setStatus('signed-out', SIGNED_OUT);
    return;
  }
  syncNow();
}

export async function signOut() {
  const cfg = config();
  const session = loadSession();
  clearSession();
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (cfg && session) {
    try {
      await fetch(`${cfg.url}/auth/v1/logout`, {
        method: 'POST',
        headers: authHeaders(cfg, session),
      });
    } catch { /* the local session is already gone, which is what matters */ }
  }
  setStatus('signed-out', 'Signed out. Progress stays on this device.');
}
