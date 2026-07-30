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
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch(() => {});
  });
}

async function start() {
  const root = document.getElementById('app');
  clear(root);
  root.append(h('p', {}, 'Loading…'));

  let verbs, vocab, chooser;
  try {
    ({ verbs } = await fetchJSON('./data/verbs.json'));
    vocab = await fetchJSON('./data/vocab.json').catch(() => []);
    chooser = await fetchJSON('./data/chooser.json').catch(() => []);
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
