// Appends preposition-choice items to data/chooser.json: à (city), au
// (masculine country), en (feminine country) or aux (plural country) — the
// correct one is decided by data/prepositions.json (hand-checked place
// genders, not model-generated), same principle as verbs.json and
// adjectives.json. The model's only job is a natural sentence and a Dutch
// translation around a preposition that is already fixed.
//
//   node scripts/generate-preposition-chooser.mjs --count=30
//
// Always appends: existing chooser.json items, their ids and review history
// are never touched, renumbered or regenerated.
//
// Scope for now: à/au/en/aux with places only (aller à Paris, habiter au
// Portugal...). chez (people), de/du/de la (coming from) and prepositions
// after specific verbs (penser à, se souvenir de) are real too but are each
// their own pattern — natural follow-ups, not folded in here.
import { readFile, writeFile } from 'node:fs/promises';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const API_URL = 'https://api.anthropic.com/v1/messages';
const PLACES_PATH = new URL('../data/prepositions.json', import.meta.url);
const CHOOSER_PATH = new URL('../data/chooser.json', import.meta.url);
const STATE_PATH = new URL('../data/preposition-state.json', import.meta.url);
const BATCH_SIZE = 20;

const PREPOSITION_FOR_TYPE = { city: 'à', masc: 'au', fem: 'en', plural: 'aux' };
const OPTIONS = ['à', 'au', 'en', 'aux'];

const ITEM_SCHEMA = {
  type: 'object',
  properties: { id: { type: 'string' }, sentence: { type: 'string' }, why: { type: 'string' }, sentenceNl: { type: 'string' } },
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

function buildSpecs(places, count, startAt) {
  const specs = [];
  for (let i = 0; i < count; i++) {
    const place = pick(places);
    specs.push({
      id: `ch-${String(startAt + i + 1).padStart(3, '0')}`,
      category: 'preposition',
      place: place.place,
      type: place.type,
      options: [...OPTIONS],
      answer: PREPOSITION_FOR_TYPE[place.type],
    });
  }
  return specs;
}

function systemPrompt() {
  return `You are writing fill-in-the-blank items testing à/au/en/aux before a place name, for a
Dutch-speaking learner (interface in English). Dutch uses "naar/in" for every place regardless
of gender or number, so this four-way split is a real, specific difficulty, not filler.

For each spec: a place name, its type (city, masculine country, feminine country, or plural
country), the four options (à, au, en, aux), and which one is correct — do not alter any of
this. Write:

- sentence: a natural, everyday French sentence containing exactly one blank, written as
  "___", immediately before the place name, using a verb of movement or location (aller,
  habiter, vivre, voyager, être, travailler, and similar). All four options must be
  grammatically parseable in that slot (a French reader could try any of them); only the given
  answer is actually correct, because of the place's own gender and number. Five to fourteen
  words.
- why: one sentence in English stating the place's type (city / masculine country / feminine
  country / plural country) and that this is why the given preposition is correct.
- sentenceNl: a natural Dutch translation of the whole completed sentence, the way a fluent
  Dutch speaker would actually say it, not word for word.

Reference: à + city (à Paris). au + masculine singular country (au Canada). en + feminine
singular country (en France). aux + plural country (aux Pays-Bas).

Return each item with its original id unchanged.`;
}

function buildUserMessage(batch) {
  const lines = batch.map((s) => `id=${s.id} place=${s.place} type=${s.type} options=[${s.options.join(', ')}] correct="${s.answer}"`);
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
  return { count: args.count ? Number(args.count) : 30, reviewLast: Boolean(args['review-last']) };
}

function printReview(items) {
  console.log(`\n${items.length} items from the last run:\n`);
  for (const item of items) {
    console.log(`${item.id}`);
    console.log(`  ${item.sentence}`);
    console.log(`  answer: ${item.answer}`);
    console.log(`  why: ${item.why}`);
    console.log(`  nl: ${item.sentenceNl}\n`);
  }
}

async function readJSON(url, fallback) {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const { count, reviewLast } = parseArgs();

  if (reviewLast) {
    const state = await readJSON(STATE_PATH, null);
    if (!state?.lastRun?.length) {
      console.log('No batch has been run yet.');
      return;
    }
    printReview(state.lastRun);
    return;
  }

  const places = JSON.parse(await readFile(PLACES_PATH, 'utf8'));
  const chooser = JSON.parse(await readFile(CHOOSER_PATH, 'utf8'));
  const maxId = chooser.reduce((max, item) => {
    const n = Number(String(item.id).replace('ch-', ''));
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);

  const specs = buildSpecs(places, count, maxId);
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
      });
    }

    // Persist after every batch: an interrupted run must cost at most one batch.
    await writeFile(CHOOSER_PATH, JSON.stringify([...chooser, ...added], null, 2), 'utf8');
    await writeFile(STATE_PATH, JSON.stringify({ lastRun: added.slice(beforeCount) }, null, 2), 'utf8');
    console.log(`  +${added.length - beforeCount} added, saved.`);
  }

  console.log(`\nAdded ${added.length} preposition items. chooser.json now has ${chooser.length + added.length} items.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
