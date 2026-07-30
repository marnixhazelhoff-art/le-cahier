import { h, clear } from '../dom.js';

export function renderHomeView(container) {
  clear(container);
  container.append(
    h('h1', {}, 'le cahier'),
    h('p', {}, 'A French vocabulary and conjugation trainer, fifteen minutes a day.'),
    h('p', {}, [h('a', { href: '#/verbs' }, 'Start a conjugation drill'), ' or browse any of the 50 verbs.']),
  );
}
