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
import { isIrregular } from './lexique-verbs.mjs';

const BATCH_SIZE = 40;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const API_URL = 'https://api.anthropic.com/v1/messages';

const CANDIDATES_PATH = new URL('../data/frequency/lexique-top.json', import.meta.url);
const VOCAB_PATH = new URL('../data/vocab.json', import.meta.url);
const STATE_PATH = new URL('../data/enrich-state.json', import.meta.url);
const VERB_FORMS_PATH = new URL('../data/frequency/verb-forms.json', import.meta.url);
const VERBS_PATH = new URL('../data/verbs.json', import.meta.url);

// A candidate is identified by its lemma and part of speech, never by its
// position in the list: devoir the noun and devoir the verb are two words,
// and the list's ranks shift whenever it is rebuilt.
const keyOf = (c) => `${c.fr}|${c.pos}`;

// l' is deliberately not a valid article here: real elision (l'hôpital)
// hides the gender the learner is trying to build, so a vowel-initial noun
// still gets le/la/un/une, matching its actual gender, even though that is
// not how a French speaker would write it.
const ARTICLES = new Set(['le', 'la', 'un', 'une']);
const MASCULINE_ARTICLES = new Set(['le', 'un']);
const FEMININE_ARTICLES = new Set(['la', 'une']);

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
    nlForms: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            pc: { type: 'string' },
            futur: { type: 'string' },
            imparfait: { type: 'string' },
          },
          required: ['pc', 'futur', 'imparfait'],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ['rank', 'article', 'nl', 'example', 'exampleNl', 'familiar', 'falseFriend', 'note', 'nlForms'],
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
    fr: 'voiture', article: 'une', nl: 'de auto', pos: 'noun', gender: 'f',
    example: 'Ma voiture est en panne.', exampleNl: 'Mijn auto is kapot.',
    familiar: false, falseFriend: null, note: null,
  },
  {
    fr: 'maison', article: 'une', nl: 'het huis', pos: 'noun', gender: 'f',
    example: "J'habite dans une maison.", exampleNl: 'Ik woon in een huis.',
    familiar: false, falseFriend: null, note: null,
  },
  {
    fr: 'content', article: null, nl: 'blij, tevreden', pos: 'adj', gender: null,
    example: 'Je suis très content.', exampleNl: 'Ik ben erg blij.',
    familiar: false, falseFriend: null, note: 'Not related to Dutch "content" (inhoud).',
  },
  {
    fr: 'temps', article: 'le', nl: 'de tijd, het weer', pos: 'noun', gender: 'm',
    example: "Je n'ai pas le temps.", exampleNl: 'Ik heb geen tijd.',
    familiar: false, falseFriend: null, note: null,
  },
  {
    fr: 'aller', article: null, nl: 'gaan', pos: 'verb', gender: null,
    example: 'Je vais au marché.', exampleNl: 'Ik ga naar de markt.',
    familiar: false, falseFriend: null, note: null,
    nlForms: { pc: 'ik ben gegaan', futur: 'ik zal gaan', imparfait: 'ik ging' },
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

Skip, with a one-word reason, if the word is: a proper noun, a function word, an
interjection with no stable meaning, crude, an English artefact, a duplicate of
something you already produced in this batch, or a verb that is essentially only used
pronominally (se souvenir, s'en aller), since the bare infinitive would teach a form
nobody uses.

pos and gender are given to you as facts from a lexical database. Use them; do not
guess or second-guess them.

Fields to produce:
- article: mandatory for nouns, one of le, la, un, une. Never l', even when the word
  starts with a vowel or mute h and a real French speaker would always elide (l'hôpital,
  l'eau) — write le hôpital, une eau instead. This is deliberately not how French is
  actually written: l' hides the gender a learner is trying to build, so pick le/la/un/une
  by the given gender (masculine: le, un; feminine: la, une) every time, elision or not.
  Whichever of definite/indefinite reads most naturally for how the word is normally
  introduced. Null for non-nouns.
- nl: the one to three most useful Dutch senses, comma separated. For every sense that
  is itself a countable Dutch noun, prefix it with its own article, de or het — judge
  each sense on its own Dutch gender, which does not have to match the French word's
  gender and does not have to be the same across senses (temps is "de tijd, het weer",
  not "de tijd, de weer"). Leave a sense bare only when it genuinely takes no article in
  Dutch (a plural, an adjective or adverb used as the gloss, a fixed greeting). Never
  guess if unsure of de/het; use the form you are most confident is correct.
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
- nlForms: verbs only, null for every other word. The Dutch of the verb's main sense
  (the first sense in nl) in three French tenses, first person singular, written the
  way a Dutch speaker would say it:
  pc: the passé composé as a Dutch perfect (ik ben gegaan, ik heb gegeten),
  futur: the futur simple with zullen (ik zal gaan),
  imparfait: the imparfait as a Dutch simple past (ik ging, ik at).
  For a verb that only exists in the third person (falloir, pleuvoir) or is almost
  only used in it (coûter, durer) use the Dutch that matches French il or ça: het
  heeft geregend, het zal regenen, het regende. Never put an object pronoun in these
  forms (het heeft toebehoord, not het heeft mij toebehoord): the French card has none.
  Pronominal verbs are skipped (see above), so these forms never contain me or zich.
- For verbs, nl is the infinitive in Dutch (gaan, eten, zich herinneren), article null,
  and the example uses the verb conjugated naturally.

Format contract, four real entries already in the bank:
${JSON.stringify(BOOTSTRAP_EXAMPLES, null, 2)}`;
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
  if (candidate.pos === 'verb') {
    if (entry.article) return `verb "${candidate.fr}" has article "${entry.article}", expected null`;
    const f = entry.nlForms;
    if (!f || ![f.pc, f.futur, f.imparfait].every((x) => typeof x === 'string' && x.trim())) {
      return 'verb missing nlForms';
    }
  } else if (entry.nlForms) {
    return `non-verb "${candidate.fr}" has nlForms`;
  }
  if (candidate.pos === 'noun') {
    if (!candidate.gender || !entry.article) return 'noun missing gender or article';
    if (!ARTICLES.has(entry.article)) return `unknown article "${entry.article}"`;
    const genderOk = candidate.gender === 'm'
      ? MASCULINE_ARTICLES.has(entry.article)
      : candidate.gender === 'f'
        ? FEMININE_ARTICLES.has(entry.article)
        : true; // mf: either is fine
    if (!genderOk) return `article "${entry.article}" disagrees with gender "${candidate.gender}"`;
  } else if (entry.article) {
    // A non-noun with an article usually means the LLM picked a fixed phrase
    // (un peu) instead of grading the bare word (peu) the candidate actually
    // is, which then gets produce-tested with the wrong surface form.
    return `non-noun "${candidate.fr}" (${candidate.pos}) has article "${entry.article}", expected null`;
  }
  if (Boolean(entry.example) !== Boolean(entry.exampleNl)) return 'example and exampleNl must both be present or both absent';
  if (!entry.nl || !entry.nl.trim()) return 'missing nl gloss';
  return null;
}

// Conjugation data for a verb: the hand-verified data/verbs.json entry when
// the verb is one of those 50, otherwise what scripts/fetch-frequency.mjs
// built from Lexique. Null when neither has a complete set of forms.
function conjugationFor(candidate, verbForms, verifiedVerbs) {
  const source = verifiedVerbs[candidate.fr] ?? verbForms[candidate.fr];
  if (!source) return null;
  const { infinitive, aux, participle, present, futureStem, imperfectStem, impersonal } = source;
  const conj = { infinitive, aux, participle, present, futureStem };
  if (imperfectStem) conj.imperfectStem = imperfectStem;
  if (impersonal) conj.impersonal = true;
  // Verbs mode already drills the 50 verified verbs per tense, so their
  // vocabulary cards stop at the infinitive. See src/vocab-cards.js.
  if (verifiedVerbs[candidate.fr]) conj.inVerbsMode = true;
  return { ...conj, irregular: isIrregular(conj) };
}

// The next batch: candidates in rank order that are neither in the bank nor
// already handled. Verbs without conjugation data are skipped here, before
// any API call, so they never cost anything.
function nextBatch(candidates, vocab, state, verbForms, verifiedVerbs) {
  const handled = new Set([...vocab.map(keyOf), ...state.done]);
  // Outside verbs, one lemma is one word, whatever its part of speech: the
  // app keys non-verb cards by lemma alone, so le petit next to petit would
  // share progress. The first (most frequent) one in wins.
  const nonVerbLemmas = new Set(vocab.filter((v) => v.pos !== 'verb').map((v) => v.fr));
  const batch = [];
  const noForms = [];
  for (const c of candidates) {
    if (batch.length >= BATCH_SIZE) break;
    if (handled.has(keyOf(c))) continue;
    if (c.pos !== 'verb' && nonVerbLemmas.has(c.fr)) continue;
    if (c.pos !== 'verb') nonVerbLemmas.add(c.fr);
    if (c.pos === 'verb' && !conjugationFor(c, verbForms, verifiedVerbs)) {
      noForms.push(c);
      continue;
    }
    batch.push(c);
  }
  return { batch, noForms };
}

async function runBatch(batch, verbForms, verifiedVerbs) {
  if (batch.length === 0) return { added: [], skipped: [] };

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
    const word = {
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
    };
    if (candidate.pos === 'verb') {
      word.verb = conjugationFor(candidate, verbForms, verifiedVerbs);
      word.nlForms = entry.nlForms;
      // "het kost", "het duurt": a verb mostly used in the third person. Its
      // tense cards then ask for il/ça instead of je. See src/vocab-cards.js.
      const forms = Object.values(entry.nlForms);
      if (!word.verb.impersonal && forms.every((f) => /^het\s/i.test(f))) word.verb.thirdPerson = true;
    }
    added.push(word);
  }

  // Ranks the model neither entered nor skipped would otherwise be retried
  // forever; record them so the next batch moves on.
  const answered = new Set([...added.map((a) => a.rank), ...skipped.map((x) => x.rank)]);
  for (const c of batch) {
    if (!answered.has(c.rank)) skipped.push({ rank: c.rank, reason: 'no answer' });
  }

  return { added, skipped };
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
  let state = await readJSON(STATE_PATH, { version: 2, done: [], rejected: [], lastBatch: null });
  if (state.version !== 2) {
    console.error('data/enrich-state.json is in the old cursor format. It was migrated once by hand; see git history.');
    process.exitCode = 1;
    return;
  }
  const verbForms = await readJSON(VERB_FORMS_PATH, {});
  const verifiedVerbs = Object.fromEntries(
    ((await readJSON(VERBS_PATH, { verbs: [] })).verbs ?? []).map((v) => [v.infinitive, v])
  );
  const byRank = new Map(candidates.map((c) => [c.rank, c]));

  if (args['review-last']) {
    if (!state.lastBatch) {
      console.log('No batch has been run yet.');
      return;
    }
    printReview(state.lastBatch.added, state.lastBatch.skipped);
    return;
  }

  if (args['dry-run']) {
    const { batch, noForms } = nextBatch(candidates, vocab, state, verbForms, verifiedVerbs);
    console.log(`Next batch, no API call (${batch.length} words${noForms.length ? `, ${noForms.length} verbs skipped for missing forms` : ''}):`);
    console.table(batch.map((c) => {
      const conj = c.pos === 'verb' ? conjugationFor(c, verbForms, verifiedVerbs) : null;
      return { rank: c.rank, fr: c.fr, pos: c.pos, gender: c.gender ?? '', irregular: conj ? conj.irregular : '' };
    }));
    return;
  }

  const target = args.target ? Number(args.target) : null;
  const batchCount = args.batches ? Number(args.batches) : (target ? Infinity : 1);

  let batchesRun = 0;
  while (batchesRun < batchCount) {
    if (target && vocab.length >= target) break;
    const { batch, noForms } = nextBatch(candidates, vocab, state, verbForms, verifiedVerbs);
    if (batch.length === 0) {
      console.log('Ran out of candidates.');
      break;
    }

    console.log(`\nBatch ${batchesRun + 1}: ranks ${batch[0].rank} to ${batch[batch.length - 1].rank}...`);
    const { added, skipped: modelSkipped } = await runBatch(batch, verbForms, verifiedVerbs);
    const skipped = [
      ...noForms.map((c) => ({ rank: c.rank, reason: 'verb without complete forms' })),
      ...modelSkipped,
    ];

    const skippedRecords = skipped.map((x) => ({
      key: byRank.has(x.rank) ? keyOf(byRank.get(x.rank)) : null,
      reason: x.reason,
      batch: todayISO(),
    })).filter((x) => x.key);

    // A word the model silently left out gets one more try in a later batch;
    // only a second miss marks it done.
    const missedBefore = new Set(state.rejected.filter((r) => r.reason === 'no answer').map((r) => r.key));
    const doneNow = skippedRecords
      .filter((x) => x.reason !== 'no answer' || missedBefore.has(x.key))
      .map((x) => x.key);

    vocab = [...vocab, ...added];
    state = {
      version: 2,
      done: [...state.done, ...doneNow],
      rejected: [...state.rejected, ...skippedRecords],
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
