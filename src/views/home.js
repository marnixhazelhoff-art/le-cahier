import { h, clear } from '../dom.js';
import { summarise } from '../deck-stats.js';

export function renderHomeView(container, data = {}) {
  clear(container);
  container.append(
    h('h1', {}, 'le cahier'),
    h('p', {}, 'A French vocabulary and conjugation trainer, fifteen minutes a day.'),
  );

  const modes = summarise(data);
  const waiting = modes.reduce((sum, m) => sum + m.waiting, 0);

  if (modes.length === 0) {
    container.append(h('p', {}, 'The decks load next. Once they are here, this is where the day starts.'));
    return;
  }

  if (waiting === 0) {
    container.append(
      h('p', {}, 'Nothing due today. Come back tomorrow, or browse the verb tables.'),
      h('p', {}, h('a', { href: '#/verbs' }, 'Browse the 50 verbs')),
    );
    return;
  }

  // Picking up a half finished session should not need any remembering, so the
  // counts and the way back in are the first thing on the page.
  container.append(
    h('p', {}, `${waiting} card${waiting === 1 ? '' : 's'} left today.`),
    h('ul', {}, modes.filter((m) => m.waiting > 0).map((m) => h('li', {}, [
      h('a', { href: m.route }, m.label),
      ` ${m.waiting} left`,
      m.due && m.newAvailable ? h('span', { class: 'gloss' }, ` (${m.due} due, ${m.newAvailable} new)`) : null,
    ]))),
    h('p', { class: 'gloss' }, h('a', { href: '#/progress' }, 'See what you have done so far')),
  );
}
