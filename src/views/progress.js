import { h, clear } from '../dom.js';
import { getHistory, allCards } from '../store.js';

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function renderProgressView(container) {
  clear(container);
  const history = getHistory();
  const todayStats = history[today()];
  const cards = Object.values(allCards());
  const leeches = cards.filter((c) => c.state === 'leech');

  container.append(h('h1', {}, 'Progress'));

  if (todayStats && todayStats.total > 0) {
    const accuracy = Math.round((todayStats.correct / todayStats.total) * 100);
    container.append(
      h('p', {}, `Today: ${todayStats.total} reviews, ${accuracy}% correct.`),
      h('p', {}, accuracy > 95
        ? 'Running close to 100 percent usually means the intervals are too short.'
        : accuracy < 80
          ? 'Below the 85 to 90 percent target. That is normal on a hard day, not a problem to fix immediately.'
          : 'Within the 85 to 90 percent range this app aims for.'),
    );
  } else {
    container.append(h('p', {}, 'No reviews yet today.'));
  }

  if (leeches.length > 0) {
    container.append(
      h('h2', {}, 'Needs rewriting'),
      h('p', {}, 'These cards have failed six or more times. A card that keeps failing usually has a bad translation or example, not a bad learner.'),
      h('ul', {}, leeches.map((c) => h('li', { class: 'mono' }, c.id))),
    );
  }
}
