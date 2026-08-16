# Koala Mode (Workout Tracker)

Personal workout tracking PWA. Local folder is named `workout-tracker-app`; the
app itself, GitHub repo, and Firebase project are all named `koala-mode`.

## Accounts / Repo

- GitHub: `park-alliance/koala-mode` (https://github.com/park-alliance/koala-mode), branch `master`
- Firebase project: `koala-mode` (Auth + Firestore), config in `firebase-init.js`
- Owner account (real data, treat carefully): `joseph.vanacore@gmail.com` - see `OWNER_EMAIL` in `app.js`
- Local `gh` CLI is authenticated as `park-alliance`

## Structure

Everything is plain HTML/CSS/JS, no build step, no framework:
- `index.html` - markup/shell
- `style.css` - styles
- `app.js` - all app logic (~85KB, single file)
- `firebase-init.js` - Firebase config + `auth`/`db` init
- `data-seed.js` - `SEED_DATA` used only to seed brand-new users
- `sw.js` - service worker (network-first caching for PWA/offline)
- `manifest.json` - PWA manifest ("Koala Mode")
- `icon-192.png` / `icon-512.png` - app icons
- `scripts/extract_seed.py`, `scripts/generate_icon.py` - one-off local helper scripts
- `data/Workout_Tracker_V1.xlsx` - original spreadsheet this app was based on
- `.gitignore` ignores `server.log` (local dev server log, not committed)

## Data storage (Firestore) - READ BEFORE CHANGING DATA SHAPES

Auth: Firebase Auth, email/password or Google sign-in popup (`app.js` ~line 1890-1910).

Per-user data lives at `users/{uid}/appData/{key}`, one Firestore doc per key.
Each doc is just `{ value: <data> }`. Keys (`DATA_KEYS` in `app.js`):
`categories`, `exercises`, `logs`, `bodyweight`, `nutrition`, `reviews`,
`reviewQuestions`, `plans`, `activeSession`, `cardioCategory`,
`nutritionGoals`, `profile`.

`nutritionGoals` = `{ calorieTarget, protein, fat, carbs }` (g targets for the
macros; calorieTarget is a manually-set daily calorie goal, editable inline
on the Weight & Nutrition tab). `profile` = `{ sex, heightIn }`, captured
(optionally) in the first-run setup wizard - `heightIn` is total inches
(feet+inches is just the input UI, see `feetInchesToTotalInches()`). Neither
is displayed as its own metric; `computeMaintenanceCalories()` (Mifflin-St
Jeor, assumes a fixed age since the wizard doesn't ask for one) uses
`profile` + the latest bodyweight only to seed a smarter one-time default
for `nutritionGoals.calorieTarget` the first time enough data exists - a
separate visible "maintenance/exercise burned" bar was tried and scrapped
as too confusing, see git history if revisiting this.

`cardioCategory` is a pointer (defaults to `'Cardio'`) to whichever category
name currently gets the cardio log form instead of weight/reps - it's kept in
sync automatically when that specific category is renamed (see
`renameCategory()` in `app.js`), so cardio detection survives a rename instead
of breaking on a hardcoded `'Cardio'` string.

Important behaviors:
- `syncWrite(key, value)` does a full `.set({ value })` - **whole-doc overwrite,
  not a merge**. Any write path must include the entire current array/object
  for that key or it will silently drop the rest of that user's data.
- `ensureSeeded()` runs once per user, gated by a `seeded` doc - editing
  `data-seed.js` is safe and only affects brand-new (unseeded) users, never
  existing accounts.
- `cloudData` is an in-memory cache kept live via Firestore `onSnapshot`
  listeners; `save*()` functions update the cache optimistically then write
  through to Firestore in the background.
- `db.enablePersistence({ synchronizeTabs: true })` in `firebase-init.js`
  gives offline read/write support (queued writes sync once back online);
  `syncWrite()`'s `.catch()` now also calls `showToast()` so a genuine write
  failure (not just offline) is visible instead of only `console.error`.
- `localStorage` (not Firestore) is used for a couple of device-local,
  non-synced bits of UI state: the rest timer (`koala-mode-rest-timer` - an
  end timestamp, not a tick count, so it recovers correctly after the tab is
  backgrounded/closed and reopened - see `saveRestTimerState()`/
  `loadRestTimerState()`) and the Review tab's one-time gear-icon hint
  banner (`koala-mode-review-gear-hint-dismissed`).

**Rules of thumb to avoid corrupting real user data:**
1. Adding fields to objects inside stored arrays: fine, but read code must
   tolerate missing fields on old records (`item.newField ?? default`) rather
   than assuming a migration happened.
2. Renaming a `DATA_KEYS` entry or a field name breaks reads for existing
   users until a migration is written - avoid unless necessary.
3. Test structural/destructive-feeling changes against a second, non-owner
   test account rather than `joseph.vanacore@gmail.com`.

## Features (as of last update)

Only 3 nav tabs, shown as an iOS-style bottom tab bar: Workout Log,
Weight & Nutrition, Review. The bar is a normal flex child at the
bottom of a full-height flex column (`#app-shell { display:flex;
flex-direction:column; height:100dvh }`, `main { flex:1; overflow-y:auto }`),
**not** `position:fixed` - iOS Safari's fixed positioning jitters/floats
during scroll and toolbar show/hide as a home-screen PWA, so the fix was to
sidestep it structurally rather than patch around it. `env(safe-area-inset-
bottom)` padding on the nav still handles the home indicator; viewport meta
tag has `viewport-fit=cover` for that to resolve correctly. Exercise/category
management and plan management were folded into the Log tab rather than
living on their own tabs.

- Session-based workout logging: start a session, log sets (weight/reps),
  finish/save. Weight field pre-fills from the exercise's most recent logged
  set - "most recent" is by workout date then set number
  (`mostRecentLoggedWeight()`), not by log id, since a backdated entry gets a
  higher id than same-day entries logged earlier. The field also carries
  over (not cleared) after logging a set, since most sets of an exercise use
  the same weight.
- Exercise/category management lives on the Log tab: "+ New Category" /
  "+ New Exercise" ghost tiles are always visible in the plain grids (no
  gear needed to add). A gear icon next to "Log Directly" reveals a flat
  category list - rename/delete only (pencil/x icons); no exercise listing
  or move-to there anymore. A gear icon on a category's own exercise list
  (e.g. under "Legs") is where individual exercises get renamed, deleted,
  or moved to another category (pencil / arrow+select / x, all on one row
  per exercise) - `renderExerciseListManagerPanel()` in `app.js`. First-run
  setup wizard (exercise templates by muscle group) auto-shows in the
  category gear panel when a user has zero categories, and now leads with a
  "Welcome to Koala Mode" heading plus an optional sex/height question
  (see `profile` above) before the template choice - explicitly closes
  itself (`exercise-manager-panel` back to `.hidden`) once setup finishes so
  the tappable category grid is immediately visible, instead of leaving the
  user staring at the now-populated-but-still-open management panel.
- Personal records: `computeExercisePRIds()` flags a logged set as a PR if
  it beats the heaviest weight ever logged for that exercise, or matches a
  previously-used weight with more reps than ever logged at that exact
  weight - evaluated in (date, set) order against only earlier sets, so
  history reflects what was actually a PR at the time. Shows as a trophy
  badge (`ICON_TROPHY`) next to that set in history, plus a one-time toast
  and a radiating-lines CSS burst around the Log Set button
  (`triggerPRBurst()`, `#pr-burst`) at the moment it's logged.
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
  "Exit planned workout" + the plan name during an active session. Its
  Start/Pause and reset controls are compact icon-only buttons (not text) so
  the whole widget reliably fits on one row next to the button on narrow
  phone widths instead of wrapping. Tapping the current time (when not
  running) opens a scroll-wheel minutes/seconds picker (`#rest-timer-
  picker-overlay`) instead of a text field - deliberate, since `inputmode=
  "numeric"` gives mobile keyboards no ":" or "." key, making M:SS/fractional
  entry effectively untypeable on a phone.
- Weight & Nutrition tab (nav icon is a flame): a `#body-view-toggle`
  Log/History segmented toggle (reusing the `.view-toggle`/`.bg-option`
  chip pattern) splits it into two views instead of one long scroll -
  History was previously always visible below the forms.
  - **Log**: the weight and nutrition forms, plus a "Today" strip
    (`renderNutritionToday()`) with Calories/Protein/Fat/Carbs progress
    bars against `nutritionGoals` - tap directly on a bar's row to edit
    that target inline (no gear icon/panel for this one). Nutrition
    entries carry an optional `meal` field (Whole Day/Breakfast/Lunch/
    Dinner/Snack chips, default Whole Day = `null`) so more than one entry
    per day is a normal, labeled thing rather than ambiguous duplicate
    rows.
  - **History**: chart-only, no list (`renderBodyweightChart()` /
    `renderNutritionChart()`, the latter plots calories/day summed across
    that day's meals) - reuses the same trend-chart code as per-exercise
    history (`buildTrendChartHTML()`/`wireTrendChart()`). Since there's no
    list to delete a bad entry from, tapping a chart point opens a tooltip
    listing that date's entries with a delete button each (`wireTrendChart`'s
    `tooltipHtml`/`onTooltipClick` options) instead.
  - Same `.log-submit-row` date-next-to-button pattern as before is used
    for the exercise set-log form and the Review tab's "Save Review" row
    too. Weight/Nutrition boxes and their submit buttons intentionally
    share one plain color scheme now (no tinted background, no
    button-color distinction between the two forms).
- Review tab (labeled "Review" in the nav, `#tab-review` internally):
  customizable questions (activity, workout quality, water intake by
  default) - see `DEFAULT_REVIEW_QUESTIONS` in `app.js`. Grid is the only
  history view (List was removed - the grid's `<table class="habit-grid">`
  gained a trailing delete-icon column per row to keep that capability).
  Each question's answer chips render in a shared CSS grid
  (`renderReviewFormFields()`) with per-question `grid-column` offsets so
  every question's rightmost (best) option lines up in the same column,
  regardless of how many options that question has - a good day is
  tapping straight down the rightmost column. A dismissible one-time hint
  (`#review-gear-hint`, `initReviewGearHint()`) points at the settings gear
  icon until dismissed or used once.
- Offline support via service worker (network-first)
- No persistent top header bar (removed to save vertical space on phones).
  "Sign Out" instead lives inside each of the three gear panels (Log
  Directly, a category's exercise list, Review settings) as a
  `.sign-out-link` at the bottom, below a divider - two are static HTML,
  the third is re-added on every render of
  `renderExerciseListManagerPanel()` since that panel's innerHTML is fully
  replaced each time.
- Date fields no longer show a "Date" label anywhere (the date picker
  itself makes that obvious) - just the bare `<input type="date">`, usually
  paired with that form's submit button via `.log-submit-row`.

## Style

- Grayscale-ish base with purple accent (`#6c5ce7` theme color). "Over
  target" states (e.g. a macro bar past its goal) use `--accent-dark`
  (`#4e3ec9`, a darker shade of the same purple), never red - tried red
  first and it read as an alarming error state rather than "you went a bit
  over," which isn't actually bad. Same reasoning killed an earlier
  red/orange/green multi-segment calorie bar entirely: matching real
  nutrition apps (MyFitnessPal, Cronometer), calories now render as one
  plain bar like every other target, not a special-cased mini dashboard -
  numbers over colors when something needs to convey more than "how full."
- Icons are inline monochrome SVGs (`stroke="currentColor"`, no fill), not
  emoji, kept flat/silhouette style throughout. Shared row-action icons
  (`ICON_PENCIL` = rename, `ICON_X` = delete, `ICON_TROPHY` = personal
  record) are defined once near `escapeHtml()` in `app.js` and reused
  everywhere; delete buttons use `.icon-btn.danger-btn` (transparent, soft
  red) instead of the old solid `.danger-btn` "Delete" text button. Moving
  an exercise to another category uses a plain `<select>`, not an icon.
- No number input in the app shows the browser's up/down spinner arrows
  (`-webkit-appearance:none` + `-moz-appearance:textfield`, applied per
  input class as each new number field's been added) - typing the exact
  value beats nudging it by 1 with tiny arrows, especially on mobile.
- No em dashes in any generated text (UI copy, code strings, docs) - use a
  regular hyphen.
- No build tooling - edit `app.js`/`style.css`/`index.html` directly and
  reload
