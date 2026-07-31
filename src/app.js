import { h, clear } from './dom.js';
import { fetchJSON } from './store.js';
import { renderHomeView } from './views/home.js';
import { renderVerbsView } from './views/verbs.js';
import { renderVocabView } from './views/vocab.js';
import { renderChooserView } from './views/chooser.js';
import { renderProgressView } from './views/progress.js';
import { renderSettingsView } from './views/settings.js';
import { captureSessionFromUrl, initSync } from './sync.js';

const ROUTES = {
  '#/home': (main, data) => renderHomeView(main, data),
  '#/verbs': (main, data) => renderVerbsView(main, data),
  '#/vocab': (main, data) => renderVocabView(main, data),
  '#/chooser': (main, data) => renderChooserView(main, data),
  '#/progress': (main, data) => renderProgressView(main, data),
  '#/settings': (main) => renderSettingsView(main),
};

const TABS = [
  ['#/home', 'Home'],
  ['#/verbs', 'Verbs'],
  ['#/vocab', 'Vocabulary'],
  ['#/chooser', 'Chooser'],
  ['#/progress', 'Progress'],
  ['#/settings', 'Settings'],
];

// Relative so it registers under a GitHub Pages subpath. Service workers need a
// secure context, so this stays silent over file:// and over a plain LAN IP
// instead of reporting a failure the learner cannot act on.
// Serving from cache first means a deploy lands one launch late: the new worker
// installs in the background while the page keeps the files it already loaded.
// That reads as "my change did not ship", so say so instead. Offering a reload
// rather than forcing one keeps it out of the way mid card.
function showUpdateNotice() {
  if (document.querySelector('.update-notice')) return;
  const root = document.getElementById('app');
  if (!root) return;
  root.prepend(h('div', { class: 'update-notice', role: 'status' }, [
    'An update is ready. ',
    h('button', { type: 'button', onclick: () => location.reload() }, 'Reload'),
  ]));
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // On a first ever visit the worker claims the page with nothing stale on
  // screen, so that handover is not an update and needs no notice.
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) showUpdateNotice();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch(() => {});
  });
}

async function start() {
  const root = document.getElementById('app');
  clear(root);
  root.append(h('p', {}, 'Loading…'));

  // verbs.json is the one file the app cannot open without. The other two are
  // allowed to be missing, but never silently: a deck that fails to load looks
  // exactly like a deck that is finished for the day, and guessing which is
  // which costs an evening.
  const failures = [];
  async function loadDeck(path) {
    try {
      return await fetchJSON(path);
    } catch (err) {
      failures.push(err.message);
      return [];
    }
  }

  let verbs, vocab, chooser;
  try {
    ({ verbs } = await fetchJSON('./data/verbs.json'));
    vocab = await loadDeck('./data/vocab.json');
    chooser = await loadDeck('./data/chooser.json');
  } catch (err) {
    clear(root);
    root.append(h('div', { class: 'page' }, h('p', { class: 'incorrect' }, err.message)));
    return;
  }

  const data = { verbs, vocab, chooser };

  const nav = h('nav', { class: 'tabs' },
    TABS.map(([href, label]) => h('a', { href }, label)));
  const main = h('main', {});
  const page = h('div', { class: 'page' }, [nav, main]);

  clear(root);
  if (failures.length > 0) {
    root.append(h('div', { class: 'load-notice', role: 'status' },
      failures.map((message) => h('p', { class: 'incorrect' }, message))));
  }
  root.append(page);

  function render() {
    const route = ROUTES[location.hash] ? location.hash : '#/home';
    for (const link of nav.querySelectorAll('a')) {
      link.setAttribute('aria-current', link.getAttribute('href') === route ? 'page' : 'false');
    }
    clear(main);
    ROUTES[route](main, data);
  }

  window.addEventListener('hashchange', render);
  render();

  // Last, and never awaited: a sync that cannot reach Supabase must not delay
  // the first card by a single frame.
  try {
    initSync();
  } catch { /* sync is an enhancement, never a dependency */ }
}

registerServiceWorker();
// Before start(), because a magic link returns #access_token=... and the router
// would otherwise treat that as an unknown route.
try {
  captureSessionFromUrl();
} catch { /* a malformed callback must not stop the app loading */ }
start();
