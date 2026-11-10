(() => {
  const { LANG, ICONS, systemById } = window.Tapdeck;

  // ------------------------------------------------------------------ i18n
  const STRINGS = {
    en: {
      battery: 'Battery', offline: "Can't reach your Mac. Start Tapdeck on it.", gateTitle: 'Open from your Mac',
      gateText: 'Start Tapdeck on your Mac and scan the QR code at 127.0.0.1:8765/connect.',
      keysTitle: 'Media keys', keysArtist: 'Nothing playing in the browser. Buttons work like your keyboard\'s media keys.',
      keysOff: 'Media keys need Accessibility permission on the Mac.',
      tapAgain: 'Tap again', failed: 'That didn\'t work', done: 'Done', running: 'Running…',
      saved: 'Screenshot saved', locked: 'Mac locked', awakeOn: 'Mac will stay awake', awakeOff: 'Mac can sleep again',
      cpu: 'CPU', ram: 'RAM',
      err_accessibility: 'Allow Accessibility for Tapdeck in System Settings → Privacy & Security.',
      err_automation: 'Allow Tapdeck to control System Events (Privacy & Security → Automation).',
      err_unsupported: 'This page can\'t do that.', err_bad_request: 'This button no longer exists.',
    },
    tr: {
      battery: 'Pil', offline: "Mac'e ulaşılamıyor. Mac'te Tapdeck'i başlat.", gateTitle: "Mac'ten aç",
      gateText: "Mac'te Tapdeck'i başlat ve 127.0.0.1:8765/connect sayfasındaki QR kodu okut.",
      keysTitle: 'Medya tuşları', keysArtist: 'Tarayıcıda çalan bir şey yok. Tuşlar klavyedeki medya tuşları gibi çalışır.',
      keysOff: "Medya tuşları için Mac'te Erişilebilirlik izni gerekli.",
      tapAgain: 'Tekrar dokun', failed: 'Olmadı, tekrar dene', done: 'Tamam', running: 'Çalışıyor…',
      saved: 'Ekran görüntüsü kaydedildi', locked: 'Mac kilitlendi', awakeOn: 'Mac uyumayacak', awakeOff: 'Mac yine uyuyabilir',
      cpu: 'CPU', ram: 'RAM',
      err_accessibility: 'Sistem Ayarları → Gizlilik ve Güvenlik → Erişilebilirlik’ten Tapdeck’e izin ver.',
      err_automation: 'Tapdeck’in System Events’i kontrol etmesine izin ver (Gizlilik ve Güvenlik → Otomasyon).',
      err_unsupported: 'Bu sayfa bunu desteklemiyor.', err_bad_request: 'Bu tuş artık yok.',
    },
  };
  const t = (k) => STRINGS[LANG][k] || STRINGS.en[k] || k;
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Restart a CSS animation class on an element.
  function replay(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  // In portrait the screen is turned 90° (see phone.css), so a touch's
  // position inside an element comes from the other axis.
  const turned = window.matchMedia('(orientation: portrait)');
  function pointIn(el, e) {
    const r = el.getBoundingClientRect();
    return turned.matches
      ? { x: e.clientY - r.top, y: r.right - e.clientX, w: r.height, h: r.width }
      : { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  }

  // A ripple from where the finger touched.
  function ripple(el, e) {
    if (reduceMotion) return;
    const p = pointIn(el, e);
    const size = Math.max(p.w, p.h) * 2.2;
    const dot = document.createElement('span');
    dot.className = 'ripple';
    dot.style.cssText = `width:${size}px;height:${size}px;left:${p.x - size / 2}px;top:${p.y - size / 2}px`;
    el.appendChild(dot);
    dot.addEventListener('animationend', () => dot.remove());
  }

  // Green glow if the Mac did it, a shake if it didn't.
  function feedback(el, result) {
    if (!reduceMotion) replay(el, result && result.ok ? 'ok' : 'fail');
  }

  function h(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html.trim();
    return tpl.content.firstElementChild;
  }

  // ------------------------------------------------------------------ api
  const params = new URLSearchParams(location.search);
  let TOKEN = params.get('t') || '';
  try {
    if (TOKEN) localStorage.setItem('tapdeckToken', TOKEN);
    else TOKEN = localStorage.getItem('tapdeckToken') || '';
  } catch {}
  if (!TOKEN) { $('gate').classList.add('show'); return; }

  let failures = 0;
  async function api(path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(path, {
        method: body ? 'POST' : 'GET',
        headers: { 'X-Token': TOKEN, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal, cache: 'no-store',
      });
      if (res.status === 401) { $('gate').classList.add('show'); throw new Error('unauthorized'); }
      const data = await res.json();
      failures = 0; $('offline').classList.remove('show');
      return data;
    } catch (e) {
      if (++failures >= 2) $('offline').classList.add('show');
      throw e;
    } finally { clearTimeout(timer); }
  }

  async function act(action, value, okMessage) {
    try {
      const r = await api('/api/action', { action, value });
      if (!r.ok) toast(r.error ? t('err_' + r.error) : (r.output || t('failed')));
      else if (r.error) toast(t('err_' + r.error));
      else if (r.running) toast(t('running'));
      else if (r.output) toast(r.output);
      else if (okMessage) toast(okMessage);
      return r;
    } catch { return { ok: false }; }
  }

  let toastTimer;
  function toast(text) {
    const el = $('toast');
    el.textContent = text; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function throttle(fn, ms) {
    let last = 0, timer = null, args;
    return (...a) => {
      args = a;
      const wait = ms - (Date.now() - last);
      if (wait <= 0) { last = Date.now(); fn(...args); }
      else if (!timer) timer = setTimeout(() => { timer = null; last = Date.now(); fn(...args); }, wait);
    };
  }

  // ------------------------------------------------------------------ sliders
  // Tap or drag anywhere on the bar to set the value. A bar taller than it
  // is wide works vertically, filling from the bottom. The CSS draws the
  // fill from --v (0 to 1).
  class Slider {
    constructor(el, { max = 100, onInput, onChange, onDraw } = {}) {
      Object.assign(this, { el, max, onInput, onChange, onDraw, value: 0, dragging: false, holdUntil: 0 });
      el.addEventListener('pointerdown', (e) => {
        this.dragging = true; try { el.setPointerCapture(e.pointerId); } catch {} el.classList.add('active'); this.move(e);
      });
      el.addEventListener('pointermove', (e) => { if (this.dragging) this.move(e); });
      const end = () => {
        if (!this.dragging) return;
        this.dragging = false; el.classList.remove('active');
        this.holdUntil = Date.now() + 1500; // ignore polled values until the Mac catches up
        this.onChange && this.onChange(this.value);
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
    move(e) {
      const p = pointIn(this.el, e);
      const vertical = this.el.clientHeight > this.el.clientWidth * 1.2;
      const f = vertical ? 1 - p.y / p.h : p.x / p.w;
      this.draw(Math.min(1, Math.max(0, f)) * this.max);
      this.onInput && this.onInput(this.value);
    }
    draw(v) {
      this.value = v;
      this.el.style.setProperty('--v', this.max ? v / this.max : 0);
      this.onDraw && this.onDraw(v);
    }
    busy() { return this.dragging || Date.now() < this.holdUntil; }
    update(v, max) {
      if (max !== undefined) this.max = max;
      if (!this.busy()) this.draw(v);
    }
  }

  const fmt = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
    return hh ? `${hh}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };

  // ------------------------------------------------------------------ pages
  const pagesEl = $('pages');
  let pageNames = [];
  let pageHasPlayer = [];
  const pageCount = () => pagesEl.children.length;
  const currentPage = () => Math.round(pagesEl.scrollLeft / pagesEl.clientWidth);
  let shownPage = -1;
  function renderDots() {
    $('dots').innerHTML = '';
    for (let i = 0; i < pageCount(); i++) {
      const b = document.createElement('button');
      b.setAttribute('aria-label', pageNames[i] || `Page ${i + 1}`);
      b.appendChild(document.createElement('span'));
      b.addEventListener('click', () => goTo(i, true));
      $('dots').appendChild(b);
    }
    followScroll();
  }
  function goTo(i, smooth) {
    pagesEl.scrollTo({ left: i * pagesEl.clientWidth, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' });
    markPage(i);
    followScroll();
  }
  function markPage(i) {
    if (i === shownPage) return;
    shownPage = i;
    try { localStorage.setItem('tapdeckPage', String(i)); } catch {}
    const page = pagesEl.children[i];
    if (page && !reduceMotion) {
      replay(page, 'enter');
      clearTimeout(page.enterTimer);
      page.enterTimer = setTimeout(() => page.classList.remove('enter'), 1200);
    }
  }
  function savedPage() {
    try { return Math.min(pageCount() - 1, Number(localStorage.getItem('tapdeckPage')) || 0); } catch { return 0; }
  }

  // While swiping, pages away from the center shrink and fade a little, the
  // dots stretch toward the page you're heading to, and the artwork glow
  // shows only around pages with a Now Playing widget.
  let scrollFrame = 0;
  let settleTimer = null;
  function followScroll() {
    scrollFrame = 0;
    const pos = pagesEl.scrollLeft / (pagesEl.clientWidth || 1);
    let glow = 0;
    [...pagesEl.children].forEach((page, i) => {
      const d = Math.min(1, Math.abs(i - pos));
      if (pageHasPlayer[i]) glow = Math.max(glow, 1 - d);
      const body = page.firstElementChild;
      if (body && !reduceMotion) {
        body.style.transform = d > 0.001 ? `scale(${1 - 0.08 * d})` : '';
        body.style.opacity = d > 0.001 ? String(1 - 0.45 * d) : '';
      }
    });
    $('ambient').style.setProperty('--show', glow.toFixed(3));
    [...$('dots').children].forEach((dot, i) => {
      const near = Math.max(0, 1 - Math.abs(i - pos));
      dot.firstChild.style.width = 7 + 13 * near + 'px';
      dot.classList.toggle('active', near > 0.5);
    });
  }
  pagesEl.addEventListener('scroll', () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(followScroll);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => markPage(currentPage()), 120);
  }, { passive: true });
  window.addEventListener('resize', () => goTo(savedPage()));

  // ------------------------------------------------------------------ shared state
  let media = { source: 'keys' };
  let mediaAt = Date.now();
  let optimisticUntil = 0;
  let muted = false;
  let muteHoldUntil = 0;
  let stats = {};

  // What's mounted on the pages, so updates reach every copy of a widget.
  let players = [];
  let levels = { volume: [], brightness: [] };
  let clocks = [];
  let calendars = [];
  let statWidgets = [];
  let stateKeys = [];

  // ------------------------------------------------------------------ artwork
  // Artwork, in the widgets and the glow behind the page, cross-fades.
  function crossfade(box, url) {
    if ((box.dataset.url || '') === (url || '')) return;
    box.dataset.url = url || '';
    if (!url) {
      box.querySelectorAll('.layer').forEach(fadeOut);
      box.classList.remove('loaded');
      return;
    }
    const img = new Image();
    img.className = 'layer';
    img.alt = '';
    img.onload = () => {
      if (box.dataset.url !== url) return;
      const old = [...box.querySelectorAll('.layer')];
      box.appendChild(img);
      void img.offsetWidth; // start from the hidden state so the fade runs
      img.classList.add('in');
      old.forEach(fadeOut);
      box.classList.add('loaded');
    };
    img.src = url;
  }
  function fadeOut(el) { el.classList.remove('in'); setTimeout(() => el.remove(), 900); }

  // Set text, sliding it in when it actually changed (a new track).
  function setText(el, text) {
    if (el.textContent === text) return;
    const first = !el.textContent;
    el.textContent = text;
    if (!first && !reduceMotion) replay(el, 'swap');
  }

  // ------------------------------------------------------------------ widget: now playing
  function livePosition() {
    if (!media.playing) return media.position || 0;
    return Math.min(media.duration || Infinity, (media.position || 0) + (Date.now() - mediaAt) / 1000);
  }

  function mountNowPlaying(el) {
    el.classList.add('w-now');
    el.innerHTML = `
      <div class="np-art">${ICONS.music}</div>
      <div class="np-info">
        <div class="np-source"><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="np-site"></span></div>
        <div class="np-title"></div>
        <div class="np-artist"></div>
        <div class="np-note" hidden></div>
      </div>
      <div class="np-progress"><span class="np-el">0:00</span><div class="seek"><div class="track"><div class="fill"></div></div></div><span class="np-dur">0:00</span></div>
      <div class="np-controls">
        <button class="prev press" aria-label="Previous">${ICONS.prev}</button>
        <button class="play press" aria-label="Play/Pause"></button>
        <button class="next press" aria-label="Next">${ICONS.next}</button>
      </div>`;
    const q = (sel) => el.querySelector(sel);
    const p = {
      art: q('.np-art'), source: q('.np-source'), site: q('.np-site'), title: q('.np-title'), artist: q('.np-artist'),
      note: q('.np-note'), progress: q('.np-progress'), elapsed: q('.np-el'), duration: q('.np-dur'), play: q('.play'), shown: null,
    };
    p.seek = new Slider(q('.seek'), {
      max: 1,
      onInput: (v) => { p.elapsed.textContent = fmt(v); },
      onChange: (v) => { media.position = v; mediaAt = Date.now(); act('seek', v); },
    });
    p.play.addEventListener('click', async () => {
      if (media.source === 'ext') {
        media.playing = !media.playing; media.position = livePosition(); mediaAt = Date.now();
        optimisticUntil = Date.now() + 1500;
        players.forEach((o) => renderPlay(o, media.playing));
      }
      const r = await act('media', 'toggle');
      if (!r.ok) feedback(p.play, r);
    });
    q('.next').addEventListener('click', async () => feedback(q('.next'), await act('media', 'next')));
    q('.prev').addEventListener('click', async () => feedback(q('.prev'), await act('media', 'prev')));
    el.querySelectorAll('button').forEach((b) => b.addEventListener('pointerdown', (e) => ripple(b, e)));
    renderPlay(p, false);
    players.push(p);
  }

  function renderPlay(p, playing) {
    if (playing === p.shown) return;
    const first = p.shown === null;
    p.shown = playing;
    p.play.innerHTML = playing ? ICONS.pause : ICONS.play;
    if (!first && !reduceMotion) replay(p.play, 'morph');
  }

  function renderMedia() {
    const ext = media.source === 'ext';
    const art = ext ? media.artwork : '';
    players.forEach((p) => {
      p.source.classList.toggle('live', ext && media.playing);
      p.site.textContent = ext ? media.site : t('keysTitle');
      setText(p.title, ext ? (media.title || media.site) : t('keysTitle'));
      setText(p.artist, ext ? [media.artist, media.album].filter(Boolean).join(' · ') : t('keysArtist'));
      p.note.hidden = ext || media.keys !== false;
      p.note.textContent = t('keysOff');
      if (Date.now() > optimisticUntil) renderPlay(p, ext && media.playing);
      crossfade(p.art, art);
      p.progress.classList.toggle('off', !ext || !(media.duration > 0));
      p.seek.el.classList.toggle('disabled', !(ext && media.canSeek && media.duration > 0));
    });
    crossfade($('ambient'), players.length ? art : '');
    tickProgress();
  }

  function tickProgress() {
    if (media.source !== 'ext' || !(media.duration > 0)) return;
    const pos = livePosition();
    players.forEach((p) => {
      p.seek.update(pos, media.duration);
      if (!p.seek.dragging) p.elapsed.textContent = fmt(pos);
      p.duration.textContent = fmt(media.duration);
    });
  }
  setInterval(tickProgress, 250);

  // ------------------------------------------------------------------ widgets: volume and brightness
  function toggleMute() { muted = !muted; muteHoldUntil = Date.now() + 1500; renderStates(); return act('mute'); }

  function mountLevel(el, kind, tile) {
    el.classList.add('w-level');
    tile.classList.add('bare');
    el.innerHTML = `<button class="lvl-btn press" aria-label="${kind === 'volume' ? 'Mute' : 'Brightness'}">${kind === 'volume' ? ICONS.volume : ICONS.sunUp}</button>
      <div class="lvl-pill"><div class="fill"></div><div class="lbl"></div></div>`;
    const btn = el.querySelector('.lvl-btn');
    const label = el.querySelector('.lbl');
    const send = throttle((v) => act(kind, Math.round(v)), kind === 'volume' ? 120 : 80);
    const slider = new Slider(el.querySelector('.lvl-pill'), {
      onInput: (v) => {
        send(v);
        levels[kind].forEach((o) => { if (o !== slider) o.draw(v); });
        if (kind === 'volume' && muted) { muted = false; renderStates(); }
      },
      onChange: (v) => {
        act(kind, Math.round(v));
        levels[kind].forEach((o) => { o.holdUntil = slider.holdUntil; });
      },
      onDraw: (v) => { label.textContent = Math.round(v); },
    });
    slider.widget = tile;
    slider.btn = btn;
    btn.addEventListener('pointerdown', (e) => ripple(btn, e));
    if (kind === 'volume') btn.addEventListener('click', toggleMute);
    else btn.addEventListener('click', async () => feedback(btn, await act('brightness_up')));
    levels[kind].push(slider);
  }

  // ------------------------------------------------------------------ widgets: clock and calendar
  function mountClock(el) {
    el.classList.add('w-clock');
    el.innerHTML = '<div class="c-time"></div><div class="c-date"><span class="long"></span><span class="short"></span></div>';
    clocks.push({ time: el.querySelector('.c-time'), long: el.querySelector('.long'), short: el.querySelector('.short') });
    el.querySelector('.c-time').innerHTML = '<span></span><small></small>';
    tickClock();
  }

  function mountCalendar(el) {
    el.classList.add('w-cal');
    calendars.push(el);
    drawCalendar(el);
  }

  function drawCalendar(el) {
    const now = new Date();
    const day = now.getDate();
    const weekday = now.toLocaleDateString(LANG, { weekday: 'short' }).replace('.', '');
    const month = now.toLocaleDateString(LANG, { month: 'long' });
    // Weeks start on Monday in Turkish, Sunday in English.
    const firstDow = LANG === 'tr' ? 1 : 0;
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const lead = (first.getDay() - firstDow + 7) % 7;
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const names = [...Array(7)].map((_, i) => new Date(2023, 0, 1 + ((i + firstDow) % 7))
      .toLocaleDateString(LANG, { weekday: 'narrow' }));
    let cells = names.map((n) => `<span class="dow">${n}</span>`).join('');
    cells += '<span></span>'.repeat(lead);
    for (let d = 1; d <= days; d++) {
      const dow = new Date(now.getFullYear(), now.getMonth(), d).getDay();
      const cls = d === day ? 'today' : dow === 0 || dow === 6 ? 'weekend' : '';
      cells += `<span class="${cls}">${d}</span>`;
    }
    el.innerHTML = `
      <div class="cal-today"><span class="cal-wd">${weekday}</span><span class="cal-day">${day}</span><span class="cal-mon">${month}</span></div>
      <div class="cal-month"><div class="cal-head"><span>${month}</span> ${now.getFullYear()}</div><div class="cal-grid">${cells}</div></div>`;
    el.dataset.day = now.toDateString();
  }

  const timeFormat = new Intl.DateTimeFormat(LANG, { hour: '2-digit', minute: '2-digit' });
  function tickClock() {
    const now = new Date();
    const time = timeFormat.format(now);
    const parts = timeFormat.formatToParts(now);
    const digits = parts.filter((x) => x.type !== 'dayPeriod').map((x) => x.value).join('').trim();
    const period = (parts.find((x) => x.type === 'dayPeriod') || {}).value || '';
    const long = now.toLocaleDateString(LANG, { weekday: 'long', day: 'numeric', month: 'long' });
    const short = now.toLocaleDateString(LANG, { weekday: 'short', day: 'numeric' });
    $('time').textContent = time;
    $('date').textContent = long;
    clocks.forEach((c) => {
      c.time.firstChild.textContent = digits; c.time.lastChild.textContent = period;
      c.long.textContent = long; c.short.textContent = short;
    });
    calendars.forEach((el) => { if (el.dataset.day !== now.toDateString()) drawCalendar(el); });
  }
  setInterval(tickClock, 1000);

  // ------------------------------------------------------------------ widget: system
  const loadClass = (p) => (p >= 85 ? 'bad' : p >= 60 ? 'warn' : '');
  const RING_COLORS = { '': 'var(--accent)', warn: 'var(--warn)', bad: 'var(--danger)', good: 'var(--ok)' };

  function mountStats(el) {
    el.classList.add('w-stats');
    const ring = (key, name) => `<div class="st" data-key="${key}"><div class="st-ring">
      <svg viewBox="0 0 44 44"><circle class="bgc" cx="22" cy="22" r="18"/><circle class="fg" cx="22" cy="22" r="18"/></svg>
      <span class="st-val">–</span></div><span class="st-name">${name}</span></div>`;
    el.innerHTML = ring('cpu', t('cpu')) + ring('ram', t('ram')) + ring('bat', t('battery'));
    statWidgets.push(el);
    renderStats();
  }

  // { key: [percent, label, colorClass] } from the last /api/stats reply.
  function statValues() {
    const out = {};
    if (stats.cpu != null) out.cpu = [stats.cpu, stats.cpu + '%', loadClass(stats.cpu)];
    if (stats.memory) out.ram = [stats.memory.percent, stats.memory.percent + '%', loadClass(stats.memory.percent)];
    const bat = stats.battery;
    if (bat) out.bat = [bat.percent, (bat.charging ? '⚡' : '') + bat.percent + '%', bat.charging || bat.plugged ? 'good' : bat.percent <= 20 ? 'bad' : ''];
    return out;
  }

  function renderStats() {
    const v = statValues();
    setChip('cpuChip', v.cpu);
    setChip('ramChip', v.ram);
    setChip('batChip', v.bat);
    statWidgets.forEach((el) => el.querySelectorAll('.st').forEach((st) => {
      const val = v[st.dataset.key];
      st.classList.toggle('hidden', !val && st.dataset.key === 'bat' && stats.cpu != null);
      if (!val) return;
      const fg = st.querySelector('.fg');
      fg.style.strokeDashoffset = 113.1 * (1 - Math.min(100, val[0]) / 100);
      fg.style.stroke = RING_COLORS[val[2]];
      st.querySelector('.st-val').textContent = val[1];
    }));
  }

  function setChip(id, val) {
    const chip = $(id);
    chip.classList.toggle('hidden', !val);
    if (!val) return;
    const b = chip.querySelector('b');
    b.textContent = val[1]; b.className = val[2] || '';
  }

  const WIDGETS = {
    now_playing: mountNowPlaying,
    clock: mountClock,
    calendar: mountCalendar,
    volume: (el, tile) => mountLevel(el, 'volume', tile),
    brightness: (el, tile) => mountLevel(el, 'brightness', tile),
    stats: mountStats,
  };

  // ------------------------------------------------------------------ deck
  let deckVersion = null;
  const stateOf = { muted: () => muted, dark: () => !!stats.dark, caffeinate: () => !!stats.caffeinate };

  async function loadDeck() {
    try {
      const deck = await api('/api/deck');
      deckVersion = deck.version;
      const keep = savedPage();
      pagesEl.innerHTML = '';
      players = []; levels = { volume: [], brightness: [] }; clocks = []; calendars = []; statWidgets = []; stateKeys = [];
      pageNames = []; pageHasPlayer = [];
      shownPage = -1;
      deck.pages.forEach((page) => {
        const section = document.createElement('section');
        section.className = 'page';
        const grid = document.createElement('div');
        grid.className = 'deck';
        grid.style.setProperty('--cols', page.cols);
        grid.style.setProperty('--rows', page.rows);
        page.buttons.forEach((b, i) => grid.appendChild(b.widget ? renderWidget(b, i) : renderKey(b, i)));
        section.appendChild(grid);
        pagesEl.appendChild(section);
        pageNames.push(page.name);
        pageHasPlayer.push(page.buttons.some((b) => b.widget === 'now_playing'));
      });
      renderDots();
      goTo(Math.min(keep, pageCount() - 1));
      renderStates();
      renderMedia();
      renderStats();
    } catch { setTimeout(loadDeck, 3000); }
  }

  function place(el, b, index) {
    el.style.gridColumn = `${b.x + 1} / span ${b.w}`;
    el.style.gridRow = `${b.y + 1} / span ${b.h}`;
    el.style.setProperty('--i', index);
  }

  // The tile is the size container; the widget lays out an inner layer, since
  // container queries can only style what's inside the container.
  function renderWidget(b, index) {
    const tile = document.createElement('div');
    tile.className = 'widget';
    place(tile, b, index);
    const body = document.createElement('div');
    body.className = 'wb';
    tile.appendChild(body);
    const mount = WIDGETS[b.widget];
    if (mount) mount(body, tile);
    return tile;
  }

  function renderKey(b, index) {
    const el = document.createElement('button');
    el.className = 'key press';
    place(el, b, index);
    el.addEventListener('pointerdown', (e) => ripple(el, e));
    if (b.color) { el.classList.add('colored'); el.style.setProperty('--c', b.color); }
    const sys = b.system && systemById(b.system);
    if (sys && sys.state) { el.dataset.state = sys.state; stateKeys.push(el); }
    if (b.system === 'mute') el.classList.add('mute');

    const inner = document.createElement('span');
    inner.className = 'inner';
    if (b.icon) {
      const e = document.createElement('span'); e.className = 'emoji'; e.textContent = b.icon; inner.appendChild(e);
    } else if (b.appIcon) {
      const img = new Image(); img.alt = '';
      img.onerror = () => img.replaceWith(letter(b.fallback || b.label));
      img.src = `/api/deck/icon/${b.id}?t=${encodeURIComponent(TOKEN)}`;
      inner.appendChild(img);
    } else if (sys) {
      inner.insertAdjacentHTML('beforeend', ICONS[sys.icon]);
    } else {
      inner.appendChild(letter(b.label));
    }
    const label = b.label || (sys ? sys[LANG] : '');
    const span = document.createElement('span'); span.className = 'label'; span.textContent = label;
    if (label) inner.appendChild(span);
    el.appendChild(inner);

    let armed = null;
    const disarm = () => { clearTimeout(armed); armed = null; el.classList.remove('armed'); span.textContent = label; };
    el.addEventListener('click', async () => {
      if (sys && sys.confirm && !armed) {
        el.classList.add('armed'); span.textContent = t('tapAgain'); if (!label) inner.appendChild(span);
        armed = setTimeout(disarm, 2500);
        return;
      }
      if (armed) disarm();
      let message;
      if (b.system === 'mute') { feedback(el, await toggleMute()); return; }
      if (sys && sys.state) {
        stats[sys.state] = !stats[sys.state]; renderStates();
        if (b.system === 'caffeinate') message = t(stats.caffeinate ? 'awakeOn' : 'awakeOff');
      }
      if (b.system === 'screenshot') message = t('saved');
      if (b.system === 'lock') message = t('locked');
      feedback(el, await act('deck', b.id, message));
      if (sys && sys.state) setTimeout(pollStats, 600);
    });
    return el;
  }

  function letter(name) {
    const d = document.createElement('div'); d.className = 'letter'; d.textContent = (name || '?')[0]; return d;
  }

  function renderStates() {
    levels.volume.forEach((s) => {
      s.btn.innerHTML = muted ? ICONS.mute : ICONS.volume;
      s.btn.classList.toggle('on', muted);
      s.widget.classList.toggle('muted', muted);
    });
    stateKeys.forEach((el) => el.classList.toggle('on', stateOf[el.dataset.state]()));
  }

  // ------------------------------------------------------------------ polling
  let build = null;
  async function pollStatus() {
    try {
      const s = await api('/api/status');
      // The app was updated on the Mac: reload to get the new version.
      if (build === null) build = s.build;
      else if (s.build !== build) { location.reload(); return; }
      media = s.media; mediaAt = Date.now();
      renderMedia();
      levels.volume.forEach((sl) => { sl.widget.classList.toggle('unavailable', s.volume == null); if (s.volume != null) sl.update(s.volume); });
      levels.brightness.forEach((sl) => { sl.widget.classList.toggle('unavailable', s.brightness == null); if (s.brightness != null) sl.update(s.brightness); });
      if (Date.now() > muteHoldUntil && !levels.volume.some((sl) => sl.busy())) { muted = s.muted; renderStates(); }
      if (deckVersion !== null && s.deckVersion !== deckVersion) loadDeck();
    } catch {}
  }

  async function pollStats() {
    try {
      stats = await api('/api/stats');
      renderStats();
      renderStates();
    } catch {}
  }

  // ------------------------------------------------------------------ keep the phone awake
  // Wake Lock needs HTTPS, so NoSleep falls back to a tiny looping video.
  if (window.NoSleep) {
    const noSleep = new NoSleep();
    const enable = () => {
      try { const p = noSleep.enable(); if (p && p.catch) p.catch(() => {}); } catch {}
      document.removeEventListener('touchend', enable);
    };
    document.addEventListener('touchend', enable);
  }

  // ------------------------------------------------------------------ loops
  let statusTimer, statsTimer;
  async function statusLoop() { await pollStatus(); statusTimer = setTimeout(statusLoop, 1000); }
  async function statsLoop() { await pollStats(); statsTimer = setTimeout(statsLoop, 3000); }
  function start() { clearTimeout(statusTimer); clearTimeout(statsTimer); statusLoop(); statsLoop(); }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(statusTimer); clearTimeout(statsTimer); }
    else { start(); tickClock(); }
  });

  tickClock();
  loadDeck();
  start();
})();
