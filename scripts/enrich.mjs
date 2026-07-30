// Turns frequency candidates into study-ready Dutch vocab entries via the
// Anthropic API. See BRIEF.md section 11.2.
//
//   node scripts/enrich.mjs --target=500     stop when the bank hits 500
//   node scripts/enrich.mjs --batches=5      add five batches
//   node scripts/enrich.mjs --dry-run        show the next batch, call nothing
//   node scripts/enrich.mjs --review-last    reprint the most recent batch
//
// ANTHROPIC_API_KEY is read from the environment and never written to disk.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const BATCH_SIZE = 40;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const API_URL = 'https://api.anthropic.com/v1/messages';

const CANDIDATES_PATH = new URL('../data/frequency/lexique-top.json', import.meta.url);
const VOCAB_PATH = new URL('../data/vocab.json', import.meta.url);
const STATE_PATH = new URL('../data/enrich-state.json', import.meta.url);

const ARTICLES = new Set(['le', 'la', 'un', 'une', "l'"]);
const MASCULINE_ARTICLES = new Set(['le', 'un', "l'"]);
const FEMININE_ARTICLES = new Set(['la', 'une', "l'"]);

const ENTRY_SCHEMA = {
  type: 'object',
  properties: {
    rank: { type: 'integer' },
    article: { type: ['string', 'null'] },
    nl: { type: 'string' },
    example: { type: 'string' },
    exampleNl: { type: 'string' },
    familiar: { type: 'boolean' },
    falseFriend: { type: ['string', 'null'] },
    note: { type: ['string', 'null'] },
  },
  required: ['rank', 'article', 'nl', 'example', 'exampleNl', 'familiar', 'falseFriend', 'note'],
  additionalProperties: false,
};

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    entries: { type: 'array', items: ENTRY_SCHEMA },
    skipped: {
      type: 'array',
      items: {
        type: 'object',
        properties: { rank: { type: 'integer' }, reason: { type: 'string' } },
        required: ['rank', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['entries', 'skipped'],
  additionalProperties: false,
};

const BOOTSTRAP_EXAMPLES = [
  {
    fr: 'voiture', article: 'une', nl: 'auto', pos: 'noun', gender: 'f',
    example: 'Ma voiture est en panne.', exampleNl: 'Mijn auto is kapot.',
    familiar: false, falseFriend: null, note: null,
  },
  {
    fr: 'maison', article: 'une', nl: 'huis', pos: 'noun', gender: 'f',
    example: "J'habite dans une maison.", exampleNl: 'Ik woon in een huis.',
    familiar: false, falseFriend: null, note: null,
  },
  {
    fr: 'content', article: null, nl: 'blij, tevreden', pos: 'adj', gender: null,
    example: 'Je suis très content.', exampleNl: 'Ik ben erg blij.',
    familiar: false, falseFriend: null, note: 'Not related to Dutch "content" (inhoud).',
  },
];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function readJSON(url, fallback) {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch {
    return fallback;
  }
}

function systemPrompt() {
  return `You are building a French vocabulary bank for a Dutch-speaking learner.
All glosses, example translations, and notes are in Dutch. The learner does grammar
separately from a textbook; you are teaching words, not rules.

For each candidate word, either produce a study entry or skip it.

Skip, with a one-word reason, if the word is: a verb, a proper noun, a function word,
an interjection with no stable meaning, crude, an English artefact, or a duplicate of
something you already produced in this batch.

pos and gender are given to you as facts from a lexical database. Use them; do not
guess or second-guess them.

Fields to produce:
- article: mandatory for nouns, one of le, la, un, une, l'. Pick whichever reads most
  naturally for how this word is normally introduced, but it must agree with the given
  gender (masculine: le, un, l'; feminine: la, une, l'). Null for non-nouns.
- nl: the two or three most useful Dutch senses, comma separated, no articles.
- example: a natural French sentence of six words or fewer that a beginner could
  plausibly say. Everyday register, not literary. Include the article for nouns.
  The sentence must contain the target word itself (its exact base form, or a
  direct inflection like a plural), not a different related word. For a word
  like jour, use jour in the example, not journée; save the journée distinction
  for the note field instead.
- exampleNl: a natural Dutch translation, not a word for word gloss.
- familiar: true only when a Dutch speaker would recognise the word with no study
  (bureau, cadeau, paraplu, trottoir, portemonnee, etalage, plafond, horloge, douche,
  fauteuil, restaurant, garage, and words like them).
- falseFriend: a short Dutch-facing warning, or null. Judge this from Dutch, not
  English. Do not import English-facing false friend warnings; many are false for
  Dutch speakers and would teach errors. Example: eventueel is not a trap for a Dutch
  speaker even though it is for an English one.
- note: a real trap only (irregular plural, gender that contradicts the ending, a
  fixed preposition, a meaning that shifts with gender). Never filler. Null if none.

Format contract, three real entries already in the bank:
${JSON.stringify(BOOTSTRAP_EXAMPLES.slice(0, 3), null, 2)}`;
}

function buildUserMessage(batch) {
  const lines = batch.map((c) => `rank=${c.rank} fr="${c.fr}" pos=${c.pos} gender=${c.gender ?? 'n/a'}`);
  return `Candidates (in frequency order):\n${lines.join('\n')}`;
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
        continue; // retry on unparseable JSON, per BRIEF.md section 11.2
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

function validateEntry(entry, candidate) {
  if (candidate.pos === 'noun') {
    if (!candidate.gender || !entry.article) return 'noun missing gender or article';
    if (!ARTICLES.has(entry.article)) return `unknown article "${entry.article}"`;
    const genderOk = candidate.gender === 'm'
      ? MASCULINE_ARTICLES.has(entry.article)
      : candidate.gender === 'f'
        ? FEMININE_ARTICLES.has(entry.article)
        : true; // mf: either is fine
    if (!genderOk) return `article "${entry.article}" disagrees with gender "${candidate.gender}"`;
  }
  if (Boolean(entry.example) !== Boolean(entry.exampleNl)) return 'example and exampleNl must both be present or both absent';
  if (!entry.nl || !entry.nl.trim()) return 'missing nl gloss';
  return null;
}

async function runBatch(candidates, cursor, vocab, state) {
  const seenFr = new Set(vocab.map((v) => v.fr));
  const batch = [];
  let i = cursor;
  while (batch.length < BATCH_SIZE && i < candidates.length) {
    const c = candidates[i];
    i += 1;
    if (seenFr.has(c.fr)) continue;
    batch.push(c);
  }

  if (batch.length === 0) return { nextCursor: i, added: [], skipped: [] };

  const byRank = new Map(batch.map((c) => [c.rank, c]));
  const result = await callClaude(batch);

  const added = [];
  const skipped = [...(result.skipped ?? [])];

  for (const entry of result.entries ?? []) {
    const candidate = byRank.get(entry.rank);
    if (!candidate) {
      skipped.push({ rank: entry.rank, reason: 'unmatched rank' });
      continue;
    }
    const error = validateEntry(entry, candidate);
    if (error) {
      skipped.push({ rank: entry.rank, reason: `rejected: ${error}` });
      continue;
    }
    added.push({
      fr: candidate.fr,
      article: entry.article,
      nl: entry.nl,
      pos: candidate.pos,
      gender: candidate.gender,
      example: entry.example,
      exampleNl: entry.exampleNl,
      familiar: entry.familiar,
      falseFriend: entry.falseFriend,
      note: entry.note,
      rank: candidate.rank,
      batch: todayISO(),
    });
  }

  return { nextCursor: i, added, skipped, batchCandidates: batch };
}

function printReview(added, skipped) {
  console.log(`\n${added.length} added, ${skipped.length} skipped\n`);
  if (added.length > 0) {
    console.table(added.map((e) => ({
      fr: e.fr, article: e.article ?? '', nl: e.nl, pos: e.pos, gender: e.gender ?? '',
      familiar: e.familiar, falseFriend: e.falseFriend ?? '',
    })));
  }
  if (skipped.length > 0) {
    console.log('Skipped:', skipped.map((s) => `#${s.rank} (${s.reason})`).join(', '));
  }
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }));

  const candidates = await readJSON(CANDIDATES_PATH, []);
  if (candidates.length === 0) {
    console.error('data/frequency/lexique-top.json is empty. Run scripts/fetch-frequency.mjs first.');
    process.exitCode = 1;
    return;
  }

  let vocab = await readJSON(VOCAB_PATH, []);
  let state = await readJSON(STATE_PATH, { cursor: 0, rejected: [], lastBatch: null });

  if (args['review-last']) {
    if (!state.lastBatch) {
      console.log('No batch has been run yet.');
      return;
    }
    printReview(state.lastBatch.added, state.lastBatch.skipped);
    return;
  }

  if (args['dry-run']) {
    const preview = candidates.slice(state.cursor, state.cursor + BATCH_SIZE);
    console.log(`Next batch (candidates ${state.cursor}-${state.cursor + preview.length}), no API call:`);
    console.table(preview.map((c) => ({ rank: c.rank, fr: c.fr, pos: c.pos, gender: c.gender ?? '', freq: c.freq })));
    return;
  }

  const target = args.target ? Number(args.target) : null;
  const batchCount = args.batches ? Number(args.batches) : (target ? Infinity : 1);

  let batchesRun = 0;
  while (batchesRun < batchCount) {
    if (target && vocab.length >= target) break;
    if (state.cursor >= candidates.length) {
      console.log('Ran out of candidates.');
      break;
    }

    console.log(`\nBatch ${batchesRun + 1}: candidates from index ${state.cursor}...`);
    const { nextCursor, added, skipped } = await runBatch(candidates, state.cursor, vocab, state);

    vocab = [...vocab, ...added];
    state = {
      cursor: nextCursor,
      rejected: [...state.rejected, ...skipped.map((s) => ({ ...s, batch: todayISO() }))],
      lastBatch: { added, skipped },
    };

    // Persist after every batch, per BRIEF.md section 11.2: an interrupted
    // run must cost at most one batch.
    await mkdir(new URL('../data/', import.meta.url), { recursive: true });
    await writeFile(VOCAB_PATH, JSON.stringify(vocab, null, 2), 'utf8');
    await writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');

    printReview(added, skipped);
    batchesRun += 1;
  }

  console.log(`\nVocab bank: ${vocab.length} entries.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
