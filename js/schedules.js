/* All timetables: every clash-free timetable for a semester of the 4-year plan, side by side.
   Uses js/times.js for the class times and the search (see docs/schedule-model.md). */
(() => {
  'use strict';

  const S = window.SUShared;
  const T = window.SUTimes;
  const { esc } = S;
  const SEMESTERS = 8;
  const PINS_KEY = 'su-planner:times-pins'; // shared with the Semester times page
  const PAGE = 24; // timetables drawn at a time
  const PALETTE = [
    '#2f6fb5', '#8e5a9b', '#c2571a', '#2b8a6e', '#a23b5a', '#5a6acf', '#7a6a2e',
    '#1f7a8c', '#b8456b', '#5b8c3a', '#6d4fb3', '#9c5b2e', '#33658a', '#8b3f8f',
  ];
  const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const $ = (sel) => document.querySelector(sel);
  const pad = (n) => String(n).padStart(2, '0');
  const num = (n) => n.toLocaleString('en');
  const phone = () => window.matchMedia('(max-width: 760px)').matches;

  const FREE_KEY = 'su-planner:free-hours'; // hours to keep free, the same for every semester
  const TYPE = { '': 'lecture', R: 'recitation', L: 'lab', D: 'discussion' };

  // blocked: hour slots (day * T.ROWS + row) no class may use.
  const state = { program: '', entry: '', plan: [], sel: 0, blocked: new Set(), shown: PAGE };

  // ---------- Saved data ----------
  function loadPlan() {
    try {
      const saved = JSON.parse(localStorage.getItem(S.KEYS.plan) || 'null');
      const seen = new Set();
      state.plan = Array.from({ length: SEMESTERS }, (_, i) => (saved?.semesters?.[i] || [])
        .filter((c) => typeof c === 'string').map(S.canonicalCode)
        .filter((c) => !seen.has(c) && seen.add(c)));
    } catch {
      state.plan = Array.from({ length: SEMESTERS }, () => []);
    }
  }
  function readPins() {
    try { return JSON.parse(localStorage.getItem(PINS_KEY) || '{}') || {}; } catch { return {}; }
  }
  function loadFree() {
    try {
      const saved = JSON.parse(localStorage.getItem(FREE_KEY) || '[]');
      const max = DAY_NAMES.length * T.ROWS;
      state.blocked = new Set(Array.isArray(saved) ? saved.filter((x) => Number.isInteger(x) && x >= 0 && x < max) : []);
    } catch {
      state.blocked = new Set();
    }
  }
  function saveFree() {
    try { localStorage.setItem(FREE_KEY, JSON.stringify(blocked())); } catch { /* not saved */ }
  }

  // ---------- Semesters ----------
  function semesterTerm(i) {
    const start = state.entry || T.fall?.term || '202601';
    return `${Number(start.slice(0, 4)) + Math.floor(i / 2)}${i % 2 ? '02' : '01'}`;
  }
  const semesterTitle = (i) => `Year ${Math.floor(i / 2) + 1} · ${i % 2 ? 'Spring' : 'Fall'}`;
  const realCodes = (i) => state.plan[i].filter((c) => !c.startsWith('~'));
  const hasTimes = (r) => r.timed.some((c) => c.groups.some((g) => g.sections.some((s) => s.slots.length)));

  // Hours to keep free: constraint (5) of the model, the slots no taken section may use.
  const blocked = () => [...state.blocked].sort((a, b) => a - b);
  const filtering = () => state.blocked.size > 0;
  const slotOf = (day, row) => day * T.ROWS + row;
  const hourText = (row) => `${pad(8 + row)}:40`;
  const check = (i, filtered) => T.checkSemester(state.plan[i], semesterTerm(i), new Map(), { blocked: filtered ? blocked() : [] });
  const countText = (alts) => `${num(alts.list.length)}${alts.complete ? '' : '+'}`;
  // "16 of 80"; just "2,000+" when the search stopped at its limit (an "of" would be meaningless).
  const ofText = (some, all) => (some.complete ? `${countText(some)} of ${countText(all)}` : countText(some));

  function renderSemList() {
    $('#sem-list').innerHTML = state.plan.map((sem, i) => {
      let badge = '<span class="sb empty">empty</span>';
      if (realCodes(i).length) {
        const r = check(i, false);
        if (r.pairs.length) badge = '<span class="sb bad">clash</span>';
        else if (!hasTimes(r)) badge = '<span class="sb empty">no times</span>';
        else if (filtering()) badge = `<span class="sb count">${ofText(check(i, true).alts, r.alts)}</span>`;
        else badge = `<span class="sb count">${countText(r.alts)}</span>`;
      }
      return `<button type="button" class="sem-tab${i === state.sel ? ' on' : ''}" role="tab" aria-selected="${i === state.sel}" data-sem="${i}">
          <span><b>${semesterTitle(i)}</b><small>${esc(S.termName(semesterTerm(i)))}</small></span>${badge}</button>`;
    }).join('');
  }

  // ---------- The selected semester ----------
  function render() {
    renderSemList();
    const i = state.sel;
    const term = semesterTerm(i);
    const all = check(i, false);
    const r = filtering() ? check(i, true) : all;
    const n = r.alts.list.length;
    const timesOk = hasTimes(all) && !all.pairs.length;

    // Header: the semester, how many timetables, and a semester picker for phones.
    const picker = `<label class="sem-pick"><span>Semester</span><select id="sem-select">${state.plan.map((_, k) =>
      `<option value="${k}"${k === state.sel ? ' selected' : ''}>${semesterTitle(k)}</option>`).join('')}</select></label>`;
    let lead = '';
    if (timesOk) {
      lead = filtering()
        ? `<p class="all-count"><b>${ofText(r.alts, all.alts).replace(/^([\d,+]+)/, '$1</b>')} timetables keep your chosen hours free</p>`
        : `<p class="all-count"><b>${countText(all.alts)}</b> different timetable${all.alts.list.length === 1 ? '' : 's'}, none with a clash</p>`;
      lead += `<p class="tt-src">Every way to take this semester's courses with no two classes at the same time. Class times from <b>${esc(all.src.termName)}</b>${all.src.assumed ? ' (Fall times stand in for Spring)' : ''}.</p>`;
    }
    $('#all-head').innerHTML = `${picker}<h2>${semesterTitle(i)} <small>${esc(S.termName(term))}</small></h2>${lead}`;

    // Hours to keep free: worth showing when there is a choice, or when some are already set.
    $('#all-filters').hidden = !timesOk || (all.alts.list.length < 2 && !filtering());
    syncPicker();

    // Notes
    const notes = [];
    if (!state.plan[i].length) {
      notes.push('<p class="note">This semester is empty in your <a href="plan.html">4-year plan</a>.</p>');
    } else if (all.pairs.length) {
      const list = all.pairs.map((p) => (p.a === p.b
        ? `<b>${esc(p.a)}</b>'s own lecture and recitation/lab (${esc(p.when.join(', '))})`
        : `<b>${esc(p.a)}</b> and <b>${esc(p.b)}</b> (${esc(p.when.join(', '))})`)).join('; ');
      notes.push(`<p class="note bad">⚠ No timetable works: ${list} clash whichever sections you take. Move one of them to another semester in your <a href="plan.html">4-year plan</a>.</p>`);
    } else if (!hasTimes(all)) {
      notes.push('<p class="note">None of this semester\'s courses has fixed class times yet.</p>');
    } else if (!n) {
      // Name the parts that can't avoid the blocked hours on their own, if any.
      const free = new Set(blocked());
      const stuck = all.timed.flatMap((c) => c.groups
        .filter((g) => g.sections.some((s) => s.slots.length) && g.sections.every((s) => s.slots.some((x) => free.has(x))))
        .map((g) => `${esc(c.code)} ${TYPE[g.type] || 'section'}`));
      const names = stuck.map((s) => `<b>${s}</b>`);
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
      notes.push(stuck.length
        ? `<p class="note warn">No timetable keeps all these hours free. Every section of ${list} meets in an hour you chose.</p>`
        : '<p class="note warn">No timetable keeps all these hours free. Free some of them.</p>');
    } else if (!r.alts.complete) {
      notes.push(`<p class="note">There are more than ${num(n)}. Only the first ${num(n)} are listed; choosing hours to keep free narrows them down.</p>`);
    }
    const left = [
      ...all.missing.map((c) => `${esc(c)} (not on this season's schedule)`),
      ...all.arranged.map((c) => `${esc(c)} (times set after you register)`),
      ...all.summer.map((c) => `${esc(c)} (summer)`),
    ];
    const slots = state.plan[i].length - realCodes(i).length;
    if (slots) left.push(`${slots} elective placeholder${slots === 1 ? '' : 's'}`);
    if (left.length && state.plan[i].length) notes.push(`<p class="note">Not in these timetables: ${left.join(', ')}.</p>`);
    $('#all-notes').innerHTML = notes.join('');

    // Legend: one colour per course, the same in every timetable.
    const colorOf = new Map(all.timed.map((c, k) => [c.code, PALETTE[k % PALETTE.length]]));
    $('#all-legend').innerHTML = timesOk && n
      ? all.timed.filter((c) => c.groups.some((g) => g.sections.some((s) => s.slots.length)))
        .map((c) => `<span class="lg"><i style="--c:${colorOf.get(c.code)}"></i>${esc(c.code)}</span>`).join('')
      : '';

    renderGrid(timesOk ? r.alts.list : [], colorOf);
  }

  function renderGrid(list, colorOf) {
    const i = state.sel;
    const shown = list.slice(0, state.shown);
    // Same height for every card: down to the latest class in any of them.
    let rows = 10;
    for (const picks of list) for (const p of picks) for (const m of p.section?.meetings || []) {
      if (m.start >= 0 && m.day >= 0 && m.day <= 4) rows = Math.max(rows, Math.min(T.ROWS, m.start + m.dur));
    }
    const kept = readPins()[i] || null;
    $('#all-grid').innerHTML = shown.map((picks, k) => card(picks, k, colorOf, rows, kept)).join('');
    const more = $('#more-btn');
    const rest = list.length - shown.length;
    more.hidden = rest <= 0;
    more.textContent = `Show ${Math.min(PAGE, rest)} more (${num(shown.length)} of ${num(list.length)} shown)`;
  }

  // Is this timetable the one the student kept on the Semester times page?
  function isKept(picks, kept) {
    if (!kept || !Object.keys(kept).length) return false;
    return picks.every((p) => !p.section || [p.section, ...(p.same || [])].some((s) => s.crn === kept[`${p.code}|${p.type}`]));
  }

  function card(picks, k, colorOf, rows, kept) {
    const meetings = picks.flatMap((p) => (p.section?.meetings || [])
      .filter((m) => m.start >= 0 && m.day >= 0 && m.day <= 4).map((m) => ({ ...m, p })));
    const days = new Set(meetings.map((m) => m.day));
    const off = DAY_SHORT.filter((_, d) => !days.has(d));
    const first = Math.min(...meetings.map((m) => m.start));
    const last = Math.max(...meetings.map((m) => m.start + m.dur));
    const facts = meetings.length
      ? `${days.size} day${days.size === 1 ? '' : 's'}${off.length ? ` · ${off.join(', ')} off` : ''} · ${pad(8 + first)}:40–${pad(8 + last)}:30`
      : 'No fixed class times';
    const mine = isKept(picks, kept);
    return `<article class="tcard${mine ? ' kept' : ''}">
        <header><b>Timetable ${num(k + 1)}</b>${mine ? '<span class="kept-tag">Your pick</span>' : ''}</header>
        ${mini(meetings, colorOf, rows, k)}
        <p class="facts">${facts}</p>
        <button type="button" class="btn${mine ? '' : ' primary'} use" data-k="${k}">${mine ? 'Open it' : 'Use this one'}</button>
      </article>`;
  }

  // A small weekly grid: Mon–Fri across, hours down, one coloured block per class.
  function mini(meetings, colorOf, rows, k) {
    const LAB = 24;
    const COL = 30;
    const TOP = 12;
    const ROW = 9;
    const w = LAB + COL * 5;
    const h = TOP + ROW * rows;
    let out = '';
    for (let d = 0; d < 5; d++) {
      out += `<rect x="${LAB + d * COL}" y="${TOP}" width="${COL}" height="${ROW * rows}" class="${d % 2 ? 'col-b' : 'col-a'}"/>`;
      out += `<text x="${LAB + d * COL + COL / 2}" y="9" class="day">${DAY_SHORT[d][0]}</text>`;
    }
    for (let row = 0; row < rows; row += 4) {
      out += `<text x="${LAB - 3}" y="${TOP + row * ROW + 6.5}" class="hour">${8 + row}:40</text>`;
      out += `<line x1="${LAB}" x2="${w}" y1="${TOP + row * ROW}" y2="${TOP + row * ROW}" class="rule"/>`;
    }
    for (const m of meetings) {
      const span = Math.min(m.dur, rows - m.start);
      if (span <= 0) continue;
      const label = `${m.p.code}${m.p.type ? ` ${m.p.type}` : ''} · ${[m.p.section, ...(m.p.same || [])].map((s) => s.group).join('/')} · ${T.timeLabel(m)}`;
      out += `<rect x="${LAB + m.day * COL + 1.5}" y="${TOP + m.start * ROW + 0.75}" width="${COL - 3}" height="${span * ROW - 1.5}" rx="2" fill="${colorOf.get(m.p.code) || '#555'}"><title>${esc(label)}</title></rect>`;
    }
    return `<svg class="mini" viewBox="0 0 ${w} ${h}" role="img" aria-label="Timetable ${k + 1}">${out}</svg>`;
  }

  // ---------- Hours to keep free ----------
  // A small week grid: click or drag over hours to keep them free. A day name toggles the whole
  // day, a time toggles that hour on every day.
  const daySlots = (d) => Array.from({ length: T.ROWS }, (_, row) => slotOf(d, row));
  const hourSlots = (row) => DAY_NAMES.map((_, d) => slotOf(d, row));
  const allIn = (slots) => slots.every((x) => state.blocked.has(x));

  function buildPicker() {
    let cells = `<span></span>${DAY_SHORT.map((d, k) =>
      `<button type="button" class="fh-day" data-day="${k}" title="Keep ${DAY_NAMES[k]} free">${d}</button>`).join('')}`;
    for (let row = 0; row < T.ROWS; row++) {
      cells += `<button type="button" class="fh-hour" data-row="${row}" title="Keep ${hourText(row)} free on every day">${hourText(row)}</button>`;
      for (let d = 0; d < DAY_NAMES.length; d++) {
        cells += `<button type="button" class="fh-cell" data-slot="${slotOf(d, row)}" aria-pressed="false" aria-label="${DAY_NAMES[d]} ${hourText(row)}"></button>`;
      }
    }
    $('#all-filters').innerHTML = `
      <details class="free-hours"${phone() ? '' : ' open'}>
        <summary><b>Keep hours free</b> <span id="fh-sum" class="fh-sum"></span></summary>
        <div class="fh-body">
          <div id="fh-grid" class="fh-grid" role="group" aria-label="Hours to keep free">${cells}</div>
          <div class="fh-side">
            <p>Click the hours you want free, or drag across them. Only timetables with no class then are shown.</p>
            <p>A day name frees the whole day. A time frees that hour on every day.</p>
            <button type="button" id="fh-clear" class="btn">Clear</button>
          </div>
        </div>
      </details>`;
  }

  // "Fri off, no 08:40, Wed 12:40–14:30"
  function describe() {
    if (!state.blocked.size) return 'none chosen';
    const rest = new Set(state.blocked);
    const parts = [];
    DAY_NAMES.forEach((_, d) => {
      if (allIn(daySlots(d))) { parts.push(`${DAY_SHORT[d]} off`); daySlots(d).forEach((x) => rest.delete(x)); }
    });
    for (let row = 0; row < T.ROWS; row++) {
      const slots = hourSlots(row);
      if (allIn(slots) && slots.some((x) => rest.has(x))) { parts.push(`no ${hourText(row)}`); slots.forEach((x) => rest.delete(x)); }
    }
    DAY_NAMES.forEach((_, d) => {
      const rows = daySlots(d).map((x, row) => (rest.has(x) ? row : -1)).filter((row) => row >= 0);
      for (let k = 0; k < rows.length;) {
        let e = k;
        while (e + 1 < rows.length && rows[e + 1] === rows[e] + 1) e++;
        parts.push(`${DAY_SHORT[d]} ${hourText(rows[k])}–${pad(8 + rows[e] + 1)}:30`);
        k = e + 1;
      }
    });
    return parts.join(', ');
  }

  function syncPicker() {
    for (const c of document.querySelectorAll('.fh-cell')) c.setAttribute('aria-pressed', String(state.blocked.has(Number(c.dataset.slot))));
    for (const b of document.querySelectorAll('.fh-day')) b.setAttribute('aria-pressed', String(allIn(daySlots(Number(b.dataset.day)))));
    for (const b of document.querySelectorAll('.fh-hour')) b.setAttribute('aria-pressed', String(allIn(hourSlots(Number(b.dataset.row)))));
    $('#fh-sum').textContent = describe();
    $('#fh-clear').disabled = !state.blocked.size;
  }

  function freeChanged() {
    saveFree();
    state.shown = PAGE;
    render();
  }
  function toggleSlots(slots) {
    const on = !allIn(slots);
    for (const x of slots) { if (on) state.blocked.add(x); else state.blocked.delete(x); }
    freeChanged();
  }

  function bindPicker() {
    const grid = $('#fh-grid');
    // Drag painting: the first cell decides whether this drag frees hours or gives them back.
    let paint = null;
    const paintCell = (cell) => {
      const x = Number(cell.dataset.slot);
      if (paint) state.blocked.add(x); else state.blocked.delete(x);
      cell.setAttribute('aria-pressed', String(paint));
    };
    grid.addEventListener('pointerdown', (e) => {
      const cell = e.target.closest('.fh-cell');
      if (!cell || e.button > 0) return;
      e.preventDefault();
      paint = !state.blocked.has(Number(cell.dataset.slot));
      paintCell(cell);
    });
    grid.addEventListener('pointermove', (e) => {
      if (paint == null) return;
      const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.fh-cell');
      if (cell && grid.contains(cell)) paintCell(cell);
    });
    const done = () => { if (paint != null) { paint = null; freeChanged(); } };
    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);
    grid.addEventListener('click', (e) => {
      const day = e.target.closest('.fh-day');
      const hour = e.target.closest('.fh-hour');
      const cell = e.target.closest('.fh-cell');
      if (day) toggleSlots(daySlots(Number(day.dataset.day)));
      else if (hour) toggleSlots(hourSlots(Number(hour.dataset.row)));
      else if (cell && e.detail === 0) toggleSlots([Number(cell.dataset.slot)]); // keyboard; mouse and touch paint above
    });
    $('#fh-clear').addEventListener('click', () => { state.blocked.clear(); freeChanged(); });
  }

  // ---------- Actions ----------
  // Keep this timetable's sections as the picks on the Semester times page, then open it there.
  function useTimetable(k) {
    const i = state.sel;
    const picks = (filtering() ? check(i, true) : check(i, false)).alts.list[k];
    if (!picks) return;
    const pins = readPins();
    if (!isKept(picks, pins[i])) {
      pins[i] = Object.fromEntries(picks.filter((p) => p.section).map((p) => [`${p.code}|${p.type}`, p.section.crn]));
      try { localStorage.setItem(PINS_KEY, JSON.stringify(pins)); } catch { /* not saved */ }
    }
    location.href = `timetable.html?sem=${i}`;
  }

  function select(i) {
    state.sel = i;
    state.shown = PAGE;
    history.replaceState(null, '', `?sem=${i}`);
    render();
    $('#main').scrollTop = 0;
  }

  function setPicks(program, entry) {
    const r = S.resolvePicks(program, entry);
    state.program = r.program;
    state.entry = r.entry;
    const prog = $('#program');
    prog.value = state.program;
    prog.classList.toggle('unset', !state.program);
    const entrySel = $('#entry');
    entrySel.innerHTML = r.years.map((t) => `<option value="${esc(t.term)}">${esc(t.termName)}</option>`).join('');
    entrySel.value = state.entry;
    $('#entry-row').hidden = !r.years.length;
    render();
  }

  // Open on ?sem=N, else the current term's semester, else the first one with courses.
  function firstSemester() {
    const params = new URLSearchParams(location.search);
    const asked = Number(params.get('sem'));
    if (params.has('sem') && Number.isInteger(asked) && asked >= 0 && asked < SEMESTERS) return asked;
    const now = Array.from({ length: SEMESTERS }, (_, i) => i).find((i) => semesterTerm(i) === T.fall?.term);
    if (now != null && state.plan[now].length) return now;
    const filled = state.plan.findIndex((s) => s.length);
    return filled >= 0 ? filled : 0;
  }

  function bindEvents() {
    $('#program').addEventListener('change', (e) => setPicks(e.target.value, state.entry));
    $('#entry').addEventListener('change', (e) => setPicks(state.program, e.target.value));
    $('#menu-toggle').addEventListener('click', () => document.body.classList.toggle('menu-hidden'));
    $('#sem-list').addEventListener('click', (e) => {
      const b = e.target.closest('.sem-tab');
      if (!b) return;
      select(Number(b.dataset.sem));
      if (phone()) document.body.classList.add('menu-hidden');
    });
    $('#all-head').addEventListener('change', (e) => {
      if (e.target.id === 'sem-select') select(Number(e.target.value));
    });
    bindPicker();
    $('#all-grid').addEventListener('click', (e) => {
      const b = e.target.closest('.use');
      if (b) useTimetable(Number(b.dataset.k));
    });
    $('#more-btn').addEventListener('click', () => {
      state.shown += PAGE;
      render();
    });
    // The plan may change in another tab (the 4-year plan page).
    window.addEventListener('storage', (e) => {
      if (e.key === S.KEYS.plan) loadPlan();
      if (e.key === FREE_KEY) loadFree();
      if ([S.KEYS.plan, PINS_KEY, FREE_KEY].includes(e.key)) render();
    });
  }

  // ---------- Start ----------
  S.fillProgramOptions($('#program'));
  loadPlan();
  loadFree();
  buildPicker();
  bindEvents();
  if (phone()) document.body.classList.add('menu-hidden'); // the timetables first; the menu opens the semesters
  const picks = S.readPicks();
  state.entry = S.resolvePicks(picks.program, picks.entry).entry;
  state.sel = firstSemester();
  setPicks(picks.program, picks.entry);
})();
