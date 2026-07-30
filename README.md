# le cahier

A French vocabulary and conjugation trainer for one Dutch speaking learner.
Spaced repetition, fifteen minutes a day, on a laptop and a phone.

Live at https://marnixhazelhoff-art.github.io/le-cahier/

Static PWA. No build step, no runtime dependencies, no framework, vanilla ES
modules. It works fully offline once loaded. See `BRIEF.md` for the design
reasoning and `CLAUDE.md` for the working rules.

## Running it locally

```
npm start
```

Then open the address it prints. Fetching `data/*.json` over `file://` is
blocked by every browser, so opening `index.html` from disk does not work.

```
npm run validate    # data integrity and conjugation spot checks, run before committing
npm test            # unit tests for the scheduler, grading and the sync merge
```

## What is where

| Path | What it does |
| --- | --- |
| `src/conjugate.js` | All four tenses, derived by rule. The data file stores no conjugated forms. |
| `src/scheduler.js` | The 2, 5, 12, 30, 75, 180 day ladder. Failure halves the interval, never resets it. |
| `src/grade.js` | Answer comparison. Accent slips grade as Almost, gender errors as Again. |
| `src/merge.js` | Per card sync merge, unit tested in `scripts/merge.test.mjs`. |
| `src/sync.js` | Supabase pull and push, written against the REST API so the app keeps zero dependencies. |
| `data/verbs.json` | Provided and verified. Do not regenerate. |
| `scripts/make-icons.py` | Redraws the icons from the palette in `src/styles.css`. Needs Pillow. |

## Deploying

GitHub Pages serves `main` at the repo root. All paths are relative, so the
subpath works without configuration. `.nojekyll` stops Pages preprocessing the
files.

**Bump `VERSION` in `service-worker.js` whenever a shell or data file changes.**
An installed copy serves from its cache first, so without a bump the old files
survive a deploy.

## Sync setup

Sync is optional. The app is fully usable signed out, and offline is the
default. Progress lives in `localStorage` until sync is on, and browser storage
on iOS can be cleared without warning, so export after a session or turn sync
on.

In a Supabase project, run:

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

Then under Authentication, URL configuration, add the deployed URL as an
allowed redirect. Magic links refuse to return to a URL that is not listed.

Finally, in the app under Settings, Sync, paste the project URL and the anon
public key, enter your email, and ask for a sign in link. The anon key belongs
in the browser: row level security is what keeps the row private.

Either `https://yourproject.supabase.co` or the REST endpoint ending in
`/rest/v1/` works; the app trims the suffix.

Progress pulls on load and pushes a few seconds after the last review. Merging
happens per card, taking the later review and the higher counts, so a session
on the phone is never overwritten by a stale laptop.

## What this does not do

No listening practice, no grammar instruction, no speech recognition, no themed
word sets, no streaks or badges. It covers roughly 95 percent of casual speech;
getting to 98 percent comprehension needs 6,000 to 7,000 words. Pair it with
audio and a grammar textbook.
