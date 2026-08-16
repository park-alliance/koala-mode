// ============ STORAGE (Firestore-backed, synced per signed-in user) ============
// get*/save* keep the exact same synchronous shape the rest of the app already
// relies on: cloudData is an in-memory cache kept current by onSnapshot
// listeners, and save*() updates the cache immediately (optimistic) then
// writes through to Firestore in the background.

const OWNER_EMAIL = 'joseph.vanacore@gmail.com';
const DATA_KEYS = ['categories', 'exercises', 'logs', 'bodyweight', 'nutrition', 'reviews', 'reviewQuestions', 'plans', 'activeSession', 'cardioCategory'];
const DEFAULT_REVIEW_QUESTIONS = [
    { id: 'activity', label: 'Activity level', options: ['Not Active', 'Light', 'Moderate', 'High'] },
    { id: 'workout', label: 'Workout', options: ['No', 'Bad', 'Average', 'Good'] },
];
const DATA_DEFAULTS = {
    categories: [],
    exercises: [],
    logs: [],
    bodyweight: [],
    nutrition: [],
    reviews: [],
    reviewQuestions: DEFAULT_REVIEW_QUESTIONS,
    plans: [],
    activeSession: null,
    cardioCategory: 'Cardio',
};

let currentUser = null;
let cloudData = JSON.parse(JSON.stringify(DATA_DEFAULTS));
let dataUnsubscribers = [];

function userDoc(key) {
    return db.collection('users').doc(currentUser.uid).collection('appData').doc(key);
}

function syncWrite(key, value) {
    userDoc(key).set({ value }).catch(err => console.error(`Failed to save ${key}:`, err));
}

async function ensureSeeded() {
    const seededRef = userDoc('seeded');
    const snap = await seededRef.get();
    if (snap.exists) return;

    const isOwner = currentUser.email === OWNER_EMAIL;
    const batch = db.batch();
    batch.set(userDoc('categories'), { value: isOwner ? SEED_DATA.categories : [] });
    batch.set(userDoc('exercises'), { value: isOwner ? SEED_DATA.exercises : [] });
    batch.set(userDoc('logs'), { value: isOwner ? SEED_DATA.logs : [] });
    batch.set(userDoc('bodyweight'), { value: [] });
    batch.set(userDoc('nutrition'), { value: [] });
    batch.set(userDoc('reviews'), { value: [] });
    batch.set(userDoc('reviewQuestions'), { value: DEFAULT_REVIEW_QUESTIONS });
    batch.set(userDoc('plans'), { value: [] });
    batch.set(userDoc('cardioCategory'), { value: 'Cardio' });
    batch.set(seededRef, { value: true });
    await batch.commit();
}

async function initialLoadAndSync() {
    const snaps = await Promise.all(DATA_KEYS.map(key => userDoc(key).get()));
    DATA_KEYS.forEach((key, i) => {
        cloudData[key] = snaps[i].exists ? snaps[i].data().value : DATA_DEFAULTS[key];
    });
    renderEverything();
    renderReviewFormFields();
    resumeSessionIfAny();

    dataUnsubscribers = DATA_KEYS.map(key =>
        userDoc(key).onSnapshot(snap => {
            cloudData[key] = snap.exists ? snap.data().value : DATA_DEFAULTS[key];
            renderEverything();
        })
    );
}

function stopSync() {
    dataUnsubscribers.forEach(unsub => unsub());
    dataUnsubscribers = [];
    cloudData = JSON.parse(JSON.stringify(DATA_DEFAULTS));
}

function getCategories() { return cloudData.categories; }
function saveCategories(v) { cloudData.categories = v; syncWrite('categories', v); }

function getExercises() { return cloudData.exercises; }
function saveExercises(v) { cloudData.exercises = v; syncWrite('exercises', v); }

function getLogs() { return cloudData.logs; }
function saveLogs(v) { cloudData.logs = v; syncWrite('logs', v); }

function getBodyweight() { return cloudData.bodyweight; }
function saveBodyweight(v) { cloudData.bodyweight = v; syncWrite('bodyweight', v); }

function getNutrition() { return cloudData.nutrition; }
function saveNutrition(v) { cloudData.nutrition = v; syncWrite('nutrition', v); }

function getReviews() { return cloudData.reviews; }
function saveReviews(v) { cloudData.reviews = v; syncWrite('reviews', v); }

function getReviewQuestions() { return cloudData.reviewQuestions; }
function saveReviewQuestions(v) { cloudData.reviewQuestions = v; syncWrite('reviewQuestions', v); }

function getPlans() { return cloudData.plans; }
function savePlans(v) { cloudData.plans = v; syncWrite('plans', v); }

function getActiveSession() { return cloudData.activeSession; }
function saveActiveSession(v) { cloudData.activeSession = v; syncWrite('activeSession', v); }

// The category currently treated as "cardio" (its exercises get the cardio
// log form instead of weight/reps). Tracked by a pointer rather than a
// hardcoded name so renaming that category doesn't silently break detection -
// see renameCategory(), which keeps this pointer in sync on rename.
function getCardioCategory() { return cloudData.cardioCategory; }
function saveCardioCategory(v) { cloudData.cardioCategory = v; syncWrite('cardioCategory', v); }

// ============ HELPERS ============

function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function uniqueExerciseId(category, name) {
    const base = `${slugify(category)}__${slugify(name)}`;
    const existingIds = new Set(getExercises().map(e => e.id));
    if (!existingIds.has(base)) return base;
    let n = 2;
    while (existingIds.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
}

function nextLogId() {
    const logs = getLogs();
    return logs.reduce((max, l) => Math.max(max, l.id), 0) + 1;
}

function todayStr() {
    const d = new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
}

function formatDate(iso) {
    const [y, m, d] = iso.split('-');
    return `${m}/${d}/${y}`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Shared row-action icons (pencil = rename, x = delete) - flat outline
// style matching the gear/timer icons.
const ICON_PENCIL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';
const ICON_X = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

// ============ TREND CHARTS (shared by exercise history and bodyweight) ============
// Plain inline SVG, no chart library - point counts here are at most in the low
// hundreds (a single exercise's full history), so this renders instantly.

function buildTrendChartHTML(points) {
    const width = 600, height = 220;
    const padding = { top: 24, right: 16, bottom: 28, left: 40 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;

    const values = points.map(p => p.value);
    const originalMin = Math.min(...values);
    const originalMax = Math.max(...values);
    const range = originalMax - originalMin || 1;
    const scaleMin = originalMin - range * 0.1;
    const scaleMax = originalMax + range * 0.1;

    const xFor = i => padding.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const yFor = v => padding.top + innerH - ((v - scaleMin) / (scaleMax - scaleMin)) * innerH;

    const linePoints = points.map((p, i) => `${xFor(i).toFixed(1)},${yFor(p.value).toFixed(1)}`).join(' ');

    const gridVals = [originalMax, (originalMin + originalMax) / 2, originalMin];
    let gridHtml = '';
    gridVals.forEach(v => {
        const y = yFor(v);
        gridHtml += `<line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}" stroke="#e5e5e5" stroke-width="1"/>`;
        gridHtml += `<text x="${padding.left - 6}" y="${(y + 3).toFixed(1)}" font-size="10" fill="#888" text-anchor="end">${Math.round(v)}</text>`;
    });

    const labelIdxs = [...new Set(points.length <= 2 ? [0, points.length - 1] : [0, Math.floor((points.length - 1) / 2), points.length - 1])];
    let xLabelsHtml = '';
    labelIdxs.forEach(i => {
        const x = xFor(i);
        const [, m, d] = points[i].date.split('-');
        xLabelsHtml += `<text x="${x.toFixed(1)}" y="${height - 6}" font-size="10" fill="#888" text-anchor="middle">${m}/${d}</text>`;
    });

    let dotsHtml = '';
    points.forEach((p, i) => {
        const x = xFor(i), y = yFor(p.value);
        dotsHtml += `<circle class="trend-point" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="#6c5ce7" stroke="#fff" stroke-width="1.5" data-x-pct="${(x / width * 100).toFixed(2)}" data-y-pct="${(y / height * 100).toFixed(2)}" data-label="${escapeHtml(p.label)}"></circle>`;
        if (p.sublabel) {
            dotsHtml += `<text x="${x.toFixed(1)}" y="${(y - 10).toFixed(1)}" font-size="9" fill="#888" text-anchor="middle">${escapeHtml(p.sublabel)}</text>`;
        }
    });

    return `
        <div class="trend-chart-wrap">
            <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
                ${gridHtml}
                <polyline points="${linePoints}" fill="none" stroke="#6c5ce7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                ${dotsHtml}
                ${xLabelsHtml}
            </svg>
            <div class="trend-tooltip"></div>
        </div>`;
}

function wireTrendChart(containerEl) {
    const tooltip = containerEl.querySelector('.trend-tooltip');
    const svg = containerEl.querySelector('svg');
    containerEl.querySelectorAll('.trend-point').forEach(pt => {
        pt.addEventListener('click', e => {
            e.stopPropagation();
            tooltip.textContent = pt.dataset.label;
            tooltip.style.left = pt.dataset.xPct + '%';
            tooltip.style.top = pt.dataset.yPct + '%';
            tooltip.classList.add('visible');
        });
    });
    svg.addEventListener('click', () => tooltip.classList.remove('visible'));
}

function wireViewToggle(toggleId, listEl, chartEl, points) {
    const toggle = document.getElementById(toggleId);
    if (points.length < 2) {
        toggle.classList.add('hidden');
        listEl.classList.remove('hidden');
        chartEl.classList.add('hidden');
        return;
    }

    toggle.classList.remove('hidden');
    toggle.querySelectorAll('.bg-option').forEach(b => b.classList.toggle('selected', b.dataset.view === 'list'));
    listEl.classList.remove('hidden');
    chartEl.classList.add('hidden');

    toggle.querySelectorAll('.bg-option').forEach(btn => {
        btn.onclick = () => {
            toggle.querySelectorAll('.bg-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            if (btn.dataset.view === 'plot') {
                listEl.classList.add('hidden');
                chartEl.classList.remove('hidden');
                chartEl.innerHTML = buildTrendChartHTML(points);
                wireTrendChart(chartEl);
            } else {
                listEl.classList.remove('hidden');
                chartEl.classList.add('hidden');
            }
        };
    });
}

function computeExerciseTrendPoints(exerciseId) {
    const logs = getLogs().filter(l => l.exerciseId === exerciseId);
    if (logs.length === 0) return [];
    const hasWeight = logs.some(l => l.weight !== null && l.weight !== undefined);
    const metric = hasWeight ? 'weight' : 'reps';

    const byDate = {};
    logs.forEach(l => {
        const v = l[metric];
        if (v === null || v === undefined) return;
        if (!byDate[l.date] || v > byDate[l.date][metric]) byDate[l.date] = l;
    });

    return Object.keys(byDate).sort().map(date => {
        const l = byDate[date];
        const label = metric === 'weight'
            ? `${formatDate(date)}: ${l.weight} lb x ${l.reps ?? '?'} reps`
            : `${formatDate(date)}: ${l.reps} reps`;
        const sublabel = metric === 'weight' && l.reps != null ? `x${l.reps}` : null;
        return { date, value: l[metric], label, sublabel };
    });
}

function computeBodyweightTrendPoints() {
    const byDate = {};
    getBodyweight().forEach(e => {
        if (!byDate[e.date] || e.weight > byDate[e.date].weight) byDate[e.date] = e;
    });
    return Object.keys(byDate).sort().map(date => {
        const e = byDate[date];
        return { date, value: e.weight, label: `${formatDate(date)}: ${e.weight} lb${e.comment ? ' - ' + e.comment : ''}` };
    });
}

// ============ SHARED EXERCISE PICKER ============
// Used by the plan editor ("add exercise") and the active-session swap/add controls.

const pickerOpenCategories = {}; // containerId -> Set of category names currently expanded

function renderExercisePickerButtons(containerId, excludeIds, onPick) {
    const container = document.getElementById(containerId);
    const categories = getCategories();
    const exercises = getExercises();

    // Default to "all collapsed" the first time a given picker is used, so
    // you're not stuck scrolling past every category to find the one you
    // want - remember what the user expands across re-renders (e.g. after
    // adding an exercise, which rebuilds this list to exclude the new pick).
    if (!pickerOpenCategories[containerId]) {
        pickerOpenCategories[containerId] = new Set();
    }
    const openSet = pickerOpenCategories[containerId];

    let html = '';
    categories.forEach(cat => {
        const list = exercises.filter(e => e.category === cat && !excludeIds.includes(e.id));
        if (list.length === 0) return;
        const isOpen = openSet.has(cat);
        html += `<div class="category-header" data-cat="${escapeHtml(cat)}"><span class="category-header-title">${escapeHtml(cat)}</span></div>`;
        html += `<div class="category-body${isOpen ? ' open' : ''}"><div class="button-grid">`;
        list.forEach(ex => {
            html += `<button type="button" class="grid-btn picker-ex-btn" data-id="${ex.id}">${escapeHtml(ex.name)}</button>`;
        });
        html += `</div></div>`;
    });

    container.innerHTML = html || '<p class="no-data">No more exercises available.</p>';

    container.querySelectorAll('.category-header').forEach(header => {
        header.addEventListener('click', () => {
            const cat = header.dataset.cat;
            if (openSet.has(cat)) openSet.delete(cat);
            else openSet.add(cat);
            renderExercisePickerButtons(containerId, excludeIds, onPick);
        });
    });
    container.querySelectorAll('.picker-ex-btn').forEach(btn => {
        btn.addEventListener('click', () => onPick(btn.dataset.id));
    });
}

// ============ TABS ============

function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
}

// ============ LOG TAB ============

let logCurrentCategory = null;
let logCurrentExerciseId = null;

function addCategoryFromPrompt(name) {
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const categories = getCategories();
    if (categories.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
        alert('That category already exists.');
        return;
    }
    categories.push(trimmed);
    saveCategories(categories);
    renderCategoryManager();
    refreshCategoryDependents();
}

function syncLogCategoryGridVisibility() {
    const panelOpen = !document.getElementById('exercise-manager-panel').classList.contains('hidden');
    document.getElementById('log-category-list').classList.toggle('hidden', panelOpen);
}

function renderLogCategoryStep() {
    const container = document.getElementById('log-category-list');
    const categories = getCategories();
    container.innerHTML = categories.map(cat =>
        `<button class="grid-btn" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
    ).join('') + `<button type="button" class="grid-btn add-tile" id="log-add-category-btn">+ New Category</button>`;

    container.querySelectorAll('.grid-btn[data-cat]').forEach(btn => {
        btn.addEventListener('click', () => selectLogCategory(btn.dataset.cat));
    });
    document.getElementById('log-add-category-btn').addEventListener('click', () => {
        addCategoryFromPrompt(prompt('New category name:'));
    });

    syncLogCategoryGridVisibility();
}

function selectLogCategory(category) {
    logCurrentCategory = category;
    document.getElementById('log-step-category').classList.add('hidden');
    document.getElementById('log-step-exercise').classList.remove('hidden');
    document.getElementById('log-step-detail').classList.add('hidden');
    document.getElementById('exercise-list-manager-panel').classList.add('hidden');
    renderLogExerciseStepContent(category);
}

function syncLogExerciseGridVisibility() {
    const panelOpen = !document.getElementById('exercise-list-manager-panel').classList.contains('hidden');
    document.getElementById('log-exercise-list').classList.toggle('hidden', panelOpen);
}

function renderLogExerciseStepContent(category) {
    document.getElementById('log-exercise-category-title').textContent = category;

    const container = document.getElementById('log-exercise-list');
    const exercises = getExercises().filter(e => e.category === category);
    container.innerHTML = exercises.map(ex =>
        `<button class="grid-btn" data-id="${ex.id}">${escapeHtml(ex.name)}</button>`
    ).join('') + `<button type="button" class="grid-btn add-tile" id="log-add-exercise-btn">+ New Exercise</button>`;

    container.querySelectorAll('.grid-btn[data-id]').forEach(btn => {
        btn.addEventListener('click', () => selectLogExercise(btn.dataset.id));
    });
    document.getElementById('log-add-exercise-btn').addEventListener('click', () => {
        const name = prompt('New exercise name:');
        if (name && name.trim()) addExercise(category, name.trim());
    });

    renderExerciseListManagerPanel(category);
    syncLogExerciseGridVisibility();
}

function renderExerciseListManagerPanel(category) {
    const panel = document.getElementById('exercise-list-manager-panel');
    const exercises = getExercises().filter(e => e.category === category);
    const otherCategories = getCategories().filter(c => c !== category);
    const rowsHtml = exercises.map(ex => `
        <div class="exercise-row">
            <span>${escapeHtml(ex.name)}</span>
            <span class="exercise-row-actions">
                <button class="icon-btn rename-ex-btn" data-id="${ex.id}" title="Rename" aria-label="Rename">${ICON_PENCIL}</button>
                <select class="move-ex-select" data-id="${ex.id}">
                    <option value="">Move to...</option>
                    ${otherCategories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
                </select>
                <button class="icon-btn danger-btn delete-ex-btn" data-id="${ex.id}" title="Delete" aria-label="Delete">${ICON_X}</button>
            </span>
        </div>`).join('') || '<p class="no-data">No exercises yet.</p>';

    panel.innerHTML = `<button type="button" class="small-btn gear-add-btn" id="add-exercise-btn">+ Add Exercise</button>${rowsHtml}<button type="button" class="link-btn sign-out-link" id="sign-out-btn-3">Sign Out</button>`;

    document.getElementById('add-exercise-btn').addEventListener('click', () => {
        const name = prompt('New exercise name:');
        if (name && name.trim()) addExercise(category, name.trim());
    });
    panel.querySelectorAll('.rename-ex-btn').forEach(btn => {
        btn.addEventListener('click', () => renameExercise(btn.dataset.id));
    });
    panel.querySelectorAll('.delete-ex-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteExercise(btn.dataset.id));
    });
    panel.querySelectorAll('.move-ex-select').forEach(select => {
        select.addEventListener('change', () => {
            if (select.value) moveExercise(select.dataset.id, select.value);
        });
    });
    document.getElementById('sign-out-btn-3').addEventListener('click', () => auth.signOut());
}

function populateDetailView(exerciseId) {
    logCurrentExerciseId = exerciseId;
    const exercise = getExercises().find(e => e.id === exerciseId);
    document.getElementById('log-detail-exercise-name').textContent = exercise ? exercise.name : '(exercise removed)';

    const isCardio = exercise && exercise.category === getCardioCategory();
    document.getElementById('log-set-form').classList.toggle('hidden', isCardio);
    document.getElementById('log-cardio-form').classList.toggle('hidden', !isCardio);

    if (isCardio) {
        resetCardioForm();
        document.getElementById('cardio-date-row').classList.toggle('hidden', !!activeSession);
        if (activeSession) document.getElementById('cardio-date').value = activeSession.date;
        renderCardioHistory(exerciseId);
    } else {
        const dateForToday = activeSession ? activeSession.date : todayStr();
        document.getElementById('log-date-row').classList.toggle('hidden', !!activeSession);
        document.getElementById('log-date').value = dateForToday;

        const mostRecentLog = mostRecentLoggedWeight(exerciseId);
        document.getElementById('log-weight').value = mostRecentLog ? mostRecentLog.weight : '';
        document.getElementById('log-reps').value = '';
        collapseLogComment();
        updateLogSetNumberUI(nextSetNumberForToday(exerciseId, dateForToday));
        renderLogHistory(exerciseId);
    }

    const points = isCardio ? [] : computeExerciseTrendPoints(exerciseId);
    wireViewToggle('log-history-toggle', document.getElementById('log-history-list'), document.getElementById('log-history-chart'), points);
}

function selectLogExercise(exerciseId) {
    document.getElementById('log-step-exercise').classList.add('hidden');
    document.getElementById('log-step-detail').classList.remove('hidden');
    document.getElementById('log-back-to-exercise').classList.remove('hidden');
    document.getElementById('log-session-view').classList.add('hidden');
    populateDetailView(exerciseId);
}

function nextSetNumberForToday(exerciseId, date) {
    const logs = getLogs().filter(l => l.exerciseId === exerciseId && l.date === date);
    const maxSet = logs.reduce((max, l) => Math.max(max, l.set || 0), 0);
    return maxSet + 1;
}

// Most recent by workout date (then set number), not by log id - a backdated
// entry gets a higher id than same-day entries logged earlier, which would
// otherwise make prefill pick a stale/wrong weight.
function mostRecentLoggedWeight(exerciseId) {
    const logs = getLogs()
        .filter(l => l.exerciseId === exerciseId && l.weight != null)
        .sort((a, b) => b.date.localeCompare(a.date) || (b.set || 0) - (a.set || 0));
    return logs[0] || null;
}

function renderLogHistory(exerciseId) {
    const container = document.getElementById('log-history-list');
    const logs = getLogs()
        .filter(l => l.exerciseId === exerciseId)
        .sort((a, b) => (b.date).localeCompare(a.date) || (b.set || 0) - (a.set || 0));

    if (logs.length === 0) {
        container.innerHTML = '<p class="no-data">No history yet. Log your first set above.</p>';
        return;
    }

    const byDate = {};
    logs.forEach(l => {
        if (!byDate[l.date]) byDate[l.date] = [];
        byDate[l.date].push(l);
    });

    let html = '';
    Object.keys(byDate).sort().reverse().forEach(date => {
        html += `<div class="history-date-group"><div class="history-date-label">${formatDate(date)}</div>`;
        byDate[date].forEach(l => {
            const parts = [];
            if (l.weight !== null && l.weight !== undefined && l.weight !== '') parts.push(`${l.weight} lb`);
            if (l.reps !== null && l.reps !== undefined && l.reps !== '') parts.push(`${l.reps} reps`);
            const main = parts.length ? parts.join(' × ') : '';
            const comment = l.comment ? ` <span class="card-sub">${escapeHtml(l.comment)}</span>` : '';
            html += `<div class="history-set">
                <span>Set ${l.set || '-'}: ${main}${comment}</span>
                <button class="icon-btn danger-btn" data-id="${l.id}" title="Delete" aria-label="Delete">${ICON_X}</button>
            </div>`;
        });
        html += `</div>`;
    });

    container.innerHTML = html;
    container.querySelectorAll('.danger-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteLogEntry(parseInt(btn.dataset.id, 10)));
    });
}

function deleteLogEntry(id) {
    if (!confirm('Delete this set?')) return;
    saveLogs(getLogs().filter(l => l.id !== id));
    renderLogHistory(logCurrentExerciseId);
}

function updateLogSetNumberUI(n) {
    document.getElementById('log-set-number').value = n;
    const inRange = n >= 1 && n <= 4;
    document.getElementById('log-set-picker').classList.toggle('hidden', !inRange);
    document.getElementById('log-set-number').classList.toggle('hidden', inRange);
    document.querySelectorAll('#log-set-picker .bg-option[data-set]').forEach(b => {
        b.classList.toggle('selected', parseInt(b.dataset.set, 10) === n);
    });
}

function initLogSetPicker() {
    document.querySelectorAll('#log-set-picker .bg-option[data-set]').forEach(btn => {
        btn.addEventListener('click', () => updateLogSetNumberUI(parseInt(btn.dataset.set, 10)));
    });
    document.getElementById('log-set-edit-btn').addEventListener('click', () => {
        document.getElementById('log-set-picker').classList.add('hidden');
        document.getElementById('log-set-number').classList.remove('hidden');
        document.getElementById('log-set-number').focus();
    });
}

function collapseLogComment() {
    document.getElementById('log-comment').value = '';
    document.getElementById('log-comment').classList.add('hidden');
    document.getElementById('log-comment-toggle').classList.remove('hidden');
}

function initLogCommentToggle() {
    document.getElementById('log-comment-toggle').addEventListener('click', () => {
        document.getElementById('log-comment-toggle').classList.add('hidden');
        document.getElementById('log-comment').classList.remove('hidden');
        document.getElementById('log-comment').focus();
    });
}

function initLogTab() {
    initLogSetPicker();
    initLogCommentToggle();

    document.getElementById('log-back-to-category').addEventListener('click', () => {
        document.getElementById('log-step-exercise').classList.add('hidden');
        document.getElementById('log-step-category').classList.remove('hidden');
    });
    document.getElementById('log-back-to-exercise').addEventListener('click', () => {
        document.getElementById('log-step-detail').classList.add('hidden');
        document.getElementById('log-step-exercise').classList.remove('hidden');
    });

    document.getElementById('log-set-form').addEventListener('submit', e => {
        e.preventDefault();
        const date = document.getElementById('log-date').value;
        const weightVal = document.getElementById('log-weight').value;
        const repsVal = document.getElementById('log-reps').value;
        const setVal = document.getElementById('log-set-number').value;
        const comment = document.getElementById('log-comment').value.trim();

        if (!date) { alert('Please choose a date.'); return; }

        const logs = getLogs();
        logs.push({
            id: nextLogId(),
            date,
            exerciseId: logCurrentExerciseId,
            set: setVal ? parseInt(setVal, 10) : nextSetNumberForToday(logCurrentExerciseId, date),
            weight: weightVal ? parseFloat(weightVal) : null,
            reps: repsVal ? parseFloat(repsVal) : null,
            comment: comment || null,
        });
        saveLogs(logs);

        const nextSet = (setVal ? parseInt(setVal, 10) : nextSetNumberForToday(logCurrentExerciseId, date)) + 1;
        // Weight (and reps) carry over instead of clearing - most sets of an
        // exercise use the same weight, so re-typing it each set is friction.
        collapseLogComment();
        updateLogSetNumberUI(nextSet);

        renderLogHistory(logCurrentExerciseId);

        if (activeSession && activeSession.exerciseIds[activeSession.currentIndex] === logCurrentExerciseId) {
            activeSession.completed[activeSession.currentIndex] = true;
            saveActiveSession(activeSession);
            renderSessionStrip();
        }
    });
}

// ============ CARDIO LOGGING ============

const CARDIO_ZONES = ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4', 'Zone 5'];

function addCardioSegmentRow(timeVal, zoneVal) {
    const list = document.getElementById('cardio-segments-list');
    const row = document.createElement('div');
    row.className = 'segment-row';
    const zoneOptions = ['<option value="">Select zone</option>']
        .concat(CARDIO_ZONES.map(z => `<option value="${z}" ${z === zoneVal ? 'selected' : ''}>${z}</option>`))
        .join('');
    row.innerHTML = `
        <label>Time (min)<input type="number" step="0.5" inputmode="decimal" class="segment-time" value="${timeVal || ''}"></label>
        <label>Zone<select class="segment-zone">${zoneOptions}</select></label>
        <button type="button" class="small-btn danger-btn">Remove</button>
    `;
    row.querySelector('button').addEventListener('click', () => row.remove());
    list.appendChild(row);
}

function resetCardioSegments() {
    document.getElementById('cardio-segments-list').innerHTML = '';
    addCardioSegmentRow();
}

function resetCardioForm() {
    document.getElementById('cardio-date').value = todayStr();
    document.getElementById('cardio-total-time').value = '';
    document.getElementById('cardio-distance').value = '';
    document.getElementById('cardio-comment').value = '';
    resetCardioSegments();
}

function renderCardioHistory(exerciseId) {
    const container = document.getElementById('log-history-list');
    const logs = getLogs().filter(l => l.exerciseId === exerciseId);
    if (logs.length === 0) {
        container.innerHTML = '<p class="no-data">No history yet. Log your first session above.</p>';
        return;
    }

    const byDate = {};
    logs.forEach(l => {
        if (!byDate[l.date]) byDate[l.date] = [];
        byDate[l.date].push(l);
    });

    let html = '';
    Object.keys(byDate).sort().reverse().forEach(date => {
        html += `<div class="history-date-group"><div class="history-date-label">${formatDate(date)}</div>`;
        byDate[date].forEach(l => {
            const parts = [];
            if (l.totalTime) parts.push(`${l.totalTime} min`);
            if (l.distance) parts.push(`${l.distance} mi`);
            if (l.segments && l.segments.length) {
                parts.push(l.segments.map(s => `${s.time ?? '?'}m @ ${s.zone || '?'}`).join(', '));
            }
            const main = parts.join(' · ') || '(no details)';
            const comment = l.comment ? ` <span class="card-sub">${escapeHtml(l.comment)}</span>` : '';
            html += `<div class="history-set">
                <span>${escapeHtml(main)}${comment}</span>
                <button class="icon-btn danger-btn" data-id="${l.id}" title="Delete" aria-label="Delete">${ICON_X}</button>
            </div>`;
        });
        html += `</div>`;
    });

    container.innerHTML = html;
    container.querySelectorAll('.danger-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm('Delete this entry?')) return;
            saveLogs(getLogs().filter(l => l.id !== parseInt(btn.dataset.id, 10)));
            renderCardioHistory(exerciseId);
        });
    });
}

function initCardioForm() {
    document.getElementById('cardio-add-segment-btn').addEventListener('click', () => addCardioSegmentRow());

    document.getElementById('log-cardio-form').addEventListener('submit', e => {
        e.preventDefault();
        const date = document.getElementById('cardio-date').value;
        const totalTimeVal = document.getElementById('cardio-total-time').value;
        const distanceVal = document.getElementById('cardio-distance').value;
        const commentVal = document.getElementById('cardio-comment').value.trim();

        if (!date) { alert('Please choose a date.'); return; }

        const segments = [];
        document.querySelectorAll('#cardio-segments-list .segment-row').forEach(row => {
            const t = row.querySelector('.segment-time').value;
            const z = row.querySelector('.segment-zone').value;
            if (t || z) segments.push({ time: t ? parseFloat(t) : null, zone: z || null });
        });

        const logs = getLogs();
        logs.push({
            id: nextLogId(),
            date,
            exerciseId: logCurrentExerciseId,
            totalTime: totalTimeVal ? parseFloat(totalTimeVal) : null,
            distance: distanceVal ? parseFloat(distanceVal) : null,
            segments,
            comment: commentVal || null,
        });
        saveLogs(logs);

        resetCardioForm();
        renderCardioHistory(logCurrentExerciseId);

        if (activeSession && activeSession.exerciseIds[activeSession.currentIndex] === logCurrentExerciseId) {
            activeSession.completed[activeSession.currentIndex] = true;
            saveActiveSession(activeSession);
            renderSessionStrip();
        }
    });
}

// ============ PLANNED WORKOUT SESSION (LOG TAB) ============

let activeSession = null;
let sessionPickerMode = null; // 'swap' | 'add'

function renderLogPlanPickerList() {
    renderPlanFilterChips();
    renderPlanList();
}

function startSessionFromPlan(planId) {
    const plan = getPlans().find(p => p.id === planId);
    if (!plan || plan.exerciseIds.length === 0) {
        alert('This plan has no exercises in it.');
        return;
    }
    activeSession = { planId: plan.id, planName: plan.name, exerciseIds: [...plan.exerciseIds], completed: plan.exerciseIds.map(() => false), currentIndex: 0, date: todayStr() };
    saveActiveSession(activeSession);
    enterSessionMode();
}

function enterSessionMode() {
    openSessionRowMenuIdx = null;
    document.getElementById('log-start-row').classList.add('hidden');
    document.getElementById('log-plan-picker').classList.add('hidden');
    document.getElementById('plan-editor').classList.add('hidden');
    document.getElementById('log-step-category').classList.add('hidden');
    document.getElementById('log-step-exercise').classList.add('hidden');
    document.getElementById('log-back-to-exercise').classList.add('hidden');
    document.getElementById('session-picker-panel').classList.add('hidden');

    document.getElementById('log-session-view').classList.remove('hidden');
    document.getElementById('log-step-detail').classList.remove('hidden');

    document.querySelector('.log-session-header-row').appendChild(document.getElementById('rest-timer'));

    renderSessionStrip();
    populateDetailView(activeSession.exerciseIds[activeSession.currentIndex]);
}

function exitSessionMode() {
    activeSession = null;
    saveActiveSession(null);
    document.getElementById('log-session-view').classList.add('hidden');
    document.getElementById('log-step-detail').classList.add('hidden');
    document.getElementById('log-plan-picker').classList.add('hidden');
    document.getElementById('plan-editor').classList.add('hidden');
    document.getElementById('log-start-row').classList.remove('hidden');
    document.getElementById('log-step-category').classList.remove('hidden');

    document.getElementById('log-start-row').appendChild(document.getElementById('rest-timer'));
}

const SESSION_GEAR_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;

let openSessionRowMenuIdx = null;

function renderSessionStrip() {
    const container = document.getElementById('log-session-strip');
    const exercises = getExercises();
    container.innerHTML = activeSession.exerciseIds.map((id, idx) => {
        const ex = exercises.find(e => e.id === id);
        const name = ex ? ex.name : '(removed)';
        const isCurrent = idx === activeSession.currentIndex;
        const isDone = !!activeSession.completed[idx];
        const rowCls = `session-pill-row${isCurrent ? ' current' : ''}${isDone ? ' completed' : ''}`;
        const menuOpen = openSessionRowMenuIdx === idx;
        return `
        <div class="${rowCls}">
            <input type="checkbox" class="session-complete-cb" data-idx="${idx}" ${isDone ? 'checked' : ''}>
            <button type="button" class="session-pill-name" data-idx="${idx}">${escapeHtml(name)}</button>
            <button type="button" class="session-row-gear" data-idx="${idx}" title="Exercise options" aria-label="Exercise options">${SESSION_GEAR_ICON}</button>
        </div>
        ${menuOpen ? `
        <div class="session-row-menu">
            <button type="button" class="link-btn session-row-swap" data-idx="${idx}">Swap</button>
            <button type="button" class="link-btn danger-text session-row-remove" data-idx="${idx}">Remove</button>
        </div>` : ''}`;
    }).join('');

    container.querySelectorAll('.session-pill-name').forEach(btn => {
        btn.addEventListener('click', () => jumpToSessionIndex(parseInt(btn.dataset.idx, 10)));
    });
    container.querySelectorAll('.session-complete-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const idx = parseInt(cb.dataset.idx, 10);
            activeSession.completed[idx] = cb.checked;
            saveActiveSession(activeSession);
            renderSessionStrip();
        });
    });
    container.querySelectorAll('.session-row-gear').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx, 10);
            openSessionRowMenuIdx = openSessionRowMenuIdx === idx ? null : idx;
            renderSessionStrip();
        });
    });
    container.querySelectorAll('.session-row-swap').forEach(btn => {
        btn.addEventListener('click', () => {
            openSessionRowMenuIdx = null;
            jumpToSessionIndex(parseInt(btn.dataset.idx, 10));
            openSessionPicker('swap');
        });
    });
    container.querySelectorAll('.session-row-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            openSessionRowMenuIdx = null;
            jumpToSessionIndex(parseInt(btn.dataset.idx, 10));
            removeCurrentFromSession();
        });
    });

    document.getElementById('log-session-title').textContent = activeSession.planName;

    const allDone = activeSession.completed.length > 0 && activeSession.completed.every(c => c);
    document.getElementById('session-finish-row').classList.toggle('hidden', !allDone);
}

function jumpToSessionIndex(idx) {
    if (idx < 0 || idx >= activeSession.exerciseIds.length) return;
    activeSession.currentIndex = idx;
    saveActiveSession(activeSession);
    renderSessionStrip();
    populateDetailView(activeSession.exerciseIds[idx]);
}

function openSessionPicker(mode) {
    sessionPickerMode = mode;
    document.getElementById('session-picker-panel').classList.remove('hidden');
    renderExercisePickerButtons('session-picker-list', activeSession.exerciseIds, onSessionPickerPick);
}

function onSessionPickerPick(exerciseId) {
    if (sessionPickerMode === 'swap') {
        activeSession.exerciseIds[activeSession.currentIndex] = exerciseId;
        activeSession.completed[activeSession.currentIndex] = false;
    } else if (sessionPickerMode === 'add') {
        activeSession.exerciseIds.push(exerciseId);
        activeSession.completed.push(false);
    }
    saveActiveSession(activeSession);
    document.getElementById('session-picker-panel').classList.add('hidden');
    renderSessionStrip();
    populateDetailView(activeSession.exerciseIds[activeSession.currentIndex]);
}

function removeCurrentFromSession() {
    if (activeSession.exerciseIds.length <= 1) {
        if (!confirm('This is the last exercise in the session. Removing it will end the planned workout. Continue?')) return;
        exitSessionMode();
        return;
    }
    if (!confirm('Remove this exercise from the current session? (The saved plan itself is not changed.)')) return;
    activeSession.exerciseIds.splice(activeSession.currentIndex, 1);
    activeSession.completed.splice(activeSession.currentIndex, 1);
    if (activeSession.currentIndex >= activeSession.exerciseIds.length) {
        activeSession.currentIndex = activeSession.exerciseIds.length - 1;
    }
    saveActiveSession(activeSession);
    renderSessionStrip();
    populateDetailView(activeSession.exerciseIds[activeSession.currentIndex]);
}

function initSessionControls() {
    document.getElementById('start-planned-btn').addEventListener('click', () => {
        document.getElementById('log-start-row').classList.add('hidden');
        document.getElementById('log-step-category').classList.add('hidden');
        document.getElementById('plan-editor').classList.add('hidden');
        document.getElementById('log-plan-picker').classList.remove('hidden');
        renderLogPlanPickerList();
    });
    document.getElementById('log-plan-picker-back').addEventListener('click', () => {
        document.getElementById('log-plan-picker').classList.add('hidden');
        document.getElementById('log-start-row').classList.remove('hidden');
        document.getElementById('log-step-category').classList.remove('hidden');
    });

    document.getElementById('log-session-exit').addEventListener('click', () => {
        if (confirm('Exit this planned workout? Anything already logged stays saved.')) exitSessionMode();
    });

    document.getElementById('session-finish-btn').addEventListener('click', exitSessionMode);

    document.getElementById('session-add-btn').addEventListener('click', () => openSessionPicker('add'));
    document.getElementById('session-picker-back').addEventListener('click', () => {
        document.getElementById('session-picker-panel').classList.add('hidden');
    });
}

function resumeSessionIfAny() {
    const saved = getActiveSession();
    if (!saved) {
        activeSession = null;
        document.getElementById('log-session-view').classList.add('hidden');
        document.getElementById('log-step-detail').classList.add('hidden');
        document.getElementById('log-plan-picker').classList.add('hidden');
        document.getElementById('plan-editor').classList.add('hidden');
        document.getElementById('log-start-row').classList.remove('hidden');
        document.getElementById('log-step-category').classList.remove('hidden');
        return;
    }
    if (!Array.isArray(saved.completed)) saved.completed = saved.exerciseIds.map(() => false);
    if (!saved.date) saved.date = todayStr();
    activeSession = saved;
    enterSessionMode();
}

// ============ PLAN WORKOUT TAB ============

let planEditorId = null;
let planEditorExerciseIds = [];

let planListOpenGroups = null;

function planCardHtml(p, exercises) {
    const names = p.exerciseIds.map(id => {
        const ex = exercises.find(e => e.id === id);
        return ex ? ex.name : '(deleted exercise)';
    }).join(', ');
    return `
    <div class="card card-row">
        <div>
            <div class="card-title">${escapeHtml(p.name)}</div>
            <div class="card-sub">${escapeHtml(names)}</div>
        </div>
        <span>
            <button type="button" class="small-btn" data-start="${p.id}">Start</button>
            <button type="button" class="small-btn" data-edit="${p.id}">Edit</button>
            <button type="button" class="small-btn" data-copy="${p.id}">Copy</button>
            <button type="button" class="icon-btn danger-btn" data-delete="${p.id}" title="Delete" aria-label="Delete">${ICON_X}</button>
        </span>
    </div>`;
}

function wirePlanListActions(container) {
    container.querySelectorAll('[data-start]').forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab('log');
            startSessionFromPlan(btn.dataset.start);
        });
    });
    container.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => openPlanEditor(btn.dataset.edit));
    });
    container.querySelectorAll('[data-copy]').forEach(btn => {
        btn.addEventListener('click', () => copyPlan(btn.dataset.copy));
    });
    container.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm('Delete this plan? (Your logged history is not affected.)')) return;
            savePlans(getPlans().filter(p => p.id !== btn.dataset.delete));
            renderPlanList();
        });
    });
}

// A plan has no stored category - its group label is derived live from the
// categories of the exercises actually in it (in the order they were added),
// e.g. a plan with a Bench Press and a Lateral Raise groups under "Push", one
// mixing Push and Legs exercises groups under "Push + Legs". This can't go
// stale the way a manually-picked tag could.
function planCategoryLabel(plan, exercises) {
    const cats = [];
    plan.exerciseIds.forEach(id => {
        const ex = exercises.find(e => e.id === id);
        if (ex && !cats.includes(ex.category)) cats.push(ex.category);
    });
    return cats.length ? cats.join(' + ') : 'Uncategorized';
}

// Live filter for the plan picker: which categories are toggled on. Empty
// set means no filter - show everything. A plan matches if any of its
// exercises belong to a selected category (OR, not AND).
let planFilterCategories = new Set();

function planMatchesFilter(plan, exercises) {
    if (planFilterCategories.size === 0) return true;
    return plan.exerciseIds.some(id => {
        const ex = exercises.find(e => e.id === id);
        return ex && planFilterCategories.has(ex.category);
    });
}

function renderPlanFilterChips() {
    const container = document.getElementById('plan-filter-chips');
    const categories = getCategories();
    // Drop any selected filter for a category that no longer exists (renamed/deleted).
    [...planFilterCategories].forEach(cat => {
        if (!categories.includes(cat)) planFilterCategories.delete(cat);
    });
    if (categories.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = categories.map(cat =>
        `<button type="button" class="bg-option${planFilterCategories.has(cat) ? ' selected' : ''}" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
    ).join('');
    container.querySelectorAll('.bg-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const cat = btn.dataset.cat;
            if (planFilterCategories.has(cat)) planFilterCategories.delete(cat);
            else planFilterCategories.add(cat);
            planListOpenGroups = null;
            renderPlanFilterChips();
            renderPlanList();
        });
    });
}

function renderPlanList() {
    const container = document.getElementById('plan-list');
    const allPlans = getPlans();
    const exercises = getExercises();
    if (allPlans.length === 0) {
        container.innerHTML = '<p class="no-data">No saved plans yet. Tap + New Plan above.</p>';
        return;
    }

    const plans = allPlans.filter(p => planMatchesFilter(p, exercises));
    if (plans.length === 0) {
        container.innerHTML = '<p class="no-data">No plans match the selected filter.</p>';
        return;
    }

    const byGroup = {};
    plans.forEach(p => {
        const label = planCategoryLabel(p, exercises);
        if (!byGroup[label]) byGroup[label] = [];
        byGroup[label].push(p);
    });
    const activeGroups = Object.keys(byGroup);

    if (activeGroups.length <= 1) {
        // Everything lands in the same group so far - skip the grouping UI
        // entirely and just show a plain list of plans.
        container.innerHTML = plans.map(p => planCardHtml(p, exercises)).join('');
        wirePlanListActions(container);
        return;
    }

    if (!planListOpenGroups) planListOpenGroups = new Set(activeGroups);

    container.innerHTML = activeGroups.map(g => {
        const open = planListOpenGroups.has(g);
        return `
        <div class="category-block">
            <div class="category-header" data-plan-group="${escapeHtml(g)}">
                <span class="category-header-title">${escapeHtml(g)} (${byGroup[g].length})</span>
            </div>
            <div class="category-body ${open ? 'open' : ''}">
                ${byGroup[g].map(p => planCardHtml(p, exercises)).join('')}
            </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.category-header').forEach(header => {
        header.addEventListener('click', () => {
            const g = header.dataset.planGroup;
            if (planListOpenGroups.has(g)) planListOpenGroups.delete(g);
            else planListOpenGroups.add(g);
            renderPlanList();
        });
    });
    wirePlanListActions(container);
}

function copyPlan(planId) {
    const plans = getPlans();
    const original = plans.find(p => p.id === planId);
    if (!original) return;
    const copy = { id: `plan-${Date.now()}`, name: `${original.name} (Copy)`, exerciseIds: [...original.exerciseIds] };
    plans.push(copy);
    savePlans(plans);
    openPlanEditor(copy.id);
}

function openPlanEditor(planId) {
    const plans = getPlans();
    const plan = planId ? plans.find(p => p.id === planId) : null;
    planEditorId = plan ? plan.id : null;
    planEditorExerciseIds = plan ? [...plan.exerciseIds] : [];

    document.getElementById('log-plan-picker').classList.add('hidden');
    document.getElementById('plan-editor').classList.remove('hidden');
    document.getElementById('plan-name-input').value = plan ? plan.name : '';

    renderPlanEditorExerciseList();
    renderPlanEditorPicker();
}

function renderPlanEditorExerciseList() {
    const container = document.getElementById('plan-editor-exercise-list');
    const exercises = getExercises();
    if (planEditorExerciseIds.length === 0) {
        container.innerHTML = '<p class="no-data">No exercises added yet.</p>';
        return;
    }
    container.innerHTML = planEditorExerciseIds.map((id, idx) => {
        const ex = exercises.find(e => e.id === id);
        const name = ex ? ex.name : '(deleted exercise)';
        return `
        <div class="plan-exercise-row">
            <span>${idx + 1}. ${escapeHtml(name)}</span>
            <span class="plan-exercise-row-actions">
                <button type="button" class="small-btn" data-up="${idx}" ${idx === 0 ? 'disabled' : ''}>&uarr;</button>
                <button type="button" class="small-btn" data-down="${idx}" ${idx === planEditorExerciseIds.length - 1 ? 'disabled' : ''}>&darr;</button>
                <button type="button" class="small-btn danger-btn" data-remove="${idx}">Remove</button>
            </span>
        </div>`;
    }).join('');

    container.querySelectorAll('[data-up]').forEach(btn => {
        btn.addEventListener('click', () => {
            const i = parseInt(btn.dataset.up, 10);
            [planEditorExerciseIds[i - 1], planEditorExerciseIds[i]] = [planEditorExerciseIds[i], planEditorExerciseIds[i - 1]];
            renderPlanEditorExerciseList();
        });
    });
    container.querySelectorAll('[data-down]').forEach(btn => {
        btn.addEventListener('click', () => {
            const i = parseInt(btn.dataset.down, 10);
            [planEditorExerciseIds[i + 1], planEditorExerciseIds[i]] = [planEditorExerciseIds[i], planEditorExerciseIds[i + 1]];
            renderPlanEditorExerciseList();
        });
    });
    container.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
            planEditorExerciseIds.splice(parseInt(btn.dataset.remove, 10), 1);
            renderPlanEditorExerciseList();
            renderPlanEditorPicker();
        });
    });
}

function renderPlanEditorPicker() {
    renderExercisePickerButtons('plan-editor-picker', planEditorExerciseIds, (exerciseId) => {
        planEditorExerciseIds.push(exerciseId);
        renderPlanEditorExerciseList();
        renderPlanEditorPicker();
    });
}

function closePlanEditor() {
    document.getElementById('plan-editor').classList.add('hidden');
    document.getElementById('log-plan-picker').classList.remove('hidden');
    renderLogPlanPickerList();
}

function initPlanTab() {
    document.getElementById('new-plan-btn').addEventListener('click', () => openPlanEditor(null));
    document.getElementById('plan-editor-back').addEventListener('click', closePlanEditor);

    document.getElementById('plan-save-btn').addEventListener('click', () => {
        const name = document.getElementById('plan-name-input').value.trim();
        if (!name) { alert('Please name this plan.'); return; }
        if (planEditorExerciseIds.length === 0) { alert('Add at least one exercise.'); return; }

        const plans = getPlans();
        const idx = plans.findIndex(p => p.id === planEditorId);
        const plan = { id: planEditorId || `plan-${Date.now()}`, name, exerciseIds: [...planEditorExerciseIds] };
        if (idx >= 0) plans[idx] = plan;
        else plans.push(plan);
        savePlans(plans);

        closePlanEditor();
    });
}

// ============ CATEGORY MANAGER (gear panel on the Log tab) ============

function renderCategoryManager() {
    const categories = getCategories();

    // Brand-new users (zero categories) always see this panel, regardless of
    // the gear toggle, so the setup wizard / empty state is never hidden behind a click.
    if (categories.length === 0) {
        document.getElementById('exercise-manager-panel').classList.remove('hidden');
    }
    syncLogCategoryGridVisibility();

    const showWizard = categories.length === 0 && !setupSkipped;
    document.getElementById('setup-wizard').classList.toggle('hidden', !showWizard);
    document.getElementById('exercise-manager-normal').classList.toggle('hidden', showWizard);
    if (showWizard) {
        resetSetupWizard();
        return;
    }

    const container = document.getElementById('category-manager-list');
    const exercises = getExercises();
    const addCategoryBtnHtml = `<button type="button" class="small-btn gear-add-btn" id="add-category-btn">+ Add Category</button>`;

    if (categories.length === 0) {
        container.innerHTML = addCategoryBtnHtml + '<p class="no-data">No categories yet. Use + Add Category above.</p>';
        document.getElementById('add-category-btn').addEventListener('click', () => {
            addCategoryFromPrompt(prompt('New category name:'));
        });
        return;
    }

    // Category settings is just rename/delete for the category itself now -
    // moving/renaming/deleting individual exercises lives in that category's
    // own exercise-list gear panel instead (renderExerciseListManagerPanel).
    container.innerHTML = addCategoryBtnHtml + categories.map(cat => {
        const exCount = exercises.filter(e => e.category === cat).length;
        return `
        <div class="exercise-row">
            <span>${escapeHtml(cat)} (${exCount})</span>
            <span class="exercise-row-actions">
                <button class="icon-btn rename-cat-btn" data-cat="${escapeHtml(cat)}" title="Rename" aria-label="Rename">${ICON_PENCIL}</button>
                <button class="icon-btn danger-btn delete-cat-btn" data-cat="${escapeHtml(cat)}" title="Delete" aria-label="Delete">${ICON_X}</button>
            </span>
        </div>`;
    }).join('');

    document.getElementById('add-category-btn').addEventListener('click', () => {
        addCategoryFromPrompt(prompt('New category name:'));
    });
    container.querySelectorAll('.rename-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => renameCategory(btn.dataset.cat));
    });
    container.querySelectorAll('.delete-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteCategory(btn.dataset.cat));
    });
}

function addExercise(category, name) {
    if (!name) return;
    const exercises = getExercises();
    if (exercises.some(e => e.category === category && e.name.toLowerCase() === name.toLowerCase())) {
        alert('That exercise already exists in this category.');
        return;
    }
    exercises.push({ id: uniqueExerciseId(category, name), name, category });
    saveExercises(exercises);
    renderCategoryManager();
    refreshCategoryDependents();
}

function deleteExercise(id) {
    const exercises = getExercises();
    const exercise = exercises.find(e => e.id === id);
    if (!exercise) return;
    const logCount = getLogs().filter(l => l.exerciseId === id).length;
    const msg = logCount > 0
        ? `Delete "${exercise.name}"? This will also delete its ${logCount} logged set(s).`
        : `Delete "${exercise.name}"?`;
    if (!confirm(msg)) return;

    saveExercises(exercises.filter(e => e.id !== id));
    saveLogs(getLogs().filter(l => l.exerciseId !== id));
    savePlans(getPlans().map(p => ({ ...p, exerciseIds: p.exerciseIds.filter(exId => exId !== id) })));
    renderCategoryManager();
    refreshCategoryDependents();
}

function renameExercise(id) {
    const exercises = getExercises();
    const exercise = exercises.find(e => e.id === id);
    if (!exercise) return;

    const newName = prompt('Rename exercise:', exercise.name);
    if (!newName || !newName.trim() || newName.trim() === exercise.name) return;
    const trimmed = newName.trim();

    if (exercises.some(e => e.category === exercise.category && e.id !== id && e.name.toLowerCase() === trimmed.toLowerCase())) {
        alert('That name is already used in this category.');
        return;
    }

    // Only the display name changes; id stays the same, so all logged history stays linked.
    exercise.name = trimmed;
    saveExercises(exercises);
    renderCategoryManager();
    refreshCategoryDependents();
}

function moveExercise(id, newCategory) {
    const exercises = getExercises();
    const exercise = exercises.find(e => e.id === id);
    if (!exercise) return;

    if (exercises.some(e => e.category === newCategory && e.id !== id && e.name.toLowerCase() === exercise.name.toLowerCase())) {
        alert(`"${exercise.name}" already exists in ${newCategory}.`);
        return;
    }

    // Only the category field changes; logs reference the exercise id, not its category, so history is untouched.
    exercise.category = newCategory;
    saveExercises(exercises);
    renderCategoryManager();
    refreshCategoryDependents();
}

function renameCategory(oldName) {
    const newName = prompt('Rename category:', oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;
    const trimmed = newName.trim();
    const categories = getCategories();
    if (categories.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
        alert('A category with that name already exists.');
        return;
    }

    saveCategories(categories.map(c => c === oldName ? trimmed : c));
    saveExercises(getExercises().map(e => e.category === oldName ? { ...e, category: trimmed } : e));
    if (oldName === getCardioCategory()) saveCardioCategory(trimmed);

    renderCategoryManager();
    refreshCategoryDependents();
}

function deleteCategory(cat) {
    const hasExercises = getExercises().some(e => e.category === cat);
    if (hasExercises) {
        alert('This category still has exercises in it. Delete those first (or move them) before deleting the category.');
        return;
    }
    if (!confirm(`Delete category "${cat}"?`)) return;
    saveCategories(getCategories().filter(c => c !== cat));
    renderCategoryManager();
    refreshCategoryDependents();
}

function refreshCategoryDependents() {
    renderLogCategoryStep();
    if (logCurrentCategory) renderLogExerciseStepContent(logCurrentCategory);
    renderPlanFilterChips();
    renderPlanList();
}

function initExerciseManagerPanels() {
    document.getElementById('exercise-manager-gear-btn').addEventListener('click', () => {
        document.getElementById('exercise-manager-panel').classList.toggle('hidden');
        syncLogCategoryGridVisibility();
    });
    document.getElementById('exercise-list-gear-btn').addEventListener('click', () => {
        document.getElementById('exercise-list-manager-panel').classList.toggle('hidden');
        syncLogExerciseGridVisibility();
    });

    initSetupWizard();
}

// ============ FIRST-RUN SETUP WIZARD ============
// Shown only while a user has zero categories. Reference data below is
// static and shared by everyone - it costs nothing per-user, since it's
// never written to Firestore.

const SHARED_SETUP_LEGS_ANTERIOR = ['Hack Squat', 'Incline Hack Squat', 'Decline Hack Squat', 'Quad Extension Machine', 'Bulgarian Split Squat'];
const SHARED_SETUP_LEGS_POSTERIOR = ['Hamstring Machine', 'Hip Thrust', 'Single Leg RDL', 'Single Leg Cable Kickback', 'Calf Raise'];

const SHARED_SETUP_LEGS = {
    'Legs': ['Squat', 'Deadlift', 'Leg Press', 'Lunges', ...SHARED_SETUP_LEGS_ANTERIOR, ...SHARED_SETUP_LEGS_POSTERIOR],
    'Legs (Anterior)': SHARED_SETUP_LEGS_ANTERIOR,
    'Legs (Posterior)': SHARED_SETUP_LEGS_POSTERIOR,
};

const SHARED_SETUP_CORE_CARDIO = {
    'Core': ['Crunches', 'Leg Raises (Flat)', 'Leg Raises (Hanging)', 'Cable Crunch'],
    'Cardio': ['Run', 'Walk', 'Rowing Machine', 'Stairmaster', 'Assault Bike', 'Swimming', 'Jiu-Jitsu'],
};

const SETUP_TEMPLATES = {
    ppl: {
        categories: {
            'Push': ['Bench Press', 'Overhead Press', 'Incline Bench Press', 'Dumbbell Press', 'Chest Fly', 'Push-ups', 'Cable Crossover', 'Tricep Pushdown', 'Overhead Tricep Extension', 'Lateral Raise', 'Front Raise'],
            'Pull': ['Pull-ups', 'Barbell Row', 'Lat Pulldown', 'Seated Cable Row', 'Deadlift', 'Bicep Curl', 'Hammer Curl', 'Preacher Curl', 'Face Pulls', 'Shrugs'],
            ...SHARED_SETUP_LEGS,
            ...SHARED_SETUP_CORE_CARDIO,
        },
    },
    muscle: {
        categories: {
            ...SHARED_SETUP_LEGS,
            'Arms': ['Bicep Curl', 'Hammer Curl', 'Tricep Pushdown', 'Overhead Tricep Extension', 'Preacher Curl'],
            'Chest': ['Bench Press', 'Incline Bench Press', 'Dumbbell Press', 'Chest Fly', 'Push-ups', 'Cable Crossover'],
            'Back': ['Pull-ups', 'Lat Pulldown', 'Barbell Row', 'Seated Cable Row', 'Deadlift'],
            'Shoulders': ['Overhead Press', 'Lateral Raise', 'Front Raise', 'Face Pulls', 'Shrugs'],
            ...SHARED_SETUP_CORE_CARDIO,
        },
    },
};

let setupSkipped = false;

function resetSetupWizard() {
    document.getElementById('setup-template-choice').classList.remove('hidden');
    document.getElementById('setup-checklist-view').classList.add('hidden');
}

function setupCheckboxRowHtml(cat, name) {
    return `
        <label class="setup-checkbox-row">
            <input type="checkbox" checked data-cat="${escapeHtml(cat)}" data-name="${escapeHtml(name)}">
            ${escapeHtml(name)}
        </label>`;
}

function renderSetupChecklist(templateKey) {
    document.getElementById('setup-template-choice').classList.add('hidden');
    document.getElementById('setup-checklist-view').classList.remove('hidden');

    const template = SETUP_TEMPLATES[templateKey];
    document.getElementById('setup-checklist-list').innerHTML = Object.entries(template.categories).map(([cat, list]) => `
        <div class="setup-category-group">
            <label class="setup-checkbox-row setup-category-toggle-row">
                <input type="checkbox" checked class="setup-cat-toggle" data-cat="${escapeHtml(cat)}">
                <h3>${escapeHtml(cat)}</h3>
            </label>
            <div class="setup-exercise-list" data-cat-list="${escapeHtml(cat)}">
                ${list.map(name => setupCheckboxRowHtml(cat, name)).join('')}
            </div>
            <div class="setup-add-custom">
                <input type="text" class="setup-custom-input" data-cat="${escapeHtml(cat)}" placeholder="Add your own exercise">
                <button type="button" class="small-btn setup-custom-add-btn" data-cat="${escapeHtml(cat)}">+ Add</button>
            </div>
        </div>
    `).join('');
}

function syncSetupCategoryToggle(cat) {
    const catCb = document.querySelector(`.setup-cat-toggle[data-cat="${CSS.escape(cat)}"]`);
    if (!catCb) return;
    const siblings = [...document.querySelectorAll(`#setup-checklist-list input[data-cat="${CSS.escape(cat)}"][data-name]`)];
    if (siblings.length === 0) { catCb.checked = true; catCb.indeterminate = false; return; }
    catCb.checked = siblings.every(s => s.checked);
    catCb.indeterminate = !catCb.checked && siblings.some(s => s.checked);
}

function addCustomSetupExercise(cat, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const list = document.querySelector(`.setup-exercise-list[data-cat-list="${CSS.escape(cat)}"]`);
    if (!list) return;
    list.insertAdjacentHTML('beforeend', setupCheckboxRowHtml(cat, trimmed));
    syncSetupCategoryToggle(cat);
}

function initSetupChecklistDelegation() {
    const container = document.getElementById('setup-checklist-list');
    container.addEventListener('change', e => {
        if (e.target.classList.contains('setup-cat-toggle')) {
            const cat = e.target.dataset.cat;
            document.querySelectorAll(`#setup-checklist-list input[data-cat="${CSS.escape(cat)}"][data-name]`)
                .forEach(cb => { cb.checked = e.target.checked; });
        } else if (e.target.matches('input[data-name]')) {
            syncSetupCategoryToggle(e.target.dataset.cat);
        }
    });
    container.addEventListener('click', e => {
        const btn = e.target.closest('.setup-custom-add-btn');
        if (!btn) return;
        const input = container.querySelector(`.setup-custom-input[data-cat="${CSS.escape(btn.dataset.cat)}"]`);
        addCustomSetupExercise(btn.dataset.cat, input.value);
        input.value = '';
        input.focus();
    });
    container.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.classList.contains('setup-custom-input')) {
            e.preventDefault();
            addCustomSetupExercise(e.target.dataset.cat, e.target.value);
            e.target.value = '';
        }
    });
}

function confirmSetupWizard() {
    const checked = [...document.querySelectorAll('#setup-checklist-list input[data-name]:checked')];
    if (checked.length === 0) {
        alert("Select at least one exercise, or use \"Skip\" to set up manually.");
        return;
    }

    const categoriesToAdd = [...new Set(checked.map(cb => cb.dataset.cat))];
    const exercisesToAdd = checked.map(cb => ({
        id: `${slugify(cb.dataset.cat)}__${slugify(cb.dataset.name)}`,
        name: cb.dataset.name,
        category: cb.dataset.cat,
    }));

    saveCategories(categoriesToAdd);
    saveExercises(exercisesToAdd);

    renderCategoryManager();
    refreshCategoryDependents();
}

function initSetupWizard() {
    document.querySelectorAll('.setup-template-btn').forEach(btn => {
        btn.addEventListener('click', () => renderSetupChecklist(btn.dataset.template));
    });
    document.getElementById('setup-back-btn').addEventListener('click', resetSetupWizard);
    document.getElementById('setup-skip-btn').addEventListener('click', () => {
        setupSkipped = true;
        renderCategoryManager();
    });
    document.querySelectorAll('.setup-confirm-btn').forEach(btn => btn.addEventListener('click', confirmSetupWizard));
    initSetupChecklistDelegation();
}

// ============ BODY & NOTES TAB ============

function renderBodyweightList() {
    const container = document.getElementById('bodyweight-list');
    const entries = getBodyweight().slice().sort((a, b) => b.date.localeCompare(a.date));
    if (entries.length === 0) {
        container.innerHTML = '<p class="no-data">No bodyweight entries yet.</p>';
    } else {
        container.innerHTML = entries.map(e => `
            <div class="card card-row">
                <div>
                    <div class="card-title">${e.weight} lb</div>
                    <div class="card-sub">${formatDate(e.date)}${e.comment ? ' · ' + escapeHtml(e.comment) : ''}</div>
                </div>
                <button class="icon-btn danger-btn" data-id="${e.id}" title="Delete" aria-label="Delete">${ICON_X}</button>
            </div>
        `).join('');
        container.querySelectorAll('.danger-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!confirm('Delete this entry?')) return;
                saveBodyweight(getBodyweight().filter(e => e.id != btn.dataset.id));
                renderBodyweightList();
            });
        });
    }

    wireViewToggle('bw-history-toggle', container, document.getElementById('bodyweight-chart'), computeBodyweightTrendPoints());
}

function initBodyTab() {
    document.getElementById('bw-date').value = todayStr();
    document.getElementById('nutrition-date').value = todayStr();

    document.getElementById('log-weight-form').addEventListener('submit', e => {
        e.preventDefault();
        const date = document.getElementById('bw-date').value;
        const weightVal = document.getElementById('bw-weight').value;
        if (!date || !weightVal) { alert('Please choose a date and enter a weight.'); return; }

        const entries = getBodyweight();
        entries.push({ id: Date.now(), date, weight: parseFloat(weightVal), comment: null });
        saveBodyweight(entries);

        document.getElementById('bw-weight').value = '';
        renderBodyweightList();
    });

    document.getElementById('log-nutrition-form').addEventListener('submit', e => {
        e.preventDefault();
        const date = document.getElementById('nutrition-date').value;
        const caloriesVal = document.getElementById('nutrition-calories').value;
        const proteinVal = document.getElementById('nutrition-protein').value;
        const fatVal = document.getElementById('nutrition-fat').value;
        const carbsVal = document.getElementById('nutrition-carbs').value;
        if (!date || (!caloriesVal && !proteinVal && !fatVal && !carbsVal)) {
            alert('Please choose a date and enter at least one of calories, protein, fat, or carbs.');
            return;
        }

        const entries = getNutrition();
        entries.push({
            id: Date.now(),
            date,
            calories: caloriesVal ? parseFloat(caloriesVal) : null,
            protein: proteinVal ? parseFloat(proteinVal) : null,
            fat: fatVal ? parseFloat(fatVal) : null,
            carbs: carbsVal ? parseFloat(carbsVal) : null,
        });
        saveNutrition(entries);

        document.getElementById('nutrition-calories').value = '';
        document.getElementById('nutrition-protein').value = '';
        document.getElementById('nutrition-fat').value = '';
        document.getElementById('nutrition-carbs').value = '';
        renderNutritionList();
    });
}

function renderNutritionList() {
    const container = document.getElementById('nutrition-list');
    const entries = getNutrition().slice().sort((a, b) => b.date.localeCompare(a.date));
    if (entries.length === 0) {
        container.innerHTML = '<p class="no-data">No nutrition entries yet.</p>';
        return;
    }
    const fmt = (v, unit) => v != null ? v + unit : '–';
    container.innerHTML = `
        <div class="nutrition-table-wrap">
            <table class="nutrition-table">
                <thead>
                    <tr><th>Date</th><th>Cal</th><th>Protein</th><th>Fat</th><th>Carbs</th><th></th></tr>
                </thead>
                <tbody>
                    ${entries.map(e => `
                    <tr>
                        <td>${formatDate(e.date)}</td>
                        <td>${fmt(e.calories, '')}</td>
                        <td>${fmt(e.protein, 'g')}</td>
                        <td>${fmt(e.fat, 'g')}</td>
                        <td>${fmt(e.carbs, 'g')}</td>
                        <td><button type="button" class="icon-btn danger-btn" data-id="${e.id}" title="Delete" aria-label="Delete">${ICON_X}</button></td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    container.querySelectorAll('.danger-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm('Delete this entry?')) return;
            saveNutrition(getNutrition().filter(e => e.id != btn.dataset.id));
            renderNutritionList();
        });
    });
}

// ============ DAILY REVIEW TAB ============

// Shared with the question manager: derives a 1-4 (worst-best) level from
// where an answer sits in its question's ordered option list, so the grid's
// color-coding works for any custom question without per-question logic.
function levelForOptionIndex(index, total) {
    if (total <= 1) return 4;
    return Math.floor((index / (total - 1)) * 3) + 1;
}

function answerLevel(question, value) {
    const idx = question.options.indexOf(value);
    if (idx < 0) return 1;
    return levelForOptionIndex(idx, question.options.length);
}

// Reviews saved before the customizable-questions system used fixed fields
// instead of an `answers` map - adapt those on the fly rather than migrating.
function reviewEntryAnswers(r) {
    if (r.answers) return r.answers;
    return {
        calories: r.calories,
        protein: r.protein,
        activity: r.activity,
        workout: r.workedOut ? (r.quality || 'Good') : 'No',
    };
}

function renderReviewFormFields() {
    const questions = getReviewQuestions();
    const container = document.getElementById('review-questions-fields');
    container.innerHTML = questions.map(q => `
        <div class="form-row">
            <label>${escapeHtml(q.label)}</label>
            <div class="button-group review-q-group" data-qid="${q.id}">
                ${q.options.map(opt => `<button type="button" class="bg-option" data-val="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`).join('')}
            </div>
        </div>
    `).join('');
    container.querySelectorAll('.review-q-group').forEach(group => {
        group.querySelectorAll('.bg-option').forEach(btn => {
            btn.addEventListener('click', () => {
                group.querySelectorAll('.bg-option').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                group.dataset.value = btn.dataset.val;
            });
        });
    });
}

function resetReviewForm() {
    document.getElementById('review-date').value = todayStr();
    document.getElementById('review-note').value = '';
    renderReviewFormFields();
}

let reviewViewMode = 'list';
let showReviewComments = false;

function refreshReviewView() {
    document.getElementById('review-stats').textContent = computeReviewStatsText();
    if (reviewViewMode === 'grid') {
        document.getElementById('review-list').classList.add('hidden');
        document.getElementById('review-grid').classList.remove('hidden');
        renderReviewGrid();
    } else {
        document.getElementById('review-list').classList.remove('hidden');
        document.getElementById('review-grid').classList.add('hidden');
        renderReviewList();
    }
}

function computeReviewStatsText() {
    const questions = getReviewQuestions();
    const entries = getReviews().slice().sort((a, b) => b.date.localeCompare(a.date));
    if (entries.length === 0 || questions.length === 0) return '';

    const last7 = entries.slice(0, 7);
    const parts = questions.map(q => {
        const best = q.options[q.options.length - 1];
        const count = last7.filter(r => reviewEntryAnswers(r)[q.id] === best).length;
        return `${q.label} ${count}/${last7.length}`;
    });

    return `Last ${last7.length}: ` + parts.join(', ');
}

function renderReviewList() {
    const container = document.getElementById('review-list');
    const questions = getReviewQuestions();
    const entries = getReviews().slice().sort((a, b) => b.date.localeCompare(a.date));
    if (entries.length === 0) {
        container.innerHTML = '<p class="no-data">No daily reviews yet.</p>';
        return;
    }
    container.innerHTML = entries.map(r => {
        const answers = reviewEntryAnswers(r);
        const summary = questions.map(q => `${escapeHtml(q.label)}: ${escapeHtml(answers[q.id] ?? '-')}`).join(' · ');
        const note = showReviewComments && r.note ? `<div class="review-note">${escapeHtml(r.note)}</div>` : '';
        return `
        <div class="card card-row">
            <div>
                <div class="card-title">${formatDate(r.date)}</div>
                <div class="card-sub">${summary}</div>
                ${note}
            </div>
            <button class="icon-btn danger-btn" data-id="${r.id}" title="Delete" aria-label="Delete">${ICON_X}</button>
        </div>`;
    }).join('');
    container.querySelectorAll('.danger-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm('Delete this review?')) return;
            saveReviews(getReviews().filter(r => r.id != btn.dataset.id));
            refreshReviewView();
        });
    });
}

function renderReviewGrid() {
    const container = document.getElementById('review-grid');
    const questions = getReviewQuestions();
    const entries = getReviews().slice().sort((a, b) => b.date.localeCompare(a.date));
    if (entries.length === 0 || questions.length === 0) {
        container.innerHTML = '<p class="no-data">No daily reviews yet.</p>';
        return;
    }

    const glyphs = { 1: 'x', 2: '-', 3: 'o', 4: '✓' };
    const cell = level => `<span class="habit-cell level-${level}">${glyphs[level]}</span>`;

    const rows = entries.map(r => {
        const answers = reviewEntryAnswers(r);
        const cells = questions.map(q => `<td>${cell(answerLevel(q, answers[q.id]))}</td>`).join('');
        const noteCell = showReviewComments ? `<td class="review-note-cell">${r.note ? escapeHtml(r.note) : ''}</td>` : '';
        return `<tr><td>${formatDate(r.date)}</td>${cells}${noteCell}</tr>`;
    }).join('');

    const headerCells = questions.map(q => `<th>${escapeHtml(q.label)}</th>`).join('');

    container.innerHTML = `
        <table class="habit-grid">
            <thead>
                <tr><th>Date</th>${headerCells}${showReviewComments ? '<th>Note</th>' : ''}</tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
}

// ============ REVIEW QUESTIONS MANAGER ============

function renderQuestionsManager() {
    const container = document.getElementById('questions-manager-list');
    const questions = getReviewQuestions();

    if (questions.length === 0) {
        container.innerHTML = '<p class="no-data">No questions yet. Add one below.</p>';
        return;
    }

    container.innerHTML = questions.map(q => `
        <div class="category-block">
            <div class="category-header" data-qid="${q.id}">
                <span class="category-header-title">${escapeHtml(q.label)} (${q.options.length})</span>
                <span>
                    <button type="button" class="icon-btn rename-question-btn" data-qid="${q.id}" title="Rename" aria-label="Rename">${ICON_PENCIL}</button>
                    <button type="button" class="icon-btn danger-btn delete-question-btn" data-qid="${q.id}" title="Delete" aria-label="Delete">${ICON_X}</button>
                </span>
            </div>
            <div class="category-body open">
                ${q.options.map((opt, idx) => `
                    <div class="plan-exercise-row">
                        <span>${idx + 1}. ${escapeHtml(opt)}</span>
                        <span class="plan-exercise-row-actions">
                            <button type="button" class="small-btn move-option-btn" data-qid="${q.id}" data-idx="${idx}" data-dir="-1" ${idx === 0 ? 'disabled' : ''}>&uarr;</button>
                            <button type="button" class="small-btn move-option-btn" data-qid="${q.id}" data-idx="${idx}" data-dir="1" ${idx === q.options.length - 1 ? 'disabled' : ''}>&darr;</button>
                            <button type="button" class="icon-btn rename-option-btn" data-qid="${q.id}" data-idx="${idx}" title="Rename" aria-label="Rename">${ICON_PENCIL}</button>
                            <button type="button" class="icon-btn danger-btn delete-option-btn" data-qid="${q.id}" data-idx="${idx}" title="Delete" aria-label="Delete">${ICON_X}</button>
                        </span>
                    </div>
                `).join('')}
                <form class="inline-form add-option-form" data-qid="${q.id}" style="margin-top:10px;">
                    <input type="text" placeholder="New option (added as the best/highest)" required>
                    <button type="submit" class="small-btn">+ Add</button>
                </form>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.rename-question-btn').forEach(btn => {
        btn.addEventListener('click', () => renameQuestion(btn.dataset.qid));
    });
    container.querySelectorAll('.delete-question-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteQuestion(btn.dataset.qid));
    });
    container.querySelectorAll('.move-option-btn').forEach(btn => {
        btn.addEventListener('click', () => moveOption(btn.dataset.qid, parseInt(btn.dataset.idx, 10), parseInt(btn.dataset.dir, 10)));
    });
    container.querySelectorAll('.rename-option-btn').forEach(btn => {
        btn.addEventListener('click', () => renameOption(btn.dataset.qid, parseInt(btn.dataset.idx, 10)));
    });
    container.querySelectorAll('.delete-option-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteOption(btn.dataset.qid, parseInt(btn.dataset.idx, 10)));
    });
    container.querySelectorAll('.add-option-form').forEach(form => {
        form.addEventListener('submit', e => {
            e.preventDefault();
            const input = form.querySelector('input');
            addOption(form.dataset.qid, input.value.trim());
        });
    });
}

function findQuestion(qid) {
    return getReviewQuestions().find(q => q.id === qid);
}

function saveQuestionsAndRefresh() {
    saveReviewQuestions(getReviewQuestions());
    renderQuestionsManager();
    renderReviewFormFields();
    refreshReviewView();
}

function addQuestion() {
    const label = prompt('New question:');
    if (!label || !label.trim()) return;
    const trimmed = label.trim();
    const questions = getReviewQuestions();
    let id = slugify(trimmed) || `question-${Date.now()}`;
    if (questions.some(q => q.id === id)) id = `${id}-${Date.now()}`;
    questions.push({ id, label: trimmed, options: ['Option A', 'Option B'] });
    saveQuestionsAndRefresh();
}

function renameQuestion(qid) {
    const q = findQuestion(qid);
    if (!q) return;
    const label = prompt('Rename question:', q.label);
    if (!label || !label.trim()) return;
    q.label = label.trim();
    saveQuestionsAndRefresh();
}

function deleteQuestion(qid) {
    const q = findQuestion(qid);
    if (!q) return;
    if (!confirm(`Delete "${q.label}"? Past reviews keep their saved answer, but you won't be asked this going forward.`)) return;
    saveReviewQuestions(getReviewQuestions().filter(x => x.id !== qid));
    renderQuestionsManager();
    renderReviewFormFields();
    refreshReviewView();
}

function addOption(qid, name) {
    if (!name) return;
    const q = findQuestion(qid);
    if (!q) return;
    if (q.options.some(o => o.toLowerCase() === name.toLowerCase())) {
        alert('That option already exists for this question.');
        return;
    }
    q.options.push(name);
    saveQuestionsAndRefresh();
}

function renameOption(qid, idx) {
    const q = findQuestion(qid);
    if (!q) return;
    const name = prompt('Rename option:', q.options[idx]);
    if (!name || !name.trim()) return;
    q.options[idx] = name.trim();
    saveQuestionsAndRefresh();
}

function deleteOption(qid, idx) {
    const q = findQuestion(qid);
    if (!q) return;
    if (q.options.length <= 1) {
        alert('A question needs at least one option. Delete the whole question instead if you no longer need it.');
        return;
    }
    if (!confirm(`Delete "${q.options[idx]}"?`)) return;
    q.options.splice(idx, 1);
    saveQuestionsAndRefresh();
}

function moveOption(qid, idx, dir) {
    const q = findQuestion(qid);
    if (!q) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= q.options.length) return;
    [q.options[idx], q.options[newIdx]] = [q.options[newIdx], q.options[idx]];
    saveQuestionsAndRefresh();
}

function initQuestionsManager() {
    document.getElementById('add-question-btn').addEventListener('click', addQuestion);
    document.getElementById('review-settings-gear-btn').addEventListener('click', () => {
        document.getElementById('review-settings-panel').classList.toggle('hidden');
    });
}

function initReviewTab() {
    initQuestionsManager();
    resetReviewForm();

    document.getElementById('review-form').addEventListener('submit', e => {
        e.preventDefault();
        const date = document.getElementById('review-date').value;
        const note = document.getElementById('review-note').value.trim();

        const answers = {};
        let allAnswered = true;
        document.querySelectorAll('.review-q-group').forEach(group => {
            const val = group.dataset.value;
            if (!val) allAnswered = false;
            answers[group.dataset.qid] = val;
        });

        if (!date || !allAnswered) {
            alert('Please answer every question before saving.');
            return;
        }

        const reviews = getReviews();
        const existingIdx = reviews.findIndex(r => r.date === date);
        if (existingIdx >= 0 && !confirm('You already saved a review for this day. Overwrite it?')) return;

        const entry = {
            id: existingIdx >= 0 ? reviews[existingIdx].id : Date.now(),
            date,
            answers,
            note: note || null,
        };

        if (existingIdx >= 0) reviews[existingIdx] = entry;
        else reviews.push(entry);
        saveReviews(reviews);

        resetReviewForm();
        refreshReviewView();
    });

    document.querySelectorAll('#review-view-toggle .bg-option').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#review-view-toggle .bg-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            reviewViewMode = btn.dataset.view;
            refreshReviewView();
        });
    });

    document.getElementById('review-show-comments').addEventListener('change', e => {
        showReviewComments = e.target.checked;
        refreshReviewView();
    });
}

// ============ AUTH ============

function showAuthScreen() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
}

function showApp(user) {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
}

let authMode = 'signin';

function initAuthUI() {
    document.getElementById('auth-toggle-mode-btn').addEventListener('click', () => {
        authMode = authMode === 'signin' ? 'signup' : 'signin';
        document.getElementById('auth-submit-btn').textContent = authMode === 'signin' ? 'Sign In' : 'Sign Up';
        document.getElementById('auth-toggle-mode-btn').textContent =
            authMode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in';
        document.getElementById('auth-error').classList.add('hidden');
    });

    document.getElementById('auth-form').addEventListener('submit', async e => {
        e.preventDefault();
        const email = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        const errorEl = document.getElementById('auth-error');
        errorEl.classList.add('hidden');
        try {
            if (authMode === 'signin') {
                await auth.signInWithEmailAndPassword(email, password);
            } else {
                await auth.createUserWithEmailAndPassword(email, password);
            }
        } catch (err) {
            errorEl.textContent = err.message;
            errorEl.classList.remove('hidden');
        }
    });

    document.getElementById('google-signin-btn').addEventListener('click', async () => {
        const errorEl = document.getElementById('auth-error');
        errorEl.classList.add('hidden');
        try {
            await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
        } catch (err) {
            errorEl.textContent = err.message;
            errorEl.classList.remove('hidden');
        }
    });

    // Sign Out lives inside each gear panel (Log Directly, exercise list, Daily
    // Review settings) instead of its own dedicated header/gear - #sign-out-btn-3
    // is re-rendered dynamically and wires itself in renderExerciseListManagerPanel().
    document.querySelectorAll('.sign-out-link').forEach(btn => {
        btn.addEventListener('click', () => auth.signOut());
    });
}

// ============ REST TIMER ============

let restTimerDefault = 120;
let restTimerRemaining = restTimerDefault;
let restTimerInterval = null;

function formatRestTimer(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function updateRestTimerDisplay() {
    document.getElementById('rest-timer-display').textContent = formatRestTimer(restTimerRemaining);
    document.getElementById('rest-timer').classList.toggle('done', restTimerRemaining === 0 && !restTimerInterval);
}

const REST_TIMER_PLAY_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>';
const REST_TIMER_PAUSE_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';

function setRestTimerToggleIcon(running) {
    const btn = document.getElementById('rest-timer-toggle');
    btn.innerHTML = running ? REST_TIMER_PAUSE_ICON : REST_TIMER_PLAY_ICON;
    btn.title = running ? 'Pause' : 'Start';
}

function startRestTimer() {
    if (restTimerRemaining <= 0) restTimerRemaining = restTimerDefault;
    setRestTimerToggleIcon(true);
    restTimerInterval = setInterval(() => {
        restTimerRemaining--;
        updateRestTimerDisplay();
        if (restTimerRemaining <= 0) pauseRestTimer();
    }, 1000);
    updateRestTimerDisplay();
}

function pauseRestTimer() {
    clearInterval(restTimerInterval);
    restTimerInterval = null;
    setRestTimerToggleIcon(false);
    updateRestTimerDisplay();
}

function resetRestTimer() {
    clearInterval(restTimerInterval);
    restTimerInterval = null;
    restTimerRemaining = restTimerDefault;
    setRestTimerToggleIcon(false);
    updateRestTimerDisplay();
}

// ============ REST TIMER PICKER (scroll wheels, like a classic timer app) ============
// No typing involved (mobile numeric keypads often can't enter ":" or "."
// anyway) - just two scroll-snap wheels read by scroll position on "Done".

const REST_TIMER_WHEEL_ITEM_HEIGHT = 36;
const REST_TIMER_MAX_MINUTES = 30;

function buildRestTimerWheel(id, max) {
    const wheel = document.getElementById(id);
    let html = '';
    for (let i = 0; i <= max; i++) {
        html += `<div class="wheel-picker-item">${String(i).padStart(2, '0')}</div>`;
    }
    wheel.innerHTML = html;
}

function scrollRestTimerWheelTo(id, value) {
    document.getElementById(id).scrollTop = value * REST_TIMER_WHEEL_ITEM_HEIGHT;
}

function readRestTimerWheel(id) {
    const wheel = document.getElementById(id);
    return Math.round(wheel.scrollTop / REST_TIMER_WHEEL_ITEM_HEIGHT);
}

function openRestTimerPicker() {
    if (restTimerInterval) return;
    const mins = Math.floor(restTimerRemaining / 60);
    const secs = restTimerRemaining % 60;
    document.getElementById('rest-timer-picker-overlay').classList.remove('hidden');
    // Set scroll position after the overlay is visible, so its layout exists.
    requestAnimationFrame(() => {
        scrollRestTimerWheelTo('rest-timer-minutes-wheel', mins);
        scrollRestTimerWheelTo('rest-timer-seconds-wheel', secs);
    });
}

function closeRestTimerPicker() {
    document.getElementById('rest-timer-picker-overlay').classList.add('hidden');
}

function applyRestTimerPicker() {
    const mins = readRestTimerWheel('rest-timer-minutes-wheel');
    const secs = readRestTimerWheel('rest-timer-seconds-wheel');
    const total = mins * 60 + secs;
    if (total > 0) {
        restTimerDefault = total;
        restTimerRemaining = total;
    }
    updateRestTimerDisplay();
    closeRestTimerPicker();
}

function initRestTimer() {
    updateRestTimerDisplay();
    buildRestTimerWheel('rest-timer-minutes-wheel', REST_TIMER_MAX_MINUTES);
    buildRestTimerWheel('rest-timer-seconds-wheel', 59);

    document.getElementById('rest-timer-display').addEventListener('click', openRestTimerPicker);
    document.getElementById('rest-timer-picker-done').addEventListener('click', applyRestTimerPicker);
    document.getElementById('rest-timer-picker-cancel').addEventListener('click', closeRestTimerPicker);
    document.getElementById('rest-timer-picker-overlay').addEventListener('click', e => {
        if (e.target.id === 'rest-timer-picker-overlay') closeRestTimerPicker();
    });

    document.getElementById('rest-timer-toggle').addEventListener('click', () => {
        if (restTimerInterval) pauseRestTimer();
        else startRestTimer();
    });
    document.getElementById('rest-timer-reset').addEventListener('click', resetRestTimer);
}

// ============ INIT ============

function renderEverything() {
    renderLogCategoryStep();
    renderPlanFilterChips();
    renderPlanList();
    renderCategoryManager();
    renderBodyweightList();
    renderNutritionList();
    renderQuestionsManager();
    refreshReviewView();
}

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initRestTimer();
    initLogTab();
    initCardioForm();
    initSessionControls();
    initPlanTab();
    initExerciseManagerPanels();
    initBodyTab();
    initReviewTab();
    initAuthUI();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    auth.onAuthStateChanged(async user => {
        stopSync();
        if (user) {
            currentUser = user;
            showApp(user);
            await ensureSeeded();
            await initialLoadAndSync();
        } else {
            currentUser = null;
            showAuthScreen();
        }
    });
});
