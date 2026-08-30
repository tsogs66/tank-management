/**
 * Shared day/night theme (Voyage Chief style).
 * Storage key marine_bright; also reads legacy vm_bright.
 */
(function (global) {
  const KEY = 'marine_bright';
  const LEGACY = 'vm_bright';

  function readBright() {
    try {
      if (localStorage.getItem(KEY) === '1') return true;
      if (localStorage.getItem(KEY) === '0') return false;
      return localStorage.getItem(LEGACY) === '1';
    } catch {
      return false;
    }
  }

  function apply(bright) {
    document.documentElement.classList.toggle('bright', !!bright);
    try {
      localStorage.setItem(KEY, bright ? '1' : '0');
      localStorage.setItem(LEGACY, bright ? '1' : '0');
    } catch { /* ignore */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', bright ? '#efebe3' : '#0a1420');
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.textContent = bright ? 'Night' : 'Bright';
      btn.setAttribute('aria-pressed', bright ? 'true' : 'false');
      btn.title = bright ? 'Switch to night / dark mode' : 'Day / bright mode for sunlight';
    });
  }

  function toggle() {
    apply(!document.documentElement.classList.contains('bright'));
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

  /* Early paint */
  try {
    if (readBright()) document.documentElement.classList.add('bright');
  } catch { /* ignore */ }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      apply(readBright());
      bind();
    });
  } else {
    apply(readBright());
    bind();
  }

  /* Keep Bright/Night aligned across AIO shell + embedded module iframes. */
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === LEGACY) apply(readBright());
  });

  global.MarineTheme = { apply, toggle, bind, readBright, KEY };
})(typeof window !== 'undefined' ? window : globalThis);
