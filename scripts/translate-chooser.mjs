// Patches data/chooser.json with a Dutch translation of each item's completed
// sentence (the blank filled in with the correct answer), so the chooser view
// can show it after grading. Never touches id, sentence, options, answer,
// why, verb or category: existing review history for these items must keep
// meaning exactly what it already means.
//
//   node scripts/translate-chooser.mjs
//
// Resumable: skips any item that already has sentenceNl, and writes after
// every batch, so an interrupted run costs at most one batch.
import { readFile, writeFile } from 'node:fs/promises';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const API_URL = 'https://api.anthropic.com/v1/messages';
const CHOOSER_PATH = new URL('../data/chooser.json', import.meta.url);
const BATCH_SIZE = 20;

const ITEM_SCHEMA = {
  type: 'object',
  properties: { id: { type: 'string' }, nl: { type: 'string' } },
  required: ['id', 'nl'],
  additionalProperties: false,
};

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: ITEM_SCHEMA } },
  required: ['items'],
  additionalProperties: false,
};

function systemPrompt() {
  return `You translate completed French sentences into natural Dutch for a Dutch-speaking
French learner. Each sentence is given already completed (its blank filled in with the
correct form). Translate the whole sentence the way a fluent Dutch speaker would actually
say it, not word for word. Return each item with its original id unchanged.`;
}

function buildUserMessage(batch) {
  const lines = batch.map((item) => `id=${item.id} sentence="${item.sentence.replace('___', item.answer)}"`);
  return `Sentences:\n${lines.join('\n')}`;
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

async function main() {
  const chooser = JSON.parse(await readFile(CHOOSER_PATH, 'utf8'));
  const pending = chooser.filter((item) => !item.sentenceNl);

  if (pending.length === 0) {
    console.log('Every item already has a translation.');
    return;
  }

  const byId = new Map(chooser.map((item) => [item.id, item]));
  console.log(`${pending.length} of ${chooser.length} items need a translation.`);

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: items ${batch[0].id}-${batch[batch.length - 1].id}...`);
    const { items } = await callClaude(batch);

    let added = 0;
    for (const result of items) {
      const item = byId.get(result.id);
      if (item && result.nl) {
        item.sentenceNl = result.nl;
        added += 1;
      }
    }

    // Persist after every batch: an interrupted run must cost at most one batch.
    await writeFile(CHOOSER_PATH, JSON.stringify(chooser, null, 2), 'utf8');
    console.log(`  +${added} translated, saved.`);
  }

  console.log(`\nDone. ${chooser.filter((i) => i.sentenceNl).length}/${chooser.length} items now have a translation.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
