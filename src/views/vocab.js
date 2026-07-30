import { h, clear } from '../dom.js';

export function renderVocabView(container) {
  clear(container);
  container.append(
    h('h1', {}, 'Vocabulary'),
    h('p', {}, 'The word list is built next, from Lexique frequency data plus Dutch glosses. Once it exists, receptive and productive drilling appears here.'),
  );
}
