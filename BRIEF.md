# Build brief: *le cahier*, a French vocabulary and conjugation trainer

## How to use this file

1. Make an empty folder and put this file plus `verbs.json` in it.
2. Open Claude Code in that folder.
3. Say: **"Read BRIEF.md. Follow the build order in section 14. Stop at each checkpoint and show me before continuing."**

Do not let it build everything in one pass. The checkpoints exist because the scheduler and the grading rules are the parts that are easy to get subtly wrong, and subtle wrongness here means months of wasted study.

`verbs.json` is already written and verified. Move it to `data/verbs.json` and do not regenerate it.

---

## 1. What this is

A spaced repetition trainer for one specific learner, built to be used daily on a laptop and a phone.

The learner is a Dutch speaker doing French grammar separately, from a textbook. This app teaches two things only: high frequency vocabulary, and the conjugation of the 50 most used verbs across four tenses. It does not teach grammar rules, so do not add grammar lessons, explanation screens, or a curriculum.

Target: 2,000 words. Around 2,000 to 3,000 word families gives roughly 95% coverage of informal spoken French, which is about one unknown word in twenty. That is the milestone this app exists to hit.

Four tenses: présent, passé composé, imparfait, futur simple. Conditionnel présent is built into the engine because it costs nothing (futur stem plus imparfait endings) but is disabled by default.

**The single most important design constraint:** this app must be usable in fifteen minutes a day, forever. Every feature that adds friction to a daily session is a feature that ends the project. When in doubt, cut.

---

## 2. Hard technical constraints

- **No build step.** Vanilla ES modules, served as static files. No Vite, no bundler, no TypeScript compile, no JSX.
- **No runtime dependencies.** Not one npm package in the app itself. Node is used only for scripts.
- **Static hosting.** The whole thing must deploy to GitHub Pages or Cloudflare Pages as a plain folder.
- **Works offline.** Installable PWA, full function with no network.
- **Fonts must degrade.** Google Fonts by link tag with a real system fallback stack, because the app has to work offline on the first flight it meets.
- **All paths relative** (`./data/verbs.json`, not `/data/verbs.json`). GitHub Pages serves from a subpath and absolute paths will break it.

Interface language is **English**. Only the answer side of cards is Dutch.

---

## 3. Repo layout

```
index.html
manifest.webmanifest
service-worker.js
package.json                  scripts only, no dependencies
CLAUDE.md                     see section 15
README.md
icons/
src/
  app.js                      router and tab shell
  store.js                    persistence, data loading
  sync.js                     Supabase sync, built last
  scheduler.js                intervals, grading, card states
  conjugate.js                the four tenses, derived by rule
  grade.js                    answer comparison and accent tolerance
  dom.js                      tiny helpers, no framework
  styles.css
  views/
    home.js  vocab.js  verbs.js  chooser.js  progress.js  settings.js
data/
  verbs.json                  provided, verified, do not regenerate
  vocab.json                  built by the enrichment pipeline
  chooser.json                imparfait vs passé composé items
  frequency/lexique-top.json  built by scripts/fetch-frequency.mjs
scripts/
  serve.mjs                   30 line static server, no deps
  fetch-frequency.mjs         Lexique 3 to ranked candidate list
  enrich.mjs                  candidates to study-ready Dutch entries
  validate.mjs                data integrity and conjugation spot checks
  make-icons.py               Pillow, run once
```

---

## 4. Design direction

The interface is a French school exercise book. Seyès ruling, red margin line, blue-black ink. This is not decoration: the ruling sets the vertical rhythm, and the one place boldness gets spent is the conjugation paradigm, where **endings are picked out in correction red while the stem stays in ink**. That colour split is pedagogical, so it must be driven by the real morphology from `conjugate.js`, not hardcoded per form.

Keep everything else quiet. No cards with drop shadows, no gradients, no rounded pills, no emoji, no progress rings.

```css
:root {
  --paper:        #F5F4EF;
  --paper-sheet:  #FCFBF7;
  --paper-edge:   #E4E1D6;
  --seyes:        #A8B2DE;   /* ruling, strong lines */
  --seyes-faint:  #DFE3F2;   /* ruling, millimetre grid */
  --marge:        #C9403A;   /* margin line, endings, errors */
  --ink:          #1B2A4E;
  --ink-soft:     #64719A;
  --ink-ghost:    #9AA3BE;
  --juste:        #1E7355;   /* correct answers */

  --rule: 30px;              /* Seyès line height, drives all vertical spacing */
  --marge-x: 3.25rem;
  --measure: 46rem;

  --display: 'Instrument Serif', 'Iowan Old Style', Georgia, serif;
  --body: 'Inter Tight', system-ui, -apple-system, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
}
```

Conjugation tables are set in `--mono` so the endings line up vertically down the paradigm. This is a functional choice, keep it.

Quality floor, no announcements: responsive to 360px wide, visible keyboard focus using the margin red, `prefers-reduced-motion` respected, every interactive element reachable by keyboard, the whole review loop operable without a mouse.

---

## 5. Data schemas

### 5.1 `data/verbs.json` (provided)

Only non derivable forms are stored. Everything else is generated by `conjugate.js`.

```json
{
  "rank": 47,
  "infinitive": "manger",
  "en": "to eat",
  "group": 1,
  "aux": "avoir",
  "participle": "mangé",
  "present": ["mange","manges","mange","mangeons","mangez","mangent"],
  "futureStem": "manger",
  "imperfectStem": null,
  "impersonal": false,
  "note": "Keeps the e before a and o to protect the soft g."
}
```

- `present` is always `[je, tu, il/elle, nous, vous, ils/elles]`.
- `futureStem` **includes the final r**. Futur is `futureStem + [ai, as, a, ons, ez, ont]`.
- `imperfectStem` is an override, normally absent. Default is `present[3]` minus `ons`.
- Impersonal verbs (`falloir`) have `null` in every person but the third, and `impersonal: true`.
- The `note` field is a real trap only. Never filler.

**Do not add a Dutch field to verbs.json.** Verb meaning is taught through the English gloss plus the drill itself. Adding Dutch here means re-verifying 50 entries for no learning gain.

### 5.2 `data/vocab.json` (built by the pipeline)

```json
{
  "fr": "voiture",
  "article": "une",
  "nl": "auto",
  "pos": "noun",
  "gender": "f",
  "example": "Ma voiture est en panne.",
  "exampleNl": "Mijn auto is kapot.",
  "familiar": false,
  "falseFriend": null,
  "note": null,
  "rank": 412,
  "batch": "2026-08-03"
}
```

Fields:

- `article` mandatory for nouns (`le`, `la`, `un`, `une`, `l'`). **Nouns are always drilled with the article attached.** Gender learned as a separate fact does not survive contact with speech.
- `pos` one of `noun | adj | adv | prep | conj | expr`. Verbs never appear here, they live in verbs.json.
- `gender` mandatory for nouns, one of `m | f | mf`.
- `familiar` true when the word is already transparent to a Dutch speaker (*bureau, cadeau, paraplu, trottoir, portemonnee, etalage, plafond, horloge, douche, fauteuil, restaurant, garage*). These skip the early intervals, see 8.4.
- `falseFriend` a short Dutch-facing warning, or null. Must be judged **from Dutch, not English.** *éventuellement* is a trap for English speakers and not for Dutch speakers, since it matches *eventueel* exactly. Getting this backwards actively teaches errors.
- `note` a real trap only: irregular plural, gender that contradicts the ending, a fixed preposition, a meaning that shifts with gender (*un poste* / *une poste*). Otherwise null.

### 5.3 `data/chooser.json`

```json
{
  "id": "ch-014",
  "sentence": "Quand je suis arrivé, il ___ la télévision.",
  "options": ["regardait", "a regardé"],
  "answer": "regardait",
  "why": "The watching was already going on when you arrived, so it is the background, not the event.",
  "verb": "regarder"
}
```

---

## 6. `src/conjugate.js`

Rules only. No per-verb tables beyond what the data file holds.

```
IMPARFAIT_ENDINGS = [ais, ais, ait, ions, iez, aient]
FUTUR_ENDINGS     = [ai, as, a, ons, ez, ont]
```

Exposed functions: `conjugate(verb, tense)`, `fullTable(verb, tenses)`, `splitEnding(form, tense, verb)`, `subject(person, form)`.

### The three traps, all of which have caught previous attempts

**1. The soft consonant guard in the imparfait.** The stem comes from the *nous* form, which carries a cedilla or a protective `e` that exists only to keep the consonant soft before `a` and `o`. Before an `i` it must be dropped.

```
manger      nous mangeons     stem "mange"    + ions -> mangions      NOT mangeions
commencer   nous commençons   stem "commenç"  + ions -> commencions   NOT commençions
```

Both keep the guard elsewhere: `je mangeais`, `je commençais`. Implement as a `fixStem(stem, ending)` that only fires when the ending starts with `i`.

**2. `être` is the only verb in the language whose imparfait stem is not the *nous* present form.** It is `ét-`. Everything else derives. Handle it with the `imperfectStem` override, not a special case in code.

**3. Passé composé agreement.** With `être` the participle agrees with the subject. Display it as the base form plus optional letters so the rule stays visible to the learner: `je suis allé(e)`, `nous sommes allé(e)s`. Do not silently pick one gender.

`subject()` elides *je* to *j'* before a vowel or mute h: `j'ai`, `j'étais`, `j'ouvre`.

`splitEnding()` returns `[stem, ending]` for the red-ink display. For imparfait and futur, match the longest ending from the set. For passé composé, split at the space so the auxiliary is the "stem". For présent there is no single ending set, so fall back to the longest shared prefix across the six forms, which is the stem the learner actually perceives.

---

## 7. The verb card model

**Do not generate 50 verbs × 4 tenses × 6 persons = 1,200 cards.** Most of those cells are predictable from a rule, drilling them is pure waste, and the review load will kill the habit inside three weeks.

French irregular presents have at most three stems, so the whole present tense of an irregular verb is recoverable from three forms. Build these card types instead:

| Card type | Scope | Roughly |
|---|---|---|
| Present, three stem cards (`je`, `nous`, `ils`) | group 3 verbs only | 90 |
| Regular pattern cards | `parler`, `finir`, `entendre` as models, all six persons | 18 |
| Auxiliary choice | the `être` verbs in the set, plus the `passer` special case | 10 |
| Irregular participle | only where it is not predictable from the group | 28 |
| Irregular futur stem | only where the stem is not the infinitive | 15 |
| Imparfait rule | one rule card, plus the `être` exception | 2 |
| Imparfait vs passé composé chooser | section 9 | 100 |

Around 260 cards. That is the difference between a project you finish and one you abandon.

Weighting: `je`, `tu`, `il` and `nous` are drilled at full weight. `vous` is recoverable from the *nous* stem and gets no cards of its own. `ils/elles` gets cards only where it introduces a stem the other persons do not show (`ils prennent`, `ils boivent`, `ils viennent`).

**Browse mode** shows the full 6 × 4 table for any verb, generated live from `conjugate.js`. Reference is not drilling. Browsing must never create or schedule cards.

---

## 8. The scheduler (`src/scheduler.js`)

This is the heart of the app. Get it right before building anything pretty.

### 8.1 Card state

```js
{ id, interval, ease, due, reps, lapses, state, lastReviewed }
// state: 'new' | 'learning' | 'review' | 'learned' | 'leech'
```

Card ids: `v:<lemma>:recall` and `v:<lemma>:produce` for vocabulary, `c:<infinitive>:<kind>:<person>` for verbs, `ch:<id>` for chooser items.

### 8.2 Intervals

Ladder target, in days: **2, 5, 12, 30, 75, 180.**

Implement as `interval = round(interval × ease)` with `ease` starting at **2.3**, which reproduces that ladder. Clamp ease to `[1.3, 2.8]`. Graduating interval for a new card is 2 days.

The ladder is not arbitrary. Optimal spacing runs at roughly 10 to 20 percent of the delay you want to retain over, so a word you want in six months needs gaps measured in weeks. Short fixed intervals feel productive and are close to useless.

### 8.3 Grading

Receptive cards are self graded on three buttons. Productive cards are typed and graded automatically.

| Grade | Effect |
|---|---|
| Again | `interval = max(1, round(interval × 0.5))`, `ease -= 0.20`, `lapses += 1` |
| Almost | interval unchanged, card repeats later in the same session, no ease change |
| Good | `interval = round(interval × ease)` |
| Easy | `interval = round(interval × ease × 1.3)`, `ease += 0.15` |

**On failure, halve the interval. Do not reset to day one.** A mature card you just missed is not a new card, and treating it as one is how people end up with a permanent backlog.

Target getting **85 to 90 percent** right. The efficiency optimum for spaced repetition sits around 85 percent, and pushing to 97 percent nearly doubles workload for a marginal gain. If a session is running at 100 percent, the intervals are too short. Surface the session accuracy on the progress screen so this is visible.

### 8.4 States

- `learned` once `interval >= 30`. Keep the 75 and 180 day checks. Nothing retires permanently.
- `leech` at `lapses >= 6`: suspend the card, list it on a "needs rewriting" screen. A word that keeps failing almost always has a bad card, usually a vague translation or a useless example, not a bad learner.
- `familiar: true` words enter at a **12 day** interval instead of 2. Around 150 of the top 2,000 are transparent from Dutch and do not need seven repetitions, they need one and a gender.

### 8.5 Staged productive cards

One receptive card per word first (see French, know the Dutch). The productive card (see Dutch, type the French with article) unlocks **automatically** once the receptive card reaches `interval >= 21`.

Production is roughly three times harder than recognition. Unlocking both at once triples the cost of a word you barely know.

### 8.6 Session

- Default cap: **12 new cards a day**, in settings. At 12/day, 2,000 words takes about six months and review load settles at 100 to 150 items, so 15 to 25 minutes.
- Separate modes for vocabulary, conjugation and the chooser, but **shuffled order inside each mode**. Never present cards grouped by anything.
- Due cards first, then new. Never let new cards starve the queue.
- If the queue is empty, say so and stop. Do not invent extra reps. An empty queue is a finished session, not a failure state.

### 8.7 Ordering of new words: the thing that is counterintuitive

Introduce new words in **frequency order** and nothing else.

Words sharing a category interfere with each other. Semantic sets like *shirt, jacket, sweater* or all the colours together are measurably slower to learn than unrelated words, and that is exactly the batching most textbooks use. Frequency order is naturally mixed and never clusters a category, so it does the right thing for free.

Thematic grouping (a scene: *le marché, le panier, mûr, peser, la monnaie*) does appear to help, unlike categorical grouping, but the evidence is mixed. Use themes **only** for output practice, if that ever gets built. Never for introducing new cards.

So: no "learn the 20 food words" feature. Ever. If it gets requested later, this section is the reason to refuse.

---

## 9. The imparfait vs passé composé chooser

The highest value screen in the app, and the only one that needs content written.

Conjugation tables teach form. Nobody plateaus on form. People plateau for years on *choosing* between imparfait and passé composé, because it is a meaning distinction with no equivalent in Dutch, where the *onvoltooid verleden tijd* and *voltooid tegenwoordige tijd* split on different lines entirely.

Generate 100 items where **both options are grammatically valid** and only one fits the meaning. Cover these contrasts explicitly:

1. Background versus event (*je lisais quand le téléphone a sonné*)
2. Habit versus single occurrence (*j'allais* every Tuesday / *je suis allé* last Tuesday)
3. State of mind and description versus change of state (*il faisait froid* / *il a fait froid toute la semaine*)
4. Duration bounded by an explicit limit, which forces passé composé (*pendant deux ans, j'ai travaillé*)
5. `être`, `avoir`, `savoir`, `vouloir`, `pouvoir` where the tense shifts the meaning (*je savais* I knew / *j'ai su* I found out)

Every item carries a one sentence `why`. Show it after answering, always, right or wrong. This is the one place in the app where explanation belongs.

Generate these with the API, then have the learner review them before they enter the deck. A wrong item here teaches a wrong instinct.

---

## 10. Grading answers (`src/grade.js`)

Compare in this order:

1. Exact match → **Good**
2. Match after Unicode NFD normalisation and stripping combining marks, so the only difference is accents → **Almost**. Show the correction with the missing accent in margin red. Do not reset the interval.
3. Otherwise → **Again**

Rules that follow from French, not from convenience:

- **Accent errors are "almost".** Typing `é` on a Dutch keyboard layout is real friction, and punishing it makes the habit collapse. Show the right form every time.
- **Gender errors are fully wrong.** `le voiture` is Again, not Almost. In French the article is half the word.
- Leading and trailing whitespace, case, and a stripped leading pronoun are all ignored.
- Where a word has two accepted Dutch senses, accept either.
- Never accept a partial match on the stem. `mangions` for `mangeions` is a different fact, not a typo.

Build the **accent input helper**: a small row of `é è ê à â ç î ô û ù` buttons under the input on touch devices, and `Alt` shortcuts on desktop. This removes daily friction and takes twenty minutes.

---

## 11. The enrichment pipeline

### 11.1 Frequency source: use Lexique 3, not a subtitle word list

Lexique 3.83 (lexique.org, CC BY-SA) ships `Lexique383.tsv` with **lemmas, part of speech and gender already attached**. That deletes two entire classes of error: no lemmatisation step, and no guessed genders.

`scripts/fetch-frequency.mjs` should:

1. Read the TSV. **Verify the column names from the header rather than trusting this brief**, but expect roughly: `ortho`, `lemme`, `cgram` (part of speech), `genre` (`m`/`f`), `nombre`, `freqlemfilms2` (per million, film subtitles), `freqlemlivres` (books).
2. Keep rows where `ortho === lemme`, so base forms only.
3. Keep `cgram` in `NOM, ADJ, ADV, PRE, CON`. Drop `VER` entirely, verbs are taught separately. Drop all pronoun, article and determiner classes, since the learner covers those in grammar.
4. Sort by `freqlemfilms2` descending. Subtitle frequency tracks spoken French, which is what this app is for. Written frequency would over-weight literary vocabulary.
5. Write the top 3,000 to `data/frequency/lexique-top.json` as `{rank, fr, pos, gender, freq}`. Take 3,000 to reach 2,000 keepers after rejections.

Fallback if lexique.org is unreachable: `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/fr/fr_50k.txt`, but that gives inflected surface forms with no POS or gender, so the pipeline then has to lemmatise and guess gender. Note the quality cost in the README if you fall back.

### 11.2 `scripts/enrich.mjs`

Turns candidates into study-ready Dutch entries via the Anthropic API.

```
node scripts/enrich.mjs --target=500     stop when the bank hits 500
node scripts/enrich.mjs --batches=5      add five batches
node scripts/enrich.mjs --dry-run        show candidates, call nothing
```

Requirements:

- Batch size **40**. Bigger batches degrade quality noticeably.
- **Resumable.** Write the cursor and the rejection list to `data/enrich-state.json` after every batch. An interrupted run must cost at most one batch.
- Read `ANTHROPIC_API_KEY` from the environment. Never write it to a file. Fail with a clear message if it is missing.
- Retry `429` and `5xx` with exponential backoff. Retry unparseable JSON up to three times.
- Pass Lexique's own `pos` and `gender` to the model as **given facts to be used, not guessed**. This is the main quality win from using Lexique.
- Include three real entries from the existing bank in the prompt as the format contract.
- Validate every returned entry before accepting: required fields present, `pos` in the allowed set, nouns have both `gender` and `article`, `example` and `exampleNl` either both present or both absent. Reject silently and record it, never write a half-formed entry.
- Persist after **every** batch, not at the end.

### 11.3 What the model must be told

The system prompt must specify:

- The learner is a **Dutch** speaker. All glosses, example translations and notes are in Dutch.
- Skip the word entirely, with a one word reason, if it is: a verb, a proper noun, a function word, an interjection with no stable meaning, crude, an English artefact, or a duplicate of something already produced in this batch.
- `nl`: the two or three most useful Dutch senses, comma separated. No articles.
- `article`: mandatory for nouns, taken from Lexique's `genre`.
- `example`: a natural French sentence of six words or fewer that a beginner could plausibly say. Everyday register, not literary. Article included for nouns.
- `exampleNl`: natural Dutch, not a word for word gloss.
- `familiar`: true only when a Dutch speaker would recognise the word with no study.
- `falseFriend`: **judged from Dutch.** Include only when a Dutch speaker would specifically go wrong. Explicitly instruct the model **not** to import English-facing false friend warnings, because many of them are false for Dutch and would teach errors.
- `note`: real traps only. Never filler.
- Return a JSON array, nothing else, no markdown fences.

### 11.4 Review protocol

After each run, print a compact table of the new entries so the learner can skim 40 rows in about two minutes. Someone has to catch wrong genders, and it has to be cheap enough to actually happen. Add `node scripts/enrich.mjs --review-last` to reprint the most recent batch.

---

## 12. PWA

- `manifest.webmanifest` with `192`, `512` and a `maskable` `512` icon, `display: standalone`, `theme_color: #1B2A4E`, `background_color: #F5F4EF`, and **relative** `start_url` and `scope`.
- Service worker: **stale while revalidate**. Serve from cache instantly, refresh in the background. Versioned cache name, `skipWaiting` plus `clients.claim`, old caches deleted on activate.
- **Never cache the Supabase endpoint.** Network only for sync.
- Icon: a scrap of seyès paper with a large `é` in ink blue sitting on the ruling, and the red margin line at the left. Generate with `scripts/make-icons.py` using Pillow so it is reproducible from the palette.
- Fetching `data/*.json` over `file://` is blocked by every browser, so the app must be served. If a fetch fails, show an error that says exactly that and tells the user to run `npm start`. This will happen and a generic error message wastes an hour.

### 12.1 Phone, and the iOS specifics

The phone is where the daily habit actually happens, so this is not a nice to have.

**It has to be hosted.** A laptop `localhost` is not reachable from the phone, and serving over a LAN IP is not a secure context, so service workers and install both refuse. GitHub Pages or Cloudflare Pages over HTTPS, then open the URL on the phone.

**Installing.** Android Chrome offers an install prompt. iOS only installs from **Safari**, never from Chrome on iOS, via Share then Add to Home Screen. There is no prompt to trigger, so put a one line hint in settings explaining it, shown only on iOS.

Then handle these, all of which are real and all of which look like "the app is broken":

- **Inputs must be at least `16px`.** Below that, iOS Safari zooms the whole page when the field takes focus and does not zoom back out. This is the single most common mobile bug in typed-answer apps.
- **`SpeechSynthesis` on iOS needs a user gesture.** Audio cannot fire on card render. Bind it to a tap on a speaker button, and treat the voice list as loading asynchronously, since `getVoices()` returns empty on first call. Fall back silently when no `fr-FR` voice exists rather than showing an error.
- **Respect the safe area.** In standalone mode there is no browser chrome, so content runs under the notch and the home indicator. `viewport-fit=cover` plus `padding: env(safe-area-inset-*)` on the shell.
- **Touch targets at 44px minimum**, and the grading buttons need to sit in the bottom third of the screen where a thumb reaches. The review loop is the one screen that gets used a thousand times, so lay it out for one handed use.
- **No hover-only affordances.** Anything revealed on hover is invisible on a phone.
- **Accents are easier on mobile than desktop**, since both keyboards give `é è ê` on a long press of the vowel. So the accent helper row from section 10 is primarily a desktop feature. Show it on touch devices only if the learner asks for it.

Verify on the actual phone, not in a desktop emulator: install to home screen, run a full session in airplane mode, force quit and reopen, confirm progress survived.

---

## 13. Sync (`src/sync.js`), built last

The point of hosting is the phone. But the same URL on two devices still means two separate progress stores, and once the schedules drift apart the spacing model quietly stops working. So sync is not optional here.

There is a second reason, which is the stronger one. **Browser storage on iOS is evictable.** Safari clears script-writable storage for sites it considers unused, and while an installed home screen app is treated more generously, it is not a guarantee. Six months of review history living only in a phone's localStorage is a single cache clear away from gone. Until sync exists, add an **export to JSON** button and use it, and make the first release of sync the highest priority item after the app is playable.

Supabase, one table:

```sql
create table progress (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table progress enable row level security;
create policy "own row" on progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Magic link auth, one user. Pull on load, push debounced a few seconds after the last review.

**Merge per card, not per blob.** Whole-document last-write-wins will silently throw away a phone session, and this is the bug that will actually bite. On conflict, take the card with the later `lastReviewed`, and take the higher `reps` and `lapses`. `history` is a date to count map, so take the max per date.

The app must be fully usable with sync switched off or signed out. Offline is the default and sync is an enhancement, never a dependency.

---

## 14. Build order, with checkpoints

Stop and show the learner at each **CHECKPOINT**.

1. `package.json` (scripts only), `scripts/serve.mjs`, `index.html` shell, `styles.css` with the tokens from section 4. Move the provided `verbs.json` into `data/`.
2. `conjugate.js` plus `scripts/validate.mjs`. **CHECKPOINT: every test in section 16 must pass before anything else is written.**
3. `scheduler.js` and `grade.js`, with unit tests for the interval ladder, the halving on failure, the leech threshold, and accent tolerance. **CHECKPOINT: show the tests.**
4. `store.js`, then the conjugation drill and browse views. **CHECKPOINT: a real drill session, playable.**
5. `scripts/fetch-frequency.mjs` against Lexique. **CHECKPOINT: show the first 50 candidates with their POS and gender.**
6. `scripts/enrich.mjs`, then run `--dry-run`, then `--batches=1`. **CHECKPOINT: show all 40 entries from the first real batch before spending more.** Fix the prompt now, not after 500 words.
7. Enrich to 500. Skim each batch.
8. The vocabulary views, receptive and productive.
9. `chooser.json` generation, then the chooser view. **CHECKPOINT: review the 100 items.**
10. Text to speech (`SpeechSynthesis`, `fr-FR`, on by default), the accent input helper, the progress screen, settings.
11. Manifest, icons, service worker, plus the export to JSON button.
12. Deploy to Pages. **CHECKPOINT: run the section 12.1 verification list on the real phone, not an emulator.**
13. `sync.js`.

---

## 15. `CLAUDE.md` to write into the repo

Keep it short. It is read on every session, so it must earn its tokens.

```markdown
# le cahier

Static PWA. No build step, no runtime dependencies, no framework. Vanilla ES modules.
`npm start` serves it. Fetching data over file:// does not work.

## Rules
- No dependencies in the app. Node only in scripts/.
- All paths relative. This deploys to a GitHub Pages subpath.
- data/verbs.json stores only non derivable forms. All four tenses come from
  src/conjugate.js. Never add a conjugated form to the data file.
- The imparfait stem is the nous present minus -ons, for every verb except être.
  Drop the cedilla and the protective e before -i endings: mangions, commencions.
- Interface English, card answers Dutch.
- New words are introduced in frequency order only. Never group by category.
  See BRIEF.md section 8.7.
- Accent errors grade as Almost. Gender errors grade as Again.
- Failure halves the interval. It never resets to day one.
- Verbs are never vocabulary cards. Vocabulary is never conjugated.

## Before committing
`npm run validate` must pass. It checks data integrity and conjugation spot checks.

## House style
No em dashes. Do not use " - " as a separator. Active voice. Sentence case in the UI.
Errors say what happened and what to do. Empty states invite an action.
```

---

## 16. Acceptance tests for `validate.mjs`

These are independently verified. Every one must pass.

**Imparfait, the soft consonant guard:**
```
manger      mangeais, mangeais, mangeait, mangions, mangiez, mangeaient
commencer   commençais, commençais, commençait, commencions, commenciez, commençaient
être        étais, étais, était, étions, étiez, étaient
```

**Futur simple, irregular stems:**
```
aller     irai, iras, ira, irons, irez, iront
pouvoir   pourrai …            voir     verrai …
venir     viendrai …           tenir    tiendrai …
appeler   appellerai …         faire    ferai …
savoir    saurai …             devoir   devrai …
recevoir  recevrai …           falloir  il faudra (third person only)
```

**Présent, multiple stems:**
```
boire      bois, bois, boit, buvons, buvez, boivent
recevoir   reçois, reçois, reçoit, recevons, recevez, reçoivent
connaître  connais, connais, connaît, connaissons, connaissez, connaissent
prendre    prends, prends, prend, prenons, prenez, prennent
vivre      vis, vis, vit, vivons, vivez, vivent
ouvrir     ouvre, ouvres, ouvre, ouvrons, ouvrez, ouvrent
finir      finis, finis, finit, finissons, finissez, finissent
faire      fais, fais, fait, faisons, faites, font
dire       dis, dis, dit, disons, dites, disent
```

**Auxiliary, participle, agreement:**
```
être avoir:    aller, venir, rester, arriver, devenir, tomber, sortir, partir
être forms:    je suis allé(e), nous sommes allé(e)s
avoir forms:   j'ai été, j'ai eu, j'ai dû, j'ai vécu, j'ai ouvert, j'ai écrit, j'ai reçu
passer:        avoir with an object, être when it means to go past. Check the note survives.
falloir:       il a fallu, and null in every other person
```

**Elision:** `j'ai`, `j'étais`, `j'ouvre`, `j'irai`, and `je vais` (not `j'vais`).

**Structural:** all 50 verbs have `present`, `futureStem`, `participle`, `aux`. Every `futureStem` ends in `r`. Every non-impersonal `present[3]` ends in `ons`.

**Scheduler:** ease 2.3 from a 2 day interval produces roughly 2, 5, 12, 28, 63. A lapse at interval 30 gives 15, not 1. Six lapses sets `leech`. A `familiar` word enters at 12.

**Grading:** `mange` for `mangé` is Almost. `le voiture` for `la voiture` is Again. `mangions` for `mangeions` is Again.

---

## 17. Do not build these

Each one has been considered and rejected. If they come up later, the reason is here.

- **A themed word set feature** ("learn the 20 colours"). Categorical grouping causes interference. Section 8.7.
- **Multiple choice vocabulary.** Recognition without production is the weakest form of practice available and it inflates the accuracy number so the scheduler learns the wrong thing.
- **Streaks, badges, points, levels.** They compete with the actual signal, which is session accuracy sitting near 87 percent.
- **A grammar section.** The learner has a textbook. Scope creep here is what kills the project.
- **Drilling all 1,200 conjugation cells.** Section 7.
- **The API key in the browser.** Sentence writing graded by Claude sounds good and needs a server. Until then, an "export today's words as a Claude prompt" button costs nothing and gets 80 percent of the value.
- **Resetting intervals to zero on failure.** Section 8.3.
- **Speech recognition.** Browser support is too uneven to build a habit on.

---

## 18. Known gaps, stated honestly

A typing app cannot teach listening, and French is unusually hard to hear because of liaison and elision. Text to speech on every card covers pronunciation of single words, and a listening mode where you hear a sentence and type it would help more, but neither substitutes for hours of real audio. Pair this app with something spoken and do not expect it to close that gap.

2,000 words gets to roughly 95 percent coverage of casual speech. Comfortable unassisted comprehension sits at 98 percent, which needs 6,000 to 7,000 word families. 2,000 is the right first target and a real milestone. It is base camp, not the summit.
