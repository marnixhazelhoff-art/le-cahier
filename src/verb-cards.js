// Builds the fixed verb-drilling deck described in BRIEF.md section 7.
// Card types are derived from verbs.json by rule, not hand-picked, so this
// file stays correct if verbs.json ever changes without a matching rewrite
// here. Never generates the full 50 x 4 x 6 grid; see section 7 for why.
import { conjugate, subject, SUBJECTS } from './conjugate.js';

const REGULAR_MODELS = ['parler', 'finir', 'entendre'];

function predictedParticiple(verb) {
  if (verb.group === 1) return verb.infinitive.replace(/er$/, 'é');
  if (verb.group === 2) return verb.infinitive.replace(/ir$/, 'i');
  if (verb.infinitive.endsWith('enir')) return `${verb.infinitive.slice(0, -4)}enu`;
  if (verb.infinitive.endsWith('dre')) return `${verb.infinitive.slice(0, -2)}u`;
  return null; // group 3 has no single reliable rule beyond the two above
}

function predictedFutureStem(verb) {
  return verb.infinitive.endsWith('re') ? verb.infinitive.slice(0, -1) : verb.infinitive;
}

// ils/elles only earns its own card when it introduces a stem that je and
// nous don't already show (ils prennent, ils boivent, ils viennent).
function ilsIntroducesNewStem(verb) {
  const je = verb.present[0];
  const nous = verb.present[3].replace(/ons$/, '');
  const ils = verb.present[5].replace(/ent$/, '');
  return ils !== je && ils !== nous;
}

function makeCard(id, { infinitive, en, kind, tense, person, prompt, expected, note, display }) {
  return { id, infinitive, en, kind, tense, person, prompt, expected, note: note ?? null, display: display ?? null };
}

// Full passé composé for one person: "j'ai mangé", "je suis allé(e)". Where
// agreement applies, conjugate() encodes it as a literal "(e)" marker meant
// for display (BRIEF.md 6: show the rule, not one arbitrary gender) — this
// expands that marker into the two accepted answers gradeAnswer needs, while
// keeping the parenthesised form as the display/correction text.
function passeComposeForm(verb, person) {
  const form = conjugate(verb, 'passe-compose')[person];
  const space = form.indexOf(' ');
  const auxForm = form.slice(0, space);
  const rest = form.slice(space + 1);
  const subj = subject(person, auxForm);
  if (!rest.includes('(')) {
    return { display: `${subj}${auxForm} ${rest}`, accepted: [`${subj}${auxForm} ${rest}`] };
  }
  const masculine = rest.replace('(e)', '');
  const feminine = rest.replace('(e)', 'e');
  return {
    display: `${subj}${auxForm} ${masculine}(e)`,
    accepted: [`${subj}${auxForm} ${masculine}`, `${subj}${auxForm} ${feminine}`],
  };
}

function presentCard(verb, person) {
  const label = SUBJECTS[person];
  return makeCard(`c:${verb.infinitive}:present:${label}`, {
    infinitive: verb.infinitive, en: verb.en, kind: 'present-stem', tense: 'present', person,
    prompt: `${verb.infinitive} (${verb.en}): present, ${label}`,
    expected: verb.present[person],
    note: verb.note,
  });
}

export function buildVerbCardDeck(verbs) {
  const byName = Object.fromEntries(verbs.map((v) => [v.infinitive, v]));
  const cards = [];

  // --- Present, three stem cards (group 3 verbs only) ---------------------
  // entendre is group 3 in the data (French traditionally files regular -re
  // verbs there) but is fully regular within that class, so it is handled
  // once, below, as one of the three regular-pattern models instead.
  for (const verb of verbs) {
    if (verb.group !== 3 || REGULAR_MODELS.includes(verb.infinitive)) continue;
    if (verb.impersonal) {
      cards.push(presentCard(verb, 2));
      continue;
    }
    cards.push(presentCard(verb, 0), presentCard(verb, 3));
    if (ilsIntroducesNewStem(verb)) cards.push(presentCard(verb, 5));
  }

  // --- Regular pattern cards: parler, finir, entendre, all six persons ----
  for (const infinitive of REGULAR_MODELS) {
    const verb = byName[infinitive];
    for (let person = 0; person < 6; person++) {
      cards.push(makeCard(`c:${infinitive}:present:${SUBJECTS[person]}`, {
        infinitive, en: verb.en, kind: 'present-pattern', tense: 'present', person,
        prompt: `${infinitive} (${verb.en}): present, ${SUBJECTS[person]}`,
        expected: verb.present[person],
      }));
    }
  }

  // --- Passé composé, full production ------------------------------------
  // One card per verb that needs one: every être-aux verb (the auxiliary is
  // never optional there), every verb whose participle isn't predictable
  // from its group, and passer (its auxiliary depends on meaning, not form,
  // flagged via its note rather than a fabricated context-free être answer).
  // Asks for the whole form, so choosing avoir or être happens as part of
  // producing the real answer, never as its own multiple-choice step.
  for (const verb of verbs) {
    const irregularParticiple = predictedParticiple(verb) !== verb.participle;
    if (verb.aux !== 'être' && verb.infinitive !== 'passer' && !irregularParticiple) continue;
    const person = verb.impersonal ? 2 : 0;
    const label = verb.impersonal ? 'il' : 'je';
    const { display, accepted } = passeComposeForm(verb, person);
    cards.push(makeCard(`c:${verb.infinitive}:passe-compose`, {
      infinitive: verb.infinitive, en: verb.en, kind: 'passe-compose-produce', tense: 'passe-compose', person,
      prompt: `${verb.infinitive} (${verb.en}): passé composé, ${label}`,
      expected: accepted,
      display,
      note: verb.note,
    }));
  }

  // --- Irregular futur stem: only where the stem is not the infinitive ----
  for (const verb of verbs) {
    if (predictedFutureStem(verb) === verb.futureStem) continue;
    const person = verb.impersonal ? 2 : 0;
    const label = verb.impersonal ? 'il' : 'je';
    cards.push(makeCard(`c:${verb.infinitive}:futur:${label}`, {
      infinitive: verb.infinitive, en: verb.en, kind: 'futur-stem', tense: 'futur', person,
      prompt: `${verb.infinitive} (${verb.en}): futur, ${label}`,
      expected: conjugate(verb, 'futur')[person],
      note: verb.note,
    }));
  }

  // --- Imparfait rule: one rule card, plus the être exception --------------
  const manger = byName.manger;
  cards.push(makeCard('c:_rule:imparfait:guard', {
    infinitive: 'manger', en: manger.en, kind: 'imparfait-rule', tense: 'imparfait', person: 3,
    prompt: `${manger.infinitive} (${manger.en}): imparfait, nous (drop the guard before -i)`,
    expected: conjugate(manger, 'imparfait')[3],
    note: 'The e that protects the soft g is only needed before a or o. Drop it before -ions, -iez.',
  }));
  const etre = byName.être;
  cards.push(makeCard('c:_rule:imparfait:etre', {
    infinitive: 'être', en: etre.en, kind: 'imparfait-rule', tense: 'imparfait', person: 0,
    prompt: `${etre.infinitive} (${etre.en}): imparfait, je (the one exception)`,
    expected: conjugate(etre, 'imparfait')[0],
    note: etre.note,
  }));

  return cards;
}
