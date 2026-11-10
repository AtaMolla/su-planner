/* Room availability: which rooms in FASS, FENS, SBS and UC are free at a given hour.
   Rooms (type, seats, equipment) come from data/rooms.js (tools/build_rooms.py).
   A room is busy when a class meets there: Fall = data/courses.js, Spring = data/schedule-*.js.
   Exams, events and one-off bookings are not in that data. */
(() => {
  'use strict';

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const ROWS = 11; // hourly rows 08:40 … 18:40, the last one ends 19:30
  const TYPE = { '': '', R: 'Recitation', L: 'Lab', D: 'Discussion' };
  const TEACH = new Set(['Classroom', 'TEAL Classroom', 'Auditorium']);
  const BLD = ['FASS', 'FENS', 'SBS', 'UC'];
  // Short names for the "must have" chips -> attribute names in rooms.js
  const NEEDS = [
    ['Projector', ['Projector Sys.', 'Projector Sys. (Multi/Collab.)']],
    ['PC', ['PC', 'PC (Touchscreen)', 'PC(Wacom)']],
    ['Whiteboard', ['Whiteboard', 'Whiteboard Extra']],
    ['Online / hybrid', ['Online/Hbyrid Room']],
    ['Window', ['Window']],
    ['Round tables', ['Round Table']],
  ];
  const KEY = 'su-planner:rooms';
  const $ = (sel) => document.querySelector(sel);
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const start = (r) => `${pad(8 + r)}:40`;
  const end = (r) => `${pad(9 + r)}:30`; // a row r ends at end(r)
  const phone = () => window.matchMedia('(max-width: 760px)').matches;

  // ---------- Rooms ----------
  const RD = window.ROOM_DATA || { rooms: [], attributes: [], buildings: {} };
  const rooms = RD.rooms.map(([b, code, name, type, seats, attrs]) => ({
    id: `${b} ${code}`, b, code, name, type: type || 'Other', seats,
    attrs: attrs.map((i) => RD.attributes[i]),
  }));
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  // Place names in the class data differ by term: "FMAN G062" / "SBS G062", "University Center G030".
  function roomOf(place) {
    const p = String(place || '').trim()
      .replace(/^FMAN /, 'SBS ').replace(/^University Center /, 'UC ')
      .replace(/^Fac\.? ?of Arts.*? (?=\S+$)/, 'FASS ').replace(/^Fac\.? ?of Engin.*? (?=\S+$)/, 'FENS ');
    return roomById.get(p) || null;
  }

  // ---------- Terms: busy[roomId][day*ROWS+row] = [{code, type, group}] ----------
  function termName(t) {
    const y = Number(t.slice(0, 4));
    return `${t.endsWith('01') ? 'Fall' : t.endsWith('02') ? 'Spring' : 'Summer'} ${t.endsWith('01') ? y : y - 1}-${t.endsWith('01') ? y + 1 : y}`;
  }
  function occupancy(data) {
    const busy = new Map();
    for (const c of data.courses) {
      for (const cl of c.classes) {
        for (const s of cl.sections) {
          for (const m of s.schedule) {
            if (m.start < 0 || m.day < 0 || m.day > 4) continue;
            const room = roomOf(data.places[m.place]);
            if (!room) continue;
            if (!busy.has(room.id)) busy.set(room.id, Array.from({ length: DAYS.length * ROWS }, () => []));
            const slots = busy.get(room.id);
            for (let k = 0; k < m.duration; k++) {
              const row = m.start + k;
              if (row >= ROWS) break;
              const list = slots[m.day * ROWS + row];
              // one entry per course + class type (sections of one course often share a room)
              const same = list.find((x) => x.code === c.code && x.type === cl.type);
              if (same) { if (!same.groups.includes(s.group)) same.groups.push(s.group); }
              else list.push({ code: c.code, name: c.name, type: cl.type, groups: [s.group] });
            }
          }
        }
      }
    }
    return busy;
  }
  const terms = [];
  if (window.COURSE_DATA?.courses) terms.push({ term: window.COURSE_DATA.term, data: window.COURSE_DATA });
  for (const [t, d] of Object.entries(window.SU_SCHEDULES || {})) if (d?.courses && !terms.some((x) => x.term === t)) terms.push({ term: t, data: d });
  terms.sort((a, b) => a.term.localeCompare(b.term));
  for (const t of terms) { t.name = t.data.termName || termName(t.term); t.busy = occupancy(t.data); }

  // ---------- State ----------
  function nowSlot() {
    const d = new Date();
    const day = d.getDay() - 1;
    const mins = d.getHours() * 60 + d.getMinutes();
    if (day < 0 || day > 4 || mins < 8 * 60 + 40 || mins >= 19 * 60 + 30) return null;
    // 08:40–09:39 -> row 0 (the 10-minute break counts as the coming hour's start)
    return { day, row: Math.min(ROWS - 1, Math.max(0, Math.floor((mins - (8 * 60 + 40)) / 60))) };
  }
  function defaultTerm() {
    const m = new Date().getMonth() + 1; // Aug–Dec: Fall, Jan–Jun: Spring
    const want = m >= 8 ? '01' : '02';
    return (terms.find((t) => t.term.endsWith(want)) || terms[0])?.term || '';
  }
  const now = nowSlot() || { day: 0, row: 0 };
  const state = {
    term: defaultTerm(), day: now.day, from: now.row, to: now.row,
    blds: new Set(BLD), kind: 'teach', seats: 0, needs: new Set(), find: '', room: '',
  };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s) {
      if (terms.some((t) => t.term === s.term)) state.term = s.term;
      if (Array.isArray(s.blds) && s.blds.length) state.blds = new Set(s.blds.filter((b) => BLD.includes(b)));
      if (['teach', 'lab', 'all'].includes(s.kind)) state.kind = s.kind;
      if (Number.isFinite(s.seats)) state.seats = Math.max(0, s.seats);
      if (Array.isArray(s.needs)) state.needs = new Set(s.needs.filter((n) => NEEDS.some(([k]) => k === n)));
    }
  } catch { /* defaults */ }
  if (!state.blds.size) state.blds = new Set(BLD);
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ term: state.term, blds: [...state.blds], kind: state.kind, seats: state.seats, needs: [...state.needs] }));
    } catch { /* not saved */ }
  }

  const term = () => terms.find((t) => t.term === state.term) || terms[0];
  const slotsOf = (id) => term()?.busy.get(id) || null;
  const busyAt = (id, day, row) => slotsOf(id)?.[day * ROWS + row] || [];

  function matches(r) {
    if (!state.blds.has(r.b)) return false;
    if (state.kind === 'teach' && !TEACH.has(r.type)) return false;
    if (state.kind === 'lab' && r.type !== 'Laboratory') return false;
    if (r.seats < state.seats) return false;
    for (const n of state.needs) {
      const want = NEEDS.find(([k]) => k === n)[1];
      if (!r.attrs.some((a) => want.includes(a))) return false;
    }
    if (state.find) {
      const q = state.find.toLowerCase().replace(/\s+/g, ' ');
      if (!`${r.id} ${r.code} ${r.name}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }
  const isFree = (r, day, from, to) => {
    for (let row = from; row <= to; row++) if (busyAt(r.id, day, row).length) return false;
    return true;
  };
  // Last row of the free run that starts at `row` (or -1 if busy there).
  function freeUntil(r, day, row) {
    let k = row;
    while (k < ROWS && !busyAt(r.id, day, k).length) k++;
    return k - 1;
  }
  const label = (x) => `${x.code}${TYPE[x.type] ? ` ${TYPE[x.type]}` : ''}`;

  // ---------- Side panel ----------
  function renderControls() {
    $('#term-pick').innerHTML = terms.map((t) =>
      `<button type="button" data-term="${t.term}" aria-pressed="${t.term === state.term}">${esc(t.name)}</button>`).join('');
    $('#day-pick').innerHTML = DAYS.map((d, i) =>
      `<button type="button" data-day="${i}" aria-pressed="${i === state.day}" title="${DAY_NAMES[i]}">${d}</button>`).join('');
    $('#from').innerHTML = Array.from({ length: ROWS }, (_, r) => `<option value="${r}">${start(r)}</option>`).join('');
    $('#to').innerHTML = Array.from({ length: ROWS }, (_, r) => `<option value="${r}" ${r < state.from ? 'disabled' : ''}>${end(r)}</option>`).join('');
    $('#from').value = state.from;
    $('#to').value = state.to;
    $('#bld-pick').innerHTML = BLD.map((b) =>
      `<button type="button" data-bld="${b}" aria-pressed="${state.blds.has(b)}" title="${esc(RD.buildings[b] || b)}">${b}</button>`).join('');
    $('#kind').value = state.kind;
    $('#seats').value = state.seats || '';
    $('#need-pick').innerHTML = NEEDS.map(([k]) =>
      `<button type="button" data-need="${esc(k)}" aria-pressed="${state.needs.has(k)}">${state.needs.has(k) ? '✓ ' : '+ '}${esc(k)}</button>`).join('');
  }

  function card(r, free) {
    const { day, from } = state;
    let tag;
    if (free) {
      const u = freeUntil(r, day, from);
      tag = u === ROWS - 1 && from === 0 ? 'Free all day' : u === ROWS - 1 ? 'Free for the rest of the day' : `Free until ${end(u)}`;
    } else {
      const first = [];
      for (let row = state.from; row <= state.to; row++) for (const x of busyAt(r.id, day, row)) if (!first.some((y) => y.code === x.code && y.type === x.type)) first.push(x);
      tag = first.slice(0, 2).map(label).join(', ') + (first.length > 2 ? ` +${first.length - 2}` : '');
    }
    return `<button type="button" class="room ${free ? 'free' : 'busy'}${r.id === state.room ? ' on' : ''}" data-room="${esc(r.id)}">
      <span class="r-top"><b>${esc(r.id)}</b><span class="r-seats" title="Seats">${r.seats} seats</span></span>
      <span class="r-name">${esc(r.name)}</span>
      <span class="r-tag">${esc(tag)}</span>
    </button>`;
  }

  function renderList() {
    const { day, from, to } = state;
    const list = rooms.filter(matches);
    const free = list.filter((r) => isFree(r, day, from, to)).sort((a, b) => freeUntil(b, day, from) - freeUntil(a, day, from) || a.seats - b.seats || a.id.localeCompare(b.id));
    const busy = list.filter((r) => !isFree(r, day, from, to)).sort((a, b) => a.id.localeCompare(b.id));
    const when = `${DAY_NAMES[day]} ${start(from)}–${end(to)}`;
    let html = `<div class="list-heading mine"><span>Free ${esc(when)}</span><span class="n">${free.length}</span></div>`;
    html += free.length ? free.map((r) => card(r, true)).join('')
      : `<p class="list-empty">${list.length ? 'No room is free for the whole time. Try a shorter time or fewer filters.' : 'No room matches these filters.'}</p>`;
    if (busy.length) {
      const open = state.find || !free.length || busy.some((r) => r.id === state.room);
      html += `<details class="busy-box"${open ? ' open' : ''}><summary class="list-heading"><span>Busy then</span><span class="n">${busy.length}</span></summary>${busy.map((r) => card(r, false)).join('')}</details>`;
    }
    $('#room-list').innerHTML = html;
  }

  // ---------- Main: week grid ----------
  function renderMain() {
    const room = state.room && roomById.get(state.room);
    const t = term();
    const head = $('#rm-head');
    const grid = $('#rm-grid');
    const inWindow = (d, r) => d === state.day && r >= state.from && r <= state.to;
    let body = '';
    if (room) {
      const slots = slotsOf(room.id);
      const shown = NEEDS.filter(([, names]) => room.attrs.some((a) => names.includes(a))).map(([k]) => k);
      const other = room.attrs.filter((a) => !NEEDS.some(([, names]) => names.includes(a)) && !['Without Window'].includes(a));
      head.innerHTML = `
        <button id="back-btn" class="btn back" type="button">← All rooms</button>
        <h2>${esc(room.id)} <small>${esc(room.name)}</small></h2>
        <p class="rm-meta"><b>${room.seats}</b> seats · ${esc(room.type)} · ${esc(RD.buildings[room.b] || room.b)} · ${esc(t?.name || '')}</p>
        ${room.attrs.length ? `<div class="attrs">${shown.map((k) => `<span class="attr key">${esc(k)}</span>`).join('')}${other.map((a) => `<span class="attr">${esc(a.replace('Online/Hbyrid Room', 'Online/hybrid'))}</span>`).join('')}</div>` : ''}
        <div class="legend"><span><i class="sw free"></i>Free</span><span><i class="sw busy"></i>Class in this room</span><span><i class="sw sel"></i>Your chosen time</span></div>`;
      for (let r = 0; r < ROWS; r++) {
        body += `<tr><th class="time" scope="row">${start(r)}</th>`;
        for (let d = 0; d < DAYS.length; d++) {
          const list = slots ? slots[d * ROWS + r] : [];
          const sel = inWindow(d, r) ? ' sel' : '';
          if (list.length) {
            const tip = list.map((x) => `${label(x)} (${x.groups.filter(Boolean).join(', ') || 'one section'}) – ${x.name}`).join('\n');
            body += `<td class="cell busy${sel}" data-d="${d}" data-r="${r}" title="${esc(tip)}">${list.slice(0, 2).map((x) => `<span class="cls">${esc(label(x))}</span>`).join('')}${list.length > 2 ? `<span class="more">+${list.length - 2}</span>` : ''}</td>`;
          } else {
            body += `<td class="cell free${sel}" data-d="${d}" data-r="${r}" title="Free ${DAY_NAMES[d]} ${start(r)}–${end(r)}"><span class="fr">Free</span></td>`;
          }
        }
        body += '</tr>';
      }
      $('#rm-foot').innerHTML = `Busy hours come from the ${esc(t?.name || '')} class schedule. Exams, events and one-off bookings are not shown – for those, check <a href="https://suis.sabanciuniv.edu/HbbmInst/SABANCI_ROOMS.main_request" target="_blank" rel="noopener">SU's room search</a>.`;
    } else {
      const list = rooms.filter(matches);
      const filters = [
        state.kind === 'teach' ? 'Classrooms & halls' : state.kind === 'lab' ? 'Labs' : 'All rooms',
        state.blds.size === BLD.length ? 'all buildings' : [...state.blds].join(', '),
        state.seats ? `${state.seats}+ seats` : '',
        ...state.needs,
      ].filter(Boolean).join(' · ');
      head.innerHTML = `
        <h2>Free rooms <small>${esc(t?.name || '')}</small></h2>
        <p class="rm-meta">${esc(filters)} – ${list.length} rooms</p>
        <p class="rm-how">Each box shows <b>how many of these rooms are free</b> in that hour. Click an hour to list them, then click a room to see its week.</p>
        <button id="list-btn" class="btn primary list-btn" type="button">Show free rooms</button>`;
      let max = 1;
      const counts = [];
      for (let r = 0; r < ROWS; r++) for (let d = 0; d < DAYS.length; d++) {
        const n = list.filter((x) => !busyAt(x.id, d, r).length).length;
        counts[d * ROWS + r] = n;
        max = Math.max(max, n);
      }
      for (let r = 0; r < ROWS; r++) {
        body += `<tr><th class="time" scope="row">${start(r)}</th>`;
        for (let d = 0; d < DAYS.length; d++) {
          const n = counts[d * ROWS + r];
          const level = list.length ? n / list.length : 0;
          const sel = inWindow(d, r) ? ' sel' : '';
          body += `<td class="cell heat${sel}${n ? '' : ' none'}" data-d="${d}" data-r="${r}" style="--lv:${level.toFixed(2)}" title="${n} of ${list.length} rooms free ${DAY_NAMES[d]} ${start(r)}–${end(r)}"><b>${n}</b><small>free</small></td>`;
        }
        body += '</tr>';
      }
      $('#rm-foot').innerHTML = `Rooms count as busy when a ${esc(t?.name || '')} class meets there. Exams, events and one-off bookings are not shown – check <a href="https://suis.sabanciuniv.edu/HbbmInst/SABANCI_ROOMS.main_request" target="_blank" rel="noopener">SU's room search</a> to book a room. Room list from ${esc(RD.fetched || '')}.`;
    }
    grid.innerHTML = `<thead><tr><th class="corner"></th>${DAYS.map((d, i) => `<th scope="col" class="${i === state.day ? 'today' : ''}"><span class="long">${DAY_NAMES[i]}</span><span class="short">${d}</span></th>`).join('')}</tr></thead><tbody>${body}</tbody>`;
  }

  function render() {
    renderControls();
    renderList();
    renderMain();
  }

  // ---------- Events ----------
  function setTime(day, from, to = from) {
    state.day = day;
    state.from = from;
    state.to = Math.max(from, to);
  }
  $('#sidebar').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.term) { state.term = b.dataset.term; save(); }
    else if (b.dataset.day) state.day = Number(b.dataset.day);
    else if (b.dataset.bld) {
      const k = b.dataset.bld;
      if (state.blds.has(k) && state.blds.size > 1) state.blds.delete(k); else state.blds.add(k);
      save();
    } else if (b.dataset.need) {
      const k = b.dataset.need;
      if (state.needs.has(k)) state.needs.delete(k); else state.needs.add(k);
      save();
    } else if (b.dataset.room) {
      state.room = b.dataset.room;
      if (phone()) document.body.classList.add('menu-hidden');
      $('#main').scrollTop = 0;
    } else if (b.id === 'now-btn') {
      const n = nowSlot();
      if (n) setTime(n.day, n.row);
      else {
        // Outside class hours: the next weekday morning
        const d = new Date();
        const wd = d.getDay() - 1; // 0 = Mon
        const early = d.getHours() * 60 + d.getMinutes() < 8 * 60 + 40;
        const next = wd >= 0 && wd <= 4 && early ? wd : wd >= 0 && wd < 4 ? wd + 1 : 0;
        setTime(next, 0);
        toast(`Classes run Monday to Friday, 08:40–19:30. Showing ${DAY_NAMES[next]} morning.`);
      }
    } else return;
    render();
  });
  $('#from').addEventListener('change', (e) => { const f = Number(e.target.value); setTime(state.day, f, Math.max(f, state.to)); render(); });
  $('#to').addEventListener('change', (e) => { state.to = Number(e.target.value); render(); });
  $('#kind').addEventListener('change', (e) => { state.kind = e.target.value; save(); render(); });
  $('#seats').addEventListener('input', (e) => { state.seats = Math.max(0, Number(e.target.value) || 0); save(); renderList(); renderMain(); });
  $('#find').addEventListener('input', (e) => { state.find = e.target.value.trim(); renderList(); renderMain(); });
  $('#main').addEventListener('click', (e) => {
    if (e.target.closest('#back-btn')) { state.room = ''; render(); return; }
    if (e.target.closest('#list-btn')) { document.body.classList.remove('menu-hidden'); return; }
    const cell = e.target.closest('td.cell');
    if (!cell) return;
    setTime(Number(cell.dataset.d), Number(cell.dataset.r));
    render();
    if (!state.room && phone()) document.body.classList.remove('menu-hidden'); // show the list for that hour
  });
  $('#menu-toggle').addEventListener('click', () => document.body.classList.toggle('menu-hidden'));

  let toastTimer;
  function toast(msg) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  if (phone()) document.body.classList.add('menu-hidden');
  if (!terms.length || !rooms.length) {
    $('#rm-head').innerHTML = '<h2>Room data is missing</h2><p class="rm-meta">Run tools/build_rooms.py to make data/rooms.js.</p>';
    return;
  }
  render();
})();
