/**
 * Shared theme cycle: Night → Bright → Sailor → Night.
 * Storage: marine_theme (night|bright|sailor); legacy marine_bright / vm_bright kept in sync.
 */
(function (global) {
  const KEY = 'marine_theme';
  const BRIGHT_KEY = 'marine_bright';
  const LEGACY = 'vm_bright';
  const MODES = ['night', 'bright', 'sailor'];

  function normalizeMode(raw) {
    const m = String(raw || '').toLowerCase();
    return MODES.includes(m) ? m : 'night';
  }

  function readMode() {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored) return normalizeMode(stored);
      if (localStorage.getItem(BRIGHT_KEY) === '1' || localStorage.getItem(LEGACY) === '1') return 'bright';
      if (localStorage.getItem(BRIGHT_KEY) === '0' || localStorage.getItem(LEGACY) === '0') return 'night';
    } catch { /* ignore */ }
    return 'night';
  }

  function readBright() {
    return readMode() === 'bright';
  }

  function themeColorFor(mode) {
    if (mode === 'bright') return '#efebe3';
    if (mode === 'sailor') return '#071824';
    return '#0a1420';
  }

  function labelFor(mode) {
    /* Button shows the *next* mode you will switch to. */
    if (mode === 'night') return 'Bright';
    if (mode === 'bright') return 'Sailor';
    return 'Night';
  }

  function titleFor(mode) {
    if (mode === 'night') return 'Day / bright mode for sunlight';
    if (mode === 'bright') return 'Sailor — crystal sea / chartroom theme';
    return 'Night / dark bridge mode';
  }

  function apply(modeOrBright, opts) {
    let mode;
    if (typeof modeOrBright === 'boolean') mode = modeOrBright ? 'bright' : 'night';
    else mode = normalizeMode(modeOrBright);

    document.documentElement.classList.toggle('bright', mode === 'bright');
    document.documentElement.classList.toggle('sailor', mode === 'sailor');
    document.documentElement.setAttribute('data-theme', mode);

    if (!opts || opts.persist !== false) {
      try {
        if (localStorage.getItem(KEY) !== mode) localStorage.setItem(KEY, mode);
        const brightFlag = mode === 'bright' ? '1' : '0';
        if (localStorage.getItem(BRIGHT_KEY) !== brightFlag) localStorage.setItem(BRIGHT_KEY, brightFlag);
        if (localStorage.getItem(LEGACY) !== brightFlag) localStorage.setItem(LEGACY, brightFlag);
      } catch { /* ignore */ }
    }

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', themeColorFor(mode));

    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.textContent = labelFor(mode);
      btn.setAttribute('aria-pressed', mode !== 'night' ? 'true' : 'false');
      btn.setAttribute('data-theme-mode', mode);
      btn.title = titleFor(mode);
    });
  }

  function toggle() {
    const cur = readMode();
    const idx = MODES.indexOf(cur);
    apply(MODES[(idx + 1) % MODES.length]);
  }

  function bind(root) {
    (root || document).querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      if (btn._themeBound) return;
      btn._themeBound = true;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        toggle();
      });
    });
  }

  /* Early paint — class only; full apply on DOM ready for button labels. */
  try {
    const m = readMode();
    if (m === 'bright') document.documentElement.classList.add('bright');
    if (m === 'sailor') document.documentElement.classList.add('sailor');
    document.documentElement.setAttribute('data-theme', m);
  } catch { /* ignore */ }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      apply(readMode());
      bind();
    });
  } else {
    apply(readMode());
    bind();
  }

  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === BRIGHT_KEY || e.key === LEGACY) {
      apply(readMode(), { persist: false });
    }
  });

  global.MarineTheme = {
    apply,
    toggle,
    bind,
    readBright,
    readMode,
    KEY,
    BRIGHT_KEY,
    MODES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
