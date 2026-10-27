/* Helpers shared by the weekly schedule (app.js) and the 4-year plan (plan.js).
   Load after data/requirements.js and js/programs.js. */
window.SUShared = (() => {
  'use strict';

  const REQUIREMENTS = window.SU_REQUIREMENTS || { terms: [], pools: [], programs: {}, catalog: {} };
  REQUIREMENTS.doubleMajors ||= {};
  REQUIREMENTS.minors ||= {};
  const PROGRAMS = window.SU_PROGRAMS || { faculties: [] };
  const KEYS = {
    program: 'su-planner:program', entry: 'su-planner:entry', plan: 'su-planner:plan',
    dm: 'su-planner:dm', minors: 'su-planner:minors',
  };
  const SEASONS = { '01': 'Fall', '02': 'Spring', '03': 'Summer' };

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  // Search text ignores spaces, case and accents: "cs201" finds "CS 201", "gul" finds "Gül".
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i').replace(/\s+/g, '').toUpperCase();
  // Requirement pages sometimes add a letter ("CIP 101N") to a course offered as "CIP 101".
  const baseCode = (code) => code.replace(/[A-Z]+$/, '');

  // Codes that are really another course (PROJ 302 isn't a separate class: it is PROJ 201).
  // Saved plans from before this was known are converted when they load.
  const ALIASES = { 'PROJ 302': 'PROJ 201' };
  const canonicalCode = (code) => ALIASES[code] || code;

  // Summer courses: x95 internships (CS 395, IE 395…) and courses SU names "Summer Internship"
  // (MGMT 300, PROJ 303). They don't run in Fall or Spring. "Summer Project" courses such as
  // PROJ 302 are taken during the regular semesters, like PROJ 201.
  const isSummerCourse = (code) => / 395[A-Z]?$/.test(code)
    || /\bsummer internship\b/i.test(REQUIREMENTS.catalog?.[code]?.[0] || '');
  // PROJ courses (PROJ 201, PROJ 302…) run in the semester, with meeting times arranged after you register.
  const isArrangedCourse = (code) => code.startsWith('PROJ ') && !isSummerCourse(code);

  const programById = new Map();
  for (const f of PROGRAMS.faculties) for (const p of f.programs) programById.set(p.id, { ...p, faculty: f });

  // A key is a degree program id ('cs'), or a double major / minor's SU code ('BAECON-DM', 'FIN-MINOR').
  const sourceOf = (key) => REQUIREMENTS.programs[key] || REQUIREMENTS.doubleMajors[key] || REQUIREMENTS.minors[key] || null;

  // Entry years (admit terms, newest first) that have requirements for a program.
  const termsFor = (key) => REQUIREMENTS.terms.filter((t) => sourceOf(key)?.terms?.[t.term]);

  function requirementsFor(key, term) {
    const cats = sourceOf(key)?.terms?.[term];
    return cats ? cats.map((c) => ({ ...c, courses: REQUIREMENTS.pools[c.pool] || [] })) : null;
  }

  const totalsFor = (key, term) => sourceOf(key)?.totals?.[term] || {};
  // ECTS minimums counted on top of the categories, e.g. Engineering 90, Basic Science 60.
  const overlaysFor = (key, term) => sourceOf(key)?.overlays?.[term] || [];

  // What kind of requirement a category is, from its name on SU's pages.
  function categoryKind(cat) {
    const n = cat.name.toLowerCase();
    if (n.startsWith('required')) return 'required';
    if (n.includes('requirement')) return 'requirement'; // e.g. "Mathematics Requirement Courses"
    if (n.includes('core')) return 'core';
    if (n.includes('area')) return 'area';
    if (n.includes('university')) return 'university';
    if (n.includes('faculty')) return 'faculty';
    if (n.includes('free')) return 'free';
    return 'other';
  }
  const KIND_ORDER = ['required', 'requirement', 'core', 'area', 'university', 'faculty', 'free', 'other'];
  // Display order of requirement categories: the program's own courses first.
  const categoryRank = (cat) => KIND_ORDER.indexOf(categoryKind(cat));

  function minLabel(cat) {
    if (cat.su) return `min ${cat.su} SU credits`;
    if (cat.minCourses) return `min ${cat.minCourses} courses`;
    return '';
  }

  // Requirement categories in display order, each with a lookup set of its course codes.
  function sortedCategories(pid, term) {
    const req = requirementsFor(pid, term);
    if (!req) return null;
    return req
      .map((cat, i) => ({ ...cat, i, rank: categoryRank(cat), kind: categoryKind(cat), set: new Set(cat.courses.flatMap((c) => [c, baseCode(c)])) }))
      .sort((a, b) => a.rank - b.rank || a.i - b.i);
  }

  // '202402' -> 'Spring 2024-2025'
  function termName(term) {
    const year = Number(term.slice(0, 4));
    return `${SEASONS[term.slice(4)] || 'Term'} ${year}-${year + 1}`;
  }

  function fillProgramOptions(select) {
    select.innerHTML = '<option value="">Choose your program…</option>'
      + PROGRAMS.faculties.map((f) => `<optgroup label="${esc(f.name)}">`
        + f.programs.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')
        + '</optgroup>').join('');
  }

  function readPicks() {
    try {
      return { program: localStorage.getItem(KEYS.program) || '', entry: localStorage.getItem(KEYS.entry) || '' };
    } catch {
      return { program: '', entry: '' };
    }
  }

  // Program and entry year are picked together: a year only counts if that program has
  // requirements for it, otherwise the newest available year is used.
  function resolvePicks(program, entry) {
    const pid = programById.has(program) ? program : '';
    const years = pid ? termsFor(pid) : REQUIREMENTS.terms;
    const term = years.some((t) => t.term === entry) ? entry : (years[0]?.term || '');
    try {
      localStorage.setItem(KEYS.program, pid);
      localStorage.setItem(KEYS.entry, term);
    } catch { /* not saved */ }
    return { program: pid, entry: term, years };
  }

  // ---------- Double major and minors ----------
  function readExtras() {
    try {
      const dm = localStorage.getItem(KEYS.dm) || '';
      const minors = JSON.parse(localStorage.getItem(KEYS.minors) || '[]');
      return {
        dm: REQUIREMENTS.doubleMajors[dm] ? dm : '',
        minors: Array.isArray(minors) ? minors.filter((m) => REQUIREMENTS.minors[m]) : [],
      };
    } catch {
      return { dm: '', minors: [] };
    }
  }

  function saveExtras(extras) {
    try {
      localStorage.setItem(KEYS.dm, extras.dm || '');
      localStorage.setItem(KEYS.minors, JSON.stringify(extras.minors || []));
    } catch { /* not saved */ }
  }

  // "Political Science and International Relations" -> "PSIR"; short names stay as they are.
  const initials = (name) => (name.length <= 20 ? name : name.split(/[\s,&]+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join(''));

  // The double major and minors picked, each with its categories for the student's entry
  // year (or the newest year it has, when it didn't exist yet back then).
  function extraPrograms(entry) {
    const { dm, minors } = readExtras();
    const keys = [...(dm ? [[dm, 'dm']] : []), ...minors.map((m) => [m, 'minor'])];
    return keys.map(([key, kind]) => {
      const src = sourceOf(key);
      const term = src.terms[entry] ? entry : (termsFor(key)[0]?.term || '');
      const short = kind === 'dm' ? `${initials(src.name)} DM` : `${initials(src.name)} minor`;
      const cats = (sortedCategories(key, term) || []).map((c) => ({ ...c, extra: { key, kind, short } }));
      return {
        key, kind, term, short, cats,
        name: src.name,
        title: kind === 'dm' ? `Double major: ${src.name}` : `Minor: ${src.name}`,
        totals: totalsFor(key, term),
      };
    }).filter((x) => x.cats.length);
  }

  // Course code -> short labels of the double major / minors whose own requirements
  // (required, core or area) list it. University, faculty and free pools are left out:
  // they hold almost every course.
  function extraTagsFor(extras) {
    const tags = new Map();
    for (const x of extras) {
      for (const cat of x.cats) {
        if (!['required', 'requirement', 'core', 'area'].includes(cat.kind)) continue;
        for (const code of cat.courses) {
          for (const k of [code, baseCode(code)]) {
            const list = tags.get(k) || [];
            if (!list.includes(x.short)) list.push(x.short);
            tags.set(k, list);
          }
        }
      }
    }
    return tags;
  }

  // The "Double major & minors" box in a page's side panel. onChange runs after a change.
  function mountExtras(box, programId, onChange) {
    const programName = programById.get(programId)?.name || '';
    const { dm, minors } = readExtras();
    const sortByName = (a, b) => a[1].name.localeCompare(b[1].name);
    const dmOptions = Object.entries(REQUIREMENTS.doubleMajors).sort(sortByName)
      .filter(([, p]) => p.name !== programName) // not your own major
      .map(([code, p]) => `<option value="${esc(code)}"${code === dm ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
    const minorOptions = Object.entries(REQUIREMENTS.minors).sort(sortByName)
      .filter(([code]) => !minors.includes(code))
      .map(([code, p]) => `<option value="${esc(code)}">${esc(p.name)}</option>`).join('');
    const picked = [dm && `${REQUIREMENTS.doubleMajors[dm].name} (DM)`, ...minors.map((m) => REQUIREMENTS.minors[m].name)].filter(Boolean);

    box.hidden = !programId || !Object.keys(REQUIREMENTS.doubleMajors).length;
    box.innerHTML = `
      <details class="extras"${picked.length || box.dataset.open ? ' open' : ''}>
        <summary><span>Double major &amp; minors</span><span class="extras-sum">${esc(picked.join(' · ') || 'none')}</span></summary>
        <label class="extra-row"><span>Double major</span>
          <select class="dm-select" aria-label="Double major"><option value="">None</option>${dmOptions}</select></label>
        <label class="extra-row"><span>Minors</span>
          <select class="minor-add" aria-label="Add a minor"><option value="">Add a minor…</option>${minorOptions}</select></label>
        <div class="minor-chips">${minors.map((m) => `<span class="xchip">${esc(REQUIREMENTS.minors[m].name)}<button type="button" data-remove="${esc(m)}" aria-label="Remove ${esc(REQUIREMENTS.minors[m].name)} minor">×</button></span>`).join('')}</div>
      </details>`;

    const details = box.querySelector('details');
    details.addEventListener('toggle', () => { box.dataset.open = details.open ? '1' : ''; });
    const changed = (next) => { saveExtras(next); mountExtras(box, programId, onChange); onChange(); };
    box.querySelector('.dm-select').addEventListener('change', (e) => changed({ dm: e.target.value, minors }));
    box.querySelector('.minor-add').addEventListener('change', (e) => {
      if (e.target.value) changed({ dm, minors: [...minors, e.target.value] });
    });
    box.querySelector('.minor-chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove]');
      if (b) changed({ dm, minors: minors.filter((m) => m !== b.dataset.remove) });
    });
  }

  return {
    REQUIREMENTS, PROGRAMS, KEYS, esc, fold, baseCode, canonicalCode, isSummerCourse, isArrangedCourse, programById, termsFor, requirementsFor,
    totalsFor, overlaysFor, categoryKind, categoryRank, minLabel, sortedCategories, termName,
    fillProgramOptions, readPicks, resolvePicks, readExtras, extraPrograms, extraTagsFor, mountExtras,
  };
})();
