// Stale while revalidate. Serve from cache instantly, refresh in the background.
// Bump VERSION whenever the shell or the data files change. Old caches are
// deleted on activate, so a bump is the whole upgrade story.

const VERSION = 'v8';
const CACHE = `le-cahier-${VERSION}`;

// Relative so this survives a GitHub Pages subpath. These resolve against the
// service worker's own location, which is the repo root.
const CORE = [
  './',
  './index.html',
  './src/styles.css',
  './src/app.js',
  './src/dom.js',
  './src/store.js',
  './src/scheduler.js',
  './src/conjugate.js',
  './src/deck-stats.js',
  './src/grade.js',
  './src/merge.js',
  './src/sync.js',
  './src/tts.js',
  './src/accent-helper.js',
  './src/verb-cards.js',
  './src/vocab-cards.js',
  './src/views/home.js',
  './src/views/verbs.js',
  './src/views/vocab.js',
  './src/views/chooser.js',
  './src/views/progress.js',
  './src/views/settings.js',
  './data/verbs.json',
  './data/vocab.json',
  './data/chooser.json',
];

// A missing icon must not fail the install and leave the app uncached.
const OPTIONAL = [
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
];

function isSupabase(url) {
  return url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in');
}

function isFont(url) {
  return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}

// Opaque font responses report status 0, so ok is false for them. Cache those
// anyway, otherwise a standalone install falls back to system fonts forever.
function worthCaching(res) {
  return Boolean(res) && (res.ok || res.type === 'opaque');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    await Promise.allSettled(OPTIONAL.map((path) => cache.add(path)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith('le-cahier-') && name !== CACHE)
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

async function revalidate(request, cache) {
  try {
    const res = await fetch(request);
    if (worthCaching(res)) await cache.put(request, res.clone());
    return res;
  } catch {
    return null;
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request, { ignoreSearch: false });

  if (cached) {
    // Refresh after responding. waitUntil keeps the worker alive for it.
    event.waitUntil(revalidate(event.request, cache));
    return cached;
  }

  const fresh = await revalidate(event.request, cache);
  if (fresh) return fresh;

  // Hash routing means every navigation is really the shell.
  if (event.request.mode === 'navigate') {
    const shell = await cache.match('./index.html');
    if (shell) return shell;
  }

  return new Response(
    'le cahier is offline and this file was never cached. Reconnect once to finish the install.',
    { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Network only for sync. The progress row must never come from a cache.
  if (isSupabase(url)) return;

  if (url.origin !== self.location.origin && !isFont(url)) return;

  event.respondWith(staleWhileRevalidate(event));
});
