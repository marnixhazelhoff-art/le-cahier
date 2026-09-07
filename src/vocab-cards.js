// Builds the vocabulary card deck from data/vocab.json. Nouns are always
// drilled with the article attached (section 5.2) since gender learned as a
// separate fact does not survive contact with speech.
function surfaceForm(entry) {
  return entry.pos === 'noun' && entry.article ? `${entry.article} ${entry.fr}` : entry.fr;
}

// le/un and la/une are both correct as long as the gender is: definite vs
// indefinite is a real but separate choice from the fact this drill is
// actually testing. Grading only the stored article as correct meant typing
// "un cinéma" for "le cinéma" failed despite the gender being right.
const ARTICLE_SWAP = { le: 'un', un: 'le', la: 'une', une: 'la' };

function alternateArticle(entry) {
  if (entry.article in ARTICLE_SWAP) return ARTICLE_SWAP[entry.article];
  if (entry.article === "l'") return entry.gender === 'f' ? 'une' : 'un';
  return null;
}

function producibleForms(entry) {
  const form = surfaceForm(entry);
  if (entry.pos !== 'noun') return [form];
  const alt = alternateArticle(entry);
  return alt ? [form, `${alt} ${entry.fr}`] : [form];
}

// A handful of Dutch glosses are shared by two entries (an/année both gloss
// "jaar"). Without a hint the produce prompt gives no way to know which
// French word is wanted, so those entries carry a short promptHint to show
// alongside the gloss.
function producePrompt(entry) {
  return entry.promptHint ? `${entry.nl} (${entry.promptHint})` : entry.nl;
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
      prompt: producePrompt(entry),
      expected: producibleForms(entry),
      example: entry.example,
      exampleNl: entry.exampleNl,
      note: entry.note,
    });
  }

  return cards;
}
