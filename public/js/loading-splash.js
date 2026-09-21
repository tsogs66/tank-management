/**
 * Global loading splash — side-view ship underway toward port (Voyage overview style).
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

  /* Bulk carrier side view — same silhouette as renderVoyageProgress / Home dashboard.
     Ship lives at local x≈70 inside .loading-splash-voyage-ship; the group slides toward port. */
  const y = 108;
  const shipX = 70;
  const waterlineY = y + 9;
  const upperHull = `M ${shipX - 44} ${waterlineY} L ${shipX - 44} ${y + 4} L ${shipX + 24} ${y + 4} L ${shipX + 46} ${waterlineY} Z`;
  const lowerHull = `M ${shipX - 44} ${y + 18} L ${shipX - 44} ${waterlineY} L ${shipX + 46} ${waterlineY} L ${shipX + 24} ${y + 18} Z`;
  const x0 = 36;
  const x1 = 444;
  let wave1 = `M ${x0 - 12} ${y + 22}`;
  let wave2 = `M ${x0 - 12} ${y + 34}`;
  for (let x = x0 - 12; x <= x1 + 12; x += 24) {
    wave1 += ` q 12 7 24 0`;
    wave2 += ` q 12 6 24 0`;
  }

  const SVG_MARKUP = `
<svg viewBox="0 0 480 200" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="ls-sky-clip"><rect x="0" y="0" width="480" height="${y - 8}"/></clipPath>
    <linearGradient id="ls-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1a3050"/>
      <stop offset="100%" stop-color="#0a1420"/>
    </linearGradient>
  </defs>
  <rect width="480" height="200" fill="url(#ls-sky)" rx="8"/>
  <g clip-path="url(#ls-sky-clip)" pointer-events="none">
    <line class="voyage-wind-streak" x1="120" y1="20" x2="108" y2="52" stroke="#e0b56a" stroke-width="1.5" stroke-linecap="round" opacity="0.55"/>
    <line class="voyage-wind-streak" x1="200" y1="12" x2="188" y2="44" stroke="#e0b56a" stroke-width="1.2" stroke-linecap="round" opacity="0.45"/>
    <line class="voyage-wind-streak" x1="280" y1="24" x2="268" y2="56" stroke="#e0b56a" stroke-width="1.4" stroke-linecap="round" opacity="0.5"/>
    <line class="voyage-wind-streak" x1="360" y1="16" x2="348" y2="48" stroke="#e0b56a" stroke-width="1.3" stroke-linecap="round" opacity="0.4"/>
  </g>
  <g class="voyage-wave"><path d="${wave1}" fill="none" stroke="#5eb8c9" stroke-width="1.5" opacity="0.28"/></g>
  <g class="voyage-wave ls-wave-2"><path d="${wave2}" fill="none" stroke="#5eb8c9" stroke-width="1.5" opacity="0.16"/></g>
  <line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="#a9a292" stroke-width="3" stroke-dasharray="2 6" stroke-linecap="round" opacity="0.55"/>
  <line class="ls-route-progress" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="#c9a227" stroke-width="3" stroke-linecap="round"/>
  <circle cx="${x0}" cy="${y}" r="6" fill="#5eb8c9"/>
  <circle cx="${x1}" cy="${y}" r="6" fill="none" stroke="#e9e4d6" stroke-width="2" opacity="0.85"/>
  <text x="${x0}" y="${y - 28}" text-anchor="start" fill="#e9e4d6" font-family="Georgia,serif" font-size="11" font-weight="600">Departure</text>
  <text x="${x1}" y="${y - 28}" text-anchor="end" fill="#e9e4d6" font-family="Georgia,serif" font-size="11" font-weight="600">Port</text>
  <text x="${x0}" y="${y - 14}" text-anchor="start" fill="#a9a292" font-family="monospace" font-size="9">0 nm</text>
  <g class="loading-splash-ship-run">
    <g class="loading-splash-ship-bob">
      <path class="voyage-wake" d="M ${shipX - 52} ${y + 12} Q ${shipX - 68} ${y + 8} ${shipX - 78} ${y + 14}"
        fill="none" stroke="#5eb8c9" stroke-width="2" stroke-dasharray="6 8" opacity="0.35"/>
      <path d="${upperHull}" fill="#7a1f2b" stroke="#122238" stroke-width="1"/>
      <path d="${lowerHull}" fill="#0d0d0d" stroke="#122238" stroke-width="1"/>
      <line x1="${shipX - 44}" y1="${waterlineY}" x2="${shipX + 46}" y2="${waterlineY}" stroke="#c9a227" stroke-width="2"/>
      <rect x="${shipX - 40}" y="${y - 8}" width="20" height="12" fill="#e9e4d6" stroke="#122238" stroke-width="0.8"/>
      <rect x="${shipX - 35}" y="${y - 16}" width="12" height="8" fill="#e9e4d6" stroke="#122238" stroke-width="0.8"/>
      <rect x="${shipX - 31}" y="${y - 25}" width="6" height="9" fill="#122238"/>
      <rect x="${shipX - 10}" y="${y}" width="9" height="4" rx="0.5" fill="#122238" opacity="0.9"/>
      <rect x="${shipX + 2}" y="${y}" width="9" height="4" rx="0.5" fill="#122238" opacity="0.9"/>
      <rect x="${shipX + 14}" y="${y}" width="9" height="4" rx="0.5" fill="#122238" opacity="0.9"/>
    </g>
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
