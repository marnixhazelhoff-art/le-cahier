// Appends 4-way tense-choice items to data/chooser.json: présent, imparfait,
// futur simple and passé composé for one person of one verb, all four
// computed by conjugate.js (not the model). Category is tense-4way, grouped
// under the same "Verbs (tenses)" umbrella as the existing imparfait/passé
// composé items in src/modules.js — to a learner picking what to practice,
// four tenses instead of two is still one skill: choosing the right tense.
//
// Runs across every verb, être-aux included: the passé composé option for
// those just displays with the agreement marker as-is (je suis allé(e)),
// same as everywhere else in the app. No verb is easier than another here.
//
//   node scripts/generate-tense-chooser.mjs --count=40
//
// Always appends: existing chooser.json items, their ids and review history
// are never touched, renumbered or regenerated.
import { readFile, writeFile } from 'node:fs/promises';
import { conjugate } from '../src/conjugate.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const API_URL = 'https://api.anthropic.com/v1/messages';
const VERBS_PATH = new URL('../data/verbs.json', import.meta.url);
const CHOOSER_PATH = new URL('../data/chooser.json', import.meta.url);
const STATE_PATH = new URL('../data/tense-chooser-state.json', import.meta.url);
const BATCH_SIZE = 20;

const PERSONS = ['je', 'tu', 'il', 'nous', 'vous', 'ils'];
const ASSIGNMENTS = ['present', 'imparfait', 'futur', 'passe-compose'];
const TENSE_LABEL = { present: 'présent', imparfait: 'imparfait', futur: 'futur simple', 'passe-compose': 'passé composé' };

const ASSIGNMENT_DESCRIPTIONS = {
  present: 'An ongoing habit, a general truth, or something true right now. Anchor with a present-tense time cue: maintenant, d\'habitude, chaque jour, en ce moment, en général.',
  imparfait: 'A habitual or ongoing action in the past, or background description. Anchor with a past time cue: autrefois, quand j\'étais petit(e), à cette époque-là, tous les étés (in a clearly past-set sentence).',
  futur: 'A specific planned or predicted future action. Anchor with a future time cue: demain, l\'année prochaine, bientôt, dans deux jours.',
  'passe-compose': 'A single completed action at a specific past moment. Anchor with a completed-past time cue: hier, la semaine dernière, ce matin, une fois, soudain.',
};

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

function buildSpecs(verbs, count, startAt) {
  const eligible = verbs.filter((v) => !v.impersonal);
  const specs = [];

  for (let i = 0; i < count; i++) {
    const verb = pick(eligible);
    const person = Math.floor(Math.random() * 6);
    const assignment = ASSIGNMENTS[i % ASSIGNMENTS.length];
    const forms = {
      present: conjugate(verb, 'present')[person],
      imparfait: conjugate(verb, 'imparfait')[person],
      futur: conjugate(verb, 'futur')[person],
      'passe-compose': conjugate(verb, 'passe-compose')[person],
    };

    specs.push({
      id: `ch-${String(startAt + i + 1).padStart(3, '0')}`,
      category: 'tense-4way',
      verb: verb.infinitive,
      en: verb.en,
      person: PERSONS[person],
      forms,
      assignment,
      options: ASSIGNMENTS.map((a) => forms[a]),
      answer: forms[assignment],
    });
  }
  return specs;
}

function systemPrompt() {
  return `You are writing fill-in-the-blank items for a Dutch-speaking French learner (interface
in English) who already knows how to form présent, imparfait, futur simple and passé composé
in isolation, but has to choose the right one for a given moment in time. Dutch does not split
tense this way, so this is a real, specific difficulty.

For each spec: a verb, a grammatical person, and the four conjugated forms already computed for
you (présent, imparfait, futur, passé composé) — do not alter them. The passé composé form may
end in "(e)" or "(e)s": that is the real written agreement marker, not a placeholder, and it
belongs in the blank exactly as given. You are also told which one is correct and why kind of
time frame it represents. Write:

- sentence: a natural, everyday French sentence containing exactly one blank, written as
  "___", where the target form belongs. The blank's subject must match the given person — use
  the pronoun itself or a natural noun phrase of the same person and number. All four given
  forms must be grammatically insertable in the blank (same slot); only the assigned one may
  fit the meaning, because of the sentence's own time cue. Six to twenty words.
- why: one sentence in English explaining why the assigned tense fits this sentence and the
  other three would not, specific to this sentence, not a generic rule restatement.
- sentenceNl: a natural Dutch translation of the whole completed sentence, the way a fluent
  Dutch speaker would actually say it, not word for word.

What each assignment means, and the kind of time cue to anchor it with:
${Object.entries(ASSIGNMENT_DESCRIPTIONS).map(([k, v]) => `- ${TENSE_LABEL[k]}: ${v}`).join('\n')}

Return each item with its original id unchanged.`;
}

function buildUserMessage(batch) {
  const lines = batch.map((s) =>
    `id=${s.id} verb=${s.verb} (${s.en}) person=${s.person} ` +
    `présent="${s.forms.present}" imparfait="${s.forms.imparfait}" futur="${s.forms.futur}" ` +
    `passé-composé="${s.forms['passe-compose']}" correct=${TENSE_LABEL[s.assignment]}`
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
  return { count: args.count ? Number(args.count) : 40, reviewLast: Boolean(args['review-last']) };
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

  const { verbs } = JSON.parse(await readFile(VERBS_PATH, 'utf8'));
  const chooser = JSON.parse(await readFile(CHOOSER_PATH, 'utf8'));
  const maxId = chooser.reduce((max, item) => {
    const n = Number(String(item.id).replace('ch-', ''));
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);

  const specs = buildSpecs(verbs, count, maxId);
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
        verb: spec.verb,
        category: spec.category,
      });
    }

    // Persist after every batch: an interrupted run must cost at most one batch.
    await writeFile(CHOOSER_PATH, JSON.stringify([...chooser, ...added], null, 2), 'utf8');
    await writeFile(STATE_PATH, JSON.stringify({ lastRun: added.slice(beforeCount) }, null, 2), 'utf8');
    console.log(`  +${added.length - beforeCount} added, saved.`);
  }

  console.log(`\nAdded ${added.length} tense-choice items. chooser.json now has ${chooser.length + added.length} items.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
