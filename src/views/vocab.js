import { newCard, grade } from '../scheduler.js';
import { gradeAnswer } from '../grade.js';
import { getCard, putCard, getSettings, recordReview } from '../store.js';
import { buildVocabCardDeck } from '../vocab-cards.js';
import { h, clear, shuffle } from '../dom.js';
import { speak } from '../tts.js';
import { attachAccentHelper } from '../accent-helper.js';

const PRODUCE_UNLOCK_INTERVAL = 21;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function cardState(spec) {
  return getCard(spec.id) ?? newCard(spec.id, { familiar: spec.familiar });
}

function buildQueue(deck, settings) {
  const byId = new Map(deck.map((spec) => [spec.id, spec]));
  const withState = deck.map((spec) => ({ spec, card: cardState(spec) }));

  const due = withState.filter((c) => c.card.state !== 'new' && c.card.due <= today());

  const newRecall = withState
    .filter((c) => c.spec.kind === 'recall' && c.card.state === 'new')
    .sort((a, b) => a.spec.lemma.localeCompare(b.spec.lemma)) // stable; deck is already rank order
    .slice(0, settings.newCardsPerDay);

  // Production unlocks once the matching receptive card has matured to a
  // 21+ day interval (section 8.5) — not gated by the daily new-word cap,
  // since it is not a new word, just a harder stage of one already known.
  const newProduce = withState.filter((c) => {
    if (c.spec.kind !== 'produce' || c.card.state !== 'new') return false;
    const recall = getCard(c.spec.requiresCardId);
    return recall && recall.interval >= PRODUCE_UNLOCK_INTERVAL;
  });

  return { queue: [...shuffle(due), ...shuffle([...newRecall, ...newProduce])], byId };
}

function renderRecallCard(container, spec, card, onGraded) {
  const revealed = h('div', {});
  const showButton = h('button', { type: 'button' }, 'Show answer');
  const playButton = h('button', { type: 'button', onclick: () => speak(spec.prompt) }, 'Play');

  const actions = h('div', { class: 'actions' }, showButton);
  showButton.addEventListener('click', () => {
    clear(revealed);
    // native Element.append coerces null/undefined arguments to the text
    // "null" instead of skipping them, unlike this file's h() helper — filter first.
    revealed.append(...[
      h('p', { class: 'correct' }, spec.answer),
      spec.example ? h('p', { class: 'mono' }, `${spec.example} — ${spec.exampleNl}`) : null,
      spec.falseFriend ? h('p', {}, `Let op: ${spec.falseFriend}`) : null,
      spec.note ? h('p', {}, spec.note) : null,
    ].filter(Boolean));
    clear(actions);
    actions.append(
      h('button', { type: 'button', onclick: () => onGraded('again') }, 'Again'),
      h('button', { type: 'button', onclick: () => onGraded('good') }, 'Good'),
      h('button', { type: 'button', onclick: () => onGraded('easy') }, 'Easy'),
    );
  });

  container.append(
    h('h2', {}, spec.prompt),
    playButton,
    revealed,
    actions,
  );
}

function renderProduceCard(container, spec, card, onGraded) {
  const input = h('input', {
    type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    'aria-label': 'Type the French word, with its article if it is a noun',
  });
  const feedback = h('div', { class: 'feedback' });
  const actions = h('div', { class: 'actions' }, h('button', { type: 'submit' }, 'Check'));

  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const typed = input.value;
      if (!typed.trim()) return;
      const result = gradeAnswer(typed, spec.expected);
      speak(spec.expected);
      input.disabled = true;
      clear(feedback);
      feedback.append(
        h('p', { class: result.grade === 'again' ? 'incorrect' : 'correct' },
          result.grade === 'good' ? 'Correct.' : `${spec.expected}`),
      );
      if (spec.note) feedback.append(h('p', {}, spec.note));
      const next = h('button', { type: 'button', onclick: () => onGraded(result.grade) }, 'Next');
      clear(actions);
      actions.append(next);
      next.focus();
    },
  });

  const accentRow = attachAccentHelper(input);
  form.append(...[
    h('h2', {}, spec.prompt),
    input,
    accentRow,
    feedback,
    actions,
  ].filter(Boolean));
  container.append(form);
  input.focus();
}

function renderCard(container, queue, index, mode, onDone) {
  clear(container);

  if (index >= queue.length) {
    container.append(h('p', {}, 'Session complete for today. Come back tomorrow for more.'));
    onDone();
    return;
  }

  const { spec, card } = queue[index];
  const remaining = queue.length - index;
  const body = h('div', {});
  container.append(h('p', {}, `${remaining} card${remaining === 1 ? '' : 's'} left`), body);

  const onGraded = (outcome) => {
    const graded = grade(card, outcome);
    putCard(graded);
    recordReview('vocab', outcome);
    renderCard(container, queue, index + 1, mode, onDone);
  };

  if (spec.kind === 'recall') renderRecallCard(body, spec, card, onGraded);
  else renderProduceCard(body, spec, card, onGraded);
}

export function renderVocabView(container, { vocab }) {
  clear(container);
  container.append(h('h1', {}, 'Vocabulary'));

  if (!vocab || vocab.length === 0) {
    container.append(h('p', {}, 'The word list is built next, from Lexique frequency data plus Dutch glosses. Once it exists, receptive and productive drilling appears here.'));
    return;
  }

  const deck = buildVocabCardDeck(vocab);
  const settings = getSettings();
  const { queue } = buildQueue(deck, settings);
  const session = h('div', { class: 'drill' });
  container.append(session);
  renderCard(session, queue, 0, 'vocab', () => {});
}
