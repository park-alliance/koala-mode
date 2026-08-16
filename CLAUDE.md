# Koala Mode (Workout Tracker)

Personal workout tracking PWA. Local folder is named `workout-tracker-app`; the
app itself, GitHub repo, and Firebase project are all named `koala-mode`.

## Accounts / Repo

- GitHub: `park-alliance/koala-mode` (https://github.com/park-alliance/koala-mode), branch `master`
- Firebase project: `koala-mode` (Auth + Firestore), config in `firebase-init.js`
- Owner account (real data, treat carefully): `joseph.vanacore@gmail.com` — see `OWNER_EMAIL` in `app.js`
- Local `gh` CLI is authenticated as `park-alliance`

## Structure

Everything is plain HTML/CSS/JS, no build step, no framework:
- `index.html` — markup/shell
- `style.css` — styles
- `app.js` — all app logic (~85KB, single file)
- `firebase-init.js` — Firebase config + `auth`/`db` init
- `data-seed.js` — `SEED_DATA` used only to seed brand-new users
- `sw.js` — service worker (network-first caching for PWA/offline)
- `manifest.json` — PWA manifest ("Koala Mode")
- `icon-192.png` / `icon-512.png` — app icons
- `scripts/extract_seed.py`, `scripts/generate_icon.py` — one-off local helper scripts
- `data/Workout_Tracker_V1.xlsx` — original spreadsheet this app was based on
- `.gitignore` ignores `server.log` (local dev server log, not committed)

## Data storage (Firestore) — READ BEFORE CHANGING DATA SHAPES

Auth: Firebase Auth, email/password or Google sign-in popup (`app.js` ~line 1890-1910).

Per-user data lives at `users/{uid}/appData/{key}`, one Firestore doc per key.
Each doc is just `{ value: <data> }`. Keys (`DATA_KEYS` in `app.js`):
`categories`, `exercises`, `logs`, `bodyweight`, `nutrition`, `reviews`,
`reviewQuestions`, `plans`, `activeSession`, `cardioCategory`.

`cardioCategory` is a pointer (defaults to `'Cardio'`) to whichever category
name currently gets the cardio log form instead of weight/reps - it's kept in
sync automatically when that specific category is renamed (see
`renameCategory()` in `app.js`), so cardio detection survives a rename instead
of breaking on a hardcoded `'Cardio'` string.

Important behaviors:
- `syncWrite(key, value)` does a full `.set({ value })` — **whole-doc overwrite,
  not a merge**. Any write path must include the entire current array/object
  for that key or it will silently drop the rest of that user's data.
- `ensureSeeded()` runs once per user, gated by a `seeded` doc — editing
  `data-seed.js` is safe and only affects brand-new (unseeded) users, never
  existing accounts.
- `cloudData` is an in-memory cache kept live via Firestore `onSnapshot`
  listeners; `save*()` functions update the cache optimistically then write
  through to Firestore in the background.

**Rules of thumb to avoid corrupting real user data:**
1. Adding fields to objects inside stored arrays: fine, but read code must
   tolerate missing fields on old records (`item.newField ?? default`) rather
   than assuming a migration happened.
2. Renaming a `DATA_KEYS` entry or a field name breaks reads for existing
   users until a migration is written — avoid unless necessary.
3. Test structural/destructive-feeling changes against a second, non-owner
   test account rather than `joseph.vanacore@gmail.com`.

## Features (as of last update)

Only 3 nav tabs, shown as an iOS-style bottom tab bar (fixed, `position:
fixed; bottom:0`, `env(safe-area-inset-bottom)` padding for the home
indicator - viewport meta tag has `viewport-fit=cover` for this to work):
Workout Log, Weight & Nutrition, Daily Review. Exercise/category management
and plan management were folded into the Log tab rather than living on
their own tabs.

- Session-based workout logging: start a session, log sets (weight/reps),
  finish/save; weight field pre-fills from the exercise's most recent logged
  set
- Exercise/category management lives on the Log tab: "+ New Category" /
  "+ New Exercise" ghost tiles are always visible in the plain grids (no
  gear needed to add). A gear icon next to "Log Directly" additionally
  reveals a management panel for rename/delete/move-between-categories
  (hides the plain grid while open), and a gear icon on a category's
  exercise list does the same for rename/delete of that category's
  exercises. First-run setup wizard (exercise templates by muscle group)
  auto-shows there when a user has zero categories.
- Plans: saved/planned workouts, managed from the "Start / Plan a Workout"
  picker screen - always-visible "+ New Plan" button, a row of toggleable
  category filter chips that live-filter the list (OR match: a plan shows
  if any of its exercises are in a selected category), and Start/Edit/Copy/
  Delete per plan. Plans are auto-grouped by the categories of the exercises
  they contain (e.g. a plan mixing Push and Legs exercises groups under
  "Push + Legs") - see `planCategoryLabel()` in `app.js`. Nothing is stored
  for this; it's computed live so it can't go stale. Picking "New"/"Edit"
  opens the full plan editor as its own screen.
- Rest timer sits inline next to "Start/Plan Workout" when idle, or next to
  "Exit planned workout" + the plan name during an active session.
- Weight & Nutrition tab: one shared date field, then two independent log
  actions below it - Weight has its own "Log Weight" button (solid-accent
  styled so it stands out), the four macros (Calories/Protein/Fat/Carbs) in
  a 1x4 row share one "Log Nutrition" button. The two groups are visually
  distinguished by background tint, not separate headers. History for each
  stays in its own section below (nutrition as a Date/Cal/Protein/Fat/Carbs
  table).
- Daily Review: customizable questions (activity, workout quality by
  default) — see `DEFAULT_REVIEW_QUESTIONS` in `app.js`
- Offline support via service worker (network-first)

## Style

- Grayscale-ish base with purple accent (`#6c5ce7` theme color)
- Icons are inline monochrome SVGs (`stroke="currentColor"`, no fill),
  matching the gear-icon path already used for session-row options - not
  emoji, kept flat/silhouette style throughout
- No build tooling — edit `app.js`/`style.css`/`index.html` directly and
  reload
