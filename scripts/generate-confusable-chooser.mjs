// Appends "best word fits" items to data/chooser.json: near-synonym or
// commonly confused French words (bon/bien, savoir/connaître, an/année...)
// where only one fits a given sentence. Unlike the tense-contrast and
// agreement categories, correctness here is semantic, not something code
// can compute in advance, so the model decides both the sentence and which
// word fits. Structural checks (answer is one of the group's words, exactly
// one blank) are automatic; meaning is not. Read through --review-last
// before trusting a batch, same as BRIEF.md section 9 asks for the original
// 100 items.
//
//   node scripts/generate-confusable-chooser.mjs --count=30
//   node scripts/generate-confusable-chooser.mjs --review-last
//
// Always appends: existing chooser.json items, their ids and review history
// are never touched, renumbered or regenerated.
import { readFile, writeFile } from 'node:fs/promises';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const API_URL = 'https://api.anthropic.com/v1/messages';
const CONFUSABLES_PATH = new URL('../data/confusables.json', import.meta.url);
const CHOOSER_PATH = new URL('../data/chooser.json', import.meta.url);
const STATE_PATH = new URL('../data/confusable-state.json', import.meta.url);
const BATCH_SIZE = 20;

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    sentence: { type: 'string' },
    answer: { type: 'string' },
    why: { type: 'string' },
    sentenceNl: { type: 'string' },
  },
  required: ['id', 'sentence', 'answer', 'why', 'sentenceNl'],
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

function buildSpecs(groups, count, startAt) {
  const specs = [];
  for (let i = 0; i < count; i++) {
    const group = pick(groups);
    specs.push({
      id: `ch-${String(startAt + i + 1).padStart(3, '0')}`,
      category: 'confusable',
      group: group.group,
      options: group.words,
      note: group.note,
    });
  }
  return specs;
}

function systemPrompt() {
  return `You are writing fill-in-the-blank items for a Dutch-speaking French learner
(interface in English), testing a group of near-synonym or commonly confused French words
where only one genuinely fits a given sentence. Unlike a grammar contrast, there is no fixed
correct answer here: you decide both the sentence and which word fits, so get this right.

For each spec: a group id, the exact words in the group (do not alter or add to them), and a
short note on how they differ. Write:

- sentence: a natural, everyday French sentence containing exactly one blank, written as
  "___", where one of the given words belongs. Every other word in the group must also be
  grammatically insertable in the blank (same part of speech, same slot), so only meaning
  decides the answer, not grammar. Give the sentence enough context to make the correct word
  unambiguous. Five to sixteen words.
- answer: the exact word from the group (copied exactly as given) that fits this sentence.
- why: one sentence in English explaining why this word fits and the others do not, specific
  to this sentence, not a restatement of the note.
- sentenceNl: a natural Dutch translation of the whole completed sentence, the way a fluent
  Dutch speaker would actually say it, not word for word.

Return each item with its original id unchanged.`;
}

function buildUserMessage(batch) {
  const lines = batch.map((s) => `id=${s.id} group=${s.group} words=[${s.options.join(', ')}] note="${s.note}"`);
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
    console.log(`${item.id} [${item.group}]`);
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

  const groups = JSON.parse(await readFile(CONFUSABLES_PATH, 'utf8'));
  const chooser = JSON.parse(await readFile(CHOOSER_PATH, 'utf8'));
  const maxId = chooser.reduce((max, item) => {
    const n = Number(String(item.id).replace('ch-', ''));
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);

  const specs = buildSpecs(groups, count, maxId);
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
      if (!spec.options.includes(item.answer)) {
        console.log(`  Rejected ${item.id}: answer "${item.answer}" is not one of [${spec.options.join(', ')}]`);
        continue;
      }
      added.push({
        id: spec.id,
        sentence: item.sentence,
        sentenceNl: item.sentenceNl,
        options: spec.options,
        answer: item.answer,
        why: item.why,
        category: spec.category,
        note: spec.note,
      });
    }

    // Persist after every batch: an interrupted run must cost at most one batch.
    await writeFile(CHOOSER_PATH, JSON.stringify([...chooser, ...added], null, 2), 'utf8');
    await writeFile(STATE_PATH, JSON.stringify({ lastRun: added.slice(beforeCount) }, null, 2), 'utf8');
    console.log(`  +${added.length - beforeCount} added, saved.`);
  }

  console.log(`\nAdded ${added.length} confusable items. chooser.json now has ${chooser.length + added.length} items.`);
  console.log('Spot-check these before trusting them: correctness here is semantic, decided by the model, not computed. node scripts/generate-confusable-chooser.mjs --review-last');
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
