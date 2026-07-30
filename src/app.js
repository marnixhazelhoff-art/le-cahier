import { h, clear } from './dom.js';
import { fetchJSON } from './store.js';
import { renderHomeView } from './views/home.js';
import { renderVerbsView } from './views/verbs.js';
import { renderVocabView } from './views/vocab.js';
import { renderChooserView } from './views/chooser.js';
import { renderProgressView } from './views/progress.js';
import { renderSettingsView } from './views/settings.js';

const ROUTES = {
  '#/home': (main) => renderHomeView(main),
  '#/verbs': (main, data) => renderVerbsView(main, data),
  '#/vocab': (main, data) => renderVocabView(main, data),
  '#/chooser': (main, data) => renderChooserView(main, data),
  '#/progress': (main) => renderProgressView(main),
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
}

start();
