/* Shared courses: which required courses the undergraduate programs have in common.
   Uses data/requirements.js through js/shared.js. University courses are left out (every
   program requires them); only each program's "Required Courses" lists are compared. */
(() => {
  'use strict';

  const S = window.SUShared;
  const { esc } = S;
  const CATALOG = S.REQUIREMENTS.catalog || {};
  const $ = (sel) => document.querySelector(sel);
  // One hue, light to dark, for "how many shared" (0 stays the plain surface).
  const RAMP = ['#e3edf9', '#c4daf3', '#9cc0ea', '#6d9fdc', '#4280cc', '#2263b0', '#164a88'];
  const PROGRAMS = S.PROGRAMS.faculties.flatMap((f) => f.programs.map((p) => ({ ...p, faculty: f.name })));
  const short = (p) => p.id.toUpperCase();

  const state = { program: '', entry: '', a: '', b: '' };

  // Each program's required courses for the entry year (its newest curriculum if it didn't exist then).
  function requiredSets() {
    const out = new Map();
    for (const p of PROGRAMS) {
      const years = S.termsFor(p.id);
      const term = years.some((t) => t.term === state.entry) ? state.entry : years[0]?.term;
      const cats = term ? S.requirementsFor(p.id, term) || [] : [];
      const codes = new Set(cats.filter((c) => S.categoryKind(c) === 'required').flatMap((c) => c.courses).map(S.baseCode));
      out.set(p.id, { codes, term, own: term === state.entry });
    }
    return out;
  }

  const su = (code) => CATALOG[code]?.[1] ?? 0;
  const name = (code) => CATALOG[code]?.[0] || '';
  const sumSu = (codes) => codes.reduce((t, c) => t + su(c), 0);
  const sorted = (set) => [...set].sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));

  function render() {
    const sets = requiredSets();
    const shared = (a, b) => [...sets.get(a).codes].filter((c) => sets.get(b).codes.has(c));
    if (!state.a) state.a = state.program || PROGRAMS[0].id;
    const others = PROGRAMS.filter((p) => p.id !== state.a);
    if (!state.b || state.b === state.a) {
      // Default partner: the program sharing the most with A.
      state.b = others.reduce((best, p) => (shared(state.a, p.id).length > shared(state.a, best.id).length ? p : best), others[0]).id;
    }
    const max = Math.max(1, ...PROGRAMS.flatMap((p) => PROGRAMS.filter((q) => q.id !== p.id).map((q) => shared(p.id, q.id).length)));
    const fill = (n) => (n ? RAMP[Math.min(RAMP.length - 1, Math.ceil((n / max) * RAMP.length) - 1)] : '');
    const dark = (n) => n && Math.ceil((n / max) * RAMP.length) - 1 >= 4;

    const older = PROGRAMS.filter((p) => !sets.get(p.id).own && sets.get(p.id).term);
    $('#ov-head').innerHTML = `
      <h2>Required courses programs share</h2>
      <p>For students who started in <b>${esc(S.termName(state.entry))}</b>. Click a square to compare two programs.</p>
      ${older.length ? `<p class="fine">${older.map((p) => esc(short(p))).join(', ')} didn't exist yet that year, so ${older.length === 1 ? 'its' : 'their'} first curriculum is used.</p>` : ''}`;

    // The matrix: row program × column program; the diagonal is the program's own count.
    let html = `<thead><tr><th class="corner" scope="col"></th>${PROGRAMS.map((p) =>
      `<th scope="col" class="${p.id === state.program ? 'mine' : ''}" title="${esc(p.name)}">${esc(short(p))}</th>`).join('')}</tr></thead><tbody>`;
    for (const p of PROGRAMS) {
      html += `<tr class="${p.id === state.program ? 'mine' : ''}"><th scope="row" title="${esc(p.name)}">${esc(short(p))}</th>`;
      for (const q of PROGRAMS) {
        const own = p.id === q.id;
        const n = own ? sets.get(p.id).codes.size : shared(p.id, q.id).length;
        const on = (p.id === state.a && q.id === state.b) || (p.id === state.b && q.id === state.a);
        const tip = own ? `${p.name}: ${n} required courses` : `${p.name} and ${q.name}: ${n} shared required course${n === 1 ? '' : 's'}`;
        html += own
          ? `<td class="own" title="${esc(tip)}">${n}</td>`
          : `<td><button type="button" class="cell${on ? ' on' : ''}${dark(n) ? ' dark' : ''}" style="${n ? `--fill:${fill(n)}` : ''}" data-a="${p.id}" data-b="${q.id}" title="${esc(tip)}" aria-label="${esc(tip)}">${n || '·'}</button></td>`;
      }
      html += '</tr>';
    }
    $('#ov-matrix').innerHTML = `${html}</tbody>`;
    $('#ov-legend').innerHTML = `<span>Fewer shared</span>${RAMP.map((c) => `<i style="background:${c}"></i>`).join('')}<span>More</span>
      <span class="sep"></span><span class="own-key">7</span><span>= the program's own required courses</span>`;

    renderPair(sets);
    renderCourses(sets);
  }

  function courseRows(codes) {
    if (!codes.length) return '<p class="none">None</p>';
    return `<ul>${sorted(codes).map((c) => `<li><b>${esc(c)}</b> <span>${esc(name(c))}</span> <small>${su(c)} SU</small></li>`).join('')}</ul>`;
  }

  function renderPair(sets) {
    const A = PROGRAMS.find((p) => p.id === state.a);
    const B = PROGRAMS.find((p) => p.id === state.b);
    const a = sets.get(A.id).codes;
    const b = sets.get(B.id).codes;
    const both = [...a].filter((c) => b.has(c));
    const onlyA = [...a].filter((c) => !b.has(c));
    const onlyB = [...b].filter((c) => !a.has(c));
    const pick = (id, side) => `<select class="pair-pick" data-side="${side}" aria-label="${side === 'a' ? 'First' : 'Second'} program">${PROGRAMS.map((p) =>
      `<option value="${p.id}"${p.id === id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
    $('#ov-pair').innerHTML = `
      <div class="pair-head">${pick(A.id, 'a')}<span>and</span>${pick(B.id, 'b')}</div>
      <p class="pair-sum"><b>${both.length}</b> shared required course${both.length === 1 ? '' : 's'} (${sumSu(both)} SU).
        With ${esc(A.name)} as your major, a double major in ${esc(B.name)} still needs <b>${onlyB.length}</b> of its required courses (${sumSu(onlyB)} SU), on top of its electives.</p>
      <div class="pair-cols">
        <div class="col"><h4>Only ${esc(short(A))} <small>${onlyA.length}</small></h4>${courseRows(onlyA)}</div>
        <div class="col both"><h4>Both <small>${both.length}</small></h4>${courseRows(both)}</div>
        <div class="col"><h4>Only ${esc(short(B))} <small>${onlyB.length}</small></h4>${courseRows(onlyB)}</div>
      </div>`;
  }

  // Every course two or more programs require, most-shared first.
  function renderCourses(sets) {
    const by = new Map();
    for (const p of PROGRAMS) for (const c of sets.get(p.id).codes) by.set(c, [...(by.get(c) || []), p]);
    const rows = [...by].filter(([, ps]) => ps.length > 1)
      .sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0], 'en', { numeric: true }));
    $('#ov-courses').innerHTML = `<thead><tr><th scope="col">Course</th><th scope="col">Name</th><th scope="col" class="num">SU</th><th scope="col" class="num">Programs</th><th scope="col">Required by</th></tr></thead>
      <tbody>${rows.map(([c, ps]) => `<tr><td><b>${esc(c)}</b></td><td>${esc(name(c))}</td><td class="num">${su(c)}</td><td class="num">${ps.length}</td>
        <td>${ps.map((p) => `<span class="tag${p.id === state.program ? ' mine' : ''}" title="${esc(p.name)}">${esc(short(p))}</span>`).join('')}</td></tr>`).join('')}</tbody>`;
  }

  function setPicks(program, entry) {
    const r = S.resolvePicks(program, entry);
    state.program = r.program;
    state.entry = r.entry;
    if (r.program) { state.a = r.program; state.b = ''; }
    const prog = $('#program');
    prog.value = state.program;
    prog.classList.toggle('unset', !state.program);
    const entrySel = $('#entry');
    entrySel.innerHTML = r.years.map((t) => `<option value="${esc(t.term)}">${esc(t.termName)}</option>`).join('');
    entrySel.value = state.entry;
    render();
  }

  $('#program').addEventListener('change', (e) => setPicks(e.target.value, state.entry));
  $('#entry').addEventListener('change', (e) => setPicks(state.program, e.target.value));
  $('#menu-toggle').addEventListener('click', () => document.body.classList.toggle('menu-hidden'));
  $('#ov-matrix').addEventListener('click', (e) => {
    const b = e.target.closest('button.cell');
    if (!b) return;
    state.a = b.dataset.a;
    state.b = b.dataset.b;
    render();
    $('#ov-pair').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  $('#ov-pair').addEventListener('change', (e) => {
    const sel = e.target.closest('.pair-pick');
    if (!sel) return;
    state[sel.dataset.side] = sel.value;
    if (state.a === state.b) state[sel.dataset.side === 'a' ? 'b' : 'a'] = '';
    render();
  });

  S.fillProgramOptions($('#program'));
  if (window.matchMedia('(max-width: 760px)').matches) document.body.classList.add('menu-hidden');
  const picks = S.readPicks();
  setPicks(picks.program, picks.entry);
})();
