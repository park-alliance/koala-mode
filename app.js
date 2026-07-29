// ============ STORAGE (Firestore-backed, synced per signed-in user) ============
// get*/save* keep the exact same synchronous shape the rest of the app already
// relies on: cloudData is an in-memory cache kept current by onSnapshot
// listeners, and save*() updates the cache immediately (optimistic) then
// writes through to Firestore in the background.

const OWNER_EMAIL = 'joseph.vanacore@gmail.com';
const DATA_KEYS = ['categories', 'exercises', 'logs', 'bodyweight', 'reviews', 'goals', 'plans', 'activeSession'];
const DATA_DEFAULTS = {
    categories: [],
    exercises: [],
    logs: [],
    bodyweight: [],
    reviews: [],
    goals: { calorieGoal: null, proteinGoal: null },
    plans: [],
    activeSession: null,
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
    batch.set(userDoc('reviews'), { value: [] });
    batch.set(userDoc('goals'), { value: { calorieGoal: null, proteinGoal: null } });
    batch.set(userDoc('plans'), { value: [] });
    batch.set(seededRef, { value: true });
    await batch.commit();
}

async function initialLoadAndSync() {
    const snaps = await Promise.all(DATA_KEYS.map(key => userDoc(key).get()));
    DATA_KEYS.forEach((key, i) => {
        cloudData[key] = snaps[i].exists ? snaps[i].data().value : DATA_DEFAULTS[key];
    });
    renderEverything();
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

function getReviews() { return cloudData.reviews; }
function saveReviews(v) { cloudData.reviews = v; syncWrite('reviews', v); }

function getGoals() { return cloudData.goals; }
function saveGoals(v) { cloudData.goals = v; syncWrite('goals', v); }

function getPlans() { return cloudData.plans; }
function savePlans(v) { cloudData.plans = v; syncWrite('plans', v); }

function getActiveSession() { return cloudData.activeSession; }
function saveActiveSession(v) { cloudData.activeSession = v; syncWrite('activeSession', v); }

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

    // Default to "all expanded" the first time a given picker is used, but
    // remember what the user collapses across re-renders (e.g. after adding
    // an exercise, which rebuilds this list to exclude the new pick).
    if (!pickerOpenCategories[containerId]) {
        pickerOpenCategories[containerId] = new Set(categories);
    }
    const openSet = pickerOpenCategories[containerId];

    let html = '';
    categories.forEach(cat => {
        const list = exercises.filter(e => e.category === cat && !excludeIds.includes(e.id));
        if (list.length === 0) return;
        const isOpen = openSet.has(cat);
        html += `<div class="category-header" data-cat="${escapeHtml(cat)}"><span class="category-header-title">${escapeHtml(cat)}</span></div>`;
        html += `<div class="category-body${isOpen ? ' open' : ''}">`;
        list.forEach(ex => {
            html += `<div class="exercise-row"><button type="button" class="picker-ex-btn" data-id="${ex.id}" style="border:none;background:none;cursor:pointer;text-align:left;padding:6px 0;font-size:14px;">+ ${escapeHtml(ex.name)}</button></div>`;
        });
        html += `</div>`;
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

function renderLogCategoryStep() {
    const container = document.getElementById('log-category-list');
    const categories = getCategories();
    container.innerHTML = categories.map(cat =>
        `<button class="grid-btn" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
    ).join('') || '<p class="no-data">No categories yet. Add one in the Exercises tab.</p>';

    container.querySelectorAll('.grid-btn').forEach(btn => {
        btn.addEventListener('click', () => selectLogCategory(btn.dataset.cat));
    });
}

function selectLogCategory(category) {
    logCurrentCategory = category;
    document.getElementById('log-step-category').classList.add('hidden');
    document.getElementById('log-step-exercise').classList.remove('hidden');
    document.getElementById('log-step-detail').classList.add('hidden');
    document.getElementById('log-exercise-category-title').textContent = category;

    const container = document.getElementById('log-exercise-list');
    const exercises = getExercises().filter(e => e.category === category);
    container.innerHTML = exercises.map(ex =>
        `<button class="grid-btn" data-id="${ex.id}">${escapeHtml(ex.name)}</button>`
    ).join('') || '<p class="no-data">No exercises in this category yet. Add one in the Exercises tab.</p>';

    container.querySelectorAll('.grid-btn').forEach(btn => {
        btn.addEventListener('click', () => selectLogExercise(btn.dataset.id));
    });
}

function populateDetailView(exerciseId) {
    logCurrentExerciseId = exerciseId;
    const exercise = getExercises().find(e => e.id === exerciseId);
    document.getElementById('log-detail-exercise-name').textContent = exercise ? exercise.name : '(exercise removed)';

    const isCardio = exercise && exercise.category === 'Cardio';
    document.getElementById('log-set-form').classList.toggle('hidden', isCardio);
    document.getElementById('log-cardio-form').classList.toggle('hidden', !isCardio);

    if (isCardio) {
        resetCardioForm();
        renderCardioHistory(exerciseId);
    } else {
        document.getElementById('log-date').value = todayStr();
        document.getElementById('log-weight').value = '';
        document.getElementById('log-reps').value = '';
        collapseLogComment();
        updateLogSetNumberUI(nextSetNumberForToday(exerciseId, todayStr()));
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

function renderLogHistory(exerciseId) {
    const container = document.getElementById('log-history-list');
    const logs = getLogs()
        .filter(l => l.exerciseId === exerciseId)
        .sort((a, b) => (b.date).localeCompare(a.date) || (b.set || 0) - (a.set || 0));

    if (logs.length === 0) {
        container.innerHTML = '<p class="no-data">No history yet — log your first set above.</p>';
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
                <button class="small-btn danger-btn" data-id="${l.id}">Delete</button>
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
    const inRange = n >= 1 && n <= 6;
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
        document.getElementById('log-weight').value = '';
        document.getElementById('log-reps').value = '';
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
        container.innerHTML = '<p class="no-data">No history yet — log your first session above.</p>';
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
            const main = parts.join(' — ') || '(no details)';
            const comment = l.comment ? ` <span class="card-sub">${escapeHtml(l.comment)}</span>` : '';
            html += `<div class="history-set">
                <span>${escapeHtml(main)}${comment}</span>
                <button class="small-btn danger-btn" data-id="${l.id}">Delete</button>
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
    const container = document.getElementById('log-plan-picker-list');
    const plans = getPlans();
    if (plans.length === 0) {
        container.innerHTML = '<p class="no-data">No saved plans yet. Create one in the Plan Workout tab.</p>';
        return;
    }
    container.innerHTML = plans.map(p =>
        `<button type="button" class="grid-btn" data-id="${p.id}" style="display:block;width:100%;text-align:left;margin-bottom:8px;">${escapeHtml(p.name)} <span class="card-sub">(${p.exerciseIds.length} exercises)</span></button>`
    ).join('');
    container.querySelectorAll('.grid-btn').forEach(btn => {
        btn.addEventListener('click', () => startSessionFromPlan(btn.dataset.id));
    });
}

function startSessionFromPlan(planId) {
    const plan = getPlans().find(p => p.id === planId);
    if (!plan || plan.exerciseIds.length === 0) {
        alert('This plan has no exercises in it.');
        return;
    }
    activeSession = { planId: plan.id, planName: plan.name, exerciseIds: [...plan.exerciseIds], completed: plan.exerciseIds.map(() => false), currentIndex: 0 };
    saveActiveSession(activeSession);
    enterSessionMode();
}

function enterSessionMode() {
    document.getElementById('log-start-row').classList.add('hidden');
    document.getElementById('log-plan-picker').classList.add('hidden');
    document.getElementById('log-step-category').classList.add('hidden');
    document.getElementById('log-step-exercise').classList.add('hidden');
    document.getElementById('log-back-to-exercise').classList.add('hidden');
    document.getElementById('session-picker-panel').classList.add('hidden');

    document.getElementById('log-session-view').classList.remove('hidden');
    document.getElementById('log-step-detail').classList.remove('hidden');

    renderSessionStrip();
    populateDetailView(activeSession.exerciseIds[activeSession.currentIndex]);
}

function exitSessionMode() {
    activeSession = null;
    saveActiveSession(null);
    document.getElementById('log-session-view').classList.add('hidden');
    document.getElementById('log-step-detail').classList.add('hidden');
    document.getElementById('log-plan-picker').classList.add('hidden');
    document.getElementById('log-start-row').classList.remove('hidden');
    document.getElementById('log-step-category').classList.remove('hidden');
}

function renderSessionStrip() {
    const container = document.getElementById('log-session-strip');
    const exercises = getExercises();
    container.innerHTML = activeSession.exerciseIds.map((id, idx) => {
        const ex = exercises.find(e => e.id === id);
        const name = ex ? ex.name : '(removed)';
        const isCurrent = idx === activeSession.currentIndex;
        const isDone = !!activeSession.completed[idx];
        const rowCls = `session-pill-row${isCurrent ? ' current' : ''}${isDone ? ' completed' : ''}`;
        return `
        <div class="${rowCls}">
            <input type="checkbox" class="session-complete-cb" data-idx="${idx}" ${isDone ? 'checked' : ''}>
            <button type="button" class="session-pill-name" data-idx="${idx}">${idx + 1}. ${escapeHtml(name)}</button>
        </div>`;
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

    document.getElementById('log-session-title').textContent = activeSession.planName;
    document.getElementById('session-position').textContent = `${activeSession.currentIndex + 1} of ${activeSession.exerciseIds.length}`;
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

    document.getElementById('session-swap-btn').addEventListener('click', () => openSessionPicker('swap'));
    document.getElementById('session-add-btn').addEventListener('click', () => openSessionPicker('add'));
    document.getElementById('session-remove-btn').addEventListener('click', removeCurrentFromSession);
    document.getElementById('session-picker-back').addEventListener('click', () => {
        document.getElementById('session-picker-panel').classList.add('hidden');
    });
}

function resumeSessionIfAny() {
    const saved = getActiveSession();
    if (!saved) return;
    if (!Array.isArray(saved.completed)) saved.completed = saved.exerciseIds.map(() => false);
    activeSession = saved;
    enterSessionMode();
}

// ============ PLAN WORKOUT TAB ============

let planEditorId = null;
let planEditorExerciseIds = [];

function renderPlanList() {
    const container = document.getElementById('plan-list');
    const plans = getPlans();
    const exercises = getExercises();
    if (plans.length === 0) {
        container.innerHTML = '<p class="no-data">No saved plans yet.</p>';
        return;
    }
    container.innerHTML = plans.map(p => {
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
                <button type="button" class="small-btn danger-btn" data-delete="${p.id}">Delete</button>
            </span>
        </div>`;
    }).join('');

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

    document.getElementById('plan-list-view').classList.add('hidden');
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
    document.getElementById('plan-list-view').classList.remove('hidden');
    renderPlanList();
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

// ============ EXERCISES TAB ============

const openCategoryBlocks = new Set();

function renderCategoryManager() {
    const categories = getCategories();

    const showWizard = categories.length === 0 && !setupSkipped;
    document.getElementById('setup-wizard').classList.toggle('hidden', !showWizard);
    document.getElementById('exercise-manager-normal').classList.toggle('hidden', showWizard);
    if (showWizard) {
        resetSetupWizard();
        return;
    }

    const container = document.getElementById('category-manager-list');
    const exercises = getExercises();

    if (categories.length === 0) {
        container.innerHTML = '<p class="no-data">No categories yet. Add one above.</p>';
        return;
    }

    container.innerHTML = categories.map(cat => {
        const exList = exercises.filter(e => e.category === cat);
        const open = openCategoryBlocks.has(cat);
        return `
        <div class="category-block">
            <div class="category-header" data-cat="${escapeHtml(cat)}">
                <span class="category-header-title">${escapeHtml(cat)} (${exList.length})</span>
                <span>
                    <button class="small-btn rename-cat-btn" data-cat="${escapeHtml(cat)}">Rename</button>
                    <button class="small-btn danger-btn delete-cat-btn" data-cat="${escapeHtml(cat)}">Delete</button>
                </span>
            </div>
            <div class="category-body ${open ? 'open' : ''}" data-cat-body="${escapeHtml(cat)}">
                ${exList.map(ex => `
                    <div class="exercise-row">
                        <span>${escapeHtml(ex.name)}</span>
                        <span class="exercise-row-actions">
                            <select class="move-ex-select" data-id="${ex.id}">
                                <option value="">Move to...</option>
                                ${categories.filter(c => c !== cat).map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
                            </select>
                            <button class="small-btn rename-ex-btn" data-id="${ex.id}">Rename</button>
                            <button class="small-btn danger-btn delete-ex-btn" data-id="${ex.id}">Delete</button>
                        </span>
                    </div>
                `).join('') || '<p class="no-data">No exercises yet.</p>'}
                <form class="inline-form add-exercise-form" data-cat="${escapeHtml(cat)}" style="margin-top:10px;">
                    <input type="text" placeholder="New exercise name" required>
                    <button type="submit" class="small-btn">+ Add</button>
                </form>
            </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.category-header').forEach(header => {
        header.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            const cat = header.dataset.cat;
            if (openCategoryBlocks.has(cat)) openCategoryBlocks.delete(cat);
            else openCategoryBlocks.add(cat);
            renderCategoryManager();
        });
    });

    container.querySelectorAll('.rename-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => renameCategory(btn.dataset.cat));
    });
    container.querySelectorAll('.delete-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteCategory(btn.dataset.cat));
    });
    container.querySelectorAll('.delete-ex-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteExercise(btn.dataset.id));
    });
    container.querySelectorAll('.rename-ex-btn').forEach(btn => {
        btn.addEventListener('click', () => renameExercise(btn.dataset.id));
    });
    container.querySelectorAll('.move-ex-select').forEach(select => {
        select.addEventListener('change', () => {
            if (select.value) moveExercise(select.dataset.id, select.value);
        });
    });
    container.querySelectorAll('.add-exercise-form').forEach(form => {
        form.addEventListener('submit', e => {
            e.preventDefault();
            const input = form.querySelector('input');
            addExercise(form.dataset.cat, input.value.trim());
        });
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
    openCategoryBlocks.add(category);
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

    // Only the display name changes — id stays the same, so all logged history stays linked.
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

    // Only the category field changes — logs reference the exercise id, not its category, so history is untouched.
    exercise.category = newCategory;
    saveExercises(exercises);
    openCategoryBlocks.add(newCategory);
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

    if (openCategoryBlocks.has(oldName)) {
        openCategoryBlocks.delete(oldName);
        openCategoryBlocks.add(trimmed);
    }

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
}

function initExercisesTab() {
    document.getElementById('add-category-form').addEventListener('submit', e => {
        e.preventDefault();
        const input = document.getElementById('new-category-name');
        const name = input.value.trim();
        if (!name) return;
        const categories = getCategories();
        if (categories.some(c => c.toLowerCase() === name.toLowerCase())) {
            alert('That category already exists.');
            return;
        }
        categories.push(name);
        saveCategories(categories);
        input.value = '';
        renderCategoryManager();
        refreshCategoryDependents();
    });

    initSetupWizard();
}

// ============ FIRST-RUN SETUP WIZARD ============
// Shown only while a user has zero categories. Reference data below is
// static and shared by everyone - it costs nothing per-user, since it's
// never written to Firestore.

const SETUP_TEMPLATES = {
    ppl: {
        categories: {
            'Push': ['Bench Press', 'Overhead Press', 'Incline Dumbbell Press', 'Chest Fly', 'Tricep Pushdown', 'Lateral Raise'],
            'Pull': ['Pull-ups', 'Barbell Row', 'Lat Pulldown', 'Deadlift', 'Bicep Curl', 'Face Pulls'],
            'Legs': ['Squat', 'Leg Press', 'Lunges', 'Leg Curl', 'Calf Raise', 'Hip Thrust'],
            'Core': ['Plank', 'Crunches', 'Leg Raises', 'Russian Twists'],
            'Cardio': ['Treadmill', 'Stationary Bike', 'Rowing Machine'],
        },
    },
    muscle: {
        categories: {
            'Legs': ['Squat', 'Leg Press', 'Leg Extension', 'Leg Curl', 'Lunges', 'Calf Raise', 'Hip Thrust'],
            'Arms': ['Bicep Curl', 'Hammer Curl', 'Tricep Pushdown', 'Overhead Tricep Extension', 'Preacher Curl'],
            'Chest': ['Bench Press', 'Incline Bench Press', 'Dumbbell Press', 'Chest Fly', 'Push-ups', 'Cable Crossover'],
            'Back': ['Pull-ups', 'Lat Pulldown', 'Barbell Row', 'Seated Cable Row', 'Deadlift'],
            'Shoulders': ['Overhead Press', 'Lateral Raise', 'Front Raise', 'Face Pulls', 'Shrugs'],
            'Core': ['Plank', 'Crunches', 'Leg Raises', 'Russian Twists', 'Cable Crunch'],
            'Cardio': ['Treadmill', 'Stationary Bike', 'Rowing Machine', 'Elliptical', 'Stair Climber'],
        },
    },
};

let setupSkipped = false;

function resetSetupWizard() {
    document.getElementById('setup-template-choice').classList.remove('hidden');
    document.getElementById('setup-checklist-view').classList.add('hidden');
}

function renderSetupChecklist(templateKey) {
    document.getElementById('setup-template-choice').classList.add('hidden');
    document.getElementById('setup-checklist-view').classList.remove('hidden');

    const template = SETUP_TEMPLATES[templateKey];
    document.getElementById('setup-checklist-list').innerHTML = Object.entries(template.categories).map(([cat, list]) => `
        <div class="setup-category-group">
            <h3>${escapeHtml(cat)}</h3>
            ${list.map(name => `
                <label class="setup-checkbox-row">
                    <input type="checkbox" checked data-cat="${escapeHtml(cat)}" data-name="${escapeHtml(name)}">
                    ${escapeHtml(name)}
                </label>
            `).join('')}
        </div>
    `).join('');
}

function confirmSetupWizard() {
    const checked = [...document.querySelectorAll('#setup-checklist-list input:checked')];
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
    document.getElementById('setup-confirm-btn').addEventListener('click', confirmSetupWizard);
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
                    <div class="card-sub">${formatDate(e.date)}${e.comment ? ' — ' + escapeHtml(e.comment) : ''}</div>
                </div>
                <button class="small-btn danger-btn" data-id="${e.id}">Delete</button>
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

    document.getElementById('bodyweight-form').addEventListener('submit', e => {
        e.preventDefault();
        const date = document.getElementById('bw-date').value;
        const weight = parseFloat(document.getElementById('bw-weight').value);
        if (!date || isNaN(weight)) { alert('Please enter a date and weight.'); return; }

        const entries = getBodyweight();
        entries.push({ id: Date.now(), date, weight, comment: null });
        saveBodyweight(entries);

        document.getElementById('bw-weight').value = '';
        renderBodyweightList();
    });
}

// ============ DAILY REVIEW TAB ============

function initButtonGroup(id) {
    const el = document.getElementById(id);
    const options = JSON.parse(el.dataset.options);
    el.innerHTML = options.map(o => `<button type="button" class="bg-option" data-val="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join('');
    el.querySelectorAll('.bg-option').forEach(btn => {
        btn.addEventListener('click', () => {
            el.querySelectorAll('.bg-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            el.dataset.value = btn.dataset.val;
            if (id === 'review-workedout') {
                document.getElementById('review-quality-row').classList.toggle('hidden', btn.dataset.val !== 'Yes');
            }
        });
    });
}

function getButtonGroupValue(id) {
    return document.getElementById(id).dataset.value || null;
}

function setButtonGroupValue(id, val) {
    const el = document.getElementById(id);
    el.dataset.value = val || '';
    el.querySelectorAll('.bg-option').forEach(b => b.classList.toggle('selected', b.dataset.val === val));
}

function resetReviewForm() {
    document.getElementById('review-date').value = todayStr();
    document.getElementById('review-note').value = '';
    ['review-calories', 'review-protein', 'review-activity', 'review-workedout', 'review-quality'].forEach(id => setButtonGroupValue(id, null));
    document.getElementById('review-quality-row').classList.add('hidden');
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
    const entries = getReviews().slice().sort((a, b) => b.date.localeCompare(a.date));
    if (entries.length === 0) return '';

    const last7 = entries.slice(0, 7);
    const proteinMet = last7.filter(r => r.protein === 'Met Goal').length;
    const caloriesOnTarget = last7.filter(r => r.calories === 'At Goal').length;
    const activeDays = last7.filter(r => r.activity !== 'Not Active').length;

    return `Last ${last7.length}: protein ${proteinMet}/${last7.length}, calories ${caloriesOnTarget}/${last7.length}, active ${activeDays}/${last7.length}`;
}

function renderReviewList() {
    const container = document.getElementById('review-list');
    const entries = getReviews().slice().sort((a, b) => b.date.localeCompare(a.date));
    if (entries.length === 0) {
        container.innerHTML = '<p class="no-data">No daily reviews yet.</p>';
        return;
    }
    container.innerHTML = entries.map(r => {
        const workout = r.workedOut ? `Yes (${r.quality})` : 'No';
        const calGoal = r.calorieGoal ? ` (goal: ${r.calorieGoal})` : '';
        const proGoal = r.proteinGoal ? ` (goal: ${r.proteinGoal}g)` : '';
        const note = showReviewComments && r.note ? `<div class="review-note">${escapeHtml(r.note)}</div>` : '';
        return `
        <div class="card card-row">
            <div>
                <div class="card-title">${formatDate(r.date)}</div>
                <div class="card-sub">Calories: ${escapeHtml(r.calories)}${calGoal} · Protein: ${escapeHtml(r.protein)}${proGoal} · Activity: ${escapeHtml(r.activity)} · Workout: ${escapeHtml(workout)}</div>
                ${note}
            </div>
            <button class="small-btn danger-btn" data-id="${r.id}">Delete</button>
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

function workoutLevel(r) {
    if (!r.workedOut) return 1;
    if (r.quality === 'Bad') return 2;
    if (r.quality === 'Average') return 3;
    return 4; // Good
}

function proteinLevel(r) {
    return r.protein === 'Met Goal' ? 4 : 1;
}

function caloriesLevel(r) {
    if (r.calories === 'At Goal') return 4;
    if (r.calories === 'Below') return 2;
    return 1; // Above
}

function activityLevel(r) {
    return { 'Not Active': 1, 'Light': 2, 'Moderate': 3, 'High': 4 }[r.activity] || 1;
}

function renderReviewGrid() {
    const container = document.getElementById('review-grid');
    const entries = getReviews().slice().sort((a, b) => b.date.localeCompare(a.date));
    if (entries.length === 0) {
        container.innerHTML = '<p class="no-data">No daily reviews yet.</p>';
        return;
    }

    const glyphs = { 1: 'x', 2: '-', 3: 'o', 4: '✓' };
    const cell = level => `<span class="habit-cell level-${level}">${glyphs[level]}</span>`;

    const rows = entries.map(r => `
        <tr>
            <td>${formatDate(r.date)}</td>
            <td>${cell(workoutLevel(r))}</td>
            <td>${cell(proteinLevel(r))}</td>
            <td>${cell(caloriesLevel(r))}</td>
            <td>${cell(activityLevel(r))}</td>
            ${showReviewComments ? `<td class="review-note-cell">${r.note ? escapeHtml(r.note) : ''}</td>` : ''}
        </tr>
    `).join('');

    container.innerHTML = `
        <table class="habit-grid">
            <thead>
                <tr><th>Date</th><th>Workout</th><th>Protein</th><th>Calories</th><th>Active</th>${showReviewComments ? '<th>Note</th>' : ''}</tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
}

function renderGoalsDisplay() {
    const goals = getGoals();
    const display = document.getElementById('goals-current-display');
    if (!goals.calorieGoal && !goals.proteinGoal) {
        display.textContent = 'No goals set yet — new reviews will be saved without a goal reference.';
        return;
    }
    display.textContent = `Current goals: ${goals.calorieGoal || '—'} calories, ${goals.proteinGoal || '—'}g protein.`;
}

function renderGoalsForm() {
    const goals = getGoals();
    document.getElementById('goal-calories').value = goals.calorieGoal || '';
    document.getElementById('goal-protein').value = goals.proteinGoal || '';
    renderGoalsDisplay();
}

function initGoalsForm() {
    document.getElementById('goals-gear-btn').addEventListener('click', () => {
        document.getElementById('goals-panel').classList.toggle('hidden');
    });

    document.getElementById('goals-form').addEventListener('submit', e => {
        e.preventDefault();
        const calorieGoal = parseFloat(document.getElementById('goal-calories').value) || null;
        const proteinGoal = parseFloat(document.getElementById('goal-protein').value) || null;
        saveGoals({ calorieGoal, proteinGoal });
        renderGoalsForm();
        document.getElementById('goals-panel').classList.add('hidden');
    });
}

function initReviewTab() {
    initGoalsForm();
    ['review-calories', 'review-protein', 'review-activity', 'review-workedout', 'review-quality'].forEach(initButtonGroup);
    resetReviewForm();

    document.getElementById('review-form').addEventListener('submit', e => {
        e.preventDefault();
        const date = document.getElementById('review-date').value;
        const calories = getButtonGroupValue('review-calories');
        const protein = getButtonGroupValue('review-protein');
        const activity = getButtonGroupValue('review-activity');
        const workedOutVal = getButtonGroupValue('review-workedout');
        const quality = getButtonGroupValue('review-quality');
        const note = document.getElementById('review-note').value.trim();

        if (!date || !calories || !protein || !activity || !workedOutVal) {
            alert('Please answer every question before saving.');
            return;
        }
        if (workedOutVal === 'Yes' && !quality) {
            alert('Please rate the workout quality.');
            return;
        }

        const reviews = getReviews();
        const existingIdx = reviews.findIndex(r => r.date === date);
        if (existingIdx >= 0 && !confirm('You already saved a review for this day. Overwrite it?')) return;

        const goals = getGoals();
        const entry = {
            id: existingIdx >= 0 ? reviews[existingIdx].id : Date.now(),
            date,
            calories,
            protein,
            activity,
            workedOut: workedOutVal === 'Yes',
            quality: workedOutVal === 'Yes' ? quality : null,
            calorieGoal: goals.calorieGoal,
            proteinGoal: goals.proteinGoal,
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
    document.getElementById('user-email').textContent = user.email;
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

    document.getElementById('sign-out-btn').addEventListener('click', () => auth.signOut());
}

// ============ INIT ============

function renderEverything() {
    renderLogCategoryStep();
    renderPlanList();
    renderCategoryManager();
    renderBodyweightList();
    renderGoalsForm();
    refreshReviewView();
}

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initLogTab();
    initCardioForm();
    initSessionControls();
    initPlanTab();
    initExercisesTab();
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
