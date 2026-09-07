// One-time pass adding Dutch de/het articles onto existing noun entries' nl
// field, in place, so recall and produce cards show Dutch nouns the same way
// French nouns already are (gender learned attached to the word, not as a
// separate fact — vocab-cards.js surfaceForm does the same for French).
//
// nl stays a plain comma-separated string; only "de "/"het " gets prepended
// onto senses that are themselves countable Dutch nouns. Going forward,
// enrich.mjs asks for this directly on new entries, so this script only
// needs to run once against the existing bank.
//
//   node scripts/backfill-nl-articles.mjs --dry-run   preview the next batch
//
// ANTHROPIC_API_KEY is read from the environment and never written to disk.
import { readFile, writeFile } from 'node:fs/promises';

const BATCH_SIZE = 40;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const API_URL = 'https://api.anthropic.com/v1/messages';
const VOCAB_PATH = new URL('../data/vocab.json', import.meta.url);

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fr: { type: 'string' },
          nl: { type: 'string' },
        },
        required: ['fr', 'nl'],
        additionalProperties: false,
      },
    },
  },
  required: ['entries'],
  additionalProperties: false,
};

function systemPrompt() {
  return `You are adding Dutch de/het articles onto an existing French-Dutch vocabulary bank
for a Dutch-speaking learner. Each candidate is a noun entry's current "nl" field: one to
three Dutch senses, comma separated, no articles.

Rewrite each "nl" by prepending "de " or "het " onto every sense that is itself a countable
Dutch noun. Judge each sense's gender independently — they do not have to agree with each
other or with the French word's gender. Example: "tijd, weer" becomes "de tijd, het weer",
not "de tijd, de weer", because weer (as in weather) is a het-word even though tijd is a
de-word.

Leave a sense bare only when it genuinely takes no article in Dutch: a plural noun, an
adjective or adverb that slipped into the gloss, a fixed greeting or interjection. Never
guess when unsure of de/het; pick whichever you are more confident is correct rather than
skip it.

Do not change spelling, add senses, remove senses, or reorder senses. The only allowed edit
is prepending "de " or "het " to a sense that does not already have it. Return exactly one
output entry per candidate, matched by "fr".

Format contract:
${JSON.stringify({
    entries: [
      { fr: 'voiture', nl: 'de auto' },
      { fr: 'temps', nl: 'de tijd, het weer' },
      { fr: 'grand', nl: 'groot, lang' },
    ],
  }, null, 2)}`;
}

function buildUserMessage(batch) {
  const lines = batch.map((e) => `fr="${e.fr}" nl="${e.nl}"`);
  return `Candidates:\n${lines.join('\n')}`;
}

async function callClaude(batch) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Export it in your shell before running this script; ' +
      'it is never written to disk.'
    );
  }

  const body = {
    model: MODEL,
    max_tokens: 8000,
    system: systemPrompt(),
    messages: [{ role: 'user', content: buildUserMessage(batch) }],
    output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
  };

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      const text = data.content.find((b) => b.type === 'text')?.text;
      try {
        return JSON.parse(text);
      } catch (err) {
        if (attempt === maxAttempts) throw new Error(`Unparseable JSON after ${maxAttempts} attempts: ${err.message}`);
        continue;
      }
    }

    if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
      const delay = Math.min(2 ** attempt * 1000, 30000);
      console.log(`HTTP ${res.status}, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})...`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }
  throw new Error('Unreachable');
}

function stripArticle(sense) {
  return sense.replace(/^(de|het)\s+/i, '');
}

// The only change the model is allowed to make is prepending an article, so
// stripping one back off must reproduce the original senses exactly, in the
// same order. Anything else means the model touched wording and the result
// is rejected rather than silently trusted.
function sameSenses(originalNl, newNl) {
  const orig = originalNl.split(',').map((s) => s.trim());
  const stripped = newNl.split(',').map((s) => stripArticle(s.trim()));
  return orig.length === stripped.length && orig.every((s, i) => s === stripped[i]);
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }));

  const vocab = JSON.parse(await readFile(VOCAB_PATH, 'utf8'));
  const byFr = new Map(vocab.map((e) => [e.fr, e]));

  // Already-processed nouns have de/het on at least their first sense; a
  // rerun after an interruption only needs to pick up where it left off.
  const pending = vocab.filter((e) => e.pos === 'noun' && !/^(de|het)\s+/i.test(e.nl));

  if (args['dry-run']) {
    const preview = pending.slice(0, BATCH_SIZE);
    console.log(`${pending.length} nouns still need de/het. Next batch:`);
    console.table(preview.map((e) => ({ fr: e.fr, nl: e.nl, rank: e.rank })));
    return;
  }

  if (pending.length === 0) {
    console.log('Every noun already has de/het on its nl field.');
    return;
  }

  let done = 0;
  let rejected = 0;
  while (done + rejected < pending.length) {
    const batch = pending.slice(done + rejected, done + rejected + BATCH_SIZE);
    console.log(`\nBatch: ${batch.length} nouns, starting at "${batch[0].fr}"...`);
    const result = await callClaude(batch);
    const byResultFr = new Map((result.entries ?? []).map((e) => [e.fr, e.nl]));

    for (const candidate of batch) {
      const newNl = byResultFr.get(candidate.fr);
      if (!newNl || !sameSenses(candidate.nl, newNl)) {
        console.log(`  REJECTED ${candidate.fr}: "${candidate.nl}" -> ${JSON.stringify(newNl)}`);
        rejected += 1;
        continue;
      }
      const entry = byFr.get(candidate.fr);
      entry.nl = newNl;
      done += 1;
    }

    // Persist after every batch: an interrupted run must cost at most one
    // batch, same reasoning as enrich.mjs.
    await writeFile(VOCAB_PATH, JSON.stringify(vocab, null, 2), 'utf8');
    console.log(`  ${done} done, ${rejected} rejected so far.`);
  }

  console.log(`\nFinished. ${done} nouns updated, ${rejected} rejected (left unchanged for a manual look).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
