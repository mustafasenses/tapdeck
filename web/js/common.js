// Shared by the phone panel (index.html) and the button editor (edit.html).
window.Tapdeck = (() => {
  const LANG = (navigator.language || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en';

  const sun = '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>';
  const speaker = '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke="none"/>';
  const ICONS = {
    play: '<svg class="ico solid" viewBox="0 0 24 24"><path d="M7 4.9v14.2a1 1 0 0 0 1.5.9l11.3-7.1a1 1 0 0 0 0-1.8L8.5 4a1 1 0 0 0-1.5.9z"/></svg>',
    pause: '<svg class="ico solid" viewBox="0 0 24 24"><rect x="6" y="4.5" width="4" height="15" rx="1.3"/><rect x="14" y="4.5" width="4" height="15" rx="1.3"/></svg>',
    playpause: '<svg class="ico solid" viewBox="0 0 24 24"><path d="M2.5 6v12a.8.8 0 0 0 1.2.7l8.6-6a.8.8 0 0 0 0-1.4l-8.6-6A.8.8 0 0 0 2.5 6z"/><rect x="14" y="5.5" width="3" height="13" rx="1"/><rect x="19" y="5.5" width="3" height="13" rx="1"/></svg>',
    next: '<svg class="ico solid" viewBox="0 0 24 24"><path d="M5 5.5v13a.8.8 0 0 0 1.2.7l9.2-6.5a.8.8 0 0 0 0-1.4L6.2 4.8A.8.8 0 0 0 5 5.5z"/><rect x="16.4" y="5" width="2.6" height="14" rx="1.1"/></svg>',
    prev: '<svg class="ico solid" viewBox="0 0 24 24"><path d="M19 5.5v13a.8.8 0 0 1-1.2.7L8.6 12.7a.8.8 0 0 1 0-1.4l9.2-6.5a.8.8 0 0 1 1.2.7z"/><rect x="5" y="5" width="2.6" height="14" rx="1.1"/></svg>',
    volume: `<svg class="ico" viewBox="0 0 24 24">${speaker}<path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.3a8 8 0 0 1 0 11.4"/></svg>`,
    mute: `<svg class="ico" viewBox="0 0 24 24">${speaker}<path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>`,
    volUp: `<svg class="ico" viewBox="0 0 24 24">${speaker}<path d="M15.5 12h6M18.5 9v6"/></svg>`,
    volDown: `<svg class="ico" viewBox="0 0 24 24">${speaker}<path d="M15.5 12h6"/></svg>`,
    sunUp: `<svg class="ico" viewBox="0 0 24 24">${sun}</svg>`,
    sunDown: '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 4v.5M12 19.5v.5M4 12h.5M19.5 12h.5M6.3 6.3l.4.4M17.3 17.3l.4.4M6.3 17.7l.4-.4M17.3 6.7l.4-.4"/></svg>',
    display: '<svg class="ico" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20h7M12 16.5V20"/></svg>',
    moon: '<svg class="ico" viewBox="0 0 24 24"><path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.3 8.3 0 1 0 10.6 10.6z"/></svg>',
    grid: '<svg class="ico" viewBox="0 0 24 24"><rect x="3" y="4" width="8" height="7" rx="1.6"/><rect x="13" y="4" width="8" height="7" rx="1.6"/><rect x="3" y="13" width="8" height="7" rx="1.6"/><rect x="13" y="13" width="8" height="7" rx="1.6"/></svg>',
    camera: '<svg class="ico" viewBox="0 0 24 24"><path d="M3.5 8.5a2 2 0 0 1 2-2h2l1.6-2.2h5.8l1.6 2.2h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.6"/></svg>',
    contrast: '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg>',
    cup: '<svg class="ico" viewBox="0 0 24 24"><path d="M4.5 9.5h11.5v4.5a5 5 0 0 1-5 5h-1.5a5 5 0 0 1-5-5z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c0 1.4 1 1.6 1 3M12 3.5c0 1.4 1 1.6 1 3"/></svg>',
    lock: '<svg class="ico" viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
    keyboard: '<svg class="ico" viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7.5 14h9"/></svg>',
    open: '<svg class="ico" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>',
    terminal: '<svg class="ico" viewBox="0 0 24 24"><rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5"/></svg>',
    text: '<svg class="ico" viewBox="0 0 24 24"><path d="M5 6.5V5h14v1.5M12 5v14M9 19h6"/></svg>',
    gear: '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  };

  // Same ids as SYSTEM_ACTIONS in server.py.
  const SYSTEM = [
    { id: 'media_toggle', icon: 'playpause', tr: 'Oynat / Duraklat', en: 'Play / Pause' },
    { id: 'media_prev', icon: 'prev', tr: 'Önceki', en: 'Previous' },
    { id: 'media_next', icon: 'next', tr: 'Sonraki', en: 'Next' },
    { id: 'mute', icon: 'mute', tr: 'Sessiz', en: 'Mute', state: 'muted' },
    { id: 'volume_down', icon: 'volDown', tr: 'Ses −', en: 'Volume −' },
    { id: 'volume_up', icon: 'volUp', tr: 'Ses +', en: 'Volume +' },
    { id: 'brightness_down', icon: 'sunDown', tr: 'Parlaklık −', en: 'Brightness −' },
    { id: 'brightness_up', icon: 'sunUp', tr: 'Parlaklık +', en: 'Brightness +' },
    { id: 'dark_mode', icon: 'contrast', tr: 'Karanlık Mod', en: 'Dark Mode', state: 'dark' },
    { id: 'caffeinate', icon: 'cup', tr: 'Uyanık Tut', en: 'Keep Awake', state: 'caffeinate' },
    { id: 'screenshot', icon: 'camera', tr: 'Ekran Görüntüsü', en: 'Screenshot' },
    { id: 'mission_control', icon: 'grid', tr: 'Mission Control', en: 'Mission Control' },
    { id: 'lock', icon: 'lock', tr: 'Kilitle', en: 'Lock' },
    { id: 'display_off', icon: 'display', tr: 'Ekranı Kapat', en: 'Display Off' },
    { id: 'sleep', icon: 'moon', tr: 'Uyku', en: 'Sleep', confirm: true },
  ];
  const systemById = (id) => SYSTEM.find((s) => s.id === id);
  const systemLabel = (id) => { const s = systemById(id); return s ? s[LANG] : id; };

  // Button background colors ('' = default card color).
  const COLORS = ['', '#8b7cff', '#3b82f6', '#06b6d4', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#64748b'];

  // Page grid limits; same as server.py.
  const GRID = { cols: 5, rows: 2, minCols: 2, maxCols: 6, minRows: 1, maxRows: 4 };

  return { LANG, ICONS, SYSTEM, systemById, systemLabel, COLORS, GRID };
})();
