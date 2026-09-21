/**
 * Global loading splash — ship pulling anchor at center screen.
 * Reference-counted by id so boot, voyage activity, and Progress can stack safely.
 */
const LoadingSplash = (() => {
  const BOOT_ID = '__boot__';
  const stack = new Map();
  let root = null;
  let labelEl = null;
  let kickerEl = null;
  let trackBar = null;
  let hideTimer = null;

  const SVG_MARKUP = `
<svg viewBox="0 0 320 200" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ls-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1a3050"/>
      <stop offset="100%" stop-color="#0a1420"/>
    </linearGradient>
    <linearGradient id="ls-sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1e4a62"/>
      <stop offset="100%" stop-color="#0c2230"/>
    </linearGradient>
  </defs>
  <rect width="320" height="200" fill="url(#ls-sky)" rx="8"/>
  <g class="loading-splash-waves" opacity="0.55">
    <path d="M-20 132 Q 20 124 60 132 T 140 132 T 220 132 T 300 132 T 380 132" fill="none" stroke="#3d8a9e" stroke-width="2"/>
    <path d="M-20 142 Q 24 136 68 142 T 156 142 T 244 142 T 332 142 T 420 142" fill="none" stroke="#2a6578" stroke-width="1.5"/>
  </g>
  <rect x="0" y="128" width="320" height="72" fill="url(#ls-sea)"/>
  <line x1="0" y1="128" x2="320" y2="128" stroke="#5eb8c9" stroke-width="1.2" opacity="0.5"/>
  <g class="loading-splash-anchor">
    <path d="M160 168 L160 152 M148 160 L172 160 M152 168 Q160 182 168 168" fill="none" stroke="#c9a227" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="160" cy="150" r="4" fill="#c9a227"/>
  </g>
  <line class="loading-splash-chain" x1="160" y1="150" x2="160" y2="108" stroke="#a89a82" stroke-width="2"/>
  <g class="loading-splash-ship">
    <path d="M118 108 L118 98 L188 98 L202 108 L188 118 L118 118 Z" fill="#243548" stroke="#c9a227" stroke-width="1.2"/>
    <path d="M118 98 L130 88 L178 88 L188 98" fill="#1a2a3d" stroke="#122238" stroke-width="0.8"/>
    <rect x="138" y="92" width="28" height="10" rx="1" fill="#3d5568" stroke="#122238" stroke-width="0.6"/>
    <rect x="152" y="100" width="6" height="14" fill="#0d0d0d" stroke="#c9a227" stroke-width="0.5"/>
    <path d="M202 108 L212 112 L202 116 Z" fill="#7a1f2b" stroke="#122238" stroke-width="0.6"/>
    <ellipse class="loading-splash-smoke" cx="208" cy="104" rx="5" ry="3" fill="rgba(200,200,200,0.35)"/>
    <ellipse class="loading-splash-smoke" cx="214" cy="100" rx="4" ry="2.5" fill="rgba(200,200,200,0.25)" style="animation-delay: 0.9s"/>
  </g>
</svg>`;

  function ensure() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'loading-splash';
    root.className = 'loading-splash';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-busy', 'false');
    root.innerHTML = `
      <div class="loading-splash-viz">${SVG_MARKUP}</div>
      <div class="loading-splash-text">
        <div class="loading-splash-kicker" id="loading-splash-kicker"></div>
        <p class="loading-splash-label" id="loading-splash-label">Starting…</p>
      </div>
      <div class="loading-splash-track" aria-hidden="true"><div class="loading-splash-track-bar" id="loading-splash-track-bar"></div></div>`;
    document.body.appendChild(root);
    labelEl = root.querySelector('#loading-splash-label');
    kickerEl = root.querySelector('#loading-splash-kicker');
    trackBar = root.querySelector('#loading-splash-track-bar');
    return root;
  }

  function topEntry() {
    let best = null;
    for (const entry of stack.values()) {
      if (!best || entry.order > best.order) best = entry;
    }
    return best;
  }

  function paint() {
    ensure();
    const top = topEntry();
    const active = !!top;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (!active) {
      const shownAt = root.dataset.shownAt ? Number(root.dataset.shownAt) : 0;
      const wait = Math.max(0, 280 - (Date.now() - shownAt));
      hideTimer = setTimeout(() => {
        if (stack.size) return;
        root.classList.remove('loading-splash--active');
        root.setAttribute('aria-busy', 'false');
        document.documentElement.classList.remove('loading-splash-open');
      }, wait);
      return;
    }
    root.dataset.shownAt = String(root.dataset.shownAt || Date.now());
    root.classList.add('loading-splash--active');
    root.setAttribute('aria-busy', 'true');
    document.documentElement.classList.add('loading-splash-open');
    if (labelEl) labelEl.textContent = top.label || 'Working…';
    if (kickerEl) {
      kickerEl.textContent = top.kicker || '';
      kickerEl.style.display = top.kicker ? '' : 'none';
    }
    if (trackBar) {
      const pct = top.pct;
      if (pct != null && isFinite(pct)) {
        trackBar.style.width = `${Math.max(4, Math.min(100, pct))}%`;
        trackBar.style.animation = 'none';
      } else {
        trackBar.style.width = '';
        trackBar.style.animation = '';
      }
    }
  }

  let orderSeq = 0;

  function show(id, label, opts) {
    if (!id) id = BOOT_ID;
    const o = opts && typeof opts === 'object' ? opts : {};
    orderSeq += 1;
    stack.set(id, {
      label: label || 'Working…',
      kicker: o.kicker || '',
      pct: o.pct != null ? o.pct : null,
      order: orderSeq,
    });
    paint();
  }

  function update(id, label, opts) {
    if (!id || !stack.has(id)) {
      show(id || BOOT_ID, label, opts);
      return;
    }
    const cur = stack.get(id);
    const o = opts && typeof opts === 'object' ? opts : {};
    if (label != null) cur.label = label;
    if (o.kicker != null) cur.kicker = o.kicker;
    if (o.pct !== undefined) cur.pct = o.pct;
    cur.order = ++orderSeq;
    paint();
  }

  function hide(id) {
    if (!id) id = BOOT_ID;
    stack.delete(id);
    paint();
  }

  function boot(label) {
    show(BOOT_ID, label || 'Starting…');
  }

  function endBoot() {
    hide(BOOT_ID);
  }

  function isVisible() {
    return stack.size > 0;
  }

  if (document.body) boot(typeof window.LOADING_SPLASH_BOOT_LABEL === 'string' ? window.LOADING_SPLASH_BOOT_LABEL : undefined);
  else document.addEventListener('DOMContentLoaded', () => {
    boot(typeof window.LOADING_SPLASH_BOOT_LABEL === 'string' ? window.LOADING_SPLASH_BOOT_LABEL : undefined);
  }, { once: true });

  return { show, update, hide, boot, endBoot, isVisible, BOOT_ID };
})();

window.LoadingSplash = LoadingSplash;
