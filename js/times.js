/* Class times for planning: which sections a course has in Fall and in Spring, and a
   solver that picks sections so a semester's courses don't overlap.
   Fall = data/courses.js (this Fall), Spring = data/schedule-<YYYY>02.js (newest Spring).
   When no Spring schedule is loaded, Spring uses the Fall times.
   Load after data files and js/shared.js. */
window.SUTimes = (() => {
  'use strict';

  const S = window.SUShared;
  const ROWS = 13; // hourly rows 08:40 … 20:40 (some evening classes end after 19:30)
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const pad = (n) => String(n).padStart(2, '0');

  function index(data) {
    if (!data?.courses) return null;
    const byCode = new Map();
    for (const c of data.courses) {
      byCode.set(c.code, {
        code: c.code,
        name: c.name,
        groups: c.classes.map((cl) => ({
          type: cl.type,
          sections: cl.sections.map((s) => {
            const meetings = s.schedule.map((m) => ({ day: m.day, start: m.start, dur: m.duration, place: data.places[m.place] || '' }));
            const slots = [];
            for (const m of meetings) {
              if (m.start < 0 || m.day < 0 || m.day > 4) continue;
              for (let k = 0; k < m.dur && m.start + k < ROWS; k++) slots.push(m.day * ROWS + m.start + k);
            }
            return { crn: String(s.crn), group: s.group, instructor: data.instructors[s.instructors] || 'TBA', meetings, slots };
          }),
        })),
      });
    }
    const year = Number(String(data.term || '').slice(0, 4));
    return { term: data.term, termName: data.termName || S.termName(data.term), byCode, year };
  }

  const fall = index(window.COURSE_DATA);
  const springKey = Object.keys(window.SU_SCHEDULES || {}).filter((t) => t.endsWith('02')).sort().pop();
  const spring = springKey ? index(window.SU_SCHEDULES[springKey]) : null;

  // The schedule to use for a semester of the plan ('202702' -> Spring times).
  // `assumed` = Spring with no Spring schedule loaded, so Fall times stand in.
  function sourceFor(term) {
    if (term.endsWith('02')) return spring ? { ...spring, assumed: false } : (fall && { ...fall, assumed: true });
    if (term.endsWith('01')) return fall && { ...fall, assumed: false };
    return null;
  }

  const lookup = (src, code) => src?.byCode.get(code) || src?.byCode.get(S.baseCode(code)) || null;

  function timeLabel(m) {
    if (m.start < 0 || m.day < 0 || m.day > 4) return 'TBA';
    return `${DAYS[m.day]} ${pad(8 + m.start)}:40–${pad(8 + m.start + m.dur)}:30`;
  }

  // Pick one section per course group (lecture, recitation, lab…) so as few class hours
  // as possible overlap. Branch and bound: groups with fewest options first, cheapest
  // options first, stop at the first clash-free choice. `pins` fixes chosen sections:
  // Map "CODE|type" -> crn.
  function solve(courses, pins = new Map(), limit = 60000) {
    const vars = [];
    for (const c of courses) {
      for (const g of c.groups) {
        let options = g.sections;
        const pinned = pins.get(`${c.code}|${g.type}`);
        if (pinned) options = options.filter((s) => s.crn === pinned).length ? options.filter((s) => s.crn === pinned) : options;
        vars.push({ code: c.code, base: c.base || c.code, type: g.type, options });
      }
    }
    vars.sort((a, b) => a.options.length - b.options.length);
    const occ = new Map();
    const choice = new Array(vars.length);
    let best = null;
    let bestCost = Infinity;
    let nodes = 0;
    const cost = (s) => s.slots.reduce((t, x) => t + (occ.get(x) || 0), 0);
    const step = (i, total) => {
      if (total >= bestCost || nodes++ > limit) return;
      if (i === vars.length) { bestCost = total; best = choice.slice(); return; }
      const ranked = vars[i].options.map((s) => [s, cost(s)]).sort((a, b) => a[1] - b[1]);
      for (const [s, add] of ranked) {
        if (total + add >= bestCost) break;
        for (const x of s.slots) occ.set(x, (occ.get(x) || 0) + 1);
        choice[i] = s;
        step(i + 1, total + add);
        for (const x of s.slots) occ.set(x, occ.get(x) - 1);
        if (bestCost === 0) return;
      }
    };
    step(0, 0);
    const picks = vars.map((v, i) => ({ code: v.code, base: v.base, type: v.type, section: best ? best[i] : v.options[0] }));
    return { cost: best ? bestCost : 0, picks };
  }

  // ---------- Every clash-free timetable (docs/schedule-model.md) ----------
  // Feasibility model, no objective: x_s = 1 if section s is taken;
  //   (1) exactly one section of every course component (lecture, recitation, lab…),
  //   (2) at most one taken section in every weekly hour slot,
  //   (3) sections the student picked are fixed to 1,
  //   (5) optional: no taken section meets in hours the student wants free (a day off, no 08:40).
  // ((4) in the document is "x is binary".) Every x that satisfies them is a valid timetable,
  // and all of them are listed.
  // Sections of one component that meet at exactly the same hours give the same timetable,
  // so they are merged into one option (e.g. DSA 201 R A1 / A2).
  const MAX_ALTS = 2000;
  const WORDS = Math.ceil((DAYS.length * ROWS) / 32); // 65 hour slots -> 3 words of 32 bits

  function maskOf(slots) {
    const m = new Array(WORDS).fill(0);
    for (const x of slots) m[x >> 5] |= 1 << (x & 31);
    return m;
  }

  // Variables and their domains: one per course component, options = its time options.
  function buildModel(courses, pins) {
    const vars = [];
    for (const c of courses) {
      for (const g of c.groups) {
        if (!g.sections.length) continue;
        const byTime = new Map();
        for (const s of g.sections) {
          const key = [...new Set(s.slots)].sort((a, b) => a - b).join(',');
          if (!byTime.has(key)) byTime.set(key, { mask: maskOf(s.slots), sections: [] });
          byTime.get(key).sections.push(s);
        }
        let options = [...byTime.values()];
        const pinned = g.sections.find((s) => s.crn === pins.get(`${c.code}|${g.type}`));
        if (pinned) options = [{ mask: maskOf(pinned.slots), sections: [pinned] }]; // (3) fixed by the student
        vars.push({ code: c.code, base: c.base || c.code, type: g.type, options, size: pinned ? 1 : g.sections.length });
      }
    }
    return vars;
  }

  // Depth-first search with backtracking. At each step it takes the component with the
  // fewest options still free (fail first) and stops a branch as soon as any component has
  // none left (forward checking), so dead ends are cut early.
  function alternatives(courses, pins = new Map(), { max = MAX_ALTS, nodeLimit = 400000, blocked = [] } = {}) {
    const vars = buildModel(courses, pins);
    const n = vars.length;
    // Hours to keep free (5) start out taken, so no section meeting then can be placed.
    const occ = maskOf(blocked);
    const free = (o) => o.mask.every((w, k) => (w & occ[k]) === 0);
    const used = new Array(n).fill(false);
    const choice = new Array(n);
    const solutions = [];
    let nodes = 0;
    let complete = true;

    const dfs = (depth) => {
      if (solutions.length >= max || nodes >= nodeLimit) { complete = false; return; }
      nodes++;
      if (depth === n) { solutions.push(choice.slice()); return; }
      let next = -1;
      let live = null;
      for (let v = 0; v < n; v++) {
        if (used[v]) continue;
        const ok = vars[v].options.filter(free);
        if (!ok.length) return; // a component can't be placed any more: dead end
        if (!live || ok.length < live.length) { next = v; live = ok; }
      }
      used[next] = true;
      for (const o of live) {
        o.mask.forEach((w, k) => { occ[k] |= w; });
        choice[next] = o;
        dfs(depth + 1);
        o.mask.forEach((w, k) => { occ[k] &= ~w; });
        if (!complete) break;
      }
      used[next] = false;
    };
    dfs(0);

    const toPicks = (sol) => vars.map((v, k) => ({
      code: v.code, base: v.base, type: v.type, section: sol[k].sections[0], same: sol[k].sections.slice(1),
    }));
    return {
      list: solutions.map(toPicks),
      complete, // false = stopped at `max` timetables (or the node limit), there may be more
      nodes,
      // Search space size: section combinations before the constraints, and how many satisfy them.
      combinations: vars.reduce((t, v) => t * v.size, 1),
      feasibleCombinations: solutions.reduce((t, sol) => t + sol.reduce((p, o) => p * o.sections.length, 1), 0),
    };
  }

  // Course pairs that share at least one class hour in a set of picks.
  function clashes(picks) {
    const at = new Map();
    for (const p of picks) for (const x of p.section?.slots || []) at.set(x, [...(at.get(x) || []), p.code]);
    const pairs = new Map();
    for (const [slot, codes] of at) {
      if (codes.length < 2) continue;
      const uniq = [...new Set(codes)].sort();
      for (let a = 0; a < uniq.length; a++) {
        for (let b = a + 1; b < uniq.length; b++) {
          const key = `${uniq[a]}|${uniq[b]}`;
          pairs.set(key, [...(pairs.get(key) || []), slot]);
        }
      }
      if (uniq.length === 1) pairs.set(`${uniq[0]}|${uniq[0]}`, [...(pairs.get(`${uniq[0]}|${uniq[0]}`) || []), slot]); // its own lecture vs recitation
    }
    return [...pairs].map(([key, slots]) => {
      const [a, b] = key.split('|');
      return { a, b, slots, when: slots.map((x) => `${DAYS[Math.floor(x / ROWS)]} ${pad(8 + (x % ROWS))}:40`) };
    });
  }

  // The search runs again on every render, so results are kept per semester content.
  const altCache = new Map();
  function cachedAlternatives(term, timed, pins, max, blocked) {
    const key = JSON.stringify([term, timed.map((c) => c.code), [...pins].sort(), max, blocked]);
    if (!altCache.has(key)) {
      if (altCache.size > 60) altCache.delete(altCache.keys().next().value);
      altCache.set(key, alternatives(timed, pins, { max, blocked }));
    }
    return altCache.get(key);
  }

  // Everything the plan needs to know about one semester's real courses (placeholders skipped).
  // `alt` = which clash-free timetable to show; `max` = how many to look for (1 = just check);
  // `blocked` = hour slots to keep free.
  function checkSemester(codes, term, pins = new Map(), { alt = 0, max = MAX_ALTS, blocked = [] } = {}) {
    const src = sourceFor(term);
    // PROJ courses get times after registration; summer courses don't run in Fall/Spring.
    const arranged = codes.filter((c) => !c.startsWith('~') && S.isArrangedCourse(c));
    const summer = codes.filter((c) => !c.startsWith('~') && S.isSummerCourse(c));
    const real = codes.filter((c) => !c.startsWith('~') && !arranged.includes(c) && !summer.includes(c));
    const none = { list: [], complete: true, nodes: 0, combinations: 0, feasibleCombinations: 0 };
    if (!src) return { src: null, timed: [], missing: real, tba: [], arranged, summer, cost: 0, picks: [], pairs: [], alts: none, alt: 0 };
    const timed = [];
    const missing = [];
    const tba = [];
    for (const code of real) {
      const c = lookup(src, code);
      if (!c) { missing.push(code); continue; }
      timed.push({ ...c, code, base: c.code }); // code = as planned ("CIP 101N"), base = as scheduled ("CIP 101")
      if (c.groups.every((g) => g.sections.every((s) => !s.slots.length))) tba.push(code);
    }
    const alts = cachedAlternatives(term, timed, pins, max, blocked);
    if (alts.list.length) {
      const k = Math.min(Math.max(0, alt), alts.list.length - 1);
      return { src, timed, missing, tba, arranged, summer, cost: 0, picks: alts.list[k], pairs: [], alts, alt: k };
    }
    // No clash-free timetable: show the choice with the fewest overlapping hours, to say what clashes.
    const { cost, picks } = solve(timed, pins);
    return { src, timed, missing, tba, arranged, summer, cost, picks, pairs: clashes(picks), alts, alt: 0 };
  }

  // Would `code` fit into a semester that already holds `codes` without any time clash?
  function fits(code, codes, term) {
    const src = sourceFor(term);
    if (!src) return true;
    const timedOnly = (c) => !c.startsWith('~') && !S.isArrangedCourse(c) && !S.isSummerCourse(c);
    const list = [...codes, code].filter(timedOnly).map((c) => lookup(src, c) && { ...lookup(src, c), code: c }).filter(Boolean);
    return solve(list, new Map(), 20000).cost === 0;
  }

  // Is the course on that season's schedule? (null = we can't tell: no data for either season.)
  function offeredIn(code, term) {
    if (S.isArrangedCourse(code) || S.isSummerCourse(code)) return null; // not on the Fall/Spring timetable by nature
    const src = sourceFor(term);
    if (!src) return null;
    if (lookup(src, code)) return true;
    const other = term.endsWith('01') ? spring : fall;
    return lookup(other, code) ? false : null;
  }

  return { ROWS, DAYS, MAX_ALTS, fall, spring, sourceFor, lookup, timeLabel, solve, alternatives, clashes, checkSemester, fits, offeredIn };
})();
