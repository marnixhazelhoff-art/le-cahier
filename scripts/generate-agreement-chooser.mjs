// Appends adjective-agreement items to data/chooser.json: which form of an
// irregular adjective (masculine or feminine singular) agrees with a given
// noun. The noun's real gender comes from data/vocab.json, already verified
// there; the two candidate forms come from data/adjectives.json, hand
// checked against real French grammar, not model-generated. The model's
// only job is a natural sentence and a one-sentence "why" around forms that
// are already fixed, same division of labour as generate-chooser.mjs.
//
//   node scripts/generate-agreement-chooser.mjs --count=30
//
// Always appends: existing chooser.json items, their ids and review history
// are never touched, renumbered or regenerated.
//
// Scope for now: singular only, masculine vs feminine. French plurals have
// enough irregulars (cheval -> chevaux) that guessing them from vocab.json
// risked generating a grammatically wrong sentence; plural agreement can be
// its own pass once there is a reliable source for noun plurals.
import { readFile, writeFile } from 'node:fs/promises';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const API_URL = 'https://api.anthropic.com/v1/messages';
const ADJECTIVES_PATH = new URL('../data/adjectives.json', import.meta.url);
const VOCAB_PATH = new URL('../data/vocab.json', import.meta.url);
const CHOOSER_PATH = new URL('../data/chooser.json', import.meta.url);
const BATCH_SIZE = 20;

// beau/nouveau/vieux elide to bel/nouvel/vieil before a vowel or mute h, a
// third form this category does not model — so these three simply never
// pair with a vowel-initial noun, rather than risk "beau homme".
const ELIDES_BEFORE_VOWEL = new Set(['beau', 'nouveau', 'vieux']);
const VOWEL_OR_MUTE_H = /^[aeiouyâàéèêëîïôûùh]/i;

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    sentence: { type: 'string' },
    why: { type: 'string' },
    sentenceNl: { type: 'string' },
  },
  required: ['id', 'sentence', 'why', 'sentenceNl'],
  additionalProperties: false,
};

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: ITEM_SCHEMA } },
  required: ['items'],
  additionalProperties: false,
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildSpecs(adjectives, nouns, count, startAt) {
  const plainNouns = nouns.filter((n) => !VOWEL_OR_MUTE_H.test(n.fr));
  const specs = [];

  for (let i = 0; i < count; i++) {
    const adj = pick(adjectives);
    const pool = ELIDES_BEFORE_VOWEL.has(adj.base) ? plainNouns : nouns;
    const noun = pick(pool);
    const correct = noun.gender === 'f' ? adj.fs : adj.ms;

    specs.push({
      id: `ch-${String(startAt + i + 1).padStart(3, '0')}`,
      category: 'agreement',
      adjective: adj.base,
      en: adj.en,
      noun: `${noun.article} ${noun.fr}`,
      options: [adj.ms, adj.fs],
      answer: correct,
      note: adj.note,
    });
  }
  return specs;
}

function systemPrompt() {
  return `You are writing fill-in-the-blank items testing French adjective agreement, for a
Dutch-speaking learner (interface in English). Dutch adjectives barely inflect, so this
agreement is a real, specific difficulty, not filler.

For each spec: a noun phrase (with its article, so its gender is fixed), an adjective, and the
two candidate forms (masculine and feminine singular) already computed for you — do not alter
them. Write:

- sentence: a natural, everyday French sentence containing exactly one blank, written as
  "___", where the adjective belongs, describing the given noun. Some of these adjectives
  normally come before the noun rather than after (beau, nouveau, vieux, bon, gros, premier,
  dernier are typical examples); place the blank wherever is grammatically natural for this
  specific adjective. Four to fourteen words.
- why: one sentence in English stating the noun's gender and that this is why the given form
  agrees, specific to this sentence.
- sentenceNl: a natural Dutch translation of the whole completed sentence (blank filled in
  with the correct form), the way a fluent Dutch speaker would actually say it, not word for
  word.

Return each item with its original id unchanged.`;
}

function buildUserMessage(batch) {
  const lines = batch.map((s) =>
    `id=${s.id} noun="${s.noun}" adjective=${s.adjective} (${s.en}) masculine="${s.options[0]}" feminine="${s.options[1]}" correct="${s.answer}"`
  );
  return `Items:\n${lines.join('\n')}`;
}

async function callClaude(batch) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Export it in your shell before running this script.');
  }

  const body = {
    model: MODEL,
    max_tokens: 4000,
    system: systemPrompt(),
    messages: [{ role: 'user', content: buildUserMessage(batch) }],
    output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
  };

  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      const text = data.content.find((b) => b.type === 'text')?.text;
      return JSON.parse(text);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      console.log(`HTTP ${res.status}, retrying in ${Math.min(2 ** attempt, 30)}s (attempt ${attempt}/5)...`);
      await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 1000, 30000)));
      continue;
    }
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }
  throw new Error('Unreachable');
}

function parseArgs() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }));
  return { count: args.count ? Number(args.count) : 30 };
}

async function main() {
  const { count } = parseArgs();

  const adjectives = JSON.parse(await readFile(ADJECTIVES_PATH, 'utf8'));
  const vocab = JSON.parse(await readFile(VOCAB_PATH, 'utf8'));
  const nouns = vocab.filter((e) => e.pos === 'noun' && (e.gender === 'm' || e.gender === 'f') && e.article);

  if (nouns.length === 0) {
    console.error('No nouns with a known m/f gender found in data/vocab.json.');
    process.exitCode = 1;
    return;
  }

  const chooser = JSON.parse(await readFile(CHOOSER_PATH, 'utf8'));
  const maxId = chooser.reduce((max, item) => {
    const n = Number(String(item.id).replace('ch-', ''));
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);

  const specs = buildSpecs(adjectives, nouns, count, maxId);
  const byId = new Map(specs.map((s) => [s.id, s]));
  const added = [];

  for (let i = 0; i < specs.length; i += BATCH_SIZE) {
    const batch = specs.slice(i, i + BATCH_SIZE);
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: items ${batch[0].id}-${batch[batch.length - 1].id}...`);
    const beforeCount = added.length;
    const { items } = await callClaude(batch);

    for (const item of items) {
      const spec = byId.get(item.id);
      if (!spec) continue;
      if (!item.sentence.includes('___')) {
        console.log(`  Rejected ${item.id}: no blank in sentence`);
        continue;
      }
      added.push({
        id: spec.id,
        sentence: item.sentence,
        sentenceNl: item.sentenceNl,
        options: spec.options,
        answer: spec.answer,
        why: item.why,
        category: spec.category,
        note: spec.note,
      });
    }

    // Persist after every batch: an interrupted run must cost at most one batch.
    await writeFile(CHOOSER_PATH, JSON.stringify([...chooser, ...added], null, 2), 'utf8');
    console.log(`  +${added.length - beforeCount} added, saved.`);
  }

  console.log(`\nAdded ${added.length} agreement items. chooser.json now has ${chooser.length + added.length} items.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
