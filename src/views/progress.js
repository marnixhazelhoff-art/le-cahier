import { h, clear } from '../dom.js';
import { getHistory, allCards, getCard } from '../store.js';
import { summarise } from '../deck-stats.js';
import { today } from '../scheduler.js';
import { buildVocabCardDeck } from '../vocab-cards.js';
import { intervalBuckets, statsFor, INTERVAL_RUNGS } from '../modules.js';

const MODE_LABEL = { verbs: 'verbs', vocab: 'vocabulary', chooser: 'chooser' };

function rate(correct, total) {
  if (!total) return null;
  return Math.round((correct / total) * 100);
}

function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = date.toLocaleDateString([], { weekday: 'short' });
  return `${weekday} ${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}`;
}

function table(head, rows) {
  return h('div', { class: 'paradigm-table' },
    h('table', {}, [
      h('thead', {}, h('tr', {}, head.map((label) => h('th', {}, label)))),
      h('tbody', {}, rows.map((cells) => h('tr', {},
        cells.map((cell, i) => (i === 0 ? h('th', {}, cell) : h('td', {}, cell)))))),
    ]));
}

function renderToday(container, history) {
  const stats = history[today()];
  container.append(h('h2', {}, 'Today'));

  if (!stats || !stats.total) {
    container.append(h('p', {}, 'No reviews yet today. Pick a drill and the count starts here.'));
    return;
  }

  const accuracy = rate(stats.correct, stats.total);
  const perMode = Object.entries(stats.byMode ?? {})
    .map(([mode, n]) => `${n} ${MODE_LABEL[mode] ?? mode}`)
    .join(', ');
  const introduced = Object.values(stats.introducedByMode ?? {}).reduce((a, b) => a + b, 0);

  container.append(
    h('p', {}, `${stats.total} reviews, ${accuracy}% correct.`),
    perMode ? h('p', { class: 'gloss' }, perMode) : null,
    introduced ? h('p', { class: 'gloss' }, `${introduced} card${introduced === 1 ? '' : 's'} introduced today.`) : null,
    h('p', {}, accuracy > 95
      ? 'Running close to 100 percent usually means the intervals are too short.'
      : accuracy < 80
        ? 'Below the 85 to 90 percent target. That is normal on a hard day, not a problem to fix immediately.'
        : 'Within the 85 to 90 percent range this app aims for.'),
  );
}

function renderLeft(container, data) {
  const modes = summarise(data);
  const waiting = modes.reduce((sum, m) => sum + m.waiting, 0);

  container.append(h('h2', {}, 'Left today'));

  if (waiting === 0) {
    container.append(h('p', {}, 'Nothing due. An empty queue is a finished session, not a failure.'));
    return;
  }

  container.append(table(
    ['Mode', 'Due', 'New', 'Total left'],
    modes.map((m) => [
      h('a', { href: m.route }, m.label),
      String(m.due),
      String(m.newAvailable),
      String(m.waiting),
    ]),
  ));
}

function renderDeck(container, data) {
  const modes = summarise(data);
  if (modes.length === 0) return;

  container.append(
    h('h2', {}, 'Deck'),
    table(
      ['Mode', 'Cards', 'Unseen', 'Learning', 'Review', 'Learned'],
      modes.map((m) => [
        m.label,
        String(m.total),
        String(m.states.new),
        String(m.states.learning),
        String(m.states.review),
        String(m.states.learned),
      ]),
    ),
    h('p', { class: 'gloss' }, 'Learned means the interval passed 30 days. Nothing ever leaves the schedule.'),
  );
}

function renderWordBuckets(container, data) {
  if (!data.vocab || data.vocab.length === 0) return;

  const t = today();
  const deck = buildVocabCardDeck(data.vocab);
  const recallIds = deck.filter((c) => c.kind === 'recall').map((c) => c.id);
  const produceIds = deck.filter((c) => c.kind === 'produce').map((c) => c.id);
  const recallBuckets = intervalBuckets(recallIds, getCard);
  const produceBuckets = intervalBuckets(produceIds, getCard);
  const recallDue = statsFor(recallIds, t).due;
  const produceDue = statsFor(produceIds, t).due;

  container.append(
    h('h2', {}, 'Where your words are'),
    table(
      ['', 'New', 'Due', ...INTERVAL_RUNGS.map((r) => `${r}d`)],
      [
        ['Recall', String(recallBuckets.new), String(recallDue), ...INTERVAL_RUNGS.map((r) => String(recallBuckets[r]))],
        ['Writing', String(produceBuckets.new), String(produceDue), ...INTERVAL_RUNGS.map((r) => String(produceBuckets[r]))],
      ],
    ),
  );
}

function renderRecent(container, history) {
  const days = Object.keys(history).filter((d) => history[d]?.total).sort().reverse().slice(0, 14);
  if (days.length === 0) return;

  container.append(
    h('h2', {}, 'Recent days'),
    table(
      ['Day', 'Reviews', 'Correct', 'New'],
      days.map((day) => {
        const s = history[day];
        const introduced = Object.values(s.introducedByMode ?? {}).reduce((a, b) => a + b, 0);
        return [dayLabel(day), String(s.total), `${rate(s.correct, s.total)}%`, String(introduced)];
      }),
    ),
  );
}

function renderAllTime(container, history) {
  const days = Object.values(history).filter((s) => s?.total);
  if (days.length === 0) return;

  const reviews = days.reduce((sum, s) => sum + s.total, 0);
  const correct = days.reduce((sum, s) => sum + s.correct, 0);

  container.append(
    h('h2', {}, 'All time'),
    h('p', {}, `${reviews} reviews across ${days.length} day${days.length === 1 ? '' : 's'}, ${rate(correct, reviews)}% correct.`),
  );
}

export function renderProgressView(container, data = {}) {
  clear(container);
  container.append(h('h1', {}, 'Progress'));

  const history = getHistory();

  renderToday(container, history);
  renderLeft(container, data);
  renderDeck(container, data);
  renderWordBuckets(container, data);
  renderRecent(container, history);
  renderAllTime(container, history);

  const leeches = Object.values(allCards()).filter((c) => c.state === 'leech');
  if (leeches.length > 0) {
    container.append(
      h('h2', {}, 'Needs rewriting'),
      h('p', {}, 'These cards have failed six or more times. A card that keeps failing usually has a bad translation or example, not a bad learner.'),
      h('ul', {}, leeches.map((c) => h('li', { class: 'mono' }, c.id))),
    );
  }
}
