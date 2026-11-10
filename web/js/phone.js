(() => {
  const { LANG, ICONS, systemById, systemLabel } = window.Tapdeck;

  // ------------------------------------------------------------------ i18n
  const STRINGS = {
    en: {
      battery: 'Battery', offline: "Can't reach your Mac. Start Tapdeck on it.", gateTitle: 'Open from your Mac',
      gateText: 'Start Tapdeck on your Mac and scan the QR code at 127.0.0.1:8765/connect.',
      keysTitle: 'Media keys', keysArtist: 'Nothing playing in the browser. Buttons work like your keyboard\'s media keys.',
      keysOff: 'Media keys need Accessibility permission on the Mac.',
      tapAgain: 'Tap again', failed: 'That didn\'t work', done: 'Done', running: 'Running…',
      saved: 'Screenshot saved', locked: 'Mac locked', awakeOn: 'Mac will stay awake', awakeOff: 'Mac can sleep again',
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
  $('prev').innerHTML = ICONS.prev;
  $('next').innerHTML = ICONS.next;

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
  // Tap or drag anywhere on the bar to set the value.
  class Slider {
    constructor(el, { max = 100, onInput, onChange, onDraw } = {}) {
      Object.assign(this, { el, max, onInput, onChange, onDraw, value: 0, dragging: false, holdUntil: 0 });
      this.fill = el.querySelector('.fill');
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
      this.draw(Math.min(1, Math.max(0, p.x / p.w)) * this.max);
      this.onInput && this.onInput(this.value);
    }
    draw(v) {
      this.value = v;
      this.fill.style.width = (this.max ? (100 * v) / this.max : 0) + '%';
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
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };

  // ------------------------------------------------------------------ pages
  const pagesEl = $('pages');
  const pageNames = [''];
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
    if (page && page.classList.contains('deck-page') && !reduceMotion) {
      replay(page, 'enter');
      clearTimeout(page.enterTimer);
      page.enterTimer = setTimeout(() => page.classList.remove('enter'), 1200);
    }
  }
  function savedPage() {
    try { return Math.min(pageCount() - 1, Number(localStorage.getItem('tapdeckPage')) || 0); } catch { return 0; }
  }

  // While swiping, pages away from the center shrink and fade a little, and
  // the dots stretch toward the page you're heading to.
  let scrollFrame = 0;
  let settleTimer = null;
  function followScroll() {
    scrollFrame = 0;
    const pos = pagesEl.scrollLeft / (pagesEl.clientWidth || 1);
    $('ambient').style.setProperty('--show', Math.max(0, 1 - pos).toFixed(3));
    if (!reduceMotion) {
      [...pagesEl.children].forEach((page, i) => {
        const body = page.querySelector('.music, .deck');
        const d = Math.min(1, Math.abs(i - pos));
        if (body) {
          body.style.transform = d > 0.001 ? `scale(${1 - 0.08 * d})` : '';
          body.style.opacity = d > 0.001 ? String(1 - 0.45 * d) : '';
        }
      });
    }
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

  // ------------------------------------------------------------------ media
  let media = { source: 'keys' };
  let mediaAt = Date.now();
  let optimisticUntil = 0;

  const seek = new Slider($('seek'), {
    max: 1,
    onInput: (v) => { $('elapsed').textContent = fmt(v); },
    onChange: (v) => { media.position = v; mediaAt = Date.now(); act('seek', v); },
  });

  function livePosition() {
    if (!media.playing) return media.position || 0;
    return Math.min(media.duration || Infinity, (media.position || 0) + (Date.now() - mediaAt) / 1000);
  }

  let shownPlaying = null;
  function renderPlayButton(playing) {
    if (playing === shownPlaying) return;
    const first = shownPlaying === null;
    shownPlaying = playing;
    $('play').innerHTML = playing ? ICONS.pause : ICONS.play;
    if (!first && !reduceMotion) replay($('play'), 'morph');
  }

  // Set text, sliding it in when it actually changed (a new track).
  function setText(el, text) {
    if (el.textContent === text) return;
    const first = !el.textContent;
    el.textContent = text;
    if (!first && !reduceMotion) replay(el, 'swap');
  }

  // Artwork and the glow behind the page cross-fade to the new image.
  let lastArt = null;
  function showArtwork(url) {
    lastArt = url;
    const boxes = [$('art'), $('ambient')];
    if (!url) {
      boxes.forEach((box) => box.querySelectorAll('.layer').forEach(fadeOut));
      $('art').classList.remove('loaded');
      return;
    }
    const probe = new Image();
    probe.onload = () => {
      if (lastArt !== url) return;
      boxes.forEach((box) => {
        const old = [...box.querySelectorAll('.layer')];
        const img = new Image();
        img.className = 'layer';
        img.alt = '';
        img.src = url;
        box.appendChild(img);
        void img.offsetWidth; // start from the hidden state so the fade runs
        img.classList.add('in');
        old.forEach(fadeOut);
      });
      $('art').classList.add('loaded');
    };
    probe.src = url;
  }
  function fadeOut(el) { el.classList.remove('in'); setTimeout(() => el.remove(), 900); }

  function renderMedia() {
    const ext = media.source === 'ext';
    $('source').classList.toggle('live', ext && media.playing);
    $('sourceText').textContent = ext ? media.site : t('keysTitle');
    setText($('title'), ext ? (media.title || media.site) : t('keysTitle'));
    setText($('artist'), ext ? [media.artist, media.album].filter(Boolean).join(' · ') : t('keysArtist'));
    $('note').hidden = ext || media.keys !== false;
    $('note').textContent = t('keysOff');
    if (Date.now() > optimisticUntil) renderPlayButton(ext && media.playing);

    const art = ext ? media.artwork : '';
    if (art !== lastArt) showArtwork(art);

    $('progress').classList.toggle('off', !ext || !(media.duration > 0));
    $('seek').classList.toggle('disabled', !(ext && media.canSeek && media.duration > 0));
    tickProgress();
  }

  function tickProgress() {
    if (media.source !== 'ext' || !(media.duration > 0)) return;
    const pos = livePosition();
    seek.update(pos, media.duration);
    if (!seek.dragging) $('elapsed').textContent = fmt(pos);
    $('duration').textContent = fmt(media.duration);
  }
  setInterval(tickProgress, 250);

  $('play').addEventListener('click', async () => {
    if (media.source === 'ext') {
      media.playing = !media.playing; media.position = livePosition(); mediaAt = Date.now();
      renderPlayButton(media.playing); optimisticUntil = Date.now() + 1500;
    }
    const r = await act('media', 'toggle');
    if (!r.ok) feedback($('play'), r);
  });
  $('next').addEventListener('click', async () => feedback($('next'), await act('media', 'next')));
  $('prev').addEventListener('click', async () => feedback($('prev'), await act('media', 'prev')));
  ['play', 'next', 'prev', 'mute'].forEach((id) => $(id).addEventListener('pointerdown', (e) => ripple($(id), e)));

  // ------------------------------------------------------------------ volume
  let muted = false;
  let muteHoldUntil = 0;
  const volume = new Slider($('volume'), {
    onInput: throttle((v) => { act('volume', Math.round(v)); if (muted) { muted = false; renderStates(); } }, 120),
    onChange: (v) => act('volume', Math.round(v)),
    onDraw: (v) => { $('volumeVal').textContent = Math.round(v); },
  });
  function toggleMute() { muted = !muted; muteHoldUntil = Date.now() + 1500; renderStates(); return act('mute'); }
  $('mute').addEventListener('click', toggleMute);

  // ------------------------------------------------------------------ button pages
  let deckVersion = null;
  let stats = {};
  const stateOf = { muted: () => muted, dark: () => !!stats.dark, caffeinate: () => !!stats.caffeinate };
  let stateKeys = [];

  async function loadDeck() {
    try {
      const deck = await api('/api/deck');
      deckVersion = deck.version;
      const keep = savedPage();
      [...pagesEl.querySelectorAll('.page.deck-page')].forEach((p) => p.remove());
      pageNames.length = 1;
      shownPage = -1;
      stateKeys = [];
      deck.pages.forEach((page) => {
        const section = document.createElement('section');
        section.className = 'page deck-page';
        const grid = document.createElement('div');
        grid.className = 'deck';
        grid.style.setProperty('--cols', page.cols);
        grid.style.setProperty('--rows', page.rows);
        page.buttons.forEach((b, i) => grid.appendChild(renderKey(b, i)));
        section.appendChild(grid);
        pagesEl.appendChild(section);
        pageNames.push(page.name);
      });
      renderDots();
      goTo(Math.min(keep, pageCount() - 1));
      renderStates();
    } catch { setTimeout(loadDeck, 3000); }
  }

  function renderKey(b, index) {
    const el = document.createElement('button');
    el.className = 'key press';
    el.style.setProperty('--i', index);
    el.addEventListener('pointerdown', (e) => ripple(el, e));
    el.style.gridColumn = `${b.x + 1} / span ${b.w}`;
    el.style.gridRow = `${b.y + 1} / span ${b.h}`;
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
    $('mute').innerHTML = muted ? ICONS.mute : ICONS.volume;
    $('mute').classList.toggle('on', muted);
    $('volume').classList.toggle('muted', muted);
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
      $('volumeRow').style.visibility = s.volume == null ? 'hidden' : '';
      if (s.volume != null) volume.update(s.volume);
      if (Date.now() > muteHoldUntil && !volume.busy()) { muted = s.muted; renderStates(); }
      if (deckVersion !== null && s.deckVersion !== deckVersion) loadDeck();
    } catch {}
  }

  function tickClock() {
    const now = new Date();
    $('time').textContent = now.toLocaleTimeString(LANG, { hour: '2-digit', minute: '2-digit' });
    $('date').textContent = now.toLocaleDateString(LANG, { weekday: 'long', day: 'numeric', month: 'long' });
  }
  setInterval(tickClock, 1000); tickClock();

  function setChip(id, text, cls) {
    const chip = $(id);
    chip.classList.toggle('hidden', text == null);
    if (text == null) return;
    const b = chip.querySelector('b');
    b.textContent = text; b.className = cls || '';
  }
  const loadClass = (p) => (p >= 85 ? 'bad' : p >= 60 ? 'warn' : '');

  async function pollStats() {
    try {
      stats = await api('/api/stats');
      setChip('cpuChip', stats.cpu + '%', loadClass(stats.cpu));
      const mem = stats.memory;
      setChip('ramChip', mem ? mem.percent + '%' : null, mem && loadClass(mem.percent));
      const bat = stats.battery;
      setChip('batChip', bat ? (bat.charging ? '⚡' : '') + bat.percent + '%' : null,
        bat && (bat.charging || bat.plugged ? 'good' : bat.percent <= 20 ? 'bad' : ''));
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

  renderDots();
  renderStates();
  renderPlayButton(false);
  loadDeck();
  start();
})();
