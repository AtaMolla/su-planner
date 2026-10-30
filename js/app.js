/* SU Planner: pick sections, see them on a weekly grid, copy the CRNs.
   Course data comes from data/courses.js (window.COURSE_DATA). */
(() => {
  'use strict';

  const DATA = window.COURSE_DATA;
  if (!DATA || !Array.isArray(DATA.courses)) {
    document.getElementById('course-list').textContent = 'Course data did not load (data/courses.js).';
    return;
  }

  // ---------- Constants ----------
  const TERM = DATA.term || '202601';
  const TERM_NAME = DATA.termName || '';
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const SLOTS = 11; // hourly rows 08:40 … 18:40
  const FIRST_HOUR = 8;
  const STORE_KEY = `su-planner:${TERM}`;
  const INTRO_KEY = 'su-planner:intro-seen';
  const PROGRAM_KEY = 'su-planner:program';
  const ENTRY_KEY = 'su-planner:entry';
  const INFO_URL = `https://suis.sabanciuniv.edu/prod/bwckschd.p_disp_detail_sched?term_in=${TERM}&crn_in=`;
  const PALETTE = [
    '#2f6fb5', '#8e5a9b', '#c2571a', '#2b8a6e', '#a23b5a', '#5a6acf', '#7a6a2e',
    '#1f7a8c', '#b8456b', '#5b8c3a', '#6d4fb3', '#9c5b2e', '#33658a', '#8b3f8f',
    '#3f7d5c', '#b0603a', '#4a5fa8', '#7d4e57', '#2e7f9e', '#86603d',
  ];

  // ---------- Helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  // Search text ignores spaces, case and accents: "cs201" finds "CS 201", "gul" finds "Gül".
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i').replace(/\s+/g, '').toUpperCase();
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const isWeekday = (day) => day >= 0 && day < DAYS.length;
  const isTimed = (m) => m.start >= 0 && isWeekday(m.day);

  function meetingText(m) {
    const day = isWeekday(m.day) ? `${DAYS[m.day]} ` : '';
    const time = isTimed(m)
      ? `${pad(FIRST_HOUR + m.start)}:40–${pad(FIRST_HOUR + m.start + m.dur)}:30`
      : 'TBA';
    return `${day}${time}${m.place ? ` · ${m.place}` : ''}`;
  }

  // ---------- Programs and their degree requirements (js/shared.js) ----------
  const {
    PROGRAMS, REQUIREMENTS, programById, termsFor, requirementsFor, categoryRank, minLabel,
  } = window.SUShared;

  // ---------- Data index ----------
  const courses = DATA.courses.map((c, ci) => {
    const key = c.code.replace(/\s+/g, '');
    const [subject, number = ''] = c.code.split(/\s+/);
    return {
      ci,
      code: c.code,
      name: c.name,
      subject,
      grad: /^[5-9]/.test(number), // SU numbering: 1xx–4xx undergraduate, 5xx and up graduate

      search: fold(`${c.code} ${c.name}`),
      classes: c.classes.map((cl, gi) => ({
        type: cl.type,
        sections: cl.sections.map((s) => {
          const instructor = DATA.instructors[s.instructors] || 'TBA';
          const meetings = s.schedule.map((m) => ({
            day: m.day, start: m.start, dur: m.duration, place: DATA.places[m.place] || '',
          }));
          const slots = [];
          for (const m of meetings) {
            if (!isTimed(m)) continue;
            for (let k = 0; k < m.dur && m.start + k < SLOTS; k++) slots.push([m.day, m.start + k]);
          }
          return {
            crn: String(s.crn), group: s.group, ci, gi, instructor,
            instructorSearch: fold(instructor),
            label: `${key}${cl.type} - ${s.group}`,
            meetings, slots,
          };
        }),
      })),
    };
  });
  const byCrn = new Map();
  courses.forEach((c) => c.classes.forEach((cl) => cl.sections.forEach((s) => byCrn.set(s.crn, s))));

  // ---------- State ----------
  const state = {
    picks: new Map(),  // course index -> [crn | null] per section group
    colors: new Map(), // course index -> colour, only while the course is on the grid
    open: null,        // course expanded in the list
    focus: null,       // course shown alone in the list (after clicking it on the grid)
    query: '',
    mode: 'name',
    days: new Set([0, 1, 2, 3, 4]),
    program: '',       // id from programs.js; '' = no program picked
    entry: '',         // admit term whose curriculum applies, e.g. '202501'
    hover: null,       // section under the pointer
    hoverCourse: null, // course whose name is under the pointer: its sections show as shadows
    justPlaced: null,  // course to animate on the next render
  };

  const picksOf = (ci) => state.picks.get(ci);
  const isPicked = (s) => picksOf(s.ci)?.[s.gi] === s.crn;
  const isPlaced = (ci) => { const a = picksOf(ci); return !!a && a.every(Boolean); };

  function setPick(s, on) {
    const arr = picksOf(s.ci) || courses[s.ci].classes.map(() => null);
    if (on) arr[s.gi] = s.crn;
    else if (arr[s.gi] === s.crn) arr[s.gi] = null;
    if (arr.some(Boolean)) state.picks.set(s.ci, arr);
    else state.picks.delete(s.ci);
  }

  function syncColor(ci) {
    if (!isPlaced(ci)) { state.colors.delete(ci); return; }
    if (state.colors.has(ci)) return;
    const used = new Set(state.colors.values());
    const free = PALETTE.filter((c) => !used.has(c));
    const pool = free.length ? free : PALETTE;
    state.colors.set(ci, pool[Math.floor(Math.random() * pool.length)]);
  }

  function placedSections() {
    const out = [];
    for (const [ci, arr] of state.picks) if (isPlaced(ci)) arr.forEach((crn) => out.push(byCrn.get(crn)));
    return out;
  }

  // ---------- Saving ----------
  function save() {
    const picks = [];
    for (const arr of state.picks.values()) arr.forEach((crn) => crn && picks.push(crn));
    const colors = {};
    for (const [ci, col] of state.colors) colors[courses[ci].code] = col;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ picks, colors, days: [...state.days] }));
    } catch { /* storage blocked: the page still works, it just forgets on reload */ }
  }

  function load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { saved = null; }
    if (!saved || typeof saved !== 'object') return;
    for (const crn of saved.picks || []) {
      const s = byCrn.get(String(crn));
      if (s) setPick(s, true);
    }
    const codeToIndex = new Map(courses.map((c) => [c.code, c.ci]));
    for (const [code, col] of Object.entries(saved.colors || {})) {
      const ci = codeToIndex.get(code);
      if (ci != null && isPlaced(ci) && /^#[0-9a-f]{6}$/i.test(col)) state.colors.set(ci, col);
    }
    for (const ci of state.picks.keys()) syncColor(ci);
    if (Array.isArray(saved.days)) state.days = new Set(saved.days.filter(isWeekday));
  }

  // ---------- Occupancy and clashes ----------
  // occ[day][slot] = sections there: courses on the grid plus the open course's partial picks.
  let occ = [];
  function computeOccupancy() {
    occ = DAYS.map(() => Array.from({ length: SLOTS }, () => []));
    for (const [ci, arr] of state.picks) {
      if (!isPlaced(ci) && ci !== state.open) continue;
      for (const crn of arr) {
        if (!crn) continue;
        const s = byCrn.get(crn);
        for (const [d, t] of s.slots) occ[d][t].push(s);
      }
    }
  }

  // What `s` would collide with. Its own alternatives (same course and group) don't
  // count, since picking `s` swaps them out.
  function clashesOf(s) {
    const hit = new Set();
    for (const [d, t] of s.slots) {
      for (const o of occ[d][t]) if (!(o.ci === s.ci && o.gi === s.gi)) hit.add(o);
    }
    return hit;
  }

  // ---------- DOM refs ----------
  const table = $('#schedule');
  const list = $('#course-list');
  const searchInput = $('#search');
  const modeSelect = $('#search-mode');
  const dayChips = $('#day-chips');
  const focusBar = $('#focus-bar');
  const summaryText = $('#summary-text');
  const tbaChips = $('#tba-chips');
  const toastEl = $('#toast');
  let cells = [];   // cells[day][slot]
  let entries = []; // course list elements by course index

  // ---------- Build static parts ----------
  function buildGrid() {
    let html = '<thead><tr><th class="corner" scope="col"></th>'
      + DAY_NAMES.map((d, i) => `<th scope="col"><span class="long">${d}</span><span class="short">${DAYS[i]}</span></th>`).join('')
      + '</tr></thead><tbody>';
    for (let t = 0; t < SLOTS; t++) {
      html += `<tr><th scope="row" class="time">${pad(FIRST_HOUR + t)}:40</th>`
        + DAYS.map((_, d) => `<td class="cell" data-day="${d}" data-slot="${t}"></td>`).join('')
        + '</tr>';
    }
    table.innerHTML = `${html}</tbody>`;
    cells = DAYS.map((_, d) => Array.from({ length: SLOTS },
      (_, t) => table.querySelector(`td[data-day="${d}"][data-slot="${t}"]`)));
  }

  function buildList() {
    list.innerHTML = courses.map((c) => `
      <div class="course" data-ci="${c.ci}">
        <button type="button" class="course-head" aria-expanded="false">
          <span class="dot"></span>
          <span class="course-title"><b>${esc(c.code)}</b> – ${esc(c.name)}</span>
          <span class="xtags"></span>
          <svg class="i chev"><use href="#i-chev"/></svg>
        </button>
        <div class="course-body"></div>
      </div>`).join('');
    entries = [...list.children];
  }

  // ---------- Program grouping ----------
  let groupOfCourse = []; // group key per course index
  let headings = new Map(); // group key -> heading element

  // With a program picked, the list follows its degree requirements for the student's entry
  // year: each course sits under the first category (in display order) that counts it.
  // Without one it stays flat.
  function arrangeList() {
    const req = requirementsFor(state.program, state.entry);
    const frag = document.createDocumentFragment();
    headings = new Map();
    if (!req) {
      groupOfCourse = courses.map(() => 'all');
      frag.append(...entries);
      list.replaceChildren(frag);
      return;
    }

    const cats = req
      .map((cat, i) => ({ ...cat, i, rank: categoryRank(cat) }))
      .sort((a, b) => a.rank - b.rank || a.i - b.i);
    const catOf = new Map();
    for (const cat of cats) {
      for (const code of cat.courses) {
        // Requirement pages sometimes add a letter ("CIP 101N") to a course offered as "CIP 101".
        for (const key of [code, code.replace(/[A-Z]+$/, '')]) if (!catOf.has(key)) catOf.set(key, cat.id);
      }
    }
    groupOfCourse = courses.map((c) => catOf.get(c.code) || (c.grad ? 'grad' : 'other'));

    const groups = [
      ...cats.map((cat) => ({ key: cat.id, title: cat.name, note: minLabel(cat), mine: cat.rank === 0 })),
      { key: 'other', title: 'Other undergraduate courses', note: '' },
      { key: 'grad', title: 'Graduate courses', note: '' },
    ];
    for (const g of groups) {
      const h = document.createElement('div');
      h.className = `list-heading${g.mine ? ' mine' : ''}`;
      h.innerHTML = `<span>${esc(g.title)}${g.note ? ` <small>${esc(g.note)}</small>` : ''}</span><span class="n"></span>`;
      headings.set(g.key, h);
      frag.append(h);
      for (const c of courses) if (groupOfCourse[c.ci] === g.key) frag.append(entries[c.ci]);
    }
    list.replaceChildren(frag);
  }

  function fillProgramSelects() {
    const html = '<option value="">Choose your program…</option>'
      + PROGRAMS.faculties.map((f) => `<optgroup label="${esc(f.name)}">`
        + f.programs.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')
        + '</optgroup>').join('');
    for (const sel of document.querySelectorAll('.program-select')) sel.innerHTML = html;
  }

  // Tag courses that also count for the picked double major or minors ("Economics DM").
  function applyExtraTags() {
    const S = window.SUShared;
    const tags = state.program ? S.extraTagsFor(S.extraPrograms(state.entry)) : new Map();
    for (const c of courses) {
      const list = tags.get(c.code) || [];
      entries[c.ci].querySelector('.xtags').innerHTML = list
        .map((t) => `<span class="xtag" title="Also counts for your ${esc(t.replace(/ DM$/, ' double major'))}">${esc(t)}</span>`).join('');
    }
  }

  // Program and entry year are picked together: a year only counts if that program has
  // requirements for it, otherwise the newest available year is used.
  function setPicks({ program = state.program, entry = state.entry, scroll = true } = {}) {
    state.program = programById.has(program) ? program : '';
    const years = state.program ? termsFor(state.program) : REQUIREMENTS.terms;
    state.entry = years.some((t) => t.term === entry) ? entry : (years[0]?.term || '');
    try {
      localStorage.setItem(PROGRAM_KEY, state.program);
      localStorage.setItem(ENTRY_KEY, state.entry);
    } catch { /* not saved */ }

    for (const sel of document.querySelectorAll('.program-select')) {
      sel.value = state.program;
      sel.classList.toggle('unset', !state.program);
    }
    const options = years.map((t) => `<option value="${esc(t.term)}">${esc(t.termName)}</option>`).join('');
    for (const sel of document.querySelectorAll('.entry-select')) {
      sel.innerHTML = options;
      sel.value = state.entry;
    }
    $('#entry-row').hidden = !state.program || !years.length;
    window.SUShared.mountExtras($('#extras'), state.program, applyExtraTags);

    arrangeList();
    applyExtraTags();
    applyFilters();
    render();
    if (scroll) list.scrollTop = 0;
  }

  function buildDayChips() {
    dayChips.innerHTML = DAYS.map((d, i) =>
      `<button type="button" data-day="${i}" aria-pressed="${state.days.has(i)}">${d.toUpperCase()}</button>`).join('');
  }

  // ---------- Filtering ----------
  let visible = new Set(); // CRNs that pass the search and day filters

  function sectionPasses(s) {
    if (state.mode === 'instructor' && state.query && !s.instructorSearch.includes(state.query)) return false;
    return s.meetings.every((m) => !isWeekday(m.day) || state.days.has(m.day));
  }

  function applyFilters() {
    visible = new Set();
    let shown = 0;
    const perGroup = new Map();
    for (const c of courses) {
      let show;
      if (state.focus != null) {
        show = c.ci === state.focus;
      } else {
        const nameOk = state.mode !== 'name' || !state.query || c.search.includes(state.query);
        // A course stays listed only if every group still has a section you could take.
        let everyGroup = true;
        for (const cl of c.classes) {
          let any = false;
          for (const s of cl.sections) if (sectionPasses(s)) { visible.add(s.crn); any = true; }
          if (!any) everyGroup = false;
        }
        show = nameOk && everyGroup;
      }
      entries[c.ci].hidden = !show;
      if (show) {
        shown++;
        perGroup.set(groupOfCourse[c.ci], (perGroup.get(groupOfCourse[c.ci]) || 0) + 1);
      }
    }
    for (const [key, h] of headings) {
      const n = perGroup.get(key) || 0;
      h.hidden = n === 0 || state.focus != null;
      h.lastElementChild.textContent = n;
    }
    if (state.open != null && entries[state.open].hidden) closeOpen();
    $('#list-empty').hidden = shown > 0;
    const counted = state.focus != null ? ''
      : shown === courses.length ? `${courses.length} courses` : `${shown} of ${courses.length} courses`;
    $('#list-meta').textContent = counted;
  }

  // ---------- Rendering ----------
  function sectionHtml(s) {
    const picked = isPicked(s);
    const clashCodes = [...new Set([...clashesOf(s)].map((o) => courses[o.ci].code))];
    return `
      <div class="section${picked ? ' picked' : ''}" role="checkbox" aria-checked="${picked}" tabindex="0" data-crn="${s.crn}">
        <div class="sec-main">
          <div class="sec-top">
            <span class="group-tag">${esc(s.group)}</span>
            <a class="info" href="${INFO_URL}${s.crn}" target="_blank" rel="noopener" title="Open this section in the SU course schedule">info ↗</a>
            <span class="crn">CRN ${s.crn}</span>
          </div>
          <div class="instructor">${esc(s.instructor)}</div>
          <ul class="meetings">${s.meetings.map((m) => `<li>${esc(meetingText(m))}</li>`).join('')}</ul>
          ${clashCodes.length ? `<div class="clash-note">Clashes with ${esc(clashCodes.join(', '))}</div>` : ''}
        </div>
        <span class="check" aria-hidden="true"><svg><use href="#i-check"/></svg></span>
      </div>`;
  }

  function renderBody(ci) {
    const c = courses[ci];
    const body = entries[ci].querySelector('.course-body');
    const showAll = state.focus === ci;
    const arr = picksOf(ci);
    const multi = c.classes.length > 1;
    const before = document.activeElement?.closest?.('.section')?.dataset.crn;

    body.innerHTML = (multi ? '<p class="pick-note">Pick one section from each group.</p>' : '')
      + c.classes.map((cl, gi) => {
        const secs = cl.sections.filter((s) => showAll || visible.has(s.crn) || isPicked(s));
        const done = !!arr?.[gi];
        const state_ = multi ? `<span class="state${done ? ' done' : ''}">${done ? 'picked ✓' : 'pick one'}</span>` : '';
        return `<div class="group"><h3>Sections${cl.type ? ` (${esc(cl.type)})` : ''}${state_}</h3>${secs.map(sectionHtml).join('')}</div>`;
      }).join('');

    if (before) body.querySelector(`.section[data-crn="${before}"]`)?.focus({ preventScroll: true });
  }

  function chipHtml(s, extra = '') {
    const c = courses[s.ci];
    return `<div class="chip${extra}" style="--chip:${state.colors.get(s.ci)}" data-crn="${s.crn}" title="${esc(`${c.code} – ${c.name}\n${s.instructor}`)}">`
      + `<span class="chip-label">${esc(s.label)}</span>`
      + `<button type="button" class="chip-x" aria-label="Remove ${esc(s.label)}">×</button></div>`;
  }

  function renderGrid() {
    const buckets = DAYS.map(() => Array.from({ length: SLOTS }, () => []));
    const unscheduled = [];
    for (const s of placedSections()) {
      if (!s.slots.length) unscheduled.push(s);
      for (const [d, t] of s.slots) buckets[d][t].push(s);
    }

    // The open course's picks while it still misses a group: shown as dashed placeholders.
    const ghosts = new Map();
    if (state.open != null && !isPlaced(state.open)) {
      for (const crn of picksOf(state.open) || []) {
        if (!crn) continue;
        const s = byCrn.get(crn);
        for (const [d, t] of s.slots) ghosts.set(`${d}:${t}`, [...(ghosts.get(`${d}:${t}`) || []), s]);
      }
    }

    let clashHours = 0;
    for (let d = 0; d < DAYS.length; d++) {
      for (let t = 0; t < SLOTS; t++) {
        const here = buckets[d][t];
        const ghostHere = ghosts.get(`${d}:${t}`) || [];
        const cell = cells[d][t];
        cell.innerHTML = here.map((s) => chipHtml(s, s.ci === state.justPlaced ? ' pop' : '')).join('')
          + ghostHere.map((s) => `<div class="chip ghost" title="Pick the remaining groups to add this course">${esc(s.label)}</div>`).join('');
        cell.classList.toggle('clash', here.length > 1);
        cell.classList.toggle('pending', ghostHere.length > 0);
        if (here.length > 1) clashHours++;
      }
    }

    const placedCourses = [...state.picks.keys()].filter(isPlaced).length;
    summaryText.innerHTML = placedCourses
      ? `${plural(placedCourses, 'course')} · ${plural(placedSections().length, 'CRN')}`
        + (clashHours ? ` · <span class="bad">${plural(clashHours, 'clashing hour')}</span>` : '')
        + (unscheduled.length ? ' · No fixed time:' : '')
      : 'Pick a course from the list to start.';
    tbaChips.innerHTML = unscheduled.map((s) => chipHtml(s)).join('');
    state.justPlaced = null;
  }

  function renderHeads() {
    for (const el of list.querySelectorAll('.course.has-picks')) {
      el.classList.remove('has-picks', 'placed');
      el.style.removeProperty('--dot');
    }
    for (const ci of state.picks.keys()) {
      const el = entries[ci];
      el.classList.add('has-picks');
      el.classList.toggle('placed', isPlaced(ci));
      if (state.colors.has(ci)) el.style.setProperty('--dot', state.colors.get(ci));
    }
  }

  function paintHover() {
    for (const row of cells) for (const cell of row) cell.classList.remove('hover-free', 'hover-clash');
    const s = state.hover;
    if (!s) return;
    for (const [d, t] of s.slots) {
      const blocked = occ[d][t].some((o) => !(o.ci === s.ci && o.gi === s.gi));
      cells[d][t].classList.add(blocked ? 'hover-clash' : 'hover-free');
    }
  }

  // Hovering a course name: a dashed "shadow" for every section it could take (within the day
  // filters), green where it fits, red where it would clash with another course on the grid.
  // An open course keeps its shadows until every part (lecture, recitation…) has a pick.
  const SHADOWS_PER_CELL = 3;
  function paintShadows() {
    for (const el of table.querySelectorAll('.shadow')) el.remove();
    const open = state.open != null && !isPlaced(state.open) ? state.open : null;
    const ci = state.hoverCourse ?? open;
    if (ci == null) return;
    const picked = picksOf(ci) || [];
    const here = new Map(); // "d:t" -> [{ s, clash }]
    for (const [gi, cl] of courses[ci].classes.entries()) {
      if (ci === open && picked[gi]) continue; // that part is chosen: only the rest still need shadows
      for (const s of cl.sections) {
        if (isPicked(s) || !visible.has(s.crn)) continue;
        for (const [d, t] of s.slots) {
          const clash = occ[d][t].some((o) => o.ci !== ci);
          here.set(`${d}:${t}`, [...(here.get(`${d}:${t}`) || []), { s, clash }]);
        }
      }
    }
    for (const [key, list] of here) {
      const [d, t] = key.split(':').map(Number);
      const clash = list.every((x) => x.clash);
      const shown = list.slice(0, SHADOWS_PER_CELL).map((x) => esc(x.s.label));
      const more = list.length - shown.length;
      const el = document.createElement('div');
      el.className = `shadow${clash ? ' clash' : ''}`;
      el.innerHTML = shown.map((l) => `<span>${l}</span>`).join('') + (more ? `<span class="more">+${more} more</span>` : '');
      cells[d][t].append(el);
    }
  }

  function render() {
    computeOccupancy();
    renderGrid();
    if (state.open != null) renderBody(state.open);
    renderHeads();
    paintHover();
    paintShadows();
  }

  // ---------- Actions ----------
  function closeOpen() {
    if (state.open == null) return;
    const el = entries[state.open];
    el.classList.remove('open');
    el.querySelector('.course-head').setAttribute('aria-expanded', 'false');
    el.querySelector('.course-body').innerHTML = '';
    state.open = null;
  }

  function openCourse(ci) {
    if (state.open === ci) return;
    closeOpen();
    if (ci == null) return;
    state.open = ci;
    const el = entries[ci];
    el.classList.add('open');
    el.querySelector('.course-head').setAttribute('aria-expanded', 'true');
  }

  function toggleSection(s) {
    const wasPlaced = isPlaced(s.ci);
    setPick(s, !isPicked(s));
    syncColor(s.ci);
    if (!wasPlaced && isPlaced(s.ci)) state.justPlaced = s.ci;
    save();
    render();
  }

  function enterFocus(ci) {
    state.focus = ci;
    document.body.classList.remove('menu-hidden');
    searchInput.disabled = true;
    focusBar.hidden = false;
    $('#focus-name').textContent = courses[ci].code;
    openCourse(ci);
    applyFilters();
    render();
    list.scrollTop = 0;
  }

  function exitFocus() {
    if (state.focus == null) return;
    state.focus = null;
    searchInput.disabled = false;
    focusBar.hidden = true;
    applyFilters();
    render();
    if (state.open != null) entries[state.open].scrollIntoView({ block: 'nearest' });
  }

  // × on a timetable block: drop that section, then show the course so a replacement is one click away.
  function removeSection(crn) {
    const s = byCrn.get(crn);
    if (!s) return;
    setPick(s, false);
    syncColor(s.ci);
    save();
    state.hover = null;
    if (state.picks.has(s.ci)) enterFocus(s.ci);
    else render();
  }

  function onSearch() {
    state.query = fold(searchInput.value);
    state.mode = modeSelect.value;
    searchInput.placeholder = state.mode === 'name' ? 'Search course code or name' : 'Search instructor';
    applyFilters();
    render();
    list.scrollTop = 0;
  }

  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }

  async function copyCrns() {
    const lines = placedSections().map((s) => `${s.label}: ${s.crn}`).sort();
    if (!lines.length) { toast('Nothing to copy yet. Add a course first.'); return; }
    const text = lines.join('\n');
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = legacyCopy(text); }
    if (ok) { toast(`Copied ${plural(lines.length, 'CRN')}`); return; }
    $('#copy-text').value = text;
    $('#copy-dialog').showModal();
    $('#copy-text').select();
  }

  // ---------- Events ----------
  function bindEvents() {
    list.addEventListener('click', (e) => {
      if (e.target.closest('a')) return; // the "info" link opens in a new tab and nothing else
      const head = e.target.closest('.course-head');
      if (head) {
        const ci = Number(head.parentElement.dataset.ci);
        if (state.focus === ci) { closeOpen(); exitFocus(); return; }
        openCourse(state.open === ci ? null : ci);
        state.hover = null;
        render();
        if (state.open != null) entries[ci].scrollIntoView({ block: 'nearest' });
        return;
      }
      const card = e.target.closest('.section');
      if (card) toggleSection(byCrn.get(card.dataset.crn));
    });

    list.addEventListener('keydown', (e) => {
      const card = e.target.closest('.section');
      if (card && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        toggleSection(byCrn.get(card.dataset.crn));
      }
    });

    // A section card previews that one section; a course name shows all its sections as shadows.
    const hoverTo = (s, ci = null) => {
      if (state.hover === s && state.hoverCourse === ci) return;
      state.hover = s;
      state.hoverCourse = ci;
      paintHover();
      paintShadows();
    };
    const target = (e) => {
      const card = e.target.closest('.section');
      if (card) return [byCrn.get(card.dataset.crn), null];
      const head = e.target.closest('.course-head');
      return [null, head ? Number(head.parentElement.dataset.ci) : null];
    };
    list.addEventListener('mouseover', (e) => hoverTo(...target(e)));
    list.addEventListener('mouseleave', () => hoverTo(null));
    list.addEventListener('focusin', (e) => hoverTo(...target(e)));
    list.addEventListener('focusout', () => hoverTo(null));

    // Timetable blocks: click to edit the course, × to remove a section.
    const onChipClick = (e) => {
      const x = e.target.closest('.chip-x');
      const chip = e.target.closest('.chip:not(.ghost)');
      if (!chip) return;
      if (x) { removeSection(chip.dataset.crn); return; }
      const ci = byCrn.get(chip.dataset.crn).ci;
      if (state.focus !== ci) enterFocus(ci);
    };
    // Hovering × greys out every block of that course, since the whole course leaves the grid.
    const onChipOver = (e) => {
      const x = e.target.closest('.chip-x');
      for (const el of document.querySelectorAll('.chip.doomed')) el.classList.remove('doomed');
      if (!x) return;
      const ci = byCrn.get(x.parentElement.dataset.crn).ci;
      for (const el of document.querySelectorAll('.chip[data-crn]')) {
        if (byCrn.get(el.dataset.crn).ci === ci) el.classList.add('doomed');
      }
    };
    for (const el of [table, tbaChips]) {
      el.addEventListener('click', onChipClick);
      el.addEventListener('mouseover', onChipOver);
      el.addEventListener('mouseleave', onChipOver);
    }

    searchInput.addEventListener('input', onSearch);
    modeSelect.addEventListener('change', onSearch);
    for (const sel of document.querySelectorAll('.program-select')) {
      sel.addEventListener('change', () => setPicks({ program: sel.value }));
    }
    for (const sel of document.querySelectorAll('.entry-select')) {
      sel.addEventListener('change', () => setPicks({ entry: sel.value }));
    }

    dayChips.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-day]');
      if (!b) return;
      const d = Number(b.dataset.day);
      if (state.days.has(d)) state.days.delete(d); else state.days.add(d);
      b.setAttribute('aria-pressed', String(state.days.has(d)));
      save();
      applyFilters();
      render();
    });

    $('#focus-exit').addEventListener('click', exitFocus);
    $('#menu-toggle').addEventListener('click', () => document.body.classList.toggle('menu-hidden'));
    $('#about-btn').addEventListener('click', () => $('#about-dialog').showModal());
    $('#copy-btn').addEventListener('click', copyCrns);
    $('#clear-btn').addEventListener('click', () => {
      if (!state.picks.size) { toast('Your schedule is already empty.'); return; }
      $('#clear-dialog').showModal();
    });
    // Act on the button's submit: the dialog's own "close" event isn't fired reliably everywhere.
    $('#clear-dialog form').addEventListener('submit', (e) => {
      if (e.submitter?.value !== 'clear') return;
      state.picks.clear();
      state.colors.clear();
      save();
      render();
      toast('Schedule cleared');
    });

    document.addEventListener('keydown', (e) => {
      if (document.querySelector('dialog[open]')) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
      if (e.key === 'Escape') {
        if (state.focus != null) exitFocus();
        else if (searchInput.value) { searchInput.value = ''; onSearch(); }
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        searchInput.focus();
      }
    });
  }

  // ---------- Start ----------
  $('#term-label').textContent = TERM_NAME;
  $('#about-term').textContent = TERM_NAME || TERM;
  load();
  buildGrid();
  buildList();
  buildDayChips();
  fillProgramSelects();
  bindEvents();
  let savedProgram = '';
  let savedEntry = '';
  try {
    savedProgram = localStorage.getItem(PROGRAM_KEY) || '';
    savedEntry = localStorage.getItem(ENTRY_KEY) || '';
  } catch { savedProgram = ''; }
  setPicks({ program: savedProgram, entry: savedEntry, scroll: false });

  try {
    if (!localStorage.getItem(INTRO_KEY)) {
      localStorage.setItem(INTRO_KEY, '1');
      $('#about-dialog').showModal();
    }
  } catch { /* no storage: skip the intro */ }
})();
