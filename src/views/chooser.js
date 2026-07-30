import { h, clear } from '../dom.js';

export function renderChooserView(container) {
  clear(container);
  container.append(
    h('h1', {}, 'Imparfait or passé composé'),
    h('p', {}, 'This drill needs 100 written contrast items, reviewed before they enter the deck. It arrives once the vocabulary bank exists.'),
  );
}
