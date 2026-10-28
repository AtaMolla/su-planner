/* Semester times: each semester of the 4-year plan on a weekly timetable, with sections
   picked so its courses don't overlap. Uses js/times.js for the schedules and the solver. */
(() => {
  'use strict';

  const S = window.SUShared;
  const T = window.SUTimes;
  const { esc } = S;
  const SEMESTERS = 8;
  const PINS_KEY = 'su-planner:times-pins';
  const PALETTE = [
    '#2f6fb5', '#8e5a9b', '#c2571a', '#2b8a6e', '#a23b5a', '#5a6acf', '#7a6a2e',
    '#1f7a8c', '#b8456b', '#5b8c3a', '#6d4fb3', '#9c5b2e', '#33658a', '#8b3f8f',
  ];
  const $ = (sel) => document.querySelector(sel);
  const pad = (n) => String(n).padStart(2, '0');
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const CATALOG = S.REQUIREMENTS.catalog || {};

  // alt: which clash-free timetable is shown, per semester (not saved: "Keep this one" saves picks).
  const state = { program: '', entry: '', plan: [], sel: 0, pins: {}, alt: {} };

  // ---------- Saved data ----------
  function loadPlan() {
    try {
      const saved = JSON.parse(localStorage.getItem(S.KEYS.plan) || 'null');
      const seen = new Set();
      state.plan = Array.from({ length: SEMESTERS }, (_, i) => (saved?.semesters?.[i] || [])
        .filter((c) => typeof c === 'string').map(S.canonicalCode) // an old "PROJ 302" is PROJ 201
        .filter((c) => !seen.has(c) && seen.add(c)));
    } catch {
      state.plan = Array.from({ length: SEMESTERS }, () => []);
    }
  }
  function loadPins() {
    try { state.pins = JSON.parse(localStorage.getItem(PINS_KEY) || '{}') || {}; } catch { state.pins = {}; }
  }
  function savePins() {
    try { localStorage.setItem(PINS_KEY, JSON.stringify(state.pins)); } catch { /* not saved */ }
  }
  const pinsFor = (i) => new Map(Object.entries(state.pins[i] || {}));

  // ---------- Semesters ----------
  function semesterTerm(i) {
    const start = state.entry || T.fall?.term || '202601';
    return `${Number(start.slice(0, 4)) + Math.floor(i / 2)}${i % 2 ? '02' : '01'}`;
  }
  const semesterTitle = (i) => `Year ${Math.floor(i / 2) + 1} · ${i % 2 ? 'Spring' : 'Fall'}`;
  const realCodes = (i) => state.plan[i].filter((c) => !c.startsWith('~'));
  const check = (i, pins = pinsFor(i), opts = { alt: state.alt[i] || 0 }) => T.checkSemester(state.plan[i], semesterTerm(i), pins, opts);
  const hasTimes = (r) => r.timed.some((c) => c.groups.some((g) => g.sections.some((s) => s.slots.length)));

  function renderSemList() {
    $('#sem-list').innerHTML = state.plan.map((sem, i) => {
      const n = realCodes(i).length;
      let badge = '<span class="sb empty">empty</span>';
      if (n) {
        const r = check(i, pinsFor(i), { max: 1 }); // the badge only needs to know if one timetable works
        if (r.pairs.length) badge = `<span class="sb bad">${plural(r.pairs.length, 'clash')}</span>`;
        else if (r.missing.length) badge = `<span class="sb warn">${r.missing.length} not on schedule</span>`;
        else badge = '<span class="sb ok">fits</span>';
      }
      return `<button type="button" class="sem-tab${i === state.sel ? ' on' : ''}" role="tab" aria-selected="${i === state.sel}" data-sem="${i}">
          <span><b>${semesterTitle(i)}</b><small>${esc(S.termName(semesterTerm(i)))} · ${plural(n, 'course')}</small></span>${badge}</button>`;
    }).join('');
  }

  // ---------- The selected semester ----------
  function render() {
    renderSemList();
    const i = state.sel;
    const term = semesterTerm(i);
    const r = check(i);
    const colorOf = new Map(realCodes(i).map((code, k) => [code, PALETTE[k % PALETTE.length]]));
    const slotsCount = state.plan[i].length - realCodes(i).length;

    // Header
    const src = r.src;
    $('#tt-head').innerHTML = `
      <h2>${semesterTitle(i)} <small>${esc(S.termName(term))}</small></h2>
      <p class="tt-src">${src
        ? `Class times from <b>${esc(src.termName)}</b>${src.assumed ? ' (no Spring schedule loaded, so Fall times are used)' : ''}, the latest ${term.endsWith('02') ? 'Spring' : 'Fall'} schedule SU has published. Future years may differ a little.`
        : 'No timetable for this kind of term.'}</p>`;

    // Notes: clashes, courses not on the schedule, no fixed time, placeholders.
    const notes = [];
    if (!state.plan[i].length) {
      notes.push(`<p class="note">This semester is empty in your <a href="plan.html">4-year plan</a>.</p>`);
    } else if (r.pairs.length) {
      const free = state.pins[i] && Object.keys(state.pins[i]).length ? check(i, new Map()) : null;
      const list = r.pairs.map((p) => (p.a === p.b
        ? `<b>${esc(p.a)}</b>'s own lecture and recitation/lab (${esc(p.when.join(', '))})`
        : `<b>${esc(p.a)}</b> and <b>${esc(p.b)}</b> (${esc(p.when.join(', '))})`)).join('; ');
      notes.push(free && free.cost === 0
        ? `<p class="note bad">⚠ The sections you picked clash: ${list}. Set them back to <b>Auto</b> and a clash-free choice exists.</p>`
        : `<p class="note bad">⚠ These clash whichever sections you take: ${list}. Move one of them to another semester in your <a href="plan.html">4-year plan</a>.</p>`);
    } else if (hasTimes(r)) {
      notes.push(altsBar(r, i));
    }
    if (r.missing.length) {
      const season = term.endsWith('02') ? 'Spring' : 'Fall';
      notes.push(`<p class="note warn">Not on the ${season} schedule (${esc(src?.termName || '')}): ${r.missing.map((c) => `<b>${esc(c)}</b>`).join(', ')}. ${r.missing.some((c) => T.offeredIn(c, term) === false) ? 'Some run only in the other semester; consider moving them.' : 'They may not run every term.'}</p>`);
    }
    if (r.tba.length) notes.push(`<p class="note">No fixed time yet: ${r.tba.map((c) => `<b>${esc(c)}</b>`).join(', ')}.</p>`);
    // PROJ courses and summer internships only get the small line in the side panel.
    if (slotsCount) notes.push(`<p class="note">${plural(slotsCount, 'elective placeholder')} ${slotsCount === 1 ? 'has' : 'have'} no times yet: choose courses in your <a href="plan.html">4-year plan</a> to see them here.</p>`);
    $('#tt-notes').innerHTML = notes.join('');

    renderGrid(r, colorOf);
    renderPicks(r, colorOf);
  }

  // The clash-free timetables for the semester: how many, which one is shown, and ‹ › to flip.
  function altsBar(r, i) {
    const n = r.alts.list.length;
    const count = `${n.toLocaleString('en')}${r.alts.complete ? '' : '+'}`;
    const pinned = Object.keys(state.pins[i] || {}).length > 0;
    let head;
    if (n === 1) head = pinned ? 'No clashes with the sections you picked.' : 'No clashes. Only one timetable works for these courses.';
    else head = `No clashes. <b>${count}</b> different timetables work for these courses${pinned ? ' and the sections you picked' : ''}.`;
    const nav = n > 1 ? `
      <span class="alt-nav">
        <button type="button" data-alt="-1" aria-label="Previous timetable" title="Previous timetable (←)">‹</button>
        <span class="alt-pos">Timetable <b>${r.alt + 1}</b> of ${count}</span>
        <button type="button" data-alt="1" aria-label="Next timetable" title="Next timetable (→)">›</button>
      </span>` : '';
    const actions = `${n > 1 ? '<button type="button" class="alt-act" data-act="keep" title="Save these sections as your picks">Keep this one</button>' : ''}${
      pinned ? '<button type="button" class="alt-act" data-act="unpin" title="Set every section back to Auto">Clear my picks</button>' : ''}`;
    const combos = r.alts.combinations.toLocaleString('en');
    let stats = '';
    if (!r.alts.complete) stats = `${combos} possible section combinations, so only the first ${n.toLocaleString('en')} clash-free timetables are listed. Pick a section in the side panel to narrow them down.`;
    else if (r.alts.combinations > 1) stats = `${combos} possible section combinations, ${r.alts.feasibleCombinations.toLocaleString('en')} with no clash. Sections that meet at the same hours count as one timetable.`;
    if (stats) stats = `<small class="alt-stats">${stats}</small>`;
    const help = '<a class="alt-help" href="help.html#times">How it works</a>';
    return `<div class="note ok alts"><p>✓ ${head}</p>${nav}${actions ? `<span class="alt-acts">${actions}</span>` : ''}${help}${stats}</div>`;
  }

  // "A1", "A1/A2" (same hours), "A1 +3"
  function groupLabel(p) {
    const all = [p.section, ...(p.same || [])].map((s) => s.group);
    return all.length <= 3 ? all.join('/') : `${all[0]} +${all.length - 1}`;
  }

  function renderGrid(r, colorOf) {
    const cells = new Map(); // slot -> [chip html]
    let lastRow = 10;
    for (const p of r.picks) {
      for (const m of p.section?.meetings || []) {
        if (m.start < 0 || m.day < 0 || m.day > 4) continue;
        for (let k = 0; k < m.dur && m.start + k < T.ROWS; k++) {
          const slot = m.day * T.ROWS + m.start + k;
          lastRow = Math.max(lastRow, m.start + k);
          const label = `${(p.base || p.code).replace(' ', '')}${p.type} · ${groupLabel(p)}`;
          const same = p.same?.length ? `\nSame hours: ${p.same.map((s) => s.group).join(', ')}` : '';
          cells.set(slot, [...(cells.get(slot) || []),
            `<div class="tchip" style="--chip:${colorOf.get(p.code) || '#555'}" title="${esc(`${p.code} ${p.type ? `(${p.type}) ` : ''}${p.section.group}\n${p.section.instructor}\n${m.place}${same}`)}"><b>${esc(label)}</b><span>${esc(m.place)}</span></div>`]);
        }
      }
    }
    let html = `<thead><tr><th class="corner"></th>${T.DAYS.map((d) => `<th scope="col">${d}</th>`).join('')}</tr></thead><tbody>`;
    for (let row = 0; row <= lastRow; row++) {
      html += `<tr><th scope="row" class="time">${pad(8 + row)}:40</th>`;
      for (let d = 0; d < T.DAYS.length; d++) {
        const list = cells.get(d * T.ROWS + row) || [];
        html += `<td class="${list.length > 1 ? 'clash' : ''}">${list.join('')}</td>`;
      }
      html += '</tr>';
    }
    $('#tt-grid').innerHTML = `${html}</tbody>`;
  }

  function sectionText(s) {
    const when = s.meetings.length ? [...new Set(s.meetings.map(T.timeLabel))].join(', ') : 'TBA';
    return `${s.group} · ${when} · ${s.instructor}`;
  }

  function renderPicks(r, colorOf) {
    const i = state.sel;
    const pins = state.pins[i] || {};
    const pickOf = new Map(r.picks.map((p) => [`${p.code}|${p.type}`, p]));
    const TYPE = { '': 'Lecture', R: 'Recitation', L: 'Lab', D: 'Discussion' };
    const rows = r.timed.map((c) => `
      <div class="pick" style="--chip:${colorOf.get(c.code)}">
        <div class="pick-title"><span class="sw"></span><b>${esc(c.code)}</b> ${esc(c.name || CATALOG[c.code]?.[0] || '')}</div>
        ${c.groups.map((g) => {
          const key = `${c.code}|${g.type}`;
          const chosen = pickOf.get(key);
          return `<label class="pick-row"><span>${TYPE[g.type] || `Sections (${esc(g.type)})`}</span>
            <select data-key="${esc(key)}">
              <option value="">Auto${chosen?.section ? ` (${esc(groupLabel(chosen))})` : ''}</option>
              ${g.sections.map((s) => `<option value="${esc(s.crn)}"${pins[key] === s.crn ? ' selected' : ''}>${esc(sectionText(s))}</option>`).join('')}
            </select></label>`;
        }).join('')}
      </div>`);
    const off = (code, why) => `<div class="pick off"><b>${esc(code)}</b> ${esc(CATALOG[code]?.[0] || '')}<small>${why}</small></div>`;
    const others = [
      ...r.missing.map((code) => off(code, "not on this season's schedule")),
      ...r.arranged.map((code) => off(code, 'times arranged after you register')),
      ...r.summer.map((code) => off(code, 'summer course: belongs in a summer')),
    ];
    $('#picks').innerHTML = rows.join('') + others.join('') || '<p class="hint">No courses with class times in this semester.</p>';
  }

  // ---------- Actions ----------
  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  // Flip to the previous / next clash-free timetable (wraps around).
  function stepAlt(delta) {
    const i = state.sel;
    const n = check(i).alts.list.length;
    if (n < 2) return;
    state.alt[i] = ((state.alt[i] || 0) + delta + n) % n;
    render();
  }

  function keepShown() {
    const i = state.sel;
    const r = check(i);
    state.pins[i] = Object.fromEntries(r.picks.filter((p) => p.section).map((p) => [`${p.code}|${p.type}`, p.section.crn]));
    state.alt[i] = 0;
    savePins();
    render();
    toast('Saved: these sections are now your picks.');
  }

  function clearPins() {
    delete state.pins[state.sel];
    state.alt[state.sel] = 0;
    savePins();
    render();
  }

  async function copyCrns() {
    const r = check(state.sel);
    const lines = r.picks.filter((p) => p.section).map((p) => `${(p.base || p.code).replace(' ', '')}${p.type} - ${p.section.group}: ${p.section.crn}`).sort();
    if (!lines.length) { toast('No sections to copy in this semester.'); return; }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast(`Copied ${plural(lines.length, 'CRN')} for ${semesterTitle(state.sel)}`);
    } catch {
      toast('Copying was blocked by the browser.');
    }
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
    S.mountExtras($('#extras'), state.program, render);
    render();
  }

  // Open on ?sem=N, else the current term's semester, else the first one with courses.
  function firstSemester() {
    const asked = Number(new URLSearchParams(location.search).get('sem'));
    if (Number.isInteger(asked) && asked >= 0 && asked < SEMESTERS && new URLSearchParams(location.search).has('sem')) return asked;
    const now = Array.from({ length: SEMESTERS }, (_, i) => i).find((i) => semesterTerm(i) === T.fall?.term);
    if (now != null && state.plan[now].length) return now;
    const filled = state.plan.findIndex((s) => s.length);
    return filled >= 0 ? filled : 0;
  }

  function bindEvents() {
    $('#program').addEventListener('change', (e) => setPicks(e.target.value, state.entry));
    $('#entry').addEventListener('change', (e) => setPicks(state.program, e.target.value));
    $('#menu-toggle').addEventListener('click', () => document.body.classList.toggle('menu-hidden'));
    $('#copy-btn').addEventListener('click', copyCrns);
    $('#sem-list').addEventListener('click', (e) => {
      const b = e.target.closest('.sem-tab');
      if (!b) return;
      state.sel = Number(b.dataset.sem);
      history.replaceState(null, '', `?sem=${state.sel}`);
      render();
    });
    $('#picks').addEventListener('change', (e) => {
      const sel = e.target.closest('select[data-key]');
      if (!sel) return;
      const i = state.sel;
      state.pins[i] = { ...(state.pins[i] || {}) };
      if (sel.value) state.pins[i][sel.dataset.key] = sel.value;
      else delete state.pins[i][sel.dataset.key];
      state.alt[i] = 0; // the list of timetables changed
      savePins();
      render();
    });
    $('#tt-notes').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.alt) stepAlt(Number(b.dataset.alt));
      else if (b.dataset.act === 'keep') keepShown();
      else if (b.dataset.act === 'unpin') clearPins();
    });
    document.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.target.closest?.('input, select, textarea')) return;
      if (e.key === 'ArrowLeft') stepAlt(-1);
      else if (e.key === 'ArrowRight') stepAlt(1);
    });
    // The plan may change in another tab (the 4-year plan page).
    window.addEventListener('storage', (e) => {
      if (e.key === S.KEYS.plan) { loadPlan(); render(); }
    });
  }

  // ---------- Start ----------
  S.fillProgramOptions($('#program'));
  loadPlan();
  loadPins();
  bindEvents();
  const picks = S.readPicks();
  const r0 = S.resolvePicks(picks.program, picks.entry);
  state.entry = r0.entry;
  state.sel = firstSemester();
  setPicks(picks.program, picks.entry);
})();
