// Generates data/chooser.json: 100 imparfait-vs-passe-compose items.
// See BRIEF.md section 9. The conjugated forms come from src/conjugate.js,
// not from the model, so they are guaranteed correct; the model's only job
// is writing a natural sentence and a one-sentence English "why" around
// forms that are already fixed.
import { readFile, writeFile } from 'node:fs/promises';
import { conjugate } from '../src/conjugate.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const API_URL = 'https://api.anthropic.com/v1/messages';
const VERBS_PATH = new URL('../data/verbs.json', import.meta.url);
const OUTPUT_PATH = new URL('../data/chooser.json', import.meta.url);

const PERSONS = ['je', 'tu', 'il', 'nous', 'vous', 'ils'];
const MEANING_SHIFT_VERBS = ['être', 'avoir', 'savoir', 'vouloir', 'pouvoir'];
const BATCH_SIZE = 20;

const CATEGORY_DESCRIPTIONS = {
  background: 'Background versus event: an ongoing situation or action already in progress (imparfait), interrupted or punctuated by a single completed action (passé composé). Classic shape: "X was happening when Y happened."',
  habit: 'Habit versus single occurrence: something done repeatedly or as a routine (imparfait) versus one specific, identifiable time it happened (passé composé). Look for words like "toujours", "chaque semaine", "d\'habitude" for the habit side, and "un jour", "hier", "cette fois-là" for the single occurrence side.',
  state: 'State of mind or description versus change of state: how someone or something simply was (imparfait) versus a shift, reaction, or transformation that occurred (passé composé). Example shape: "il faisait froid" (it was cold, ongoing) versus "il a fait froid toute la semaine" (it was cold for a bounded week) or a sudden reaction.',
  duration: 'Duration bounded by an explicit time limit stated in the sentence (pendant deux ans, toute la semaine, trois fois, pendant longtemps). Even though the action itself lasted a while, the explicit boundary forces passé composé, not imparfait. The correct answer for every item in this category is the passé composé form.',
  meaning: 'A verb whose usual English/Dutch gloss shifts between the two tenses: imparfait describes an ongoing state or ability, passé composé describes the specific moment something changed, was discovered, or was decided. Example: je savais (I knew, ongoing) versus j\'ai su (I found out, one moment). Only être, avoir, savoir, vouloir, pouvoir are used for this category.',
};

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    sentence: { type: 'string' },
    why: { type: 'string' },
  },
  required: ['id', 'sentence', 'why'],
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

function buildSpecs(verbs) {
  const byName = Object.fromEntries(verbs.map((v) => [v.infinitive, v]));
  const eligible = verbs.filter((v) => !v.impersonal);
  const specs = [];
  let n = 1;

  const push = (category, verb, personIndex, correctTense) => {
    const imparfait = conjugate(verb, 'imparfait')[personIndex];
    const passeCompose = conjugate(verb, 'passe-compose')[personIndex];
    specs.push({
      id: `ch-${String(n).padStart(3, '0')}`,
      category,
      verb: verb.infinitive,
      en: verb.en,
      person: PERSONS[personIndex],
      options: [imparfait, passeCompose],
      answer: correctTense === 'imparfait' ? imparfait : passeCompose,
      correctTense,
    });
    n += 1;
  };

  for (const category of ['background', 'habit', 'state']) {
    for (let i = 0; i < 20; i++) {
      push(category, pick(eligible), Math.floor(Math.random() * 6), i % 2 === 0 ? 'imparfait' : 'passe-compose');
    }
  }

  for (let i = 0; i < 20; i++) {
    push('duration', pick(eligible), Math.floor(Math.random() * 6), 'passe-compose');
  }

  for (const infinitive of MEANING_SHIFT_VERBS) {
    for (let i = 0; i < 4; i++) {
      push('meaning', byName[infinitive], Math.floor(Math.random() * 6), i % 2 === 0 ? 'imparfait' : 'passe-compose');
    }
  }

  return specs;
}

function systemPrompt() {
  return `You are writing fill-in-the-blank items for a French learner (interface in English) who
already knows both the imparfait and passé composé forms in isolation, but struggles to choose
between them, since Dutch splits this differently (onvoltooid verleden tijd versus voltooid
tegenwoordige tijd) than French does. This is the highest-value screen in the app: form is not
the problem, meaning is.

For each spec you are given: an id, a verb, a grammatical person, a category, and the two exact
conjugated forms already computed for you (do not alter them). Write:

- sentence: a natural, everyday French sentence containing exactly one blank, written as "___",
  where the target verb form belongs. The blank's grammatical subject must match the given
  person — use the pronoun itself or a natural noun phrase of the same person and number (e.g.
  "les enfants" for ils, "ma sœur et moi" for nous). Both provided forms must be grammatically
  valid if inserted in the blank; only the specified correct one may fit the meaning. The
  sentence needs enough context (a time word, a second clause, an explicit duration) to make
  the correct choice unambiguous. Six to twenty words.
- why: one sentence in English explaining why the correct form fits and the other does not,
  specific to this sentence, not a generic rule restatement.

Category definitions:
${Object.entries(CATEGORY_DESCRIPTIONS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

Return each item with its original id unchanged.`;
}

function buildUserMessage(batch) {
  const lines = batch.map((s) =>
    `id=${s.id} verb=${s.verb} (${s.en}) person=${s.person} category=${s.category} ` +
    `imparfait="${s.options[0]}" passe-compose="${s.options[1]}" correct=${s.correctTense}`
  );
  return `Items:\n${lines.join('\n')}`;
}

async function callClaude(batch) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');

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
      await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 1000, 30000)));
      continue;
    }
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }
}

async function main() {
  const { verbs } = JSON.parse(await readFile(VERBS_PATH, 'utf8'));
  const specs = buildSpecs(verbs);
  const byId = new Map(specs.map((s) => [s.id, s]));
  const results = [];

  for (let i = 0; i < specs.length; i += BATCH_SIZE) {
    const batch = specs.slice(i, i + BATCH_SIZE);
    console.log(`Batch ${i / BATCH_SIZE + 1}: items ${batch[0].id}-${batch[batch.length - 1].id}...`);
    const { items } = await callClaude(batch);

    for (const item of items) {
      const spec = byId.get(item.id);
      if (!spec) continue;
      if (!item.sentence.includes('___')) {
        console.log(`  Rejected ${item.id}: no blank in sentence`);
        continue;
      }
      results.push({
        id: spec.id,
        sentence: item.sentence,
        options: spec.options,
        answer: spec.answer,
        why: item.why,
        verb: spec.verb,
        category: spec.category,
      });
    }
  }

  await writeFile(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nWrote ${results.length} items to data/chooser.json`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
