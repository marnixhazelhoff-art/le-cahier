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
- Bump VERSION in service-worker.js whenever a shell or data file changes, and
  add new src/ files to its CORE list. An installed copy serves its cache first,
  so skipping the bump ships nothing.
- The daily new card cap is a budget that gets spent, recorded per mode per day
  in history.introducedByMode. Never derive it from cards still in the new
  state: grading a card leaves that state, so a rebuilt queue would hand out a
  fresh full batch.
- Never sort the new vocabulary queue. The deck is already in rank order, and
  sorting by lemma introduces words alphabetically.
- The buttons that end a card live in one .actions container inside .drill,
  which becomes a fixed thumb zone bar on a coarse pointer. Do not use .actions
  outside a drill.
- Nothing in sync.js may throw into the app. It sets a status instead.

## Before committing
`npm run validate` must pass. It checks data integrity and conjugation spot checks.

## House style
No em dashes. Do not use " - " as a separator. Active voice. Sentence case in the UI.
Errors say what happened and what to do. Empty states invite an action.
