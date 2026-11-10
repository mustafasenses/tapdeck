// Runs in every frame. If the frame plays audio/video, reports what's playing
// and carries out play/pause/next/previous/seek commands from the panel.

(() => {
  if (window.__tapdeckBridge) return;
  window.__tapdeckBridge = true;

  // Sites with their own next/previous buttons. Others fall back to the
  // system media keys (next) or restarting the track (previous).
  const SITES = [
    { test: (h) => h === 'music.youtube.com', name: 'YouTube Music', next: '.next-button', prev: '.previous-button' },
    { test: (h) => h === 'youtube.com' || h.endsWith('.youtube.com'), name: 'YouTube', next: '.ytp-next-button', prev: '.ytp-prev-button' },
    {
      test: (h) => h === 'open.spotify.com', name: 'Spotify',
      next: '[data-testid="control-button-skip-forward"]',
      prev: '[data-testid="control-button-skip-back"]',
      toggle: '[data-testid="control-button-playpause"]',
    },
    { test: (h) => h.endsWith('soundcloud.com'), name: 'SoundCloud', next: '.skipControl__next', prev: '.skipControl__previous', toggle: '.playControl' },
    { test: (h) => h.endsWith('deezer.com'), name: 'Deezer', next: '[data-testid="next_track_button"]', prev: '[data-testid="previous_track_button"]' },
    { test: (h) => h.endsWith('twitch.tv'), name: 'Twitch' },
    { test: (h) => h.endsWith('netflix.com'), name: 'Netflix' },
  ];
  const host = location.hostname.replace(/^www\./, '');
  const site = SITES.find((s) => s.test(host)) || { name: host };

  let lastPlayed = null; // last unmuted element the user actually played
  let reported = false;

  const audible = (m) => !m.muted && m.volume > 0;

  document.addEventListener('play', (e) => {
    if (e.target instanceof HTMLMediaElement && audible(e.target)) lastPlayed = e.target;
  }, true);

  function pickMedia() {
    const all = [...document.querySelectorAll('video, audio')];
    // Muted autoplay (feed previews, hover thumbnails) isn't "what's playing".
    const playing = all.filter((m) => !m.paused && !m.ended && audible(m));
    if (playing.length) return playing.reduce((a, b) => (size(b) > size(a) ? b : a));
    if (lastPlayed && lastPlayed.isConnected) return lastPlayed;
    const loaded = all.filter((m) => m.duration > 0 && audible(m));
    return loaded.length ? loaded.reduce((a, b) => (size(b) > size(a) ? b : a)) : null;
  }

  function size(m) {
    return m.offsetWidth * m.offsetHeight + (m.duration > 0 ? 1 : 0);
  }

  function pickArtwork(meta) {
    let best = null;
    let bestSize = -1;
    for (const a of (meta && meta.artwork) || []) {
      if (!a.src || !/^https?:/.test(a.src)) continue; // blob:/data: won't load on the phone
      const s = parseInt(String(a.sizes || '0').split(/[x ]/)[0], 10) || 0;
      if (s > bestSize) { best = a.src; bestSize = s; }
    }
    if (best) return best;
    const og = document.querySelector('meta[property="og:image"]');
    return og && /^https?:/.test(og.content) ? og.content : '';
  }

  function snapshot() {
    const media = pickMedia();
    const session = navigator.mediaSession;
    const meta = session && session.metadata;
    // Pages like Spotify keep their <audio> out of the DOM but set mediaSession.
    if (!media && !(meta && meta.title)) return null;

    const finite = media && Number.isFinite(media.duration);
    return {
      title: (meta && meta.title) || document.title,
      artist: (meta && meta.artist) || '',
      album: (meta && meta.album) || '',
      artwork: pickArtwork(meta),
      site: site.name,
      playing: media ? !media.paused && !media.ended : session.playbackState === 'playing',
      position: media ? media.currentTime : 0,
      duration: finite ? media.duration : 0,
      rate: media ? media.playbackRate : 1,
      canSeek: Boolean(finite && media.duration > 0),
    };
  }

  function send() {
    const state = snapshot();
    try {
      if (state) {
        chrome.runtime.sendMessage({ type: 'state', state });
        reported = true;
      } else if (reported) {
        chrome.runtime.sendMessage({ type: 'gone' });
        reported = false;
      }
    } catch {
      // Extension was reloaded; this old content script is orphaned.
    }
  }

  setInterval(send, 1000);
  for (const ev of ['play', 'pause', 'seeked', 'loadedmetadata', 'ended', 'ratechange']) {
    document.addEventListener(ev, () => setTimeout(send, 50), true);
  }
  window.addEventListener('pagehide', () => {
    if (reported) {
      try { chrome.runtime.sendMessage({ type: 'gone' }); } catch {}
    }
  });

  function click(selector) {
    const el = selector && document.querySelector(selector);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false; // hidden
    el.click();
    return true;
  }

  function run(cmd, value) {
    const media = pickMedia();
    switch (cmd) {
      case 'toggle':
        if (media) {
          if (media.paused) media.play().catch(() => {});
          else media.pause();
          return true;
        }
        return click(site.toggle);
      case 'next':
        return click(site.next);
      case 'prev':
        // Like a music player: restart the track unless we're at its start.
        if (media && media.currentTime > 3 && !site.prev) {
          media.currentTime = 0;
          return true;
        }
        if (click(site.prev)) return true;
        if (media) {
          media.currentTime = 0;
          return true;
        }
        return false;
      case 'seek':
        if (media && Number.isFinite(media.duration)) {
          media.currentTime = Math.max(0, Math.min(media.duration, Number(value) || 0));
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type !== 'cmd') return;
    const ok = run(msg.cmd, msg.value);
    reply({ ok });
    setTimeout(send, 150);
  });
})();
