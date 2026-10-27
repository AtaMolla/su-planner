/* Prerequisite flowchart: which of a program's required, core and area courses open which.
   Data: data/requirements.js (catalog entries carry prerequisites as AND-of-OR groups).
   Helpers: js/shared.js. */
(() => {
  'use strict';

  const S = window.SUShared;
  const { REQUIREMENTS, esc, fold } = S;
  const CATALOG = REQUIREMENTS.catalog || {};
  const OFFERED = new Map((window.COURSE_DATA?.courses || []).map((c) => [c.code, c.name]));
  // Older data files have no prerequisite field (6th catalog value).
  const HAS_PREREQS = Object.values(CATALOG).some((v) => Array.isArray(v[5]));
  const CHARTED = ['required', 'core', 'area'];
  const KIND_NAME = { required: 'Required', core: 'Core elective', area: 'Area elective', outside: 'Other group' };
  const KIND_ORDER = { required: 0, core: 1, area: 2, outside: 3 };

  // Layout, in SVG units.
  const NODE_W = 176;
  const NODE_H = 46;
  const GAP_X = 86;
  const GAP_Y = 12;
  const PAD = 20;
  const HEAD = 30;

  const $ = (sel) => document.querySelector(sel);
  const svg = $('#chart');
  const byCode = (a, b) => a.localeCompare(b, 'en', { numeric: true });
  const nameOf = (code) => CATALOG[code]?.[0] || OFFERED.get(code) || '';
  // Some catalog pages list a course as its own prerequisite (SPS 303); those groups are ignored.
  const prereqOf = (code) => (CATALOG[code]?.[5] || []).filter((g) => !g.some((p) => S.baseCode(p) === S.baseCode(code)));
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  const state = {
    program: '',
    entry: '',
    kinds: new Set(CHARTED),
    outside: true,
    selected: null,
    chart: '', // '' = the major; otherwise a double major / minor SU code
    query: '',
  };

  // ---------- Graph ----------
  let graph = null; // { kind: Map, group: Map, parents: Map, children: Map, edges: [], cols: [[code]], loose: [code] }

  function buildGraph() {
    const extra = state.chart ? S.extraPrograms(state.entry).find((x) => x.key === state.chart) : null;
    const cats = extra ? extra.cats : (state.program ? S.sortedCategories(state.program, state.entry) : null);
    if (!cats) return null;

    // Each course sits in the first of Required / Core / Area that lists it.
    const kind = new Map();
    const group = new Map();
    for (const cat of cats) {
      const k = cat.kind === 'requirement' ? 'required' : cat.kind; // e.g. "Mathematics Requirement"
      if (!CHARTED.includes(k)) continue;
      for (const code of cat.courses) {
        if (!kind.has(code)) { kind.set(code, k); group.set(code, cat.name); }
      }
    }
    for (const [code, k] of [...kind]) if (!state.kinds.has(k)) kind.delete(code);

    // Pull in prerequisites from other groups (and their own prerequisites) when asked.
    if (state.outside) {
      const queue = [...kind.keys()];
      while (queue.length && kind.size < 500) {
        const code = queue.shift();
        for (const g of prereqOf(code)) {
          for (const p of g) {
            if (kind.has(p)) continue;
            kind.set(p, 'outside');
            queue.push(p);
          }
        }
      }
    }

    const parents = new Map([...kind.keys()].map((c) => [c, new Set()]));
    const children = new Map([...kind.keys()].map((c) => [c, new Set()]));
    const edgeAlt = new Map(); // "from>to" -> only reachable as one of several options
    for (const code of kind.keys()) {
      for (const g of prereqOf(code)) {
        for (const p of g) {
          if (!kind.has(p) || p === code) continue;
          parents.get(code).add(p);
          children.get(p).add(code);
          const key = `${p}>${code}`;
          edgeAlt.set(key, (edgeAlt.get(key) ?? true) && g.length > 1);
        }
      }
    }
    const edges = [...edgeAlt].map(([key, alt]) => { const [from, to] = key.split('>'); return { from, to, alt }; });

    // Step = longest chain of prerequisites before the course (cycles are cut).
    const level = new Map();
    const visiting = new Set();
    const levelOf = (c) => {
      if (level.has(c)) return level.get(c);
      if (visiting.has(c)) return 0;
      visiting.add(c);
      let l = 0;
      for (const p of parents.get(c)) l = Math.max(l, levelOf(p) + 1);
      visiting.delete(c);
      level.set(c, l);
      return l;
    };

    const loose = [];
    const cols = [];
    const sortKey = (a, b) => KIND_ORDER[kind.get(a)] - KIND_ORDER[kind.get(b)] || byCode(a, b);
    for (const code of [...kind.keys()].sort(sortKey)) {
      if (!parents.get(code).size && !children.get(code).size) {
        if (kind.get(code) !== 'outside') loose.push(code);
        continue;
      }
      const l = levelOf(code);
      (cols[l] ||= []).push(code);
    }
    for (let i = 0; i < cols.length; i++) cols[i] ||= [];
    orderColumns(cols, parents, children);
    return { kind, group, parents, children, edges, cols, loose };
  }

  // Fewer crossings: sort each column by the average position of its neighbours, both ways.
  function orderColumns(cols, parents, children) {
    const pos = new Map();
    const index = () => cols.forEach((col) => col.forEach((c, i) => pos.set(c, i / Math.max(1, col.length - 1))));
    const avg = (set, fallback) => {
      const v = [...set].filter((c) => pos.has(c)).map((c) => pos.get(c));
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : fallback;
    };
    index();
    for (let round = 0; round < 4; round++) {
      for (let l = 1; l < cols.length; l++) {
        cols[l] = cols[l].map((c) => [c, avg(parents.get(c), pos.get(c))]).sort((a, b) => a[1] - b[1]).map(([c]) => c);
        index();
      }
      for (let l = cols.length - 2; l >= 0; l--) {
        cols[l] = cols[l].map((c) => [c, avg(children.get(c), pos.get(c))]).sort((a, b) => a[1] - b[1]).map(([c]) => c);
        index();
      }
    }
  }

  // ---------- Drawing ----------
  const at = new Map(); // code -> {x, y}

  function draw() {
    graph = buildGraph();
    at.clear();
    const wrap = $('#chart-wrap');
    if (!graph) {
      svg.innerHTML = '';
      svg.setAttribute('width', 0);
      svg.setAttribute('height', 0);
      wrap.dataset.empty = 'Choose your program on the left to see its prerequisite chart.';
      $('#loose').innerHTML = '';
      renderDetails();
      return;
    }
    const { cols, edges, kind } = graph;
    if (!cols.length) {
      svg.innerHTML = '';
      svg.setAttribute('width', 0);
      svg.setAttribute('height', 0);
      wrap.dataset.empty = HAS_PREREQS
        ? 'None of the courses shown have prerequisites among each other.'
        : 'The course data has no prerequisite information yet. Rebuild it with: python tools/build_requirements.py';
    } else {
      delete wrap.dataset.empty;
    }

    const rows = Math.max(0, ...cols.map((c) => c.length));
    const width = PAD * 2 + cols.length * NODE_W + Math.max(0, cols.length - 1) * GAP_X;
    const height = PAD * 2 + HEAD + rows * (NODE_H + GAP_Y) - GAP_Y;
    cols.forEach((col, l) => {
      const offset = ((rows - col.length) * (NODE_H + GAP_Y)) / 2; // centre short columns
      col.forEach((code, i) => at.set(code, { x: PAD + l * (NODE_W + GAP_X), y: PAD + HEAD + offset + i * (NODE_H + GAP_Y) }));
    });

    const heads = cols.map((col, l) => `<text class="col-head" x="${PAD + l * (NODE_W + GAP_X)}" y="${PAD + 12}">Step ${l + 1} <tspan class="col-n">· ${col.length}</tspan></text>`).join('');

    const paths = edges.filter((e) => at.has(e.from) && at.has(e.to)).map((e) => {
      const a = at.get(e.from);
      const b = at.get(e.to);
      const x1 = a.x + NODE_W;
      const y1 = a.y + NODE_H / 2;
      const x2 = b.x - 4;
      const y2 = b.y + NODE_H / 2;
      const dx = Math.max(30, (x2 - x1) / 2);
      return `<path class="edge${e.alt ? ' alt' : ''}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}"/>`;
    }).join('');

    const nodes = [...at].map(([code, p]) => {
      const k = kind.get(code);
      const name = nameOf(code);
      return `<g class="node k-${k}" data-code="${esc(code)}" transform="translate(${p.x},${p.y})" tabindex="0" role="button" aria-label="${esc(`${code} ${name}`)}">
          <title>${esc(`${code} – ${name || 'name not listed'}\n${KIND_NAME[k]}`)}</title>
          <rect class="box" width="${NODE_W}" height="${NODE_H}" rx="7"/>
          <rect class="bar" width="5" height="${NODE_H}" rx="2.5"/>
          <text class="code" x="14" y="19">${esc(code)}</text>
          <text class="name" x="14" y="35">${esc(clip(name, 27))}</text>
        </g>`;
    }).join('');

    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = `<defs>
        <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="arrow"/></marker>
        <marker id="arrow-on" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="arrow-on"/></marker>
      </defs>${heads}<g class="edges">${paths}</g><g class="nodes">${nodes}</g>`;

    renderLoose();
    if (state.selected && !graph.kind.has(state.selected)) state.selected = null;
    highlight();
    renderDetails();
  }

  function renderLoose() {
    const box = $('#loose');
    if (!graph.loose.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<h2>Not linked to the courses above <small>${graph.loose.length} · no prerequisites here and they open none</small></h2>
      <div class="loose-list">${graph.loose.map((code) => `<button type="button" class="loose-chip" data-code="${esc(code)}" title="${esc(nameOf(code))}"><span class="sw k-${graph.kind.get(code)}"></span><b>${esc(code)}</b> ${esc(clip(nameOf(code), 30))}</button>`).join('')}</div>`;
  }

  // ---------- Selection ----------
  function walk(start, next) {
    const seen = new Set();
    const queue = [start];
    while (queue.length) {
      for (const n of next.get(queue.shift()) || []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    return seen;
  }

  function highlight() {
    const sel = state.selected;
    const q = state.query;
    const up = sel ? walk(sel, graph.parents) : new Set();
    const down = sel ? walk(sel, graph.children) : new Set();
    for (const el of svg.querySelectorAll('.node')) {
      const code = el.dataset.code;
      const match = q && fold(`${code} ${nameOf(code)}`).includes(q);
      el.classList.toggle('sel', code === sel);
      el.classList.toggle('up', up.has(code));
      el.classList.toggle('down', down.has(code));
      el.classList.toggle('match', !!match);
      el.classList.toggle('dim', (sel && code !== sel && !up.has(code) && !down.has(code)) || (!!q && !sel && !match));
    }
    for (const el of svg.querySelectorAll('.edge')) {
      const { from, to } = el.dataset;
      const on = sel && (((up.has(from) || from === sel) && (up.has(to) || to === sel))
        || ((down.has(from) || from === sel) && (down.has(to) || to === sel)));
      el.classList.toggle('on', !!on);
      el.classList.toggle('dim', !!sel && !on);
      el.setAttribute('marker-end', on ? 'url(#arrow-on)' : 'url(#arrow)');
    }
    for (const el of document.querySelectorAll('.loose-chip')) el.classList.toggle('sel', el.dataset.code === sel);
  }

  function codeButton(code) {
    return graph?.kind.has(code)
      ? `<button type="button" class="jump" data-code="${esc(code)}">${esc(code)}</button>`
      : `<span class="nojump" title="Not in this chart">${esc(code)}</span>`;
  }

  function renderDetails() {
    const box = $('#details');
    const code = state.selected;
    if (!graph || !code) {
      box.innerHTML = '<p class="hint">Click a course to see what it needs and what it opens.</p>';
      return;
    }
    const c = CATALOG[code];
    const k = graph.kind.get(code);
    const needs = prereqOf(code);
    const opens = [...(graph.children.get(code) || [])].sort(byCode);
    const later = walk(code, graph.children).size;
    box.innerHTML = `
      <div class="d-head"><span class="sw k-${k}"></span><b>${esc(code)}</b></div>
      <div class="d-name">${esc(nameOf(code) || 'Name not listed')}</div>
      <div class="d-meta">${c ? `${c[1] ?? '?'} SU · ${c[2] ?? '?'} ECTS · ` : ''}${esc(graph.group.get(code) || KIND_NAME[k])}${OFFERED.has(code) ? ' · offered now' : ''}</div>
      <div class="d-sec">Needs</div>
      ${needs.length ? `<ul class="d-list">${needs.map((g) => `<li>${g.map(codeButton).join(' <span class="or">or</span> ')}</li>`).join('')}</ul>` : '<p class="d-none">No prerequisites.</p>'}
      <div class="d-sec">Opens</div>
      ${opens.length ? `<div class="d-chips">${opens.map(codeButton).join('')}</div>
        <p class="d-note">${later > opens.length ? `${later} courses in this chart depend on it, directly or later.` : ''}</p>` : '<p class="d-none">Nothing in this chart.</p>'}`;
  }

  function select(code, { scroll = false } = {}) {
    state.selected = code;
    highlight();
    renderDetails();
    if (scroll && code) {
      const el = svg.querySelector(`.node[data-code="${CSS.escape(code)}"]`) || document.querySelector(`.loose-chip[data-code="${CSS.escape(code)}"]`);
      el?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    }
  }

  // ---------- Pickers ----------
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
    S.mountExtras($('#extras'), state.program, () => { fillChartOptions(); state.selected = null; draw(); });
    fillChartOptions();
    state.selected = null;
    draw();
    $('#main').scrollTo(0, 0);
  }

  // "Chart": the major, or one of the double major / minors picked.
  function fillChartOptions() {
    const extras = state.program ? S.extraPrograms(state.entry) : [];
    if (!extras.some((x) => x.key === state.chart)) state.chart = '';
    const major = S.programById.get(state.program)?.name || 'Major';
    const sel = $('#chart-for');
    sel.innerHTML = `<option value="">Major: ${esc(major)}</option>`
      + extras.map((x) => `<option value="${esc(x.key)}">${esc(x.title)}</option>`).join('');
    sel.value = state.chart;
    $('#chart-row').hidden = !extras.length;
  }

  // ---------- Events ----------
  function bindEvents() {
    $('#program').addEventListener('change', (e) => setPicks(e.target.value, state.entry));
    $('#entry').addEventListener('change', (e) => setPicks(state.program, e.target.value));
    $('#menu-toggle').addEventListener('click', () => document.body.classList.toggle('menu-hidden'));
    $('#chart-for').addEventListener('change', (e) => {
      state.chart = e.target.value;
      state.selected = null;
      draw();
      $('#main').scrollTo(0, 0);
    });

    $('#kind-chips').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-kind]');
      if (!b) return;
      const k = b.dataset.kind;
      if (state.kinds.has(k)) state.kinds.delete(k); else state.kinds.add(k);
      b.setAttribute('aria-pressed', String(state.kinds.has(k)));
      draw();
    });
    $('#show-outside').addEventListener('change', (e) => { state.outside = e.target.checked; draw(); });

    $('#search').addEventListener('input', (e) => {
      state.query = fold(e.target.value);
      highlight();
      const first = state.query && svg.querySelector('.node.match');
      first?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    });
    $('#search').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const first = svg.querySelector('.node.match');
      if (first) select(first.dataset.code, { scroll: true });
    });

    svg.addEventListener('click', (e) => {
      const node = e.target.closest('.node');
      select(node && node.dataset.code !== state.selected ? node.dataset.code : null);
    });
    svg.addEventListener('keydown', (e) => {
      const node = e.target.closest('.node');
      if (node && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(node.dataset.code); }
    });
    $('#loose').addEventListener('click', (e) => {
      const chip = e.target.closest('.loose-chip');
      if (chip) select(chip.dataset.code === state.selected ? null : chip.dataset.code);
    });
    $('#details').addEventListener('click', (e) => {
      const jump = e.target.closest('.jump');
      if (jump) select(jump.dataset.code, { scroll: true });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (state.selected) select(null);
      else if ($('#search').value) { $('#search').value = ''; state.query = ''; highlight(); }
    });
  }

  // ---------- Start ----------
  S.fillProgramOptions($('#program'));
  bindEvents();
  const picks = S.readPicks();
  setPicks(picks.program, picks.entry);
})();
