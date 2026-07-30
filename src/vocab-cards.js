// Builds the vocabulary card deck from data/vocab.json. Nouns are always
// drilled with the article attached (section 5.2) since gender learned as a
// separate fact does not survive contact with speech.
function surfaceForm(entry) {
  return entry.pos === 'noun' && entry.article ? `${entry.article} ${entry.fr}` : entry.fr;
}

export function buildVocabCardDeck(vocab) {
  const sorted = [...vocab].sort((a, b) => a.rank - b.rank);
  const cards = [];

  for (const entry of sorted) {
    const form = surfaceForm(entry);
    const recallId = `v:${entry.fr}:recall`;

    cards.push({
      id: recallId,
      kind: 'recall',
      lemma: entry.fr,
      familiar: entry.familiar,
      prompt: form,
      answer: entry.nl,
      example: entry.example,
      exampleNl: entry.exampleNl,
      falseFriend: entry.falseFriend,
      note: entry.note,
    });

    cards.push({
      id: `v:${entry.fr}:produce`,
      kind: 'produce',
      lemma: entry.fr,
      familiar: entry.familiar,
      requiresCardId: recallId,
      prompt: entry.nl,
      expected: form,
      example: entry.example,
      exampleNl: entry.exampleNl,
      note: entry.note,
    });
  }

  return cards;
}
