(() => {
  const TOKEN = document.querySelector('meta[name="tapdeck-token"]').content;
  const { ICONS, SYSTEM, systemById, WIDGETS, widgetById, COLORS, GRID } = window.Tapdeck;
  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const TYPES = [
    { id: 'hotkey', icon: 'keyboard', name: 'Shortcut', desc: 'Press a key combination, like ⌘⇧5' },
    { id: 'open', icon: 'open', name: 'Open', desc: 'An app, website or folder' },
    { id: 'command', icon: 'terminal', name: 'Command', desc: 'Run a terminal command' },
    { id: 'text', icon: 'text', name: 'Type text', desc: 'Type a saved text where the cursor is' },
    { id: 'system', icon: 'gear', name: 'Mac control', desc: 'Media, volume, brightness, lock, sleep…' },
  ];
  const SIZES = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1]];
  const MOD_ORDER = [['ctrl', '⌃'], ['alt', '⌥'], ['shift', '⇧'], ['cmd', '⌘']];
  const KEY_NAMES = {
    Space: 'Space', Enter: '↩', Escape: 'Esc', Backspace: '⌫', Delete: '⌦', Tab: '⇥',
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',',
    Period: '.', Slash: '/', Backquote: '`', IntlBackslash: '§', Home: 'Home', End: 'End',
    PageUp: 'PgUp', PageDown: 'PgDn', NumpadEnter: 'Num ↩',
  };
  const keyName = (code) => KEY_NAMES[code] || code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
  const sysName = (id) => (systemById(id) || {}).en || id;
  // Widgets can't be made smaller than this (columns, rows); buttons go down to 1 x 1.
  const minSize = (b) => (b.widget ? widgetById(b.widget).min : [1, 1]);

  // ------------------------------------------------------------------ state
  let deck = { pages: [] };
  let meta = { apps: [], keys: [], accessibility: true };
  let pageIndex = 0;
  let selected = null; // { id } for a button, or { x, y } for an empty cell

  async function api(path, body) {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Token': TOKEN, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.status);
    return data;
  }

  let toastTimer;
  function toast(text) {
    $('toast').textContent = text; $('toast').classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2600);
  }

  const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
  const page = () => deck.pages[pageIndex];
  const current = () => (selected && selected.id ? page().buttons.find((b) => b.id === selected.id) : null);
  const appByPath = (p) => meta.apps.find((a) => a.path === p);
  const appIconUrl = (p) => `/api/editor/appicon?path=${encodeURIComponent(p)}&t=${encodeURIComponent(TOKEN)}`;

  // ------------------------------------------------------------------ grid geometry
  function occupied(p, exceptId) {
    const cells = new Set();
    p.buttons.forEach((b) => {
      if (b.id === exceptId) return;
      for (let x = b.x; x < b.x + b.w; x++) for (let y = b.y; y < b.y + b.h; y++) cells.add(x + ',' + y);
    });
    return cells;
  }
  function fits(p, x, y, w, h, exceptId) {
    if (x < 0 || y < 0 || x + w > p.cols || y + h > p.rows) return false;
    const taken = occupied(p, exceptId);
    for (let cx = x; cx < x + w; cx++) for (let cy = y; cy < y + h; cy++) if (taken.has(cx + ',' + cy)) return false;
    return true;
  }
  function freeSpot(p, w, h) {
    for (let y = 0; y + h <= p.rows; y++) for (let x = 0; x + w <= p.cols; x++) if (fits(p, x, y, w, h)) return { x, y };
    return null;
  }
  function cellAt(clientX, clientY) {
    const r = $('board').getBoundingClientRect();
    const gap = 12, p = page();
    const cw = (r.width - gap * (p.cols - 1)) / p.cols, ch = (r.height - gap * (p.rows - 1)) / p.rows;
    const clamp = (v, max) => Math.max(0, Math.min(max, v));
    return { x: clamp(Math.floor((clientX - r.left) / (cw + gap)), p.cols - 1), y: clamp(Math.floor((clientY - r.top) / (ch + gap)), p.rows - 1) };
  }
  const place = (el, x, y, w, h) => { el.style.gridColumn = `${x + 1} / span ${w}`; el.style.gridRow = `${y + 1} / span ${h}`; };

  // ------------------------------------------------------------------ saving
  let saveTimer = null;
  function changed({ board = true, pages = false, inspector = false } = {}) {
    if (board) renderBoard();
    if (pages) renderPages();
    if (inspector) renderInspector();
    $('saveStatus').className = 'save-status';
    $('saveStatus').textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  }
  async function save() {
    try {
      await api('/api/editor/save', deck);
      $('saveStatus').textContent = 'Saved. Your phone updates by itself.';
    } catch (e) {
      $('saveStatus').className = 'save-status error';
      $('saveStatus').textContent = 'Couldn\'t save: ' + e.message;
    }
  }

  // ------------------------------------------------------------------ pages
  const GRIP = '<svg class="grip" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M3 8h10M3 11.5h10"/></svg>';

  function renderPages() {
    const list = $('pageList');
    // Where each page sat before, so reordered pages slide into place.
    const before = new Map([...list.children].map((el) => [el.dataset.key, el.getBoundingClientRect().top]));
    list.innerHTML = '';
    deck.pages.forEach((p, i) => {
      if (!p.key) Object.defineProperty(p, 'key', { value: newId(), enumerable: false });
      const el = document.createElement('div');
      el.className = 'page-item' + (i === pageIndex ? ' active' : '');
      el.dataset.page = i;
      el.dataset.key = p.key;
      el.draggable = true;
      el.title = 'Drag to reorder';
      el.insertAdjacentHTML('beforeend', GRIP);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name || `Page ${i + 1}`;
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = p.buttons.length;
      el.append(name, count);
      el.addEventListener('click', () => { pageIndex = i; selected = null; renderAll(); });
      dragPages(el, i);
      list.appendChild(el);
    });
    if (!reduceMotion) {
      [...list.children].forEach((el) => {
        const top = before.get(el.dataset.key);
        const dy = top === undefined ? 0 : top - el.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2, .9, .3, 1.1)' });
      });
    }
    const p = page();
    $('pageName').value = p.name;
    $('cols').textContent = p.cols;
    $('rows').textContent = p.rows;
    $('colsDown').disabled = p.cols <= GRID.minCols;
    $('colsUp').disabled = p.cols >= GRID.maxCols;
    $('rowsDown').disabled = p.rows <= GRID.minRows;
    $('rowsUp').disabled = p.rows >= GRID.maxRows;
    $('pageLeft').disabled = pageIndex === 0;
    $('pageRight').disabled = pageIndex === deck.pages.length - 1;
    $('addPage').disabled = deck.pages.length >= 20;
  }

  // Drag pages in the sidebar to reorder them; a line shows where it will go.
  let draggedPage = null;
  function dragPages(el, i) {
    const clear = () => document.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
    el.addEventListener('dragstart', (e) => {
      draggedPage = i;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
    });
    el.addEventListener('dragend', () => { draggedPage = null; el.classList.remove('dragging'); clear(); });
    el.addEventListener('dragover', (e) => {
      if (draggedPage === null) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      clear();
      el.classList.add(after ? 'drop-after' : 'drop-before');
    });
    el.addEventListener('drop', (e) => {
      if (draggedPage === null) return;
      e.preventDefault();
      const after = el.classList.contains('drop-after');
      clear();
      const from = draggedPage;
      let to = i + (after ? 1 : 0);
      if (from < to) to -= 1;
      draggedPage = null;
      if (from === to) return;
      const current = deck.pages[pageIndex];
      const [moved] = deck.pages.splice(from, 1);
      deck.pages.splice(to, 0, moved);
      pageIndex = deck.pages.indexOf(current);
      changed({ pages: true });
    });
  }

  $('pageName').addEventListener('input', (e) => { page().name = e.target.value; changed({ board: false }); renderPageNames(); });
  function renderPageNames() {
    [...$('pageList').children].forEach((el, i) => { el.querySelector('.name').textContent = deck.pages[i].name || `Page ${i + 1}`; });
  }
  $('addPage').addEventListener('click', () => {
    deck.pages.push({ name: `Page ${deck.pages.length + 1}`, cols: GRID.cols, rows: GRID.rows, buttons: [] });
    pageIndex = deck.pages.length - 1; selected = null;
    renderAll(); changed({ pages: true });
    $('pageName').select();
  });
  $('deletePage').addEventListener('click', () => {
    if (deck.pages.length === 1) return toast('You need at least one page.');
    const n = page().buttons.length;
    if (n && !confirm(`Delete "${page().name}" and its ${n} button${n === 1 ? '' : 's'}?`)) return;
    deck.pages.splice(pageIndex, 1);
    pageIndex = Math.max(0, pageIndex - 1); selected = null;
    renderAll(); changed({ pages: true });
  });
  function movePage(dir) {
    const j = pageIndex + dir;
    if (j < 0 || j >= deck.pages.length) return;
    [deck.pages[pageIndex], deck.pages[j]] = [deck.pages[j], deck.pages[pageIndex]];
    pageIndex = j;
    changed({ pages: true });
  }
  $('pageLeft').addEventListener('click', () => movePage(-1));
  $('pageRight').addEventListener('click', () => movePage(1));

  // Changing the grid keeps every button: ones that no longer fit move to a
  // free spot (shrinking if needed). If there's no room, nothing changes.
  function resizeGrid(dc, dr) {
    const p = page();
    const next = { ...p, cols: p.cols + dc, rows: p.rows + dr, buttons: [] };
    const outside = [];
    p.buttons.forEach((b) => (b.x + b.w <= next.cols && b.y + b.h <= next.rows ? next.buttons : outside).push({ ...b }));
    for (const b of outside) {
      const [mw, mh] = minSize(b);
      b.w = Math.max(mw, Math.min(b.w, next.cols)); b.h = Math.max(mh, Math.min(b.h, next.rows));
      let spot = freeSpot(next, b.w, b.h);
      if (!spot) { b.w = mw; b.h = mh; spot = freeSpot(next, mw, mh); }
      if (!spot) return toast('Not enough room. Remove or shrink some buttons first.');
      Object.assign(b, spot);
      next.buttons.push(b);
    }
    deck.pages[pageIndex] = next;
    changed({ pages: true, inspector: true });
  }
  $('colsDown').addEventListener('click', () => resizeGrid(-1, 0));
  $('colsUp').addEventListener('click', () => resizeGrid(1, 0));
  $('rowsDown').addEventListener('click', () => resizeGrid(0, -1));
  $('rowsUp').addEventListener('click', () => resizeGrid(0, 1));

  // ------------------------------------------------------------------ board
  function keyContent(b) {
    const inner = document.createElement('span');
    inner.className = 'inner';
    if (b.widget) {
      const w = widgetById(b.widget);
      inner.insertAdjacentHTML('beforeend', ICONS[w.icon]);
      const s = document.createElement('span'); s.className = 'label'; s.textContent = w.en; inner.appendChild(s);
      return inner;
    }
    const a = b.action;
    const sys = a.type === 'system' && systemById(a.id);
    if (b.icon) {
      const e = document.createElement('span'); e.className = 'emoji'; e.textContent = b.icon; inner.appendChild(e);
    } else if (a.type === 'open' && a.target.endsWith('.app')) {
      const img = new Image(); img.src = appIconUrl(a.target);
      img.onerror = () => img.replaceWith(letter(b.label || a.target.split('/').pop()));
      inner.appendChild(img);
    } else if (sys) {
      inner.insertAdjacentHTML('beforeend', ICONS[sys.icon]);
    } else {
      inner.appendChild(letter(b.label || 'Button'));
    }
    const text = b.label || (sys ? sys.en : '');
    if (text) { const s = document.createElement('span'); s.className = 'label'; s.textContent = text; inner.appendChild(s); }
    return inner;
  }
  function letter(name) { const d = document.createElement('div'); d.className = 'letter'; d.textContent = (name || '?')[0]; return d; }

  // Where each button was before the last render, so moved and resized
  // buttons can glide to their new place instead of jumping (FLIP).
  let boardPage = null;
  function renderBoard() {
    const board = $('board');
    const p = page();
    const before = new Map();
    const samePage = boardPage === pageIndex;
    if (samePage) board.querySelectorAll('.key[data-id]').forEach((el) => before.set(el.dataset.id, el.getBoundingClientRect()));
    boardPage = pageIndex;
    board.innerHTML = '';
    board.style.setProperty('--cols', p.cols);
    board.style.setProperty('--rows', p.rows);

    const taken = occupied(p);
    for (let y = 0; y < p.rows; y++) for (let x = 0; x < p.cols; x++) {
      if (taken.has(x + ',' + y)) continue;
      const cell = document.createElement('div');
      cell.className = 'cell' + (selected && !selected.id && selected.x === x && selected.y === y ? ' selected' : '');
      cell.textContent = '+';
      place(cell, x, y, 1, 1);
      cell.addEventListener('click', () => { selected = { x, y }; renderBoard(); renderInspector(); });
      board.appendChild(cell);
    }

    p.buttons.forEach((b) => {
      const el = document.createElement('div');
      el.className = 'key' + (selected && selected.id === b.id ? ' selected' : '');
      el.dataset.id = b.id;
      if (b.color) { el.classList.add('colored'); el.style.setProperty('--c', b.color); }
      if (b.widget) el.classList.add('widget-tile');
      place(el, b.x, b.y, b.w, b.h);
      el.appendChild(keyContent(b));
      const type = b.widget ? { icon: 'widget' } : TYPES.find((x) => x.id === b.action.type);
      if (type && type.id !== 'system') el.insertAdjacentHTML('beforeend', `<span class="badge">${ICONS[type.icon]}</span>`);
      const handle = document.createElement('div');
      handle.className = 'handle';
      handle.title = 'Drag to resize';
      el.appendChild(handle);
      el.addEventListener('pointerdown', (e) => startDrag(e, b, el, e.target === handle ? 'resize' : 'move'));
      board.appendChild(el);
    });
    animateBoard(before, samePage);
  }

  function animateBoard(before, samePage) {
    if (reduceMotion) return;
    $('board').querySelectorAll('.key[data-id]').forEach((el, i) => {
      if (!samePage) { el.style.setProperty('--i', i); el.classList.add('enter'); return; }
      const old = before.get(el.dataset.id);
      if (!old) { el.classList.add('pop'); return; }
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left, dy = old.top - now.top;
      const sx = old.width / now.width, sy = old.height / now.height;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
      el.animate([
        { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transformOrigin: 'top left', transform: 'none' },
      ], { duration: 420, easing: 'cubic-bezier(.2, .9, .3, 1.1)' });
    });
  }

  // Move / resize with the pointer. A ghost shows where the button will land:
  // green if it fits, red if it would overlap or leave the grid.
  function startDrag(e, b, el, mode) {
    e.preventDefault();
    const p = page();
    const start = cellAt(e.clientX, e.clientY);
    const grab = { dx: start.x - b.x, dy: start.y - b.y };
    const [mw, mh] = minSize(b);
    const sx = e.clientX, sy = e.clientY;
    let ghost = null, target = null, dropPage = null, moved = false;

    const onMove = (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      if (!moved) {
        moved = true;
        selected = { id: b.id }; renderBoard(); renderInspector();
        el = [...$('board').children].find((n) => n.classList.contains('selected'));
        el.classList.add('lifted');
        ghost = document.createElement('div'); ghost.className = 'ghost'; $('board').appendChild(ghost);
      }
      document.querySelectorAll('.page-item.drop').forEach((n) => n.classList.remove('drop'));
      const overPage = mode === 'move' && document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.page-item[data-page]');
      dropPage = overPage && Number(overPage.dataset.page) !== pageIndex ? Number(overPage.dataset.page) : null;
      if (dropPage !== null) { overPage.classList.add('drop'); ghost.style.display = 'none'; return; }
      ghost.style.display = '';
      const c = cellAt(ev.clientX, ev.clientY);
      target = mode === 'move'
        ? { x: Math.max(0, Math.min(p.cols - b.w, c.x - grab.dx)), y: Math.max(0, Math.min(p.rows - b.h, c.y - grab.dy)), w: b.w, h: b.h }
        : { x: b.x, y: b.y, w: Math.max(mw, c.x - b.x + 1), h: Math.max(mh, c.y - b.y + 1) };
      place(ghost, target.x, target.y, target.w, target.h);
      ghost.classList.toggle('bad', !fits(p, target.x, target.y, target.w, target.h, b.id));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.querySelectorAll('.page-item.drop').forEach((n) => n.classList.remove('drop'));
      if (!moved) { selected = { id: b.id }; renderBoard(); renderInspector(); return; }
      if (dropPage !== null) return moveToPage(b, dropPage);
      if (target && fits(p, target.x, target.y, target.w, target.h, b.id)) {
        Object.assign(b, target);
        changed({ pages: true, inspector: true });
      } else {
        renderBoard();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function moveToPage(b, i) {
    const dest = deck.pages[i];
    const [mw, mh] = minSize(b);
    let w = Math.min(b.w, dest.cols), h = Math.min(b.h, dest.rows);
    let spot = freeSpot(dest, w, h);
    if (!spot) { w = mw; h = mh; spot = freeSpot(dest, w, h); }
    if (!spot) { toast(`"${dest.name}" is full.`); return renderBoard(); }
    page().buttons = page().buttons.filter((x) => x !== b);
    dest.buttons.push(Object.assign(b, spot, { w, h }));
    selected = null;
    toast(`Moved to "${dest.name}".`);
    changed({ pages: true, inspector: true });
  }

  function deleteSelected() {
    const b = current();
    if (!b) return;
    page().buttons = page().buttons.filter((x) => x !== b);
    selected = { x: b.x, y: b.y };
    changed({ pages: true, inspector: true });
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, .recorder')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && current()) { e.preventDefault(); deleteSelected(); }
    if (e.key === 'Escape') { selected = null; renderBoard(); renderInspector(); }
  });

  // ------------------------------------------------------------------ inspector
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    children.flat().forEach((c) => c != null && el.append(c));
    return el;
  }

  function defaultAction(type) {
    if (type === 'hotkey') return { type, code: '', mods: [] };
    if (type === 'open') return { type, target: '' };
    if (type === 'command') return { type, command: '' };
    if (type === 'text') return { type, text: '' };
    if (type === 'system') return { type, id: 'media_toggle' };
    return { type: 'none' };
  }

  function add(item) {
    const nb = { id: newId(), ...item, x: selected.x, y: selected.y };
    page().buttons.push(nb);
    selected = { id: nb.id };
    changed({ pages: true, inspector: true });
  }

  // A widget starts at its first preset that fits at the chosen cell.
  function addWidget(w) {
    const p = page();
    const size = [...w.sizes, w.min].find(([cw, ch]) => fits(p, selected.x, selected.y, cw, ch));
    if (!size) return toast(`Not enough room here for ${w.en} (needs ${w.min[0]} × ${w.min[1]}).`);
    add({ widget: w.id, w: size[0], h: size[1] });
  }

  function sizeButtons(b, presets) {
    const sizes = h('div', { class: 'sizes' });
    presets.forEach(([w, hh]) => {
      const ok = fits(page(), b.x, b.y, w, hh, b.id);
      const cells = Array.from({ length: w * hh }, () => h('b'));
      const icon = h('i', {}, cells);
      icon.style.gridTemplateColumns = `repeat(${w}, 9px)`;
      sizes.append(h('button', {
        class: 'size' + (b.w === w && b.h === hh ? ' active' : ''), disabled: !ok, title: `${w} × ${hh}`,
        onclick: () => { Object.assign(b, { w, h: hh }); changed({ inspector: true }); },
      }, icon));
    });
    return sizes;
  }

  const WIDGET_HINTS = {
    now_playing: 'What\'s playing in your browser, with artwork, a seek bar and controls. One row high, it shows a compact player.',
    clock: 'The time and date, sized to fit.',
    calendar: 'Today\'s date on small tiles; the whole month from 2 × 2 up.',
    volume: 'A bar to drag, with mute. Make it tall for a vertical slider.',
    brightness: 'Your Mac\'s built-in display. Make it tall for a vertical slider.',
    stats: 'CPU, memory and battery.',
  };

  function renderWidgetInspector(box, b) {
    const w = widgetById(b.widget);
    box.append(
      h('h2', {}, w.en),
      h('div', { class: 'section' },
        h('p', { class: 'empty-state' }, WIDGET_HINTS[b.widget] || ''),
        h('div', { class: 'field' }, h('span', { class: 'field-title' }, 'Size'), sizeButtons(b, w.sizes),
          h('div', { class: 'hint' }, `Or drag the round handle on its corner. Smallest: ${w.min[0]} × ${w.min[1]}.`))),
      h('div', { class: 'actions' }, h('button', { class: 'btn danger', onclick: deleteSelected }, 'Delete widget')),
    );
  }

  // The panel slides in when the selection changes, not on every edit.
  let inspected = null;
  function renderInspector() {
    const box = $('inspector');
    box.innerHTML = '';
    const key = selected ? (selected.id || `${pageIndex}:${selected.x},${selected.y}`) : null;
    if (key !== inspected && !reduceMotion) { box.classList.remove('fresh'); void box.offsetWidth; box.classList.add('fresh'); }
    inspected = key;
    if (!selected) {
      box.append(h('h2', {}, 'Nothing selected'), h('p', { class: 'empty-state' }, 'Click a button on the left to change it, or an empty cell to add a new one.'));
      return;
    }
    const b = current();

    if (!b) {
      box.append(h('h2', {}, 'Add here'), h('p', { class: 'empty-state' }, 'A button that does something:'));
      const chooser = h('div', { class: 'chooser' });
      TYPES.forEach((type) => chooser.append(h('button', {
        class: 'type', html: `${ICONS[type.icon]}<div>${type.name}<small>${type.desc}</small></div>`,
        onclick: () => add({ label: '', icon: '', color: '', action: defaultAction(type.id), w: 1, h: 1 }),
      })));
      const widgets = h('div', { class: 'widget-choices' });
      WIDGETS.forEach((w) => widgets.append(h('button', {
        class: 'type', html: ICONS[w.icon] + w.en, onclick: () => addWidget(w),
      })));
      box.append(chooser, h('p', { class: 'empty-state' }, 'Or a widget:'), widgets);
      return;
    }

    if (b.widget) return renderWidgetInspector(box, b);

    const title = b.label || (b.action.type === 'system' ? sysName(b.action.id) : 'Button');

    // -- look
    const labelInput = h('input', { type: 'text', maxlength: 40, placeholder: b.action.type === 'system' ? sysName(b.action.id) : 'Label' });
    labelInput.value = b.label;
    labelInput.addEventListener('input', () => { b.label = labelInput.value; changed(); });
    const iconInput = h('input', { type: 'text', maxlength: 16 });
    iconInput.value = b.icon;
    iconInput.addEventListener('input', () => { b.icon = iconInput.value.trim(); changed(); });
    const swatches = h('div', { class: 'swatches' });
    COLORS.forEach((c) => {
      const s = h('button', { class: 'swatch' + (c ? '' : ' none') + (b.color === c ? ' active' : ''), title: c || 'Default' });
      if (c) s.style.setProperty('--c', c);
      s.addEventListener('click', () => { b.color = c; changed({ inspector: true }); });
      swatches.append(s);
    });

    // -- size
    const sizes = sizeButtons(b, SIZES);

    const look = h('div', { class: 'section' },
      h('label', { class: 'field' }, h('span', { class: 'field-title' }, 'Label'), labelInput),
      h('div', { class: 'field' }, h('span', { class: 'field-title' }, 'Icon'),
        h('div', { class: 'icon-row' }, iconInput),
        h('div', { class: 'hint' }, 'Any emoji. Press ⌃⌘Space to pick one. Leave empty for the default icon.')),
      h('div', { class: 'field' }, h('span', { class: 'field-title' }, 'Color'), swatches),
      h('div', { class: 'field' }, h('span', { class: 'field-title' }, 'Size'), sizes,
        h('div', { class: 'hint' }, 'Or drag the round handle on the button\'s corner. Sizes that would overlap another button are greyed out.')),
    );

    // -- action
    const types = h('div', { class: 'types' });
    TYPES.forEach((type) => types.append(h('button', {
      class: 'type' + (b.action.type === type.id ? ' active' : ''),
      html: ICONS[type.icon] + type.name,
      onclick: () => { if (b.action.type !== type.id) { b.action = defaultAction(type.id); changed({ inspector: true }); } },
    })));
    const act = h('div', { class: 'section' }, h('span', { class: 'field-title' }, 'Action'), types, actionFields(b));

    const result = h('div', { class: 'test-result' });
    const tools = h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => test(b, result) }, '▶ Try it'),
      h('button', { class: 'btn danger', onclick: deleteSelected }, 'Delete button'),
    );

    box.append(h('h2', {}, title), look, act, tools, result);
  }

  function actionFields(b) {
    const a = b.action;
    const wrap = h('div');

    if (a.type === 'hotkey') {
      const rec = h('div', { class: 'recorder', tabindex: 0 });
      const draw = () => {
        rec.innerHTML = '';
        if (!a.code) { rec.append(h('span', { class: 'placeholder' }, 'Click here, then press the shortcut')); return; }
        MOD_ORDER.forEach(([m, sym]) => { if (a.mods.includes(m)) rec.append(h('kbd', {}, sym)); });
        rec.append(h('kbd', {}, keyName(a.code)));
      };
      rec.addEventListener('keydown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!meta.keys.includes(e.code)) return; // modifier on its own, or an unsupported key
        a.code = e.code;
        a.mods = [e.ctrlKey && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift', e.metaKey && 'cmd'].filter(Boolean);
        draw(); renderMods(); changed(); rec.blur();
      });
      draw();

      const mods = h('div', { class: 'mods' });
      const keySelect = h('select');
      keySelect.append(h('option', { value: '' }, '—'));
      meta.keys.forEach((code) => keySelect.append(h('option', { value: code }, keyName(code))));
      keySelect.addEventListener('change', () => { a.code = keySelect.value; draw(); changed(); });
      function renderMods() {
        mods.innerHTML = '';
        MOD_ORDER.forEach(([m, sym]) => mods.append(h('button', {
          class: a.mods.includes(m) ? 'on' : '',
          onclick: () => { a.mods = a.mods.includes(m) ? a.mods.filter((x) => x !== m) : [...a.mods, m]; renderMods(); draw(); changed(); },
        }, sym)));
        keySelect.value = a.code || '';
      }
      renderMods();
      wrap.append(rec, h('div', { class: 'or' }, 'or pick by hand'), mods,
        h('label', { class: 'field' }, h('span', { class: 'field-title' }, 'Key'), keySelect),
        h('div', { class: 'hint' }, 'Some shortcuts (like ⌘Q or ⌘Tab) are taken by the browser. Pick those by hand.'));
    }

    if (a.type === 'open') {
      const select = h('select');
      select.append(h('option', { value: '' }, 'Choose an app…'));
      meta.apps.forEach((app) => select.append(h('option', { value: app.path }, app.name)));
      select.value = appByPath(a.target) ? a.target : '';
      const icon = h('img', { alt: '' });
      const url = h('input', { type: 'text', placeholder: 'https://… or ~/Folder' });
      url.value = appByPath(a.target) ? '' : a.target;
      const syncIcon = () => { const app = appByPath(a.target); icon.style.display = app ? '' : 'none'; if (app) icon.src = appIconUrl(a.target); };
      select.addEventListener('change', () => {
        a.target = select.value; url.value = '';
        const app = appByPath(a.target);
        if (app && !b.label) b.label = app.name;
        changed({ inspector: true });
      });
      url.addEventListener('input', () => { a.target = url.value; select.value = ''; syncIcon(); changed(); });
      syncIcon();
      wrap.append(
        h('label', { class: 'field' }, h('span', { class: 'field-title' }, 'App'), h('div', { class: 'app-pick' }, icon, select)),
        h('div', { class: 'or' }, 'or'),
        h('label', { class: 'field' }, h('span', { class: 'field-title' }, 'Website or folder'), url,
          h('div', { class: 'hint' }, 'e.g. https://github.com or ~/Projects')),
      );
    }

    if (a.type === 'command') {
      const area = h('textarea', { class: 'mono', spellcheck: 'false', placeholder: 'orb start' });
      area.value = a.command;
      area.addEventListener('input', () => { a.command = area.value; changed(); });
      wrap.append(h('label', { class: 'field' }, h('span', { class: 'field-title' }, 'Command'), area,
        h('div', { class: 'hint', html: 'Runs in zsh like your terminal, so PATH and aliases work. Examples: <kbd>orb start</kbd>, <kbd>cd ~/Projects/app && npm run build</kbd>' })));
    }

    if (a.type === 'text') {
      const area = h('textarea');
      area.value = a.text;
      area.addEventListener('input', () => { a.text = area.value; changed(); });
      wrap.append(h('label', { class: 'field' }, h('span', { class: 'field-title' }, 'Text'), area,
        h('div', { class: 'hint' }, 'Typed into whichever app is focused. New lines press Return.')));
    }

    if (a.type === 'system') {
      const grid = h('div', { class: 'systems' });
      SYSTEM.forEach((s) => grid.append(h('button', {
        class: 'type' + (a.id === s.id ? ' active' : ''),
        html: ICONS[s.icon] + s.en,
        onclick: () => { a.id = s.id; changed({ inspector: true }); },
      })));
      wrap.append(grid);
    }
    return wrap;
  }

  async function test(b, out) {
    out.className = 'test-result'; out.textContent = '…';
    try {
      const r = await api('/api/editor/test', { action: b.action });
      out.className = 'test-result ' + (r.ok ? 'ok' : 'bad');
      const why = r.error === 'accessibility' ? 'needs Accessibility permission (see the banner above)' : r.error || r.output;
      out.textContent = r.ok ? `✓ Done${r.running ? ', still running' : ''}${r.output ? ': ' + r.output : ''}` : `✗ Didn't work${why ? ': ' + why : ''}`;
    } catch (e) {
      out.className = 'test-result bad'; out.textContent = '✗ ' + e.message;
    }
  }

  // ------------------------------------------------------------------ accessibility banner
  function renderBanner() {
    $('axBanner').hidden = meta.accessibility;
    $('main').classList.toggle('with-banner', !meta.accessibility);
  }
  $('axButton').addEventListener('click', async () => {
    await api('/api/editor/accessibility', {});
    $('axText').textContent = 'Now turn on the app running Tapdeck (e.g. Terminal) in System Settings → Privacy & Security → Accessibility.';
  });
  window.addEventListener('focus', async () => {
    try { meta.accessibility = (await api('/api/editor/meta')).accessibility; renderBanner(); } catch {}
  });

  // ------------------------------------------------------------------ start
  function renderAll() { renderPages(); renderBoard(); renderInspector(); }

  (async () => {
    [deck, meta] = await Promise.all([api('/api/editor/deck'), api('/api/editor/meta')]);
    renderBanner();
    renderAll();
  })();
})();
