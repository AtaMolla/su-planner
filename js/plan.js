/* 4-year plan: place courses into eight semesters and track them against the
   program's degree requirements for the student's entry year.
   Data: data/requirements.js (catalog, pools), data/courses.js (this term's offer).
   Helpers: js/shared.js. */
(() => {
  'use strict';

  const S = window.SUShared;
  const { REQUIREMENTS, esc, fold, baseCode } = S;
  const CATALOG = REQUIREMENTS.catalog || {};
  const OFFER = window.COURSE_DATA || { courses: [] };
  const OFFERED = new Map(OFFER.courses.map((c) => [c.code, c.name]));
  const CURRENT_TERM = OFFER.term || '';
  const SEMESTERS = 8;
  const KIND_LABEL = {
    required: 'Required', core: 'Core', area: 'Area', university: 'University',
    free: 'Free', faculty: 'Faculty', other: 'Other',
  };

  const $ = (sel) => document.querySelector(sel);
  const byCode = (a, b) => a.localeCompare(b, 'en', { numeric: true });
  const isOffered = (code) => OFFERED.has(code) || OFFERED.has(baseCode(code));
  const inCat = (cat, code) => cat.set.has(code) || cat.set.has(baseCode(code));
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  // Elective placeholders in the plan: "~<category id>~<random>", worth a typical 3 SU / 6 ECTS course.
  const SLOT_SU = 3;
  const SLOT_ECTS = 6;
  const LOAD_MIN = 15; // normal semester load, in SU credits
  const LOAD_MAX = 20;
  const isSlot = (code) => code.startsWith('~');
  const slotCatId = (code) => code.split('~')[1] || '';
  const makeSlot = (catId) => `~${catId}~${Math.random().toString(36).slice(2, 8)}`;
  const catById = (id) => cats?.find((c) => c.id === id)
    || extras.flatMap((x) => x.cats).find((c) => c.id === id) || null;

  function slotName(cat) {
    if (!cat) return 'Elective';
    if (cat.kind === 'university') return 'HUM course';
    if (cat.extra) return `${KIND_LABEL[cat.kind] || 'Other'} elective`; // the tag names the minor / DM
    return `${shortLabel(cat)} elective`;
  }

  // Catalog entry: [name, SU credits, ECTS, Engineering ECTS, Basic Science ECTS, prerequisites].
  function info(code) {
    if (isSlot(code)) return { name: slotName(catById(slotCatId(code))), su: SLOT_SU, ects: SLOT_ECTS, eng: 0, basic: 0 };
    const c = CATALOG[code];
    if (c) return { name: c[0], su: c[1] ?? 0, ects: c[2] ?? 0, eng: c[3] ?? 0, basic: c[4] ?? 0 };
    return { name: OFFERED.get(code) || '', su: 0, ects: 0, eng: 0, basic: 0 };
  }

  // ---------- State ----------
  const state = {
    program: '',
    entry: '',
    years: [],
    plan: Array.from({ length: SEMESTERS }, () => []), // course codes per semester
    target: 0, // semester that "+" adds to
    query: '',
    onlyCat: '', // list only this group's courses (after "choose a course" on a placeholder)
  };
  let cats = null;       // the program's categories in display order (shared.js)
  let exclusive = [];    // categories a course is counted in exactly once
  let facultyCat = null; // "Faculty Courses": a course count that overlaps the others
  let overlays = [];     // ECTS minimums that overlap the others: Engineering, Basic Science
  let extras = [];       // double major / minors picked (shared.js extraPrograms), each with .excl
  let extraTags = new Map(); // course code -> ["Economics DM", "Finance minor"]

  // A double major's own groups to track (university and free credits are shared with the
  // major, and its +30 SU shows in its total); a minor's are all of them.
  const extraGroups = (x) => x.cats.filter((c) => (x.kind === 'dm'
    ? ['required', 'requirement', 'core', 'area'].includes(c.kind)
    : !['faculty', 'university', 'free'].includes(c.kind)));

  // SU: a double major needs the whole major plus 30 SU credits on top of it.
  const DM_EXTRA_SU = 30;
  function extraGoal(x) {
    if (x.kind !== 'dm') return x.totals.su || 0;
    const major = S.totalsFor(state.program, state.entry).su;
    return major ? major + DM_EXTRA_SU : (x.totals.su || 0);
  }

  function loadExtras() {
    extras = state.program ? S.extraPrograms(state.entry).map((x) => ({ ...x, excl: extraGroups(x) })) : [];
    extraTags = S.extraTagsFor(extras);
  }

  function savePlan() {
    try { localStorage.setItem(S.KEYS.plan, JSON.stringify({ semesters: state.plan })); } catch { /* not saved */ }
  }

  // Returns whether a plan was saved before (even an emptied one).
  function loadPlan() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(S.KEYS.plan) || 'null'); } catch { saved = null; }
    if (!Array.isArray(saved?.semesters)) return false;
    const seen = new Set();
    state.plan = Array.from({ length: SEMESTERS }, (_, i) => (saved.semesters[i] || [])
      .filter((c) => typeof c === 'string' && !seen.has(c) && seen.add(c)));
    return true;
  }

  // ---------- Semesters ----------
  function semesterTerm(i) {
    const start = state.entry || CURRENT_TERM || '202601';
    const year = Number(start.slice(0, 4)) + Math.floor(i / 2);
    return `${year}${i % 2 ? '02' : '01'}`;
  }
  const semesterTitle = (i) => `Year ${Math.floor(i / 2) + 1} · ${i % 2 ? 'Spring' : 'Fall'}`;
  function semesterStatus(i) {
    const term = semesterTerm(i);
    if (!CURRENT_TERM) return 'future';
    return term < CURRENT_TERM ? 'past' : term === CURRENT_TERM ? 'now' : 'future';
  }
  const whereIs = (code) => state.plan.findIndex((sem) => sem.includes(code));

  // ---------- Prerequisite order ----------
  // Prerequisites are AND-of-OR groups: every group is needed, any one course of a group is enough.
  // Some catalog pages list a course as its own prerequisite (SPS 303); those groups are ignored.
  const prereqOf = (code) => (CATALOG[code]?.[5] || []).filter((g) => !g.some((p) => baseCode(p) === baseCode(code)));

  // Semester of every planned course, by its code and its base code ("CIP 101N" -> "CIP 101").
  function planIndex() {
    const where = new Map();
    state.plan.forEach((sem, i) => sem.forEach((code) => {
      where.set(code, i);
      if (!where.has(baseCode(code))) where.set(baseCode(code), i);
    }));
    return where;
  }

  // A group is done when one of its courses sits in an earlier semester. Otherwise it is
  // "late" (planned in the same or a later semester) or "missing" (not in the plan at all).
  function prereqIssues(code, i, where) {
    const late = [];
    const missing = [];
    for (const group of prereqOf(code)) {
      const sems = group.map((p) => where.get(p)).filter((s) => s != null);
      if (sems.some((s) => s < i)) continue;
      if (sems.length) late.push({ group, at: Math.min(...sems) });
      else missing.push(group);
    }
    return { late, missing };
  }

  function allIssues() {
    const where = planIndex();
    const issues = new Map();
    state.plan.forEach((sem, i) => sem.forEach((code) => issues.set(code, prereqIssues(code, i, where))));
    return issues;
  }

  const lateCodes = (issues) => new Set([...issues].filter(([, v]) => v.late.length).map(([code]) => code));

  function lateText(i, item) {
    const when = item.at === i ? 'same semester' : `planned in ${semesterTitle(item.at)}`;
    return `Needs ${item.group.join(' or ')} first (${when})`;
  }

  // ---------- Requirement accounting ----------
  function shortLabel(cat) {
    if (!cat) return 'Other';
    if (cat.extra) return cat.extra.short; // "Finance minor", "Economics DM"
    if (cat.kind === 'requirement') return `${cat.name.split(' ')[0].slice(0, 4)}. req`; // "Math. req"
    if (cat.kind === 'core') {
      const m = cat.name.match(/\b(I{1,3})\b/);
      return m ? `Core ${m[1]}` : 'Core';
    }
    return KIND_LABEL[cat.kind] || 'Other';
  }

  // Walk the plan in semester order and count each course once, in the first category it
  // belongs to that still needs credits; when all are full it lands in the last one
  // (usually Free Electives). Faculty Courses is counted on top, as SU does.
  // `groups` defaults to the major's; a double major or minor is counted on its own with its groups.
  function allocate(plan = state.plan, groups = exclusive) {
    const forMajor = groups === exclusive;
    const used = new Map(groups.map((c) => [c.id, { su: 0, ects: 0, n: 0 }]));
    const full = (c) => {
      const u = used.get(c.id);
      if (c.su != null) return u.su >= c.su;
      if (c.minCourses != null) return u.n >= c.minCourses;
      return false;
    };
    const countedIn = new Map();
    let su = 0;
    let ects = 0;
    let n = 0;
    let faculty = 0;
    const split = { eng: 0, basic: 0 };
    for (const sem of plan) {
      for (const code of sem) {
        const c = info(code);
        su += c.su; ects += c.ects; n++;
        split.eng += c.eng; split.basic += c.basic;
        // A placeholder counts in its own category; a course in the first one that lists it.
        // For the major, a double major / minor placeholder counts as a free elective.
        let member;
        if (isSlot(code)) {
          member = groups.filter((cat) => cat.id === slotCatId(code));
          if (!member.length && forMajor) member = groups.filter((cat) => cat.kind === 'free');
        } else {
          member = groups.filter((cat) => inCat(cat, code));
        }
        const pick = member.find((cat) => !full(cat)) || member[member.length - 1] || null;
        countedIn.set(code, pick);
        if (pick) {
          const u = used.get(pick.id);
          u.su += c.su; u.ects += c.ects; u.n++;
        }
        if (forMajor && facultyCat && inCat(facultyCat, code)) faculty++;
      }
    }
    return { used, countedIn, su, ects, n, faculty, split };
  }

  // ---------- Suggested plan ----------
  const courseNumber = (code) => code.split(' ')[1] || '';
  // Freshman courses ending in 2 (MATH 102, HIST 192, AL 102) are the Spring half of a pair.
  const isSpringCode = (code) => /2[A-Z]?$/.test(courseNumber(code));

  // Earliest semester (0-based) by course level: 1xx/2xx from Year 2, 3xx from Year 2 Spring,
  // 4xx from Year 3 Spring, graduation projects (49x) in Year 4.
  function earliestSemester(code) {
    const num = courseNumber(code);
    if (num.startsWith('49')) return 6;
    const level = Number(num[0]);
    if (level >= 4) return 5;
    if (level === 3) return 3;
    return 2;
  }

  // A suggested 8-semester plan for the program: university courses in Year 1, required
  // courses after it in prerequisite order, and elective placeholders to reach each minimum,
  // keeping semesters at 15–20 SU credits where possible.
  function suggestPlan() {
    const sems = Array.from({ length: SEMESTERS }, () => []);
    const load = (s) => sems[s].reduce((t, code) => t + info(code).su, 0);
    const placed = new Map(); // base code -> semester
    const put = (code, s) => { sems[s].push(code); placed.set(baseCode(code), s); };
    const known = (code) => !!CATALOG[code];

    // 1. Freshman university courses fill Year 1.
    const uni = exclusive.find((c) => c.kind === 'university');
    const uniPool = uni ? uni.courses.filter(known) : [];
    for (const code of uniPool) if (courseNumber(code).startsWith('1')) put(code, isSpringCode(code) ? 1 : 0);

    // 2. Courses to place in prerequisite order: every required course, enough of each
    //    choose-from list to meet its minimum, and the other non-HUM university courses.
    //    The double major's and minors' required courses join the same queue.
    const queue = [];
    const queued = (code) => placed.has(baseCode(code)) || queue.includes(code);
    const requiredOf = (groups) => {
      for (const cat of groups) {
        if (cat.kind === 'required') for (const code of cat.courses) if (known(code) && !queued(code)) queue.push(code);
      }
      for (const cat of groups) {
        if (cat.kind !== 'requirement') continue;
        let su = 0;
        let n = 0;
        for (const code of cat.courses) if (queued(code)) { su += info(code).su; n++; }
        for (const code of [...cat.courses].sort(byCode)) {
          if ((cat.su == null || su >= cat.su) && (cat.minCourses == null || n >= cat.minCourses)) break;
          if (!known(code) || queued(code)) continue;
          queue.push(code); su += info(code).su; n++;
        }
      }
    };
    requiredOf(exclusive);
    for (const code of uniPool) if (!queued(code) && !code.startsWith('HUM ')) queue.push(code);
    for (const x of extras) requiredOf(x.excl);

    const inPlan = new Set([...placed.keys(), ...queue.map(baseCode)]);
    // Every prerequisite group needs one of its courses in an earlier semester; groups
    // with no course in the plan can't be helped, so they don't hold a course back.
    const ready = (code, s) => prereqOf(code).every((g) => {
      const mine = g.filter((p) => inPlan.has(baseCode(p)));
      return !mine.length || mine.some((p) => placed.has(baseCode(p)) && placed.get(baseCode(p)) < s);
    });
    // Courses that many others wait on go first.
    const depth = new Map();
    const dependents = (code) => queue.filter((c) => prereqOf(c).some((g) => g.some((p) => baseCode(p) === baseCode(code))));
    const chain = (code, seen = new Set()) => {
      if (depth.has(code)) return depth.get(code);
      if (seen.has(code)) return 0;
      seen.add(code);
      const d = 1 + Math.max(0, ...dependents(code).map((c) => chain(c, seen)));
      depth.set(code, d);
      return d;
    };

    // SU credits of required courses per semester, leaving room for electives
    // (more when a double major or minor adds required courses).
    const queueSU = queue.reduce((t, c) => t + info(c).su, 0);
    const REQUIRED_PER_SEMESTER = Math.max(12, Math.ceil(queueSU / (SEMESTERS - 2)) + 3);
    let left = [...queue];
    for (let s = 2; s < SEMESTERS && left.length; s++) {
      const candidates = left
        .filter((c) => earliestSemester(c) <= s && ready(c, s) && !(semesterStatus(s) === 'now' && !isOffered(c)))
        .sort((a, b) => chain(b) - chain(a) || byCode(a, b));
      let taken = 0;
      for (const code of candidates) {
        const su = info(code).su;
        if (taken > 0 && taken + su > REQUIRED_PER_SEMESTER) continue;
        put(code, s);
        taken += su;
      }
      left = left.filter((c) => !placed.has(baseCode(c)));
    }
    for (const code of left) put(code, SEMESTERS - 1); // could not be ordered; the plan will flag it

    // 3. Elective placeholders for whatever each category still needs.
    const group = { university: [], core: [], extra: [], area: [], free: [], topUp: [] };
    const used = allocate(sems).used;
    const need = (cat, u = used) => Math.max(0, (cat.su ?? 0) - (u.get(cat.id)?.su || 0));
    for (const kind of ['university', 'core', 'area', 'free']) {
      for (const cat of exclusive.filter((c) => c.kind === kind)) {
        for (let k = Math.ceil(need(cat) / SLOT_SU); k > 0; k--) group[kind].push(makeSlot(cat.id));
      }
    }
    // Top up to the program's total with free electives.
    const total = S.totalsFor(state.program, state.entry).su || 0;
    const free = exclusive.find((c) => c.kind === 'free');
    const count = () => Object.values(group).reduce((t, list) => t + list.length, 0);
    const planned = () => sems.reduce((t, _, s) => t + load(s), 0) + count() * SLOT_SU;
    while (free && total && planned() < total) group.free.push(makeSlot(free.id));

    // Double major / minor electives: each one takes the place of one of the major's free
    // electives while there are some (it counts there too), otherwise it is extra.
    for (const x of extras) {
      const xUsed = allocate(sems, x.excl).used;
      for (const cat of x.excl.filter((c) => c.kind === 'core' || c.kind === 'area')) {
        for (let k = Math.ceil(need(cat, xUsed) / SLOT_SU); k > 0; k--) {
          group.free.pop();
          group.extra.push(makeSlot(cat.id));
        }
      }
    }
    // A double major needs its own total: the major plus 30 SU.
    for (const x of extras.filter((e) => e.kind === 'dm')) {
      const xFree = x.cats.find((c) => c.kind === 'free') || x.excl[x.excl.length - 1];
      while (xFree && extraGoal(x) && planned() < extraGoal(x)) group.topUp.push(makeSlot(xFree.id));
    }
    const slots = [...group.university, ...group.core, ...group.extra, ...group.area, ...group.free, ...group.topUp];

    // Spread them over Years 2–4 so each semester lands between 15 and 20 credits.
    for (let s = 2; s < SEMESTERS; s++) {
      let rest = slots.length * SLOT_SU;
      for (let t = s; t < SEMESTERS; t++) rest += load(t);
      const target = Math.min(LOAD_MAX, Math.max(LOAD_MIN, Math.ceil(rest / (SEMESTERS - s))));
      while (slots.length && load(s) < target && load(s) + SLOT_SU <= LOAD_MAX) sems[s].push(slots.shift());
    }
    while (slots.length) {
      let s = 2;
      for (let t = 3; t < SEMESTERS; t++) if (load(t) < load(s)) s = t;
      sems[s].push(slots.shift());
    }

    // Even out: no semester under 15 while another can spare a placeholder; failing
    // that, add a free elective (a little over the total beats a light semester).
    const later = Array.from({ length: SEMESTERS - 2 }, (_, k) => k + 2);
    for (let guard = 0; guard < 40; guard++) {
      const low = later.find((s) => load(s) < LOAD_MIN);
      if (low == null) break;
      const donor = [...later].sort((x, y) => load(y) - load(x))
        .find((t) => t !== low && load(t) - SLOT_SU >= LOAD_MIN && sems[t].some(isSlot));
      if (donor != null) {
        const slot = [...sems[donor]].reverse().find(isSlot);
        sems[donor] = sems[donor].filter((c) => c !== slot);
        sems[low].push(slot);
      } else if (free) {
        sems[low].push(makeSlot(free.id));
      } else {
        break;
      }
    }
    return sems;
  }

  function applySuggestion() {
    if (!cats) return;
    state.plan = suggestPlan();
    savePlan();
    render();
    const heavy = extras.some((x) => x.kind === 'dm') && state.plan.some((s) => s.reduce((t, c) => t + info(c).su, 0) > LOAD_MAX);
    toast(`Suggested plan for ${planName()}.${heavy ? ' A double major needs some semesters over 20 credits; they are marked.' : ' Change anything you like.'}`, heavy);
  }

  // "Economics + Finance minor" for messages.
  function planName() {
    const major = S.programById.get(state.program)?.name || 'your program';
    return [major, ...extras.map((x) => (x.kind === 'dm' ? `${x.name} double major` : `${x.name} minor`))].join(' + ');
  }

  function askSuggestion() {
    const name = planName();
    $('#suggest-text').textContent = state.plan.some((s) => s.length)
      ? `This replaces your current plan with a suggested one for ${name}: university courses in Year 1, required courses in prerequisite order, and placeholders for electives.`
      : `Fill your plan with a suggested one for ${name}.`;
    $('#suggest-dialog').showModal();
  }

  // ---------- Catalog (sidebar) ----------
  const catalogEl = $('#catalog');
  let rowByCode = new Map();
  let headingEls = []; // [{el, rows}]

  function renderCatalog() {
    const codes = Object.keys(CATALOG).sort(byCode);
    const groups = [];
    if (cats) {
      const groupOf = new Map();
      for (const code of codes) {
        const cat = cats.find((c) => inCat(c, code));
        const key = cat ? cat.id : 'other';
        if (!groupOf.has(key)) groupOf.set(key, []);
        groupOf.get(key).push(code);
      }
      for (const cat of cats) if (groupOf.has(cat.id)) groups.push({ id: cat.id, title: cat.name, note: S.minLabel(cat), kind: cat.kind, codes: groupOf.get(cat.id) });
      if (groupOf.has('other')) groups.push({ title: 'Other courses', note: 'not in your program', kind: 'other', codes: groupOf.get('other') });
    } else {
      groups.push({ title: '', note: '', kind: 'other', codes });
    }

    catalogEl.innerHTML = groups.map((g) => (g.title
      ? `<div class="list-heading${g.kind === 'required' ? ' mine' : ''}" data-cat="${esc(g.id || '')}"><span>${esc(g.title)}${g.note ? ` <small>${esc(g.note)}</small>` : ''}</span><span class="n"></span></div>`
      : '') + g.codes.map(catalogRow).join('')).join('');

    rowByCode = new Map([...catalogEl.querySelectorAll('.cc')].map((el) => [el.dataset.code, el]));
    headingEls = [];
    let current = null;
    for (const el of catalogEl.children) {
      if (el.classList.contains('list-heading')) { current = { el, rows: [] }; headingEls.push(current); }
      else if (current) current.rows.push(el);
    }
  }

  // "Economics DM", "Finance minor": the double major / minors a course also counts for.
  function xtagsHtml(code) {
    const list = extraTags.get(code) || extraTags.get(baseCode(code)) || [];
    return list.length ? `<span class="xtags">${list.map((t) => `<span class="xtag" title="Also counts for your ${esc(t.replace(/ DM$/, ' double major'))}">${esc(t)}</span>`).join('')}</span>` : '';
  }

  function catalogRow(code) {
    const c = info(code);
    const now = isOffered(code)
      ? ` · <span class="cc-now" title="Offered in ${esc(S.termName(CURRENT_TERM))}">offered now</span>` : '';
    // Engineering / Basic Science shares, only when the program asks for them.
    const split = overlays.map((o) => (c[o.field] ? ` · ${o.field === 'eng' ? 'Eng' : 'Basic'} ${fmt(c[o.field])}` : '')).join('');
    return `<div class="cc" draggable="true" data-code="${esc(code)}" data-search="${esc(fold(`${code} ${c.name}`))}">
        <div class="cc-main">
          <div class="cc-title"><b>${esc(code)}</b> ${esc(c.name)}</div>
          <div class="cc-meta">${fmt(c.su)} SU · ${fmt(c.ects)} ECTS${split}${now}<span class="cc-where"></span></div>
          ${xtagsHtml(code)}
        </div>
        <button type="button" class="cc-add" aria-label="Add ${esc(code)} to the selected semester" title="Add to the selected semester">+</button>
      </div>`;
  }

  function updateCatalog() {
    const only = state.onlyCat ? catById(state.onlyCat) : null;
    const q = state.query;
    let shown = 0;
    for (const [code, el] of rowByCode) {
      const at = whereIs(code);
      el.classList.toggle('planned', at >= 0);
      el.querySelector('.cc-where').textContent = at >= 0 ? ` · planned: ${semesterTitle(at)}` : '';
      const hit = (!q || el.dataset.search.includes(q)) && (!only || inCat(only, code));
      el.hidden = !hit;
      if (hit) shown++;
    }
    for (const h of headingEls) {
      const n = h.rows.filter((r) => !r.hidden).length;
      h.el.hidden = n === 0;
      h.el.lastElementChild.textContent = n;
    }
    $('#list-empty').hidden = shown > 0;
    $('#list-meta').textContent = `${shown} courses`;
    $('#target-note').innerHTML = `Adding to <b>${esc(semesterTitle(state.target))}</b> · ${esc(S.termName(semesterTerm(state.target)))}`
      + (only ? `<div class="only-note">Showing only <b>${esc(only.extra ? `${only.extra.short}: ` : '')}${esc(only.name)}</b> <button type="button" class="clear-only">Show all</button></div>` : '');
  }

  // ---------- Progress ----------
  function meter(value, max) {
    const pct = max ? Math.min(100, (value / max) * 100) : 0;
    return `<div class="meter" role="meter" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${value}"><i style="width:${pct}%"></i></div>`;
  }

  function renderProgress(a, issues) {
    const totals = state.program ? S.totalsFor(state.program, state.entry) : {};
    const box = $('#progress');
    const late = [...lateCodes(issues)];
    const orderHtml = late.length ? `
      <div class="order-warn" role="alert">
        <span class="order-label">${late.length === 1 ? 'This course is planned before its prerequisites:' : `${late.length} courses are planned before their prerequisites:`}</span>
        ${late.map((code) => `<button type="button" class="late-chip" data-code="${esc(code)}" title="Show it in the plan">${esc(code)}</button>`).join('')}
      </div>` : '';
    const head = `
      <div class="prog-totals">
        <div class="total">
          <div class="total-num"><b>${fmt(a.su)}</b>${totals.su ? ` / ${totals.su}` : ''} SU credits</div>
          ${totals.su ? meter(a.su, totals.su) : ''}
        </div>
        <div class="total">
          <div class="total-num"><b>${fmt(a.ects)}</b>${totals.ects ? ` / ${totals.ects}` : ''} ECTS</div>
          ${totals.ects ? meter(a.ects, totals.ects) : ''}
        </div>
        <div class="total">
          <div class="total-num"><b>${a.n}</b> courses planned</div>
        </div>
      </div>`;

    if (!cats) {
      box.innerHTML = `${head}${orderHtml}<p class="prog-hint">Choose your program in the list on the left to check your plan against its degree requirements.</p>`;
      return;
    }

    const rows = exclusive.map((cat) => {
      const u = a.used.get(cat.id);
      const byCredits = cat.su != null;
      const goal = byCredits ? cat.su : cat.minCourses;
      const have = byCredits ? u.su : u.n;
      const met = goal != null && have >= goal;
      return `
        <div class="m" style="--k: var(--k-${cat.kind})">
          <div class="m-label"><span class="sw" aria-hidden="true"></span>${esc(cat.name)}</div>
          <div class="m-val">${met ? '<span class="ok" aria-label="met">✓</span> ' : ''}${fmt(have)}${goal != null ? ` / ${goal}` : ''} ${byCredits ? 'SU' : 'courses'}</div>
          ${goal != null ? meter(have, goal) : ''}
        </div>`;
    });
    // Minimums that every course counts toward on top of its own group.
    const also = [];
    const alsoMeter = (name, have, goal, unit) => `
        <div class="m" style="--k: var(--k-faculty)">
          <div class="m-label">${esc(name)}</div>
          <div class="m-val">${goal && have >= goal ? '<span class="ok" aria-label="met">✓</span> ' : ''}${fmt(have)}${goal ? ` / ${goal}` : ''} ${unit}</div>
          ${goal ? meter(have, goal) : ''}
        </div>`;
    if (facultyCat) also.push(alsoMeter(facultyCat.name, a.faculty, facultyCat.minCourses, 'courses'));
    for (const o of overlays) also.push(alsoMeter(o.name, a.split[o.field] || 0, o.ects, 'ECTS'));
    const alsoHtml = also.length
      ? `<div class="also-label">Also counted, on top of the groups above</div><div class="meters also">${also.join('')}</div>` : '';

    const required = cats.find((c) => c.kind === 'required');
    const missing = required ? required.courses.filter((code) => CATALOG[code] && whereIs(code) < 0) : [];
    const missingHtml = required ? `
      <div class="missing">
        <span class="missing-label">${missing.length ? 'Required courses not in your plan yet:' : 'All required courses are in your plan.'}</span>
        ${missing.map((code) => `<button type="button" class="miss" data-code="${esc(code)}" title="${esc(info(code).name)} – add to ${esc(semesterTitle(state.target))}">+ ${esc(code)}</button>`).join('')}
      </div>` : '';

    box.innerHTML = `${head}${orderHtml}<div class="meters">${rows.join('')}</div>${alsoHtml}${missingHtml}${extrasProgress(a)}`;
  }

  // One section per double major / minor: its own groups, its total, and its missing required courses.
  function extrasProgress(a) {
    return extras.map((x) => {
      const xa = allocate(state.plan, x.excl);
      const meters = x.excl.map((cat) => {
        const u = xa.used.get(cat.id);
        const byCredits = cat.su != null;
        const goal = byCredits ? cat.su : cat.minCourses;
        const have = byCredits ? u.su : u.n;
        return `
          <div class="m" style="--k: var(--k-${cat.kind})">
            <div class="m-label"><span class="sw" aria-hidden="true"></span>${esc(cat.name)}</div>
            <div class="m-val">${goal != null && have >= goal ? '<span class="ok" aria-label="met">✓</span> ' : ''}${fmt(have)}${goal != null ? ` / ${goal}` : ''} ${byCredits ? 'SU' : 'courses'}</div>
            ${goal != null ? meter(have, goal) : ''}
          </div>`;
      });
      // A double major's total is the whole plan against major + 30 SU; a minor's is what its groups hold.
      const goal = extraGoal(x);
      const have = x.kind === 'dm' ? a.su : [...xa.used.values()].reduce((t, u) => t + u.su, 0);
      if (goal) {
        meters.push(`
          <div class="m" style="--k: var(--k-faculty)">
            <div class="m-label">${x.kind === 'dm' ? 'Total for both diplomas <small>your major + 30</small>' : 'Minor total'}</div>
            <div class="m-val">${have >= goal ? '<span class="ok" aria-label="met">✓</span> ' : ''}${fmt(have)} / ${goal} SU</div>
            ${meter(have, goal)}
          </div>`);
      }
      const missing = x.excl.filter((c) => c.kind === 'required')
        .flatMap((c) => c.courses).filter((code) => CATALOG[code] && whereIs(code) < 0 && whereIs(baseCode(code)) < 0);
      const note = x.kind === 'dm'
        ? 'Needs your whole major, these groups, 30 SU on top of the major (the total), and a 3.20 GPA.'
        : 'Courses can count toward your major and this minor at the same time here; check SU\'s rules on shared courses.';
      return `
        <div class="extra-prog">
          <div class="extra-title">${esc(x.title)}${x.term !== state.entry ? ` <small>(requirements of ${esc(S.termName(x.term))})</small>` : ''}</div>
          <p class="extra-note">${esc(note)}</p>
          <div class="meters also">${meters.join('')}</div>
          ${missing.length ? `<div class="missing"><span class="missing-label">Required for it, not in your plan yet:</span>
            ${missing.map((code) => `<button type="button" class="miss" data-code="${esc(code)}" title="${esc(info(code).name)} – add to ${esc(semesterTitle(state.target))}">+ ${esc(code)}</button>`).join('')}</div>` : ''}
        </div>`;
    }).join('');
  }

  // ---------- Semesters ----------
  function renderSemesters(a, issues) {
    $('#semesters').innerHTML = state.plan.map((sem, i) => {
      const status = semesterStatus(i);
      let su = 0;
      let ects = 0;
      const items = sem.map((code) => {
        const c = info(code);
        su += c.su; ects += c.ects;
        const cat = a.countedIn.get(code);
        const kind = cat ? cat.kind : 'other';
        if (isSlot(code)) {
          const own = catById(slotCatId(code));
          return `
          <li class="pc slot" draggable="true" data-code="${esc(code)}">
            <span class="tag" style="--k: var(--k-${own ? own.kind : 'other'})"><span class="sw" aria-hidden="true"></span>${esc(shortLabel(own))}</span>
            <span class="pc-body"><span class="pc-code">${esc(c.name)}</span>
              <button type="button" class="slot-pick" data-cat="${esc(own?.id || '')}" title="Show these courses in the list">choose a course</button></span>
            <span class="pc-cr" title="Typical SU credits">${fmt(c.su)}</span>
            <button type="button" class="pc-x" aria-label="Remove this placeholder">×</button>
          </li>`;
        }
        const warn = status === 'now' && !isOffered(code)
          ? `<span class="pc-warn">not offered in ${esc(S.termName(CURRENT_TERM))}</span>` : '';
        const iss = issues.get(code) || { late: [], missing: [] };
        const order = iss.late.map((item) => `<span class="pc-prereq">${esc(lateText(i, item))}</span>`).join('')
          + iss.missing.map((g) => `<span class="pc-missing">Needs ${esc(g.join(' or '))}, not in your plan</span>`).join('');
        return `
          <li class="pc${iss.late.length ? ' late' : ''}" draggable="true" data-code="${esc(code)}">
            <span class="tag" style="--k: var(--k-${kind})"><span class="sw" aria-hidden="true"></span>${esc(shortLabel(cat))}</span>
            <span class="pc-body"><span class="pc-code">${esc(code)}</span> <span class="pc-name">${esc(c.name)}</span>${xtagsHtml(code)}${warn}${order}</span>
            <span class="pc-cr" title="SU credits">${fmt(c.su)}</span>
            <button type="button" class="pc-x" aria-label="Remove ${esc(code)}">×</button>
          </li>`;
      }).join('');
      const target = i === state.target;
      let loadNote = '';
      if (sem.length && su < LOAD_MIN) loadNote = `<span class="load low" title="A normal load is ${LOAD_MIN}–${LOAD_MAX} SU credits">Under ${LOAD_MIN}</span>`;
      else if (su > LOAD_MAX) loadNote = `<span class="load over" title="More than ${LOAD_MAX} SU credits is an overload">Overload</span>`;
      return `
        <article class="sem ${status}${target ? ' target' : ''}" data-sem="${i}">
          <header class="sem-head">
            <button type="button" class="sem-pick" aria-pressed="${target}" title="Add courses from the list to this semester">
              <span class="sem-title">${semesterTitle(i)}</span>
              <span class="sem-term">${S.termName(semesterTerm(i))}${status === 'now' ? ' · this term' : ''}</span>
            </button>
            <span class="sem-cr"><span><b>${fmt(su)}</b> SU · ${fmt(ects)} ECTS</span>${loadNote}</span>
          </header>
          <ul class="sem-list">${items}</ul>
          ${sem.length ? '' : `<p class="sem-empty">${target ? 'Press + next to a course in the list, or drag one here.' : 'Drag courses here, or click this semester to add to it.'}</p>`}
        </article>`;
    }).join('');
  }

  function render() {
    const a = allocate();
    const issues = allIssues();
    renderProgress(a, issues);
    renderSemesters(a, issues);
    updateCatalog();
    return issues;
  }

  // ---------- Actions ----------
  let toastTimer = 0;
  function toast(msg, warn = false) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('warn', warn);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), warn ? 4000 : 2200);
  }

  function addTo(code, i) {
    const from = whereIs(code);
    if (from === i) { toast(`${code} is already in ${semesterTitle(i)}`); return; }
    const lateBefore = lateCodes(allIssues());
    if (from >= 0) state.plan[from] = state.plan[from].filter((c) => c !== code);
    // A course takes the place of a matching elective placeholder in that semester:
    // a double major / minor one first (more specific), then the major's. A course that is
    // required for the major counts there, so it never fills the major's placeholders.
    let replaced = null;
    if (!isSlot(code)) {
      const first = exclusive.find((cat) => inCat(cat, code));
      const majorFits = first && first.kind !== 'required' && first.kind !== 'requirement'
        ? exclusive.filter((cat) => inCat(cat, code)) : [];
      const extraFits = extras.flatMap((x) => x.excl).filter((cat) => cat.kind !== 'required' && cat.kind !== 'requirement' && inCat(cat, code));
      const order = [...extraFits, ...majorFits].map((cat) => cat.id);
      replaced = state.plan[i].filter((t) => isSlot(t) && order.includes(slotCatId(t)))
        .sort((x, y) => order.indexOf(slotCatId(x)) - order.indexOf(slotCatId(y)))[0] || null;
      if (replaced) state.plan[i] = state.plan[i].filter((t) => t !== replaced);
      // The group filter has done its job once no placeholder of that group is left.
      if (replaced && state.onlyCat && !state.plan.flat().some((t) => isSlot(t) && slotCatId(t) === state.onlyCat)) state.onlyCat = '';
    }
    state.plan[i].push(code);
    savePlan();
    const issues = render();
    const label = isSlot(code) ? info(code).name : code;
    const slotLabel = replaced ? info(replaced).name : '';
    const article = /^[AEIOU]/i.test(slotLabel) ? 'an' : 'a';
    const done = `${from >= 0 ? 'Moved' : 'Added'} ${label} to ${semesterTitle(i)}${replaced ? ` in place of ${article} ${slotLabel} placeholder` : ''}`;
    // Warn about this course, or about a course this move left before its prerequisite.
    const own = issues.get(code).late[0];
    const broken = [...lateCodes(issues)].find((c) => c !== code && !lateBefore.has(c));
    if (own) toast(`${done} · ⚠ needs ${own.group.join(' or ')} first`, true);
    else if (broken) toast(`${done} · ⚠ ${broken} is now before its prerequisite`, true);
    else toast(done);
  }

  function remove(code) {
    const from = whereIs(code);
    if (from < 0) return;
    state.plan[from] = state.plan[from].filter((c) => c !== code);
    savePlan();
    render();
  }

  function setTarget(i) {
    if (state.target === i) return;
    state.target = i;
    render();
  }

  // fromUser: the student changed a picker. firstVisit: no plan was ever saved.
  function setPicks(program, entry, { fromUser = false, firstVisit = false } = {}) {
    const before = state.program;
    const r = S.resolvePicks(program, entry);
    state.program = r.program;
    state.entry = r.entry;
    state.years = r.years;
    cats = state.program ? S.sortedCategories(state.program, state.entry) : null;
    exclusive = cats ? cats.filter((c) => c.kind !== 'faculty') : [];
    facultyCat = cats ? cats.find((c) => c.kind === 'faculty') || null : null;
    overlays = state.program ? S.overlaysFor(state.program, state.entry) : [];

    const prog = $('#program');
    prog.value = state.program;
    prog.classList.toggle('unset', !state.program);
    const entrySel = $('#entry');
    entrySel.innerHTML = r.years.map((t) => `<option value="${esc(t.term)}">${esc(t.termName)}</option>`).join('');
    entrySel.value = state.entry;
    $('#entry-row').hidden = !r.years.length;
    loadExtras();
    S.mountExtras($('#extras'), state.program, extrasChanged);

    // Start on the current term if it falls inside the plan.
    const now = Array.from({ length: SEMESTERS }, (_, i) => i).find((i) => semesterStatus(i) === 'now');
    if (now != null && !state.plan[state.target]?.length) state.target = now;

    renderCatalog();
    render();
    catalogEl.scrollTop = 0;

    // Picking a major shows a suggested plan: straight away when the plan is empty,
    // after asking when it would replace courses already planned.
    if (!cats) return;
    const empty = !state.plan.some((s) => s.length);
    if (empty && (fromUser || firstVisit)) applySuggestion();
    else if (!empty && fromUser && state.program !== before) askSuggestion();
  }

  // A double major or minor was added or removed: update tags and meters, then offer a
  // suggested plan that includes it.
  function extrasChanged() {
    loadExtras();
    state.onlyCat = '';
    renderCatalog();
    render();
    if (!cats) return;
    if (state.plan.some((s) => s.length)) askSuggestion(); else applySuggestion();
  }

  // "choose a course" on a placeholder: aim at its semester and list only its group's courses.
  function choosePlaceholder(catId, i) {
    setTarget(i);
    document.body.classList.remove('menu-hidden');
    if ($('#search').value) { $('#search').value = ''; state.query = ''; }
    state.onlyCat = catById(catId) ? catId : '';
    updateCatalog();
    catalogEl.scrollTop = 0;
    const cat = catById(catId);
    toast(`Pick ${cat ? `a course from ${cat.name}` : 'a course'}: it replaces the placeholder in ${semesterTitle(i)}`);
  }

  // ---------- Events ----------
  function bindEvents() {
    $('#program').addEventListener('change', (e) => setPicks(e.target.value, state.entry, { fromUser: true }));
    $('#entry').addEventListener('change', (e) => setPicks(state.program, e.target.value, { fromUser: true }));
    $('#suggest-btn').addEventListener('click', () => {
      if (!cats) { toast('Choose your program first.'); return; }
      if (state.plan.some((s) => s.length)) askSuggestion(); else applySuggestion();
    });
    // Dialog buttons act on submit (the dialog's own "close" event isn't fired reliably everywhere).
    $('#suggest-dialog form').addEventListener('submit', (e) => {
      if (e.submitter?.value === 'suggest') applySuggestion();
    });
    $('#search').addEventListener('input', (e) => { state.query = fold(e.target.value); updateCatalog(); });
    $('#menu-toggle').addEventListener('click', () => document.body.classList.toggle('menu-hidden'));
    $('#print-btn').addEventListener('click', () => window.print());
    $('#clear-btn').addEventListener('click', () => {
      if (!state.plan.some((s) => s.length)) { toast('Your plan is already empty.'); return; }
      $('#clear-dialog').showModal();
    });
    $('#clear-dialog form').addEventListener('submit', (e) => {
      if (e.submitter?.value !== 'clear') return;
      state.plan = Array.from({ length: SEMESTERS }, () => []);
      savePlan();
      render();
      toast('Plan cleared');
    });

    catalogEl.addEventListener('click', (e) => {
      const add = e.target.closest('.cc-add');
      if (add) addTo(add.closest('.cc').dataset.code, state.target);
    });

    $('#progress').addEventListener('click', (e) => {
      const lateChip = e.target.closest('.late-chip');
      if (lateChip) {
        const row = document.querySelector(`.pc[data-code="${CSS.escape(lateChip.dataset.code)}"]`);
        row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        row?.classList.remove('flash');
        void row?.offsetWidth; // restart the animation
        row?.classList.add('flash');
        return;
      }
      const miss = e.target.closest('.miss');
      if (miss) addTo(miss.dataset.code, state.target);
    });

    const semesters = $('#semesters');
    semesters.addEventListener('click', (e) => {
      const x = e.target.closest('.pc-x');
      if (x) { remove(x.closest('.pc').dataset.code); return; }
      const sem = e.target.closest('.sem');
      const pick = e.target.closest('.slot-pick');
      if (pick && sem) { choosePlaceholder(pick.dataset.cat, Number(sem.dataset.sem)); return; }
      if (sem) setTarget(Number(sem.dataset.sem));
    });

    // Drag and drop: from the list or between semesters; drop back on the list to remove.
    document.addEventListener('dragstart', (e) => {
      const item = e.target.closest?.('.cc, .pc');
      if (!item) return;
      e.dataTransfer.setData('text/plain', item.dataset.code);
      e.dataTransfer.setData('application/x-from', item.classList.contains('pc') ? 'plan' : 'list');
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });
    document.addEventListener('dragend', () => {
      for (const el of document.querySelectorAll('.dragging, .drop-over')) el.classList.remove('dragging', 'drop-over');
    });
    semesters.addEventListener('dragover', (e) => {
      const sem = e.target.closest('.sem');
      if (!sem) return;
      e.preventDefault();
      for (const el of semesters.querySelectorAll('.drop-over')) if (el !== sem) el.classList.remove('drop-over');
      sem.classList.add('drop-over');
    });
    semesters.addEventListener('dragleave', (e) => {
      const sem = e.target.closest('.sem');
      if (sem && !sem.contains(e.relatedTarget)) sem.classList.remove('drop-over');
    });
    semesters.addEventListener('drop', (e) => {
      const sem = e.target.closest('.sem');
      const code = e.dataTransfer.getData('text/plain');
      if (!sem || !code) return;
      e.preventDefault();
      addTo(code, Number(sem.dataset.sem));
    });
    const sidebar = $('#sidebar');
    sidebar.addEventListener('dragover', (e) => {
      if ([...e.dataTransfer.types].includes('application/x-from')) e.preventDefault();
    });
    sidebar.addEventListener('drop', (e) => {
      if (e.dataTransfer.getData('application/x-from') !== 'plan') return;
      e.preventDefault();
      remove(e.dataTransfer.getData('text/plain'));
    });

    // "Show all" after "choose a course" on a placeholder.
    $('#target-note').addEventListener('click', (e) => {
      if (e.target.closest('.clear-only')) { state.onlyCat = ''; updateCatalog(); }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      if ($('#search').value || state.onlyCat) {
        $('#search').value = '';
        state.query = '';
        state.onlyCat = '';
        updateCatalog();
      }
    });
  }

  // ---------- Start ----------
  S.fillProgramOptions($('#program'));
  const hadPlan = loadPlan();
  bindEvents();
  const picks = S.readPicks();
  setPicks(picks.program, picks.entry, { firstVisit: !hadPlan });
})();
