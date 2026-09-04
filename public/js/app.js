/* Tank Chief — SPA */
const CATS = [
  { id: 'fuel', label: 'Fuel Oil', icon: '⛽', color: 'var(--fuel)' },
  { id: 'lube', label: 'Lube Oil', icon: '🛢', color: 'var(--lube)' },
  { id: 'misc', label: 'Misc / Bilge', icon: '🔧', color: 'var(--misc)' },
  { id: 'water', label: 'Fresh Water', icon: '💧', color: 'var(--water)' },
];

const STATE = {
  vessels: [],
  activeVesselId: null,
  bundle: null,
  settings: {},
  conversionTable: null,
  online: navigator.onLine,
  route: { page: 'dashboard', tankId: null },
  // Dashboard tank view, remembered between visits.
  tankView: readPref('tankView', 'table'),
  tankGroup: readPref('tankGroup', 'all'),
  tankTabOpen: readPref('tankTabOpen', 'true') !== 'false',
};

function readPref(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

function showToast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2400);
}

/** Chrome/Edge/Android fire this once; keep it so About can offer Install. */
let deferredInstallPrompt = null;

function isStandaloneDisplay() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;
}

function isAppleMobile() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function installHintText() {
  if (isStandaloneDisplay()) {
    return 'This device already has the app on the home screen. Open it from there for full-screen use.';
  }
  if (isAppleMobile()) {
    return 'On iPhone or iPad: tap Share, then Add to Home Screen.';
  }
  if (deferredInstallPrompt) {
    return 'Adds a home-screen icon so the app opens full-screen, like a native app.';
  }
  return 'On Android, Chrome, or Edge, tap the button to install. On iPhone or iPad, use Share → Add to Home Screen.';
}

function paintInstallButton() {
  const btn = document.getElementById('btn-install-app');
  const hint = document.getElementById('about-install-hint');
  if (hint) hint.textContent = installHintText();
  if (!btn) return;
  if (isStandaloneDisplay()) {
    btn.textContent = 'Installed on this device';
    btn.disabled = true;
  } else {
    btn.disabled = false;
    btn.textContent = 'Install on phone or tablet';
  }
}

async function promptAppInstall() {
  if (isStandaloneDisplay()) {
    showToast('Already installed on this device');
    return;
  }
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    try {
      const choice = await deferredInstallPrompt.userChoice;
      if (choice.outcome === 'accepted') showToast('Installing…');
    } catch (err) {
      console.warn(err);
    }
    deferredInstallPrompt = null;
    paintInstallButton();
    return;
  }
  if (isAppleMobile()) {
    showToast('Use Share → Add to Home Screen');
    return;
  }
  showToast('Use the browser menu: Install app or Add to Home Screen');
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  paintInstallButton();
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  paintInstallButton();
  showToast('App installed on this device');
});

/** Live progress UI for long PDF OCR / extract jobs. */
const PdfProgress = (() => {
  let timer = null;

  function ensure(mountEl) {
    let box = mountEl?.querySelector?.('.pdf-progress') || document.getElementById('pdf-progress');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'pdf-progress';
    box.className = 'pdf-progress';
    box.innerHTML = `
      <div class="pdf-progress-head">
        <div class="pdf-progress-title">Reading PDF…</div>
        <div class="pdf-progress-time" id="pdf-progress-time">0:00</div>
      </div>
      <div class="pdf-progress-bar indeterminate"><div id="pdf-progress-fill"></div></div>
      <div class="pdf-progress-msg" id="pdf-progress-msg">Starting…</div>
      <div class="pdf-progress-meta hint" id="pdf-progress-meta"></div>`;
    if (mountEl) mountEl.prepend(box);
    else document.body.appendChild(box);
    return box;
  }

  function fmtElapsed(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  function show(mountEl, title) {
    const box = ensure(mountEl);
    box.style.display = '';
    box.classList.add('active');
    box.querySelector('.pdf-progress-title').textContent = title || 'Reading PDF…';
    box.querySelector('#pdf-progress-msg').textContent = 'Starting…';
    box.querySelector('#pdf-progress-meta').textContent = '';
    box.querySelector('#pdf-progress-time').textContent = '0:00';
    const bar = box.querySelector('.pdf-progress-bar');
    const fill = box.querySelector('#pdf-progress-fill');
    bar.classList.add('indeterminate');
    bar.classList.remove('determinate');
    fill.style.width = '30%';
    return box;
  }

  function update(job) {
    const box = document.getElementById('pdf-progress');
    if (!box || !job) return;
    const msg = box.querySelector('#pdf-progress-msg');
    const meta = box.querySelector('#pdf-progress-meta');
    const fill = box.querySelector('#pdf-progress-fill');
    const bar = box.querySelector('.pdf-progress-bar');
    const time = box.querySelector('#pdf-progress-time');
    if (job.elapsedMs != null) time.textContent = fmtElapsed(job.elapsedMs);
    msg.textContent = job.message || job.phase || 'Working…';
    const bits = [];
    if (job.phase) bits.push(String(job.phase));
    if (job.page && job.pages) bits.push(`page ${job.page}/${job.pages}`);
    if (job.pct != null) bits.push(`${job.pct}%`);
    meta.textContent = bits.join(' · ');
    if (job.pct != null && job.phase !== 'ocr' && job.phase !== 'heartbeat') {
      bar.classList.remove('indeterminate');
      bar.classList.add('determinate');
      fill.style.width = `${Math.max(2, Math.min(100, job.pct))}%`;
    } else if (job.phase === 'ocr' || job.phase === 'heartbeat') {
      bar.classList.add('indeterminate');
      bar.classList.remove('determinate');
    }
  }

  function hide() {
    const box = document.getElementById('pdf-progress');
    if (!box) return;
    box.classList.remove('active');
    box.style.display = 'none';
    if (timer) { clearInterval(timer); timer = null; }
  }

  async function runJob(vesselId, file, {
    ocr = true,
    includeRaw = false,
    mountEl = null,
    title = null,
    pageMode = 'auto',
    pageFrom = null,
    pageTo = null,
    pages = null,
    spanUntilNextTank = true,
    tableRole = 'auto',
  } = {}) {
    const box = show(mountEl, title || `Reading ${file.name}…`);
    const started = Date.now();
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      const t = box.querySelector('#pdf-progress-time');
      if (t) t.textContent = fmtElapsed(Date.now() - started);
    }, 500);

    const fd = new FormData();
    fd.append('file', file);
    fd.append('includeRaw', includeRaw ? 'true' : 'false');
    fd.append('ocr', ocr ? 'true' : 'false');
    fd.append('pageMode', pageMode || 'auto');
    if (pageFrom) fd.append('pageFrom', String(pageFrom));
    if (pageTo) fd.append('pageTo', String(pageTo));
    if (pages) fd.append('pages', String(pages));
    fd.append('spanUntilNextTank', spanUntilNextTank ? 'true' : 'false');
    fd.append('tableRole', tableRole || 'auto');
    update({ message: 'Uploading PDF…', phase: 'upload', pct: 1, elapsedMs: 0 });

    // Real bytes-sent progress: a capacity book is tens of megabytes and the
    // upload is the slow half over a ship's link.
    const startedJob = await Api.upload(
      `/api/vessels/${vesselId}/import-pdf/jobs`, fd,
      (pct, phase) => update(phase === 'uploading'
        ? { message: `Uploading ${file.name}…`, phase: 'upload', pct, elapsedMs: Date.now() - started }
        : { message: 'Waiting for the server to read it…', phase: 'upload', elapsedMs: Date.now() - started })
    );
    let job = startedJob;
    update(job);

    while (job && (job.status === 'queued' || job.status === 'running')) {
      await new Promise((r) => setTimeout(r, 600));
      job = await Api.request(`/api/vessels/${vesselId}/import-pdf/jobs/${startedJob.jobId}`);
      update({ ...job, elapsedMs: Date.now() - started });
    }

    if (timer) { clearInterval(timer); timer = null; }
    if (!job) throw new Error('PDF job disappeared');
    if (job.status === 'error') throw new Error(job.error || job.message || 'PDF import failed');
    hide();
    return job.result || job;
  }

  return { show, update, hide, runJob };
})();

/**
 * Save a JSON backup where the user can find it.
 *
 * The order of attempts, and what each one means for the message shown
 * afterwards, lives in ChengSaveFile so that Tank Chief, Voyage Chief and the
 * ChEng AIO shell all put files in the same place by the same rules. The
 * fallback below only runs in a build that somehow loaded without it.
 *
 * @returns {Promise<{method:string, filename:string, where?:string}>}
 */
async function downloadJson(filename, obj) {
  const safeName = filename || `tank-chief-backup-${Date.now()}.json`;
  if (window.ChengSaveFile) return ChengSaveFile.saveJson(safeName, obj);

  const text = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try { a.remove(); } catch (_) { /* ignore */ }
    try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
  }, 4000);
  return { method: 'anchor', filename: safeName };
}

/** Where the file went, in the words the user needs to find it. */
function downloadWhereLabel(saved) {
  if (window.ChengSaveFile) return ChengSaveFile.whereLabel(saved);
  return saved && saved.filename ? `started — check Downloads for ${saved.filename}` : 'saved';
}

function allTanks() {
  const t = STATE.bundle?.tanks || {};
  return CATS.flatMap((c) => t[c.id] || []);
}

function findTank(id) {
  return allTanks().find((t) => t.id === id) || null;
}

function getReading(id) {
  return STATE.bundle?.readings?.[id] || null;
}

function fillStatusClass(pct) {
  if (pct == null) return 'neutral';
  if (pct >= 95) return 'bad';
  if (pct >= 85) return 'warn'; // workbook uses 85% capacity as working limit
  return 'good';
}

function vesselName() {
  return STATE.bundle?.vessel?.name || STATE.bundle?.voyage?.vessel || 'No vessel';
}

function setMobileNavOpen(open) {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const toggle = document.getElementById('menu-toggle');
  if (!sidebar) return;
  sidebar.classList.toggle('open', !!open);
  backdrop?.classList.toggle('show', !!open);
  document.body.classList.toggle('nav-open', !!open);
  if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function closeMobileNav() {
  setMobileNavOpen(false);
}

function closeMoreSheet() {
  const sheet = document.getElementById('bnMoreSheet');
  if (!sheet) return;
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
}

function openMoreSheet() {
  const sheet = document.getElementById('bnMoreSheet');
  if (!sheet) return;
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  renderMoreNav();
}

function apiHref(path) {
  return (typeof Api !== 'undefined' && Api.withPrefix) ? Api.withPrefix(path) : path;
}

const BOTTOM_PRIMARY = new Set(['dashboard', 'fuel', 'fuel-report', 'bunker-plan']);

function isAioEmbedded() {
  try {
    if (document.documentElement.classList.contains('chengaio-embed')) return true;
    if (window.ChengLicense && typeof ChengLicense.isEmbeddedInAio === 'function') {
      return !!ChengLicense.isEmbeddedInAio();
    }
  } catch (_) { /* ignore */ }
  return false;
}

function isBunkerOpsEmbed() {
  return document.documentElement.classList.contains('bunker-ops-embed');
}

/**
 * The two planning screens — Bunker Plan (the fill sequence and monitoring
 * sheet) and Bunker Consumption (the voyage fuel calculation) — are hidden
 * from this menu whenever ChEng AIO is the shell. The suite has its own
 * Bunkering Plan and Consumption Plan entries and opens these same pages in
 * an iframe, so leaving the tabs here would put one sheet in two places in
 * the same window.
 *
 * Standalone, each is a licensed program in its own right: an office that did
 * not buy the bunkering sheet does not get it on the menu.
 */
function planNavAllowed(moduleId) {
  if (isAioEmbedded()) return false;
  if (!window.ChengLicense) return true;
  try {
    const ent = ChengLicense.loadEntitlement();
    if (!ChengLicense.isValid(ent)) return false;
    if (typeof ChengLicense.moduleAllowed !== 'function') return true;
    return !!ChengLicense.moduleAllowed(moduleId, ent);
  } catch (_) {
    return true;
  }
}

function bunkerPlanNavAllowed() {
  if (isBunkerOpsEmbed()) return false;
  return planNavAllowed('bunkeringplan');
}

function bunkerConsumptionNavAllowed() {
  if (isBunkerOpsEmbed()) return false;
  return planNavAllowed('bunkerplan');
}

/* Page id → whether its menu entry is on, and the sidebar label to match. */
const PLAN_NAV_PAGES = [
  { page: 'bunker-plan', label: 'Bunker Plan', allowed: bunkerPlanNavAllowed },
  { page: 'bunker-consumption', label: 'Bunker Consumption', allowed: bunkerConsumptionNavAllowed },
];

function applyBunkerPlanNavVisibility() {
  for (const entry of PLAN_NAV_PAGES) {
    const show = entry.allowed();
    document.querySelectorAll(`[data-page="${entry.page}"]`).forEach((el) => {
      el.hidden = !show;
      el.style.display = show ? '' : 'none';
    });
    document.querySelectorAll('#sidebar-nav .nav-btn, #bn-more-nav .nav-btn').forEach((el) => {
      const own = (el.querySelector('span:last-child')?.textContent || el.textContent || '').trim();
      if (own !== entry.label) return;
      el.hidden = !show;
      el.style.display = show ? '' : 'none';
    });
  }
}

function syncBottomNav() {
  const page = STATE.route.page;
  document.querySelectorAll('#bottomNav .bn-item').forEach((btn) => {
    const p = btn.dataset.page;
    if (p === 'more') {
      btn.classList.toggle('active', !BOTTOM_PRIMARY.has(page));
    } else {
      btn.classList.toggle('active', p === page);
    }
  });
  applyBunkerPlanNavVisibility();
}

function renderMoreNav() {
  const host = document.getElementById('bn-more-nav');
  if (!host) return;
  host.innerHTML = '';

  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.innerHTML = `
    <div class="ship">${vesselName()}</div>
    <div class="sub"><span class="status-dot ${STATE.online ? 'online' : 'offline'}"></span>
      ${STATE.online ? 'Online' : 'Offline'} · ${Branding.APP_NAME}</div>
    <select class="vessel-select" id="bn-vessel-switcher">
      <option value="">— Select vessel —</option>
      ${STATE.vessels.map((v) => `<option value="${v.id}" ${v.id === STATE.activeVesselId ? 'selected' : ''}>${v.name}</option>`).join('')}
    </select>`;
  host.appendChild(brand);

  const mk = (page, label, icon) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nav-btn' + (STATE.route.page === page ? ' active' : '');
    b.innerHTML = `<span class="ic">${icon}</span><span>${label}</span>`;
    b.onclick = () => { closeMoreSheet(); navigate(page); };
    return b;
  };

  let g = document.createElement('div');
  g.className = 'nav-group-label'; g.textContent = 'Tanks';
  host.appendChild(g);
  for (const c of CATS) {
    if (c.id === 'fuel') continue;
    host.appendChild(mk(c.id, c.label, c.icon));
  }
  host.appendChild(mk('add-tank', 'Add Tank', '+'));
  host.appendChild(mk('calibration', 'Calibration DB', '☰'));

  g = document.createElement('div');
  g.className = 'nav-group-label'; g.textContent = 'Fuel Management';
  host.appendChild(g);
  if (bunkerPlanNavAllowed()) host.appendChild(mk('bunker-plan', 'Bunker Plan', '📈'));
  host.appendChild(mk('bunker-after', 'After Bunkering', '📥'));
  host.appendChild(mk('bunker-summary', 'Bunker Summary', '📑'));
  if (bunkerConsumptionNavAllowed()) {
    host.appendChild(mk('bunker-consumption', 'Bunker Consumption', '📊'));
  }
  host.appendChild(mk('report', 'Voyage Report', '📋'));

  g = document.createElement('div');
  g.className = 'nav-group-label'; g.textContent = 'Reference';
  host.appendChild(g);
  host.appendChild(mk('vcf-wcf', 'VCF / WCF Calc', 'Σ'));
  host.appendChild(mk('iso8217', 'ISO 8217 Specs', '▤'));

  g = document.createElement('div');
  g.className = 'nav-group-label'; g.textContent = 'System';
  host.appendChild(g);
  host.appendChild(mk('setup', 'Vessel Setup', '⚙'));
  host.appendChild(mk('settings', 'Backup / Sync', '⇅'));
  host.appendChild(mk('about', 'About', 'ℹ'));

  const themeBtn = document.createElement('button');
  themeBtn.type = 'button';
  themeBtn.className = 'theme-toggle no-print';
  themeBtn.setAttribute('data-theme-toggle', '');
  themeBtn.textContent = document.documentElement.classList.contains('bright') ? 'Night' : 'Bright';
  themeBtn.title = 'Day / bright mode for sunlight';
  host.appendChild(themeBtn);
  if (window.MarineTheme) MarineTheme.bind(host);

  const sw = document.getElementById('bn-vessel-switcher');
  if (sw) {
    sw.onchange = async (e) => {
      const id = e.target.value;
      if (!id) return;
      await Api.setActive(id);
      STATE.activeVesselId = id;
      await reloadBundle();
      closeMoreSheet();
      navigate('dashboard');
      showToast('Loaded vessel');
    };
  }
}

/** Pages that were folded into another screen; old links still land somewhere sensible. */
const PAGE_ALIASES = { bunkering: 'bunker-plan' };

function navigate(page, tankId = null) {
  let next = PAGE_ALIASES[page] || page;
  if (next === 'bunker-plan' && !isBunkerOpsEmbed() && !bunkerPlanNavAllowed()) {
    showToast(isAioEmbedded()
      ? 'Open Bunkering Plan from the ChEng AIO menu'
      : 'Bunker Plan is not available on this license');
    next = 'dashboard';
  }
  if (next === 'bunker-consumption' && !bunkerConsumptionNavAllowed()) {
    showToast(isAioEmbedded()
      ? 'Open Consumption Plan from the ChEng AIO menu'
      : 'Bunker Consumption is not available on this license');
    next = 'dashboard';
  }
  STATE.route = { page: next, tankId };
  closeMobileNav();
  closeMoreSheet();
  render();
  window.scrollTo(0, 0);
}

async function persistPart(part, data) {
  STATE.bundle[part] = data;
  await OfflineDB.idbSet('vessel:' + STATE.activeVesselId, STATE.bundle);
  try {
    await Api.savePart(STATE.activeVesselId, part, data);
  } catch {
    await Api.mutate(`/api/vessels/${STATE.activeVesselId}/${part}`, { method: 'PUT', body: data });
    showToast('Saved offline — will sync when online');
  }
}

async function reloadBundle() {
  if (!STATE.activeVesselId) { STATE.bundle = null; return; }
  STATE.bundle = await Api.getVessel(STATE.activeVesselId);
}

/* ---------- Nav / shell ---------- */
function renderNav() {
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = '';

  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.innerHTML = `
    <div class="ship">${vesselName()}</div>
    <div class="sub"><span class="status-dot ${STATE.online ? 'online' : 'offline'}"></span>
      ${STATE.online ? 'Online' : 'Offline'} · ${Branding.APP_NAME}</div>
    <select class="vessel-select" id="vessel-switcher">
      <option value="">— Select vessel —</option>
      ${STATE.vessels.map((v) => `<option value="${v.id}" ${v.id === STATE.activeVesselId ? 'selected' : ''}>${v.name}</option>`).join('')}
    </select>`;
  nav.appendChild(brand);

  const mk = (page, label, icon) => {
    const b = document.createElement('button');
    b.className = 'nav-btn' + (STATE.route.page === page ? ' active' : '');
    b.innerHTML = `<span class="ic">${icon}</span><span>${label}</span>`;
    b.onclick = () => navigate(page);
    return b;
  };

  nav.appendChild(mk('dashboard', 'Dashboard', '▦'));

  let g = document.createElement('div');
  g.className = 'nav-group-label'; g.textContent = 'Tanks';
  nav.appendChild(g);
  for (const c of CATS) nav.appendChild(mk(c.id, c.label, c.icon));
  nav.appendChild(mk('add-tank', 'Add Tank', '+'));
  nav.appendChild(mk('calibration', 'Calibration DB', '☰'));

  g = document.createElement('div');
  g.className = 'nav-group-label'; g.textContent = 'Fuel Management';
  nav.appendChild(g);
  nav.appendChild(mk('fuel-report', 'Fuel Report', '🧾'));
  if (bunkerPlanNavAllowed()) nav.appendChild(mk('bunker-plan', 'Bunker Plan', '📈'));
  if (bunkerConsumptionNavAllowed()) nav.appendChild(mk('bunker-consumption', 'Bunker Consumption', '📊'));
  nav.appendChild(mk('bunker-after', 'After Bunkering', '📥'));
  nav.appendChild(mk('bunker-summary', 'Bunker Summary', '📑'));
  nav.appendChild(mk('report', 'Voyage Report', '📋'));

  g = document.createElement('div');
  g.className = 'nav-group-label'; g.textContent = 'Reference';
  nav.appendChild(g);
  nav.appendChild(mk('vcf-wcf', 'VCF / WCF Calc', 'Σ'));
  nav.appendChild(mk('iso8217', 'ISO 8217 Specs', '▤'));

  g = document.createElement('div');
  g.className = 'nav-group-label'; g.textContent = 'System';
  nav.appendChild(g);
  nav.appendChild(mk('setup', 'Vessel Setup', '⚙'));
  nav.appendChild(mk('settings', 'Backup / Sync', '⇅'));
  nav.appendChild(mk('about', 'About', 'ℹ'));

  /* The credit that prints from pages which print themselves — the voyage
     report calls window.print() on the live page rather than building a
     document. Rebuilt on each render so its timestamp is the print's, not the
     one from whenever the app was opened. */
  const pageCredit = document.getElementById('app-credit-page');
  if (pageCredit) pageCredit.outerHTML = Branding.printCredit().replace(
    'class="app-credit-print"', 'class="app-credit-print" id="app-credit-page"');

  /* Who wrote it, at the foot of the navigation, so it is on every page rather
     than only on the About page nobody opens. */
  const credit = document.createElement('div');
  credit.className = 'nav-credit no-print';
  credit.innerHTML = `<span>${Branding.APP_NAME}</span>`
    + Branding.AUTHORS.map((a) => `<b>${a}</b>`).join('');
  nav.appendChild(credit);

  const themeBtn = document.createElement('button');
  themeBtn.type = 'button';
  themeBtn.className = 'theme-toggle no-print';
  themeBtn.setAttribute('data-theme-toggle', '');
  themeBtn.textContent = document.documentElement.classList.contains('bright') ? 'Night' : 'Bright';
  themeBtn.title = 'Day / bright mode for sunlight';
  nav.appendChild(themeBtn);
  if (window.MarineTheme) MarineTheme.bind(nav);

  document.getElementById('vessel-switcher').onchange = async (e) => {
    const id = e.target.value;
    if (!id) return;
    await Api.setActive(id);
    STATE.activeVesselId = id;
    await reloadBundle();
    navigate('dashboard');
    showToast('Loaded vessel');
  };
}

function render() {
  renderNav();
  syncBottomNav();
  const main = document.getElementById('main');
  main.innerHTML = '';

  if (!STATE.online) {
    const banner = document.createElement('div');
    banner.className = 'offline-banner';
    banner.textContent = 'Working offline — changes are saved locally and will sync when the server is available.';
    main.appendChild(banner);
  }

  const noVesselOk = ['setup', 'settings', 'about', 'vcf-wcf', 'iso8217'];
  if (!STATE.bundle && !noVesselOk.includes(STATE.route.page)) {
    main.innerHTML += `<div class="form-panel"><h2>No vessel selected</h2>
      <p style="color:var(--text-dim)">Create or select a vessel in Vessel Setup to begin.</p>
      <button class="btn primary" id="go-setup">Open Vessel Setup</button></div>`;
    document.getElementById('go-setup').onclick = () => navigate('setup');
    return;
  }

  const page = STATE.route.page;
  if (page === 'dashboard') renderDashboard(main);
  else if (page === 'calibration') renderCalibrationList(main);
  else if (page === 'add-tank') renderAddTank(main);
  else if (page === 'voyage') BunkerConsumption.render(main);
  else if (page === 'fuel-report') FuelReport.render(main);
  else if (page === 'bunker-plan') BunkerReports.renderPlan(main);
  else if (page === 'bunker-consumption') BunkerConsumption.render(main);
  else if (page === 'bunker-after') BunkerReports.renderAfter(main);
  else if (page === 'bunker-summary') BunkerReports.renderSummary(main);
  else if (page === 'report') renderReport(main);
  else if (page === 'vcf-wcf') renderVcfWcf(main);
  else if (page === 'iso8217') renderIso8217(main);
  else if (page === 'setup') renderSetup(main);
  else if (page === 'settings') renderSettings(main);
  else if (page === 'about') renderAbout(main);
  else if (CATS.some((c) => c.id === page) && !STATE.route.tankId) renderCategory(main, page);
  else if (STATE.route.tankId) renderTankDetail(main, STATE.route.tankId);
}

/* ---------- Dashboard ---------- */
function categoryTotals(catId) {
  const tanks = STATE.bundle.tanks[catId] || [];
  let capacity = 0, volume = 0, weight = 0, withReading = 0;
  for (const t of tanks) {
    capacity += t.capacity || 0;
    const r = getReading(t.id);
    if (r?.result) {
      volume += r.result.volumeObserved || 0;
      weight += r.result.weightMT || 0;
      withReading++;
    }
  }
  return { capacity, volume, weight, withReading, count: tanks.length };
}

function renderDashboard(main) {
  const v = STATE.bundle.voyage || {};
  main.innerHTML += `<div class="page-head"><div>
    <h1>Vessel Tank Overview</h1>
    <div class="desc">${vesselName()} · ${v.port || ''} · ${v.date || ''}</div>
  </div></div>`;

  let grandVol = 0, grandCap = 0, grandWeight = 0, totalTanks = 0, readTanks = 0;
  const cards = document.createElement('div');
  cards.className = 'cards-row';
  for (const c of CATS) {
    const t = categoryTotals(c.id);
    grandVol += t.volume; grandCap += t.capacity; grandWeight += t.weight;
    totalTanks += t.count; readTanks += t.withReading;
    const pct = t.capacity ? (t.volume / t.capacity) * 100 : 0;
    cards.innerHTML += `<div class="card">
      <div class="label"><span class="cat-dot cat-${c.id}"></span>${c.label}</div>
      <div class="value">${fmt(t.volume,1)}<span class="unit">m³ / ${fmt(t.capacity,0)}</span></div>
      <div class="sub">${t.withReading}/${t.count} logged · ${fmt(pct,1)}% full</div>
    </div>`;
  }
  const summary = document.createElement('div');
  summary.className = 'cards-row';
  summary.innerHTML = `
    <div class="card"><div class="label">Total Volume</div><div class="value">${fmt(grandVol,1)}<span class="unit">m³</span></div></div>
    <div class="card"><div class="label">Total Weight</div><div class="value">${fmt(grandWeight,1)}<span class="unit">MT</span></div></div>
    <div class="card"><div class="label">Readings</div><div class="value">${readTanks}<span class="unit">/ ${totalTanks}</span></div></div>`;
  main.appendChild(summary);
  main.appendChild(cards);

  const modeRow = document.createElement('div');
  modeRow.className = 'btn-row no-print';
  modeRow.style.margin = '4px 0 2px';
  modeRow.innerHTML = `
    <button class="btn small ${STATE.tankView === 'graphic' ? 'primary' : ''}" id="tv-graphic">Graphical tanks</button>
    <button class="btn small ${STATE.tankView === 'graphic' ? '' : 'primary'}" id="tv-table">Table</button>`;
  main.appendChild(modeRow);
  modeRow.querySelector('#tv-graphic').onclick = () => setTankView('graphic');
  modeRow.querySelector('#tv-table').onclick = () => setTankView('table');

  if (STATE.tankView === 'graphic') {
    renderTankGraphics(main);
    return;
  }

  for (const c of CATS) {
    const title = document.createElement('div');
    title.className = 'section-title';
    title.innerHTML = `<span class="cat-dot cat-${c.id}"></span>${c.label}`;
    main.appendChild(title);
    main.appendChild(buildTankTable(STATE.bundle.tanks[c.id] || []));
  }
}

function setTankView(mode) {
  STATE.tankView = mode;
  try { localStorage.setItem('tankView', mode); } catch { /* private mode */ }
  navigate('dashboard');
}

/* ---------- graphical tank view ---------- */

const TANK_GROUPS = [
  { id: 'all', label: 'All tanks', match: () => true },
  { id: 'fuel', label: 'Fuel oil', match: (t) => t.category === 'fuel' },
  { id: 'storage', label: 'Storage', match: (t) => t.category === 'fuel' && roleIs(t, 'storage') },
  { id: 'settling', label: 'Settling', match: (t) => roleIs(t, 'settling') },
  { id: 'service', label: 'Service', match: (t) => roleIs(t, 'service') },
  { id: 'overflow', label: 'Overflow', match: (t) => roleIs(t, 'overflow') },
  { id: 'lube', label: 'Lube oil', match: (t) => t.category === 'lube' },
  { id: 'water', label: 'Fresh water', match: (t) => t.category === 'water' },
  { id: 'misc', label: 'Misc / bilge', match: (t) => t.category === 'misc' },
];

function roleIs(tank, role) {
  return String(tank.fuelRole || '').toLowerCase() === role;
}

function allTanks() {
  const out = [];
  for (const c of CATS) for (const t of (STATE.bundle.tanks[c.id] || [])) out.push(t);
  return out;
}

function renderTankGraphics(main) {
  const group = TANK_GROUPS.find((g) => g.id === STATE.tankGroup) || TANK_GROUPS[0];
  const tanks = allTanks().filter(group.match);

  const grid = document.createElement('div');
  grid.className = 'tg-grid' + (STATE.tankTabOpen === false ? ' tab-collapsed' : '');
  if (!tanks.length) {
    grid.innerHTML = '<div class="empty-state">No tanks in this group</div>';
  }
  for (const t of tanks) {
    const r = getReading(t.id);
    const pct = r?.result?.fillPercent ?? null;
    const card = document.createElement('div');
    card.className = 'tg-card clickable';
    card.onclick = () => navigate(t.category, t.id);
    const role = TankGraphics.roleOf(t);
    card.title = `${t.name} — ${TankGraphics.ROLE_MEANING[role] || ''}`;
    card.innerHTML = `
      <div class="tg-name">${escapeHtml(t.name)}</div>
      <div class="tg-art">${TankGraphics.tankSvg(t, pct, { safeFill: t.category === 'fuel' ? 85 : null })}
        <div class="tg-pct">${pct != null ? fmt(pct, 0) + '%' : '—'}</div>
      </div>
      <div class="tg-stats">
        <span class="tg-chip" style="--tg-chip:${TankGraphics.liquidColour(t)}">${escapeHtml(TankGraphics.contentLabel(t))}</span>
        <span>${r ? fmt(r.result.volumeObserved, 1) : '–'} m³</span>
        <span>${r?.tempC != null && r.tempC !== '' ? fmt(r.tempC, 1) + ' °C' : '– °C'}</span>
        <span>${r?.result?.weightMT != null ? fmt(r.result.weightMT, 2) + ' MT' : '– MT'}</span>
      </div>`;
    grid.appendChild(card);
  }
  main.appendChild(grid);
  main.appendChild(buildGroupTab(group));
}

/**
 * The group picker rides on the right edge rather than sitting in the flow, so
 * switching between fuel, lube and water does not cost a scroll back to the top
 * on a screen showing forty tanks.
 */
function buildGroupTab(current) {
  const counts = {};
  const all = allTanks();
  for (const g of TANK_GROUPS) counts[g.id] = all.filter(g.match).length;

  const tab = document.createElement('aside');
  tab.className = 'tg-tab no-print' + (STATE.tankTabOpen === false ? ' collapsed' : '');
  tab.innerHTML = `
    <button class="tg-tab-handle" aria-expanded="${STATE.tankTabOpen !== false}">
      <span class="tg-tab-handle-text">Groups</span>
    </button>
    <div class="tg-tab-body">
      <div class="tg-tab-title">Show</div>
      ${TANK_GROUPS.map((g) => `
        <button class="tg-group ${g.id === current.id ? 'on' : ''}" data-group="${g.id}" ${counts[g.id] ? '' : 'disabled'}>
          <span>${escapeHtml(g.label)}</span><b>${counts[g.id]}</b>
        </button>`).join('')}
      <div class="tg-tab-title">Contents</div>
      ${['hfo', 'lsfo', 'mdo', 'mgo', 'lsmgo', 'lube', 'water', 'misc'].map((k) => `
        <div class="tg-key"><i style="background:${TankGraphics.CONTENT[k].fill}"></i>${TankGraphics.CONTENT[k].label}</div>`).join('')}
      <div class="tg-tab-title">Along the chain</div>
      ${[['storage', 'Storage'], ['settling', 'Settling'], ['service', 'Service'], ['overflow', 'Overflow']].map(([role, label]) => `
        <div class="tg-key"><i style="background:${TankGraphics.shade(TankGraphics.CONTENT.mdo.fill, TankGraphics.ROLE_SHADE[role])}"></i>${label}</div>`).join('')}
    </div>`;

  tab.querySelector('.tg-tab-handle').onclick = () => {
    STATE.tankTabOpen = STATE.tankTabOpen === false;
    try { localStorage.setItem('tankTabOpen', String(STATE.tankTabOpen)); } catch { /* private mode */ }
    tab.classList.toggle('collapsed', STATE.tankTabOpen === false);
    const grid = document.querySelector('.tg-grid');
    if (grid) grid.classList.toggle('tab-collapsed', STATE.tankTabOpen === false);
  };
  tab.querySelectorAll('[data-group]').forEach((btn) => {
    btn.onclick = () => {
      STATE.tankGroup = btn.dataset.group;
      try { localStorage.setItem('tankGroup', STATE.tankGroup); } catch { /* private mode */ }
      navigate('dashboard');
    };
  });
  return tab;
}

function buildTankTable(tanks) {
  const wrap = document.createElement('div');
  wrap.className = 'scroll-x';
  const table = document.createElement('table');
  table.className = 'tank-table';
  table.innerHTML = `<thead><tr>
    <th>Tank</th><th>Role</th><th>Side</th><th>100% m³</th><th>85% m³</th><th>Reading</th><th>Vol m³</th><th>Fill</th><th>MT</th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');
  for (const t of tanks) {
    const r = getReading(t.id);
    const pct = r?.result?.fillPercent ?? null;
    const cls = fillStatusClass(pct);
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.onclick = () => navigate(t.category, t.id);
    tr.innerHTML = `
      <td class="tname">${t.name}</td>
      <td><span class="tag">${t.fuelRole || '—'}</span></td>
      <td>${t.side || '—'}</td>
      <td>${fmt(t.capacity,1)}</td>
      <td>${fmt((t.capacity||0)*0.85,1)}</td>
      <td>${r ? fmt(r.reading, r.gaugeType === 'volume' ? 2 : 1) : '–'}</td>
      <td>${r ? fmt(r.result.volumeObserved,2) : '–'}</td>
      <td>${pct != null ? `<div class="fillbar-wrap"><div class="fillbar-track"><div class="fillbar-fill" style="width:${Math.min(100,pct)}%;background:${cls==='bad'?'var(--bad)':cls==='warn'?'var(--warn)':'var(--good)'}"></div></div><span class="fillbar-pct">${fmt(pct,0)}%</span></div>` : '<span class="pill neutral">none</span>'}</td>
      <td>${r?.result?.weightMT != null ? fmt(r.result.weightMT,2) : '–'}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderCategory(main, catId) {
  const c = CATS.find((x) => x.id === catId);
  const t = categoryTotals(catId);
  main.innerHTML += `<div class="page-head"><div><h1><span class="cat-dot cat-${c.id}"></span>${c.label}</h1>
    <div class="desc">${t.count} tanks · ${fmt(t.capacity,0)} m³</div></div></div>`;
  main.appendChild(buildTankTable(STATE.bundle.tanks[catId] || []));
}

/* ---------- Tank detail ---------- */
function renderTankDetail(main, tankId) {
  const tank = findTank(tankId);
  if (!tank) { main.innerHTML += '<div class="empty-state">Tank not found</div>'; return; }
  const existing = getReading(tankId) || {};
  const c = CATS.find((x) => x.id === tank.category);

  const back = document.createElement('div');
  back.className = 'back-link';
  back.textContent = '← Back to ' + c.label;
  back.onclick = () => navigate(tank.category);
  main.appendChild(back);

  main.innerHTML += `<div class="page-head"><div><h1>${tank.name}</h1>
    <div class="desc">${c.label} · ${tank.fuelRole || ''} · ${tank.side || ''} · cap ${fmt(tank.capacity,2)} m³ · ${tank.calcType}</div></div>
    <div class="btn-row">
      <button class="btn small" id="btn-edit-calib">Edit calibration</button>
      <button class="btn small danger" id="btn-del-tank">Delete tank</button>
    </div></div>`;

  const grid = document.createElement('div');
  grid.className = 'detail-grid';
  const gaugeChoice = tank.calcType === 'direct' && /SETT|SERVICE/i.test(tank.name || '');
  const initialGT = existing.gaugeType || 'meter';

  grid.innerHTML = `
    <div class="form-panel">
      ${gaugeChoice ? `<div class="form-row"><label>Gauge type</label>
        <select id="in-gaugetype">
          <option value="meter" ${initialGT==='meter'?'selected':''}>Meter / ullage (calibration)</option>
          <option value="volume" ${initialGT==='volume'?'selected':''}>Volume gauge (m³ direct)</option>
        </select></div>` : ''}
      <div class="form-row"><label id="reading-label">${initialGT==='volume'?'Volume m³':(tank.soundingMethod||'Reading')}</label>
        <input type="number" step="any" id="in-reading" value="${existing.reading ?? ''}"></div>
      <div class="form-row-2" id="trimlist-row" style="${initialGT==='volume'?'display:none':''}">
        <div class="form-row"><label>Trim (m)</label><input type="number" step="any" id="in-trim" value="${existing.trim ?? STATE.bundle.voyage?.trim ?? 0}"></div>
        <div class="form-row"><label>List / Heel (°)</label><input type="number" step="any" id="in-list" value="${existing.list ?? STATE.bundle.voyage?.heel ?? 0}"></div>
      </div>
    <div class="form-row-2">
      <div class="form-row"><label>Temp (°C)</label><input type="number" step="any" id="in-temp" value="${existing.tempC ?? 15}"></div>
      <div class="form-row"><label>Density @15°C (kg/L)</label><input type="number" step="any" id="in-density" value="${existing.density15 ?? ''}" placeholder="0.9584"></div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label>SG / relative density → density</label>
        <div style="display:flex;gap:6px"><input type="number" step="any" id="in-sg" placeholder="e.g. 0.959"><button type="button" class="btn small" id="btn-sg-den">SG→ρ</button></div>
        <div class="hint">Workbook Conversion sheet (RD/SG)</div></div>
      <div class="form-row"><label>Density → SG</label>
        <div style="display:flex;gap:6px"><input type="number" step="any" id="in-den-to-sg" placeholder="kg/L"><button type="button" class="btn small" id="btn-den-sg">ρ→SG</button></div>
        <div class="hint" id="sg-equiv-hint">Equivalent SG shown after convert</div></div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label>API → density (Conversion sheet)</label>
        <div style="display:flex;gap:6px"><input type="number" step="any" id="in-api" placeholder="API"><button type="button" class="btn small" id="btn-api-den">Use</button></div>
        <div class="hint">From workbook Conversion sheet</div></div>
      <div class="form-row"><label>Capacity ref</label>
        <div class="hint">100% ${fmt(tank.capacity,2)} m³ · 85% ${fmt((tank.capacity||0)*0.85,2)} m³</div></div>
    </div>
    <button class="btn primary" id="btn-calc" style="width:100%">Calculate & Save</button>
    </div>
    <div class="result-panel" id="result-panel"></div>`;
  main.appendChild(grid);

  document.getElementById('btn-edit-calib').onclick = () => navigate('calibration', tankId);
  document.getElementById('btn-del-tank').onclick = async () => {
    if (!confirm('Delete this tank and its readings?')) return;
    await Api.deleteTank(STATE.activeVesselId, tankId);
    await reloadBundle();
    navigate(tank.category);
    showToast('Tank deleted');
  };

  if (gaugeChoice) {
    document.getElementById('in-gaugetype').onchange = (e) => {
      document.getElementById('trimlist-row').style.display = e.target.value === 'volume' ? 'none' : '';
    };
  }

  async function doCalc() {
    const reading = parseFloat(document.getElementById('in-reading').value);
    if (Number.isNaN(reading)) { showToast('Enter a reading'); return; }
    const gaugeType = gaugeChoice ? document.getElementById('in-gaugetype').value : 'meter';
    const inputs = {
      reading,
      trim: gaugeType === 'volume' ? 0 : (parseFloat(document.getElementById('in-trim').value) || 0),
      list: gaugeType === 'volume' ? 0 : (parseFloat(document.getElementById('in-list').value) || 0),
      tempC: parseFloat(document.getElementById('in-temp').value) || 15,
      density15: document.getElementById('in-density').value === '' ? null : parseFloat(document.getElementById('in-density').value),
      gaugeType,
    };
    let result;
    try {
      const resp = await Api.calculate(STATE.activeVesselId, { tankId, inputs, save: true });
      result = resp.result;
      STATE.bundle.readings[tankId] = resp.reading;
      await OfflineDB.idbSet('vessel:' + STATE.activeVesselId, STATE.bundle);
    } catch {
      result = computeTank(tank, inputs);
      STATE.bundle.readings[tankId] = { ...inputs, result, savedAt: new Date().toISOString() };
      await persistPart('readings', STATE.bundle.readings);
    }
    renderResultSteps(document.getElementById('result-panel'), tank, result, inputs);
    showToast('Reading saved');
  }
  document.getElementById('btn-calc').onclick = doCalc;

  async function loadConversionTable() {
    if (STATE.conversionTable) return STATE.conversionTable;
    const table = await Api.request('/api/reference/conversion');
    STATE.conversionTable = table;
    return table;
  }

  async function syncSgHintFromDensity() {
    const dens = parseFloat(document.getElementById('in-density').value);
    const hint = document.getElementById('sg-equiv-hint');
    if (!hint || Number.isNaN(dens)) return;
    try {
      const table = await loadConversionTable();
      const sg = typeof density15ToSg === 'function'
        ? density15ToSg(dens, table.rdToDensity15)
        : null;
      if (sg != null) {
        hint.textContent = `≈ SG ${fmt(sg, 4)} (from density ${fmt(dens, 4)})`;
        document.getElementById('in-den-to-sg').value = dens;
        document.getElementById('in-sg').value = fmt(sg, 4);
      }
    } catch (_) { /* ignore */ }
  }

  document.getElementById('btn-api-den').onclick = async () => {
    const api = parseFloat(document.getElementById('in-api').value);
    if (Number.isNaN(api)) { showToast('Enter API'); return; }
    try {
      const table = await loadConversionTable();
      const dens = typeof apiToDensity15Lookup === 'function'
        ? apiToDensity15Lookup(api, table.apiToDensity15)
        : null;
      if (dens == null) { showToast('No conversion data'); return; }
      document.getElementById('in-density').value = dens;
      await syncSgHintFromDensity();
      showToast(`Density @15°C ≈ ${dens}`);
    } catch (e) { showToast(e.message); }
  };

  document.getElementById('btn-sg-den').onclick = async () => {
    const sg = parseFloat(document.getElementById('in-sg').value);
    if (Number.isNaN(sg)) { showToast('Enter SG / relative density'); return; }
    try {
      const table = await loadConversionTable();
      const dens = typeof sgToDensity15 === 'function'
        ? sgToDensity15(sg, table.rdToDensity15)
        : null;
      if (dens == null) { showToast('SG out of conversion table range'); return; }
      document.getElementById('in-density').value = dens;
      document.getElementById('in-den-to-sg').value = dens;
      document.getElementById('sg-equiv-hint').textContent = `SG ${fmt(sg, 4)} → density ${fmt(dens, 4)} kg/L`;
      showToast(`Density @15°C ≈ ${dens}`);
    } catch (e) { showToast(e.message); }
  };

  document.getElementById('btn-den-sg').onclick = async () => {
    const dens = parseFloat(document.getElementById('in-den-to-sg').value
      || document.getElementById('in-density').value);
    if (Number.isNaN(dens)) { showToast('Enter density @15°C'); return; }
    try {
      const table = await loadConversionTable();
      const sg = typeof density15ToSg === 'function'
        ? density15ToSg(dens, table.rdToDensity15)
        : null;
      if (sg == null) { showToast('Density out of conversion table range'); return; }
      document.getElementById('in-sg').value = sg;
      document.getElementById('in-density').value = dens;
      document.getElementById('sg-equiv-hint').textContent = `Density ${fmt(dens, 4)} → SG ${fmt(sg, 4)}`;
      showToast(`SG / RD ≈ ${sg}`);
    } catch (e) { showToast(e.message); }
  };

  document.getElementById('in-density').addEventListener('change', syncSgHintFromDensity);
  if (existing.density15 != null) syncSgHintFromDensity();

  if (existing.result) renderResultSteps(document.getElementById('result-panel'), tank, existing.result, existing);
  else document.getElementById('result-panel').innerHTML = '<div class="empty-state">Enter sounding and calculate</div>';
}

function renderResultSteps(panel, tank, r, inputs) {
  const pct = r.fillPercent;
  const cls = fillStatusClass(pct);
  const color = cls === 'bad' ? 'var(--bad)' : cls === 'warn' ? 'var(--warn)' : 'var(--good)';
  const circ = 2 * Math.PI * 34;
  const dash = Math.max(0, Math.min(100, pct || 0)) / 100 * circ;
  panel.innerHTML = `
    <div class="gauge-wrap">
      <div class="gauge-ring">
        <svg width="84" height="84"><circle cx="42" cy="42" r="34" stroke="var(--border)" stroke-width="8" fill="none"/>
        <circle cx="42" cy="42" r="34" stroke="${color}" stroke-width="8" fill="none"
          stroke-dasharray="${dash} ${circ}" stroke-linecap="round"/></svg>
        <div class="gauge-pct">${pct != null ? fmt(pct,0)+'%' : '–'}</div>
      </div>
      <div>
        <div style="font-size:22px;font-weight:800">${fmt(r.volumeObserved,2)} m³</div>
        <div style="color:var(--text-dim);font-size:12px">observed · cap ${fmt(tank.capacity,1)} m³</div>
        ${r.weightMT != null ? `<div style="margin-top:4px;font-weight:700;color:var(--accent-2)">${fmt(r.weightMT,3)} MT</div>` : ''}
      </div>
    </div>`;
  const steps = document.createElement('div');
  steps.className = 'steps';
  const defs = [];
  if (r.gaugeType === 'volume') {
    defs.push({ label: 'Volume gauge', formula: 'direct reading', value: fmt(inputs.reading,3)+' m³' });
    defs.push({ label: 'Observed volume', formula: 'clamped to capacity', value: fmt(r.volumeObserved,3)+' m³', highlight: true });
  } else if (tank.calcType === 'correction') {
    defs.push({
      label: 'Trim correction',
      formula: `Interp2 FLOOR/CEILING inc=${r.soundingIncrement ?? '?'} ÷ ${tank.correctionDivisor}`,
      value: fmt((r.trimCorrection||0)/(tank.correctionDivisor||1),3),
    });
    defs.push({
      label: 'List correction',
      formula: `Interp2 FLOOR/CEILING inc=${r.heelIncrement ?? '?'} ÷ ${tank.correctionDivisor}`,
      value: fmt((r.listCorrection||0)/(tank.correctionDivisor||1),3),
    });
    defs.push({ label: 'Corrected reading', formula: 'reading + corrections', value: fmt(r.correctedReading,2) });
    defs.push({ label: 'Observed volume', formula: 'volume curve interp', value: fmt(r.volumeObserved,3)+' m³', highlight: true });
  } else {
    defs.push({
      label: 'Observed volume',
      formula: `trim×heel grid · sounding inc=${r.soundingIncrement ?? '?'} · heel inc=${r.heelIncrement ?? '?'}`,
      value: fmt(r.volumeObserved,3)+' m³',
      highlight: true,
    });
  }
  if (r.vcf != null) {
    let sgNote = '';
    if (STATE.conversionTable?.rdToDensity15 && typeof density15ToSg === 'function') {
      const sgEq = density15ToSg(inputs.density15, STATE.conversionTable.rdToDensity15);
      if (sgEq != null) sgNote = ` · SG≈${fmt(sgEq, 4)}`;
    }
    defs.push({ label: 'VCF (ASTM 54B)', formula: `ρ15=${inputs.density15}${sgNote}, T=${inputs.tempC}°C`, value: fmt(r.vcf,4) });
    defs.push({ label: 'Vol @15°C', formula: 'obs × VCF', value: fmt(r.correctedVolume15,3)+' m³' });
    defs.push({ label: 'WCF', formula: 'ρ15 − 0.0011', value: fmt(r.wcf,4) });
    defs.push({ label: 'Weight in air', formula: 'vol15 × WCF', value: fmt(r.weightMT,3)+' MT', highlight: true });
  }
  for (const s of defs) {
    steps.innerHTML += `<div class="step${s.highlight?' highlight':''}">
      <div class="step-label">${s.label}<span class="formula">${s.formula}</span></div>
      <div class="step-value">${s.value}</div></div>`;
  }
  panel.appendChild(steps);
}

/* ---------- Add tank ---------- */
/**
 * The sounding-pipe height a tank will actually be read against.
 *
 * It is only needed to flip a reading between dip and ullage, and for the
 * workbook tables it is the top of the calibration axis — so that is the
 * default, taken from the table rather than typed. An explicit value on the
 * tank overrides it, for the tanks where the table does not run all the way to
 * the sounding point and the flip would otherwise be out by the shortfall.
 */
function pipeHeightInfo(tank) {
  const Core = window.FuelReportCore;
  const explicit = Number(tank && tank.pipeHeight) || 0;
  const fromTable = Core && Core.soundingPipeHeight
    ? Number(Core.soundingPipeHeight({ ...tank, pipeHeight: 0 })) || 0
    : 0;
  return {
    explicit,
    fromTable,
    effective: explicit > 0 ? explicit : fromTable,
    overridden: explicit > 0,
  };
}

/** One line saying where the height comes from, under the override box. */
function pipeHeightHint(tank) {
  const info = pipeHeightInfo(tank);
  if (!info.fromTable) {
    return 'No calibration table yet — import one and the height is taken from it. '
      + 'Enter a value only to override.';
  }
  return `From the calibration table: <b>${fmt(info.fromTable, 0)} mm</b>. `
    + (info.overridden
      ? `Overridden with ${fmt(info.explicit, 0)} mm — clear the box to go back to the table.`
      : 'Leave blank to use it; enter a value only to override.');
}

function renderAddTank(main) {
  main.innerHTML += `<div class="page-head"><div><h1>Add Tank</h1>
    <div class="desc">Manually add storage, settling, or service tanks — or import tanks and sounding tables from a capacity PDF.</div></div></div>
    <div class="help-box">Use role <b>storage</b>, <b>settling</b>, or <b>service</b> so bunkering distribution can target the right tanks. Side and tank number enable Port/Starboard and No.1/No.2 splits.
      <br>PDF sounding books: upload below to create one tank per table found (L.C.G/T.C.G/V.C.G/IMOM hydrostatic blocks are skipped). Supports trim grids, SOUNDING|VOLUME, and sectioned EVEN KEEL / TRIM BY STERN|HEAD (ullage) books.</div>`;

  const form = document.createElement('div');
  form.className = 'form-panel';
  form.style.maxWidth = '720px';
  form.innerHTML = `
    <div class="form-row"><label>Tank name</label><input id="t-name" placeholder="NO.3 H.F.O. TANK (P)"></div>
    <div class="form-row-3">
      <div class="form-row"><label>Category</label>
        <select id="t-cat">${CATS.map(c=>`<option value="${c.id}">${c.label}</option>`).join('')}</select></div>
      <div class="form-row"><label>Role</label>
        <select id="t-role">
          <option value="storage">Storage</option>
          <option value="settling">Settling</option>
          <option value="service">Service</option>
          <option value="overflow">Overflow</option>
          <option value="other">Other</option>
        </select></div>
      <div class="form-row"><label>Fuel grade</label>
        <select id="t-grade">
          <option value="hfo">HFO</option><option value="lsfo">LSFO/VLSFO</option>
          <option value="mdo">MDO</option><option value="mgo">MGO</option><option value="other">Other</option>
        </select></div>
    </div>
    <div class="form-row-3">
      <div class="form-row"><label>Side</label>
        <select id="t-side"><option value="port">Port</option><option value="starboard">Starboard</option><option value="center" selected>Center</option></select></div>
      <div class="form-row"><label>Tank No.</label><input id="t-no" type="number" placeholder="1"></div>
      <div class="form-row"><label>Capacity (m³)</label><input id="t-cap" type="number" step="any"></div>
    </div>
    <div class="form-row-3">
      <div class="form-row"><label>Calc type</label>
        <select id="t-calc"><option value="correction">Correction (trim+list + curve)</option><option value="direct">Direct volume grid</option></select></div>
      <div class="form-row"><label>Sounding method</label>
        <select id="t-method"><option value="ullage">Ullage</option><option value="sounding">Sounding</option></select></div>
      <div class="form-row"><label>Pipe height mm <span class="hint-inline">override</span></label>
        <input id="t-pipe" type="number" step="any" placeholder="from the table"
          title="Leave blank: the height is taken from the top of the calibration table once one is imported."></div>
    </div>
    <div class="btn-row">
      <button class="btn primary" id="btn-add-tank">Add tank</button>
      <a class="btn" href="${apiHref('/api/templates/tanks.csv')}">Download CSV template</a>
      <a class="btn" id="btn-export-tanks-csv" href="#">Export tanks CSV</a>
    </div>
    <div class="section-title">Import tanks from sounding PDF</div>
    <p class="hint">Upload a capacity / sounding-table PDF (Veniamis trim-grid or Gangos SOUNDING|VOLUME style). Preview tanks found, then create them with calibration tables applied. <b>Scanned books need OCR</b> (installed automatically when available) — large PDFs can take several minutes.</p>
    <div class="form-row-3" style="margin-bottom:8px">
      <div class="form-row"><label>Page range</label>
        <select id="add-pdf-page-mode">
          <option value="auto" selected>Auto-detect (all pages)</option>
          <option value="range">Select start–end pages</option>
        </select>
      </div>
      <div class="form-row"><label>Start page</label><input id="add-pdf-from" type="number" min="1" placeholder="1" disabled></div>
      <div class="form-row"><label>End page</label><input id="add-pdf-to" type="number" min="1" placeholder="last" disabled></div>
    </div>
    <div class="form-row-3" style="margin-bottom:8px">
      <div class="form-row"><label>Table pattern</label>
        <select id="add-pdf-role">
          <option value="auto" selected>Auto (heel / trim / volume)</option>
          <option value="trim">Trim grid</option>
          <option value="heel">Heel / list grid</option>
          <option value="volume">Volume curve</option>
        </select>
      </div>
      <div class="form-row" style="display:flex;align-items:flex-end">
        <label class="hint" style="display:flex;align-items:center;gap:6px;margin:0">
          <input type="checkbox" id="add-pdf-span" checked> Continue table until next tank name
        </label>
      </div>
      <div class="form-row"></div>
    </div>
    <div class="btn-row" style="align-items:center;gap:8px;flex-wrap:wrap">
      <label class="btn primary">Upload PDF<input type="file" id="add-pdf-file" accept=".pdf,application/pdf" hidden></label>
      <label class="hint" style="display:flex;align-items:center;gap:6px;margin:0">
        <input type="checkbox" id="add-pdf-ocr" checked> Use OCR for scanned PDFs
      </label>
      <label class="hint" style="display:flex;align-items:center;gap:6px;margin:0">
        <input type="checkbox" id="add-pdf-update" checked> Update existing tanks with same name
      </label>
    </div>
    <div id="add-pdf-progress-host"></div>
    <div id="add-pdf-panel" class="pdf-import-panel" style="display:none;margin-top:12px">
      <div id="add-pdf-summary" class="hint" style="margin:0 0 10px"></div>
      <div id="add-pdf-tanks"></div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn primary" id="btn-create-pdf-tanks" disabled>Create selected tanks</button>
      </div>
    </div>
    <div class="section-title">Import / edit tanks from CSV or Excel</div>
    <p class="hint">Accepts tank-list CSV, Giorgis <b>fuel / lube / misc / fresh-water CSV</b>, or <b>lube-oil XLSX</b>. Multi-tank files import depth/ullage × trim volumes and heel corrections. Matching names update calibration tables.</p>
    <label class="hint" style="display:flex;align-items:center;gap:6px;margin:0 0 8px">
      <input type="checkbox" id="csv-update-existing" checked> Update existing tanks with same name
    </label>
    <input type="file" id="csv-file" accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
    <button class="btn" id="btn-import-csv" style="margin-top:8px">Import CSV / Excel</button>`;
  main.appendChild(form);

  const exportTanks = document.getElementById('btn-export-tanks-csv');
  if (exportTanks && STATE.activeVesselId) {
    exportTanks.href = apiHref(`/api/vessels/${STATE.activeVesselId}/tanks.csv`);
  }

  document.getElementById('btn-add-tank').onclick = async () => {
    const name = document.getElementById('t-name').value.trim();
    if (!name) { showToast('Enter tank name'); return; }
    const tank = {
      name,
      category: document.getElementById('t-cat').value,
      fuelRole: document.getElementById('t-role').value,
      fuelGrade: document.getElementById('t-grade').value,
      side: document.getElementById('t-side').value,
      tankNo: document.getElementById('t-no').value ? Number(document.getElementById('t-no').value) : null,
      capacity: parseFloat(document.getElementById('t-cap').value) || 0,
      calcType: document.getElementById('t-calc').value,
      soundingMethod: document.getElementById('t-method').value,
      pipeHeight: parseFloat(document.getElementById('t-pipe').value) || 0,
      correctionDivisor: 10,
      volumeCurve: { x: [0], v: [0] },
      trimAxis: [], trimVals: [], trimGrid: [],
      listAxis: [], listVals: [], listGrid: [],
    };
    await Api.upsertTank(STATE.activeVesselId, tank);
    await reloadBundle();
    showToast('Tank added — open Calibration DB to enter tables');
    navigate('calibration');
  };

  let addPdfFile = null;
  let addPdfPreview = null;

  const syncAddPdfPages = () => {
    const manual = document.getElementById('add-pdf-page-mode')?.value === 'range';
    const from = document.getElementById('add-pdf-from');
    const to = document.getElementById('add-pdf-to');
    if (from) from.disabled = !manual;
    if (to) to.disabled = !manual;
  };
  document.getElementById('add-pdf-page-mode')?.addEventListener('change', syncAddPdfPages);
  syncAddPdfPages();

  function readAddPdfOpts() {
    return {
      ocr: document.getElementById('add-pdf-ocr')?.checked !== false,
      pageMode: document.getElementById('add-pdf-page-mode')?.value || 'auto',
      pageFrom: parseInt(document.getElementById('add-pdf-from')?.value, 10) || null,
      pageTo: parseInt(document.getElementById('add-pdf-to')?.value, 10) || null,
      spanUntilNextTank: document.getElementById('add-pdf-span')?.checked !== false,
      tableRole: document.getElementById('add-pdf-role')?.value || 'auto',
    };
  }

  document.getElementById('add-pdf-file').onchange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    addPdfFile = file;
    const host = document.getElementById('add-pdf-progress-host');
    const panel = document.getElementById('add-pdf-panel');
    const sum = document.getElementById('add-pdf-summary');
    const box = document.getElementById('add-pdf-tanks');
    const btn = document.getElementById('btn-create-pdf-tanks');
    try {
      const opts = readAddPdfOpts();
      if (opts.pageMode === 'range' && !opts.pageFrom && !opts.pageTo) {
        showToast('Enter start and/or end page for manual range');
        return;
      }
      showToast(opts.ocr
        ? 'Reading PDF (progress below — OCR may take several minutes)…'
        : 'Reading PDF tanks…');
      const res = await PdfProgress.runJob(STATE.activeVesselId, file, {
        ...opts,
        mountEl: host,
        title: `Reading ${file.name}…`,
      });
      addPdfPreview = res;
      panel.style.display = '';

      const tankGroups = res.tanks || [];
      const usable = res.usableTables || (res.tables || []).filter((t) => !t.skipped && t.kind !== 'unknown');
      if (!tankGroups.length && !usable.length) {
        sum.innerHTML = [
          (res.warnings || []).map((w) => escapeHtml(w)).join('<br>')
            || 'No usable tank tables found in this PDF.',
          res.ocrUsed ? '<div class="pill">OCR ran</div>' : '<div class="hint">Tip: keep “Use OCR” checked for scanned capacity books, or seed from the FINAL .xlsm workbook instead.</div>',
        ].join('');
        box.innerHTML = '';
        btn.disabled = true;
        showToast('No tanks found in PDF');
        return;
      }

      const continuedN = usable.filter((t) => t.continued).length;
      sum.innerHTML = [
        `<b>${tankGroups.length || usable.length}</b> tank group(s) · <b>${usable.length}</b> usable table(s)`,
        continuedN ? `<span class="pill">${continuedN} continued across pages</span>` : '',
        res.skippedHydrostatic ? `<span class="pill warn">${res.skippedHydrostatic} hydrostatic skipped</span>` : '',
        res.pages ? `${res.pages} page(s)` : '',
        res.ocrUsed ? '<span class="pill good">OCR used</span>' : '',
      ].filter(Boolean).join(' · ');

      // Build checklist from tank groups; fall back to usable tables
      const rows = tankGroups.length
        ? tankGroups.map((tk) => {
          const tables = (res.tables || []).filter((t) => (tk.tableIds || []).includes(t.id) && !t.skipped);
          const roles = [...new Set(tables.map((t) => t.tableRole).filter(Boolean))].join(', ');
          const kinds = [...new Set(tables.map((t) => t.kind))].join(', ');
          const cap = Math.max(0, ...tables.map((t) => Number(t.capacity) || 0));
          const pages = tables.map((t) => {
            const a = t.pageStart || t.page;
            const b = t.pageEnd || t.page;
            return a === b ? String(a) : `${a}–${b}`;
          }).filter(Boolean).slice(0, 4).join(', ');
          return {
            name: tk.name,
            meta: `${tk.tableCount || tables.length} table(s)${roles ? ` · ${roles}` : kinds ? ` · ${kinds}` : ''}${pages ? ` · p.${pages}` : ''}${cap ? ` · ~${fmt(cap, 1)} m³` : ''}`,
          };
        })
        : usable.map((t) => ({
          name: t.tankName || t.titleHint || t.id,
          meta: `${t.tableRole || t.kind} · page ${t.pageStart || t.page}${t.pageEnd && t.pageEnd !== (t.pageStart || t.page) ? `–${t.pageEnd}` : ''}${t.capacity ? ` · ~${fmt(t.capacity, 1)} m³` : ''}`,
        }));

      box.innerHTML = rows.map((r, i) => `
        <label class="pdf-tank-pick">
          <input type="checkbox" data-tank-name="${escapeHtml(r.name)}" checked>
          <span><b>${escapeHtml(r.name)}</b><div class="hint">${escapeHtml(r.meta)}</div></span>
        </label>`).join('');

      btn.disabled = false;
      showToast(`Found ${rows.length} tank(s) in PDF`);
    } catch (err) {
      PdfProgress.hide();
      showToast(err.message);
    }
  };

  document.getElementById('btn-create-pdf-tanks').onclick = async () => {
    if (!addPdfFile) { showToast('Choose a PDF first'); return; }
    const checked = [...document.querySelectorAll('#add-pdf-tanks [data-tank-name]:checked')]
      .map((el) => el.getAttribute('data-tank-name'));
    if (!checked.length) { showToast('Select at least one tank'); return; }
    const host = document.getElementById('add-pdf-progress-host');
    try {
      PdfProgress.show(host, 'Creating tanks from PDF…');
      PdfProgress.update({ message: 'Creating selected tanks…', phase: 'create', pct: 60, elapsedMs: 0 });
      showToast('Creating tanks from PDF…');
      const opts = readAddPdfOpts();
      const fd = new FormData();
      fd.append('file', addPdfFile);
      fd.append('createTanks', 'true');
      fd.append('updateExisting', document.getElementById('add-pdf-update').checked ? 'true' : 'false');
      fd.append('ocr', opts.ocr ? 'true' : 'false');
      fd.append('pageMode', opts.pageMode);
      if (opts.pageFrom) fd.append('pageFrom', String(opts.pageFrom));
      if (opts.pageTo) fd.append('pageTo', String(opts.pageTo));
      fd.append('spanUntilNextTank', opts.spanUntilNextTank ? 'true' : 'false');
      fd.append('tableRole', opts.tableRole || 'auto');
      fd.append('tankNames', JSON.stringify(checked));
      const res = await Api.upload(`/api/vessels/${STATE.activeVesselId}/import-pdf`, fd,
        (pct, phase) => PdfProgress.update(phase === 'uploading'
          ? { message: 'Uploading the selected tanks…', phase: 'upload', pct }
          : { message: 'Creating tanks on the server…', phase: 'create' }));
      PdfProgress.update({ message: 'Done', phase: 'done', pct: 100 });
      PdfProgress.hide();
      await reloadBundle();
      const c = res.created || 0;
      const u = res.updated || 0;
      const f = res.failed || 0;
      showToast(`PDF import: ${c} created, ${u} updated${f ? `, ${f} failed` : ''}`);
      navigate('calibration');
    } catch (err) {
      PdfProgress.hide();
      showToast(err.message);
    }
  };

  document.getElementById('btn-import-csv').onclick = async () => {
    const file = document.getElementById('csv-file').files[0];
    if (!file) { showToast('Choose a CSV or Excel file'); return; }
    const updateExisting = document.getElementById('csv-update-existing')?.checked !== false;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('updateExisting', updateExisting ? 'true' : 'false');
    Progress.start(document.getElementById('btn-import-csv').closest('.form-panel'),
      `Uploading ${file.name}…`);
    let res;
    try {
      res = await Api.upload(`/api/vessels/${STATE.activeVesselId}/tanks/import-csv`, fd,
        (pct, phase) => Progress.set(pct, phase === 'uploading'
          ? `Uploading… ${pct == null ? '' : pct + '%'}`
          : 'Reading the file on the server…'));
    } catch (err) {
      Progress.done();
      showToast(err.message);
      return;
    }
    Progress.done('Imported');
    await reloadBundle();
    const c = res.created ?? 0;
    const u = res.updated ?? 0;
    const total = res.imported ?? (c + u);
    const fmt = res.format === 'giorgis-fuel-csv' ? 'Giorgis fuel workbook'
      : res.format === 'giorgis-misc-csv' ? 'Giorgis misc workbook'
        : res.format === 'giorgis-water-csv' ? 'Giorgis fresh-water workbook'
          : res.format === 'giorgis-lube-csv' || res.format === 'giorgis-lube-xlsx' ? 'Giorgis lube workbook'
            : res.format === 'giorgis-workbook-csv' ? 'Giorgis workbook'
              : 'Tanks CSV';
    showToast(`${fmt}: ${u} updated, ${c} created${total ? ` (${total} tanks)` : ''}`);
  };
}

/* ---------- Calibration editor ---------- */
function renderCalibrationList(main) {
  if (STATE.route.tankId) return renderCalibrationEditor(main, STATE.route.tankId);

  const head = document.createElement('div');
  head.className = 'page-head no-print';
  head.innerHTML = `<div><h1>Calibration Database</h1>
    <div class="desc">Excel-style sounding tables: edit in-app, or export/import CSV &amp; Excel per tank. Workbook import refreshes Tank1–Tank4 style sheets.</div></div>
    <div class="btn-row">
      <button class="btn primary" id="btn-print-fuel-book">Print all fuel calibration</button>
      <label class="btn">Import workbook<input type="file" id="excel-import" accept=".xlsm,.xlsx" hidden></label>
      <button class="btn" id="btn-import-repo-excel">Import repo workbook</button>
      <a class="btn" href="${apiHref('/api/templates/calibration.csv')}">Calibration CSV template</a>
    </div>`;
  main.appendChild(head);

  const help = document.createElement('div');
  help.className = 'help-box no-print';
  help.innerHTML = `Reference format from <b>TANK MANAGEMENT CAPTAIN VENIAMIS FINAL VERSION.xlsm</b> sheets <b>Tank1–Tank4</b>:
    row headers = sounding/ullage (or Depth), column headers = trim (m), then SOUNDING CM / VOLUME, then list/heel table.
    <br>Per tank: <b>Export CSV / Excel</b> → edit in spreadsheet → <b>Import CSV/Excel</b>. Plain sounding×trim grids are accepted.
    <br>PDF capacity books: open a tank → <b>Import PDF</b>. Supports trim grids and SOUNDING|VOLUME tables; L.C.G/T.C.G/V.C.G/IMOM hydrostatic columns are skipped automatically. Scanned pages: pass OCR or pre-OCR the PDF.
    <br><b>Print / PDF</b> builds a professional landscape capacity book (cover + trim/heel/volume tables) for one tank or all fuel tanks.`;
  main.appendChild(help);

  const wrap = document.createElement('div');
  wrap.className = 'scroll-x form-panel';
  let rows = '';
  for (const t of allTanks()) {
    const hasCurve = (t.volumeCurve?.x?.length || 0) > 1 || (t.trimGrid?.length || 0) > 0;
    rows += `<tr class="clickable" data-id="${t.id}">
      <td class="tname">${escapeHtml(t.name)}</td>
      <td>${t.category}</td>
      <td>${t.fuelRole || ''}</td>
      <td>${t.calcType}</td>
      <td>${fmt(t.capacity,1)}</td>
      <td>${fmt((t.capacity||0)*0.85,1)}</td>
      <td><span class="pill ${hasCurve?'good':'warn'}">${hasCurve?'tables present':'needs data'}</span></td>
    </tr>`;
  }
  wrap.innerHTML = `<table class="data-table"><thead><tr>
    <th>Tank</th><th>Cat</th><th>Role</th><th>Type</th><th>100% m³</th><th>85% m³</th><th>Calibration</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
  main.appendChild(wrap);
  wrap.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.onclick = () => navigate('calibration', tr.dataset.id);
  });

  document.getElementById('btn-print-fuel-book').onclick = () => {
    const fuel = (STATE.bundle?.tanks?.fuel || []).filter((t) =>
      (t.trimAxis || []).length || (t.listAxis || []).length || (t.volumeCurve?.x || []).length
    );
    if (!fuel.length) { showToast('No fuel calibration tables to print'); return; }
    printCalibrationDocuments(fuel, { bookTitle: 'FUEL TANK CALIBRATION TABLES' });
  };

  document.getElementById('excel-import').onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append('file', file);
      Progress.start(e.target.closest('.form-panel') || null, `Uploading ${file.name}…`);
      const res = await Api.upload(`/api/vessels/${STATE.activeVesselId}/import-excel`, fd,
        (pct, phase) => Progress.set(pct, phase === 'uploading'
          ? `Uploading… ${pct == null ? '' : pct + '%'}`
          : 'Reading the workbook on the server…'));
      Progress.done('Imported');
      await reloadBundle();
      showToast(`Imported ${res.found?.length || 0} tank tables from workbook`);
      navigate('calibration');
    } catch (err) { Progress.done(); showToast(err.message); }
  };
  document.getElementById('btn-import-repo-excel').onclick = async () => {
    try {
      const res = await Api.request(`/api/vessels/${STATE.activeVesselId}/import-excel`, { method: 'POST', body: { useRepoFile: true } });
      await reloadBundle();
      showToast(`Imported ${res.found?.length || 0} tank tables from repo workbook`);
      navigate('calibration');
    } catch (err) { showToast(err.message); }
  };
}

function renderCalibrationEditor(main, tankId) {
  const tank = findTank(tankId);
  if (!tank) { main.innerHTML += '<div class="empty-state">Tank not found</div>'; return; }

  const back = document.createElement('div');
  back.className = 'back-link';
  back.textContent = '← All tanks';
  back.onclick = () => navigate('calibration');
  main.appendChild(back);

  const isDirect = tank.calcType === 'direct';
  const head = document.createElement('div');
  head.className = 'page-head no-print';
  head.innerHTML = `<div><h1>${escapeHtml(tank.name)}</h1>
    <div class="desc">Excel Tank-sheet layout · ${isDirect ? 'Depth × trim volume grid + heel table' : 'SOUNDING ullage × trim correction + volume curve + list/heel'} · 100% ${fmt(tank.capacity,2)} m³ · 85% ${fmt((tank.capacity||0)*0.85,2)} m³</div></div>
    <div class="btn-row">
      <button class="btn small" id="btn-back-tank">Back to tank</button>
      <button class="btn small primary" id="btn-print-tank-calib">Print / PDF</button>
      <a class="btn small" id="btn-export-csv" href="${apiHref(`/api/vessels/${STATE.activeVesselId}/tanks/${tankId}/calibration.csv`)}">Export CSV</a>
      <a class="btn small" id="btn-export-xlsx" href="${apiHref(`/api/vessels/${STATE.activeVesselId}/tanks/${tankId}/calibration.xlsx`)}">Export Excel</a>
      <label class="btn small">Import CSV/Excel<input type="file" id="table-import" accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label>
      <label class="btn small">Import PDF<input type="file" id="pdf-import" accept=".pdf,application/pdf" hidden></label>
      <label class="hint" style="display:flex;align-items:center;gap:4px;margin:0;font-size:12px">
        <input type="checkbox" id="pdf-import-ocr" checked> OCR
      </label>
      <button class="btn small" id="btn-export-tank">Export JSON</button>
      <button class="btn primary" id="btn-save-calib">Save calibration</button>
    </div>`;
  main.appendChild(head);
  document.getElementById('btn-back-tank').onclick = () => navigate(tank.category || 'fuel', tankId);
  document.getElementById('btn-print-tank-calib').onclick = () => {
    printCalibrationDocuments([findTank(tankId) || tank], { bookTitle: 'TANK CALIBRATION TABLES' });
  };

  document.getElementById('table-import').onchange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('apply', 'true');
      Progress.start(e.target.closest('.form-panel') || null, `Uploading ${file.name}…`);
      const res = await Api.upload(
        `/api/vessels/${STATE.activeVesselId}/tanks/${tankId}/import-table`, fd,
        (pct, phase) => Progress.set(pct, phase === 'uploading'
          ? `Uploading… ${pct == null ? '' : pct + '%'}`
          : 'Reading the table on the server…')
      );
      Progress.done('Imported');
      await reloadBundle();
      const parts = [];
      if (res.patch?.trimAxis) parts.push(`trim ${res.patch.trimAxis.length}×${(res.patch.trimVals || []).length}`);
      if (res.patch?.listAxis) parts.push(`list ${res.patch.listAxis.length}×${(res.patch.listVals || []).length}`);
      if (res.patch?.volumeCurve?.x) parts.push(`volume ${res.patch.volumeCurve.x.length}`);
      showToast(`Imported ${parts.join(', ') || 'calibration'}`);
      navigate('calibration', tankId);
    } catch (err) {
      Progress.done();
      showToast(err.message);
    }
  };

  const pdfPanel = document.createElement('div');
  pdfPanel.className = 'form-panel pdf-import-panel no-print';
  pdfPanel.innerHTML = `<div class="section-title" style="margin-top:0">PDF table import</div>
    <p class="hint" style="margin:0 0 10px">Set page range / pattern below, then use <b>Import PDF</b> above. Continuation pages merge until the next tank title. Hydrostatic blocks are skipped.</p>
    <div class="form-row-3" style="margin-bottom:8px">
      <div class="form-row"><label>Page range</label>
        <select id="pdf-page-mode">
          <option value="auto" selected>Auto-detect (all pages)</option>
          <option value="range">Select start–end pages</option>
        </select>
      </div>
      <div class="form-row"><label>Start page</label><input id="pdf-page-from" type="number" min="1" placeholder="1" disabled></div>
      <div class="form-row"><label>End page</label><input id="pdf-page-to" type="number" min="1" placeholder="last" disabled></div>
    </div>
    <div class="form-row-3" style="margin-bottom:10px">
      <div class="form-row"><label>Table pattern</label>
        <select id="pdf-table-role">
          <option value="auto" selected>Auto (heel / trim / volume)</option>
          <option value="trim">Trim grid</option>
          <option value="heel">Heel / list grid</option>
          <option value="volume">Volume curve</option>
        </select>
      </div>
      <div class="form-row" style="display:flex;align-items:flex-end">
        <label class="hint" style="display:flex;align-items:center;gap:6px;margin:0">
          <input type="checkbox" id="pdf-span-tank" checked> Continue until next tank name
        </label>
      </div>
      <div class="form-row"></div>
    </div>
    <div id="calib-pdf-progress-host"></div>
    <div id="pdf-tank-summary" class="hint" style="margin:0 0 10px"></div>
    <div id="pdf-tables"></div>`;
  main.appendChild(pdfPanel);

  const syncCalibPdfPages = () => {
    const manual = document.getElementById('pdf-page-mode')?.value === 'range';
    const from = document.getElementById('pdf-page-from');
    const to = document.getElementById('pdf-page-to');
    if (from) from.disabled = !manual;
    if (to) to.disabled = !manual;
  };
  document.getElementById('pdf-page-mode')?.addEventListener('change', syncCalibPdfPages);

  document.getElementById('pdf-import').onchange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const host = document.getElementById('calib-pdf-progress-host');
    try {
      const useOcr = document.getElementById('pdf-import-ocr')?.checked !== false;
      const pageMode = document.getElementById('pdf-page-mode')?.value || 'auto';
      const pageFrom = parseInt(document.getElementById('pdf-page-from')?.value, 10) || null;
      const pageTo = parseInt(document.getElementById('pdf-page-to')?.value, 10) || null;
      const spanUntilNextTank = document.getElementById('pdf-span-tank')?.checked !== false;
      const tableRole = document.getElementById('pdf-table-role')?.value || 'auto';
      if (pageMode === 'range' && !pageFrom && !pageTo) {
        showToast('Enter start and/or end page for manual range');
        return;
      }
      showToast(useOcr
        ? 'Reading PDF (progress below — OCR may take several minutes)…'
        : 'Reading PDF tables…');
      const res = await PdfProgress.runJob(STATE.activeVesselId, file, {
        ocr: useOcr,
        pageMode,
        pageFrom,
        pageTo,
        spanUntilNextTank,
        tableRole,
        mountEl: host,
        title: `Reading ${file.name}…`,
      });
      const tables = res.tables || [];
      const usable = (res.usableTables || tables.filter((t) => !t.skipped && t.kind !== 'hydrostatic'));
      if (!tables.length) {
        showToast((res.warnings || []).join(' ') || 'No tables found in this PDF');
        return;
      }
      const sum = document.getElementById('pdf-tank-summary');
      const tankBits = (res.tanks || []).map((tk) =>
        `${escapeHtml(tk.name)} (${tk.tableCount})`
      ).join(' · ');
      const continuedN = usable.filter((t) => t.continued).length;
      sum.innerHTML = [
        tankBits ? `<b>Tanks found:</b> ${tankBits}` : '',
        continuedN ? `<span class="pill">${continuedN} continued</span>` : '',
        res.skippedHydrostatic ? `<span class="pill warn">${res.skippedHydrostatic} hydrostatic table(s) skipped</span>` : '',
        res.ocrUsed ? '<span class="pill">OCR used</span>' : '',
        (res.warnings || []).length ? `<div class="hint">${escapeHtml(res.warnings.join(' '))}</div>` : '',
      ].filter(Boolean).join(' ');

      const box = document.getElementById('pdf-tables');
      // Group cards by tank for readability
      const byTank = new Map();
      for (const t of tables) {
        const key = t.skipped ? '— Skipped (hydrostatic)' : (t.tankName || t.titleHint || `Page ${t.page}`);
        if (!byTank.has(key)) byTank.set(key, []);
        byTank.get(key).push(t);
      }
      box.innerHTML = [...byTank.entries()].map(([tankLabel, group]) => {
        const cards = group.map((t) => {
          const preview = (t.preview || []).slice(0, 6).map((row) =>
            `<tr>${row.slice(0, 8).map((c) => `<td>${escapeHtml(String(c ?? ''))}</td>`).join('')}</tr>`
          ).join('');
          const hydroNote = (t.removedHydroHeaders || []).length
            ? `<div class="hint">Stripped columns: ${escapeHtml(t.removedHydroHeaders.join(', '))}</div>`
            : '';
          const pageLabel = (t.pageStart || t.page) === (t.pageEnd || t.page)
            ? `page ${t.pageStart || t.page}`
            : `pages ${t.pageStart || t.page}–${t.pageEnd || t.page}`;
          const axisHint = (t.pattern?.axisVals || []).length
            ? `<div class="hint">Pattern cols: ${(t.pattern.axisVals || []).slice(0, 8).join(', ')}${(t.pattern.axisVals || []).length > 8 ? '…' : ''}</div>`
            : '';
          const defaultTarget = t.tableRole === 'heel' ? 'list'
            : t.tableRole === 'volume' ? 'volume'
            : t.tableRole === 'trim' ? 'trim'
            : 'auto';
          if (t.skipped) {
            return `<div class="pdf-table-card skipped" data-tid="${escapeHtml(t.id)}">
              <div class="pdf-table-head">
                <div><b>${escapeHtml(t.id)}</b> · ${escapeHtml(pageLabel)} · <span class="pill warn">skipped</span>
                  <div class="hint">${escapeHtml(t.skipReason || 'Hydrostatic table disregarded')}</div>
                </div>
              </div>
              <div class="scroll-x"><table class="data-table compact">${preview}</table></div>
            </div>`;
          }
          return `<div class="pdf-table-card" data-tid="${escapeHtml(t.id)}">
            <div class="pdf-table-head">
              <div><b>${escapeHtml(t.id)}</b> · ${escapeHtml(pageLabel)} · ${t.rows}×${t.cols} ·
                <span class="pill">${escapeHtml(t.tableRole || t.kind || 'unknown')}</span>
                ${t.layoutHint ? `<span class="pill">${escapeHtml(t.layoutHint)}</span>` : ''}
                ${t.continued ? '<span class="pill good">continued</span>' : ''}
                ${t.titleHint ? `<div class="hint">${escapeHtml(t.titleHint)}</div>` : ''}
                ${axisHint}
                ${hydroNote}
              </div>
              <div class="btn-row">
                <select data-target>
                  <option value="auto" ${defaultTarget === 'auto' ? 'selected' : ''}>Auto (${escapeHtml(t.tableRole || t.kind || 'detect')})</option>
                  <option value="full">Full (trim + list seed)</option>
                  <option value="trim" ${defaultTarget === 'trim' ? 'selected' : ''}>Trim grid only</option>
                  <option value="list" ${defaultTarget === 'list' ? 'selected' : ''}>List / heel grid</option>
                  <option value="volume" ${defaultTarget === 'volume' ? 'selected' : ''}>Volume curve</option>
                </select>
                <button class="btn primary small" data-apply>Apply to tank</button>
              </div>
            </div>
            <div class="scroll-x"><table class="data-table compact">${preview}</table></div>
          </div>`;
        }).join('');
        return `<div class="pdf-tank-group">
          <div class="section-title" style="margin:12px 0 8px">${escapeHtml(tankLabel)}</div>
          ${cards}
        </div>`;
      }).join('');

      box.querySelectorAll('[data-apply]').forEach((btn) => {
        btn.onclick = async () => {
          const card = btn.closest('.pdf-table-card');
          const tableId = card.dataset.tid;
          const target = card.querySelector('[data-target]').value;
          const table = tables.find((x) => x.id === tableId);
          try {
            const res2 = await Api.request(
              `/api/vessels/${STATE.activeVesselId}/tanks/${tankId}/import-pdf`,
              {
                method: 'POST',
                body: { table, tableId, target, apply: true },
              }
            );
            await reloadBundle();
            showToast(`Applied ${res2.tableId || tableId} (${res2.kind || target})`);
            navigate('calibration', tankId);
          } catch (err) {
            showToast(err.message);
          }
        };
      });
      const skipN = res.skippedHydrostatic || 0;
      showToast(`Found ${usable.length} usable table(s) in ${res.pages || '?'} page(s)`
        + (skipN ? ` · skipped ${skipN} hydrostatic` : '')
        + ((res.tanks || []).length ? ` · ${(res.tanks || []).length} tank(s)` : '')
        + (continuedN ? ` · ${continuedN} continued` : ''));
    } catch (err) {
      PdfProgress.hide();
      showToast(err.message);
    }
  };

  const meta = document.createElement('div');
  meta.className = 'form-panel no-print';
  const detectedInc = (typeof detectIncrement === 'function')
    ? detectIncrement(tank.trimAxis || [])
    : 1;
  const soundingInc = tank.soundingIncrement || detectedInc || 1;
  const heelInc = tank.heelIncrement || ((typeof detectIncrement === 'function')
    ? detectIncrement(tank.listAxis || tank.trimAxis || [])
    : soundingInc);
  const incOpts = [1, 2, 5, 10, 20, 25, 50];
  const optHtml = (selected) => incOpts.map((n) =>
    `<option value="${n}" ${Number(selected) === n ? 'selected' : ''}>${n}</option>`
  ).join('');

  meta.innerHTML = `
    <div class="form-row-3">
      <div class="form-row"><label>Calc type</label>
        <select id="c-type">
          <option value="correction" ${!isDirect?'selected':''}>correction (Tank1 style)</option>
          <option value="direct" ${isDirect?'selected':''}>direct (Tank2–4 style)</option>
        </select></div>
      <div class="form-row"><label>Capacity 100% m³</label><input id="c-cap" type="number" step="any" value="${tank.capacity||0}"></div>
      <div class="form-row"><label>Correction divisor</label><input id="c-div" type="number" step="any" value="${tank.correctionDivisor|| (isDirect?1:10)}"></div>
    </div>
    <div class="form-row-3">
      <div class="form-row"><label>Pipe height mm <span class="hint-inline">override</span></label>
        <input id="c-pipe" type="number" step="any"
          value="${Number(tank.pipeHeight) > 0 ? tank.pipeHeight : ''}"
          placeholder="${Math.round(pipeHeightInfo(tank).fromTable) || ''}">
        <div class="hint">${pipeHeightHint(tank)}</div></div>
      <div class="form-row"><label>Sounding method</label>
        <select id="c-method">
          <option value="ullage" ${tank.soundingMethod==='ullage'?'selected':''}>ullage</option>
          <option value="sounding" ${tank.soundingMethod==='sounding'?'selected':''}>sounding</option>
        </select></div>
      <div class="form-row"><label>85% volume (ref)</label><input value="${fmt((tank.capacity||0)*0.85,2)}" disabled></div>
    </div>
    <div class="form-row-3">
      <div class="form-row"><label>Sounding table increment</label>
        <select id="c-sound-inc">${optHtml(soundingInc)}</select>
        <div class="hint">Excel-style FLOOR/CEILING double interp · detected ${detectedInc}</div></div>
      <div class="form-row"><label>List / heel increment</label>
        <select id="c-heel-inc">${optHtml(heelInc)}</select>
        <div class="hint">Usually same as sounding step (1, 2, 5, 10…)</div></div>
      <div class="form-row"><label>Table order</label>
        <input value="${(tank.trimVals||[])[0] > (tank.trimVals||[]).slice(-1)[0] ? 'Descending trim cols' : 'Ascending trim cols'}" disabled>
        <div class="hint">Both −2…+2 and +2…−2 are supported</div></div>
    </div>`;
  main.appendChild(meta);

  main.appendChild(buildExcelCalibrationTable(tank));

  const sticky = document.createElement('div');
  sticky.className = 'calib-sticky-actions no-print';
  sticky.innerHTML = `
    <span class="hint">Landscape preferred for wide grids · Save before printing</span>
    <button class="btn" id="btn-print-tank-calib-2">Print / PDF</button>
    <button class="btn primary" id="btn-save-calib-2">Save calibration</button>`;
  main.appendChild(sticky);

  async function saveCalibrationFromEditor() {
    const parsed = readExcelCalibrationTable(tank);
    const calibration = {
      calcType: document.getElementById('c-type').value,
      capacity: parseFloat(document.getElementById('c-cap').value) || 0,
      correctionDivisor: parseFloat(document.getElementById('c-div').value) || 10,
      pipeHeight: parseFloat(document.getElementById('c-pipe').value) || 0,
      soundingMethod: document.getElementById('c-method').value,
      soundingIncrement: parseFloat(document.getElementById('c-sound-inc').value) || 1,
      heelIncrement: parseFloat(document.getElementById('c-heel-inc').value) || 1,
      ...parsed,
    };
    await Api.saveCalibration(STATE.activeVesselId, tankId, calibration);
    await reloadBundle();
    showToast('Calibration saved');
    navigate('calibration', tankId);
  }

  document.getElementById('btn-save-calib').onclick = saveCalibrationFromEditor;
  document.getElementById('btn-save-calib-2').onclick = saveCalibrationFromEditor;
  document.getElementById('btn-print-tank-calib-2').onclick = () => {
    printCalibrationDocuments([findTank(tankId) || tank], { bookTitle: 'TANK CALIBRATION TABLES' });
  };
  document.getElementById('btn-export-tank').onclick = async () => {
    try {
      const saved = await downloadJson(tank.id + '-calibration.json', findTank(tankId));
      showToast(`Calibration ${downloadWhereLabel(saved)}`);
    } catch (e) {
      showToast(e.message || 'Export failed');
    }
  };

  // Keep focused spreadsheet cells visible above the Android keyboard
  main.querySelector('.excel-scroll')?.addEventListener('focusin', (ev) => {
    const el = ev.target;
    if (!(el instanceof HTMLElement)) return;
    setTimeout(() => {
      try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); } catch (_) { /* ignore */ }
    }, 120);
  });
}

/** Excel Tank1/Tank2-style combined calibration grid */
function buildExcelCalibrationTable(tank) {
  const panel = document.createElement('div');
  panel.className = 'form-panel excel-calib';
  panel.style.marginTop = '14px';

  const isDirect = tank.calcType === 'direct';
  const rowAxis = tank.trimAxis || [];
  const trimVals = tank.trimVals || [];
  const trimGrid = tank.trimGrid || [];
  const listAxis = tank.listAxis || [];
  const listVals = tank.listVals || [];
  const listGrid = tank.listGrid || [];
  const volX = tank.volumeCurve?.x || [];
  const volV = tank.volumeCurve?.v || [];
  const volMap = new Map(volX.map((x, i) => [Number(x), volV[i]]));

  const rowLabel = isDirect ? 'Depth' : 'SOUNDING ullage';
  const trimLabel = isDirect ? 'Trim → volume m³' : 'Trim (m) → correction';
  const listLabel = isDirect ? 'Heel (deg) → correction' : 'List / heel (deg) → correction';

  // Header row 1: section labels
  let head1 = `<th class="excel-corner">${escapeHtml(rowLabel)}</th>`;
  trimVals.forEach(() => { head1 += '<th class="excel-sec-trim"></th>'; });
  if (!isDirect) {
    head1 += '<th class="excel-sec-vol">SOUNDING CM</th><th class="excel-sec-vol">sounding VOLUME</th>';
  } else {
    head1 += '<th class="excel-gap"></th>';
  }
  if (listVals.length) {
    head1 += `<th class="excel-sec-list">${isDirect ? 'Depth' : 'sounding ullage'}</th>`;
    listVals.forEach(() => { head1 += '<th class="excel-sec-list"></th>'; });
  }

  // Header row 2: numeric trim / list values (editable)
  let head2 = '<th class="excel-corner-sub"></th>';
  trimVals.forEach((v, j) => {
    head2 += `<th class="excel-trim-h"><input type="number" step="any" data-excel="trimVal" data-j="${j}" value="${v}" title="${trimLabel}"></th>`;
  });
  if (!isDirect) {
    head2 += '<th></th><th></th>';
  } else {
    head2 += '<th></th>';
  }
  if (listVals.length) {
    head2 += '<th></th>';
    listVals.forEach((v, j) => {
      head2 += `<th class="excel-list-h"><input type="number" step="any" data-excel="listVal" data-j="${j}" value="${v}" title="${listLabel}"></th>`;
    });
  }

  const nRows = Math.max(rowAxis.length, listAxis.length, isDirect ? 0 : volX.length, 1);
  let body = '';
  for (let i = 0; i < nRows; i++) {
    const ra = rowAxis[i];
    body += '<tr>';
    body += `<td class="excel-rowh"><input type="number" step="any" data-excel="rowAxis" data-i="${i}" value="${ra ?? ''}"></td>`;
    for (let j = 0; j < trimVals.length; j++) {
      const val = trimGrid[i] && trimGrid[i][j] != null ? trimGrid[i][j] : '';
      body += `<td class="excel-trim"><input type="number" step="any" data-excel="trimGrid" data-r="${i}" data-c="${j}" value="${val}"></td>`;
    }
    if (!isDirect) {
      // Prefer matching volume curve by sounding axis when available
      const volAtRow = (ra != null && volMap.has(Number(ra)))
        ? volMap.get(Number(ra))
        : (volV[i] ?? '');
      const xAtRow = (ra != null) ? ra : (volX[i] ?? '');
      body += `<td class="excel-vol"><input type="number" step="any" data-excel="volX" data-i="${i}" value="${xAtRow ?? ''}"></td>`;
      body += `<td class="excel-vol"><input type="number" step="any" data-excel="volV" data-i="${i}" value="${volAtRow ?? ''}"></td>`;
    } else {
      body += '<td class="excel-gap"></td>';
    }
    if (listVals.length) {
      const la = listAxis[i] ?? '';
      body += `<td class="excel-rowh"><input type="number" step="any" data-excel="listAxis" data-i="${i}" value="${la}"></td>`;
      for (let j = 0; j < listVals.length; j++) {
        const val = listGrid[i] && listGrid[i][j] != null ? listGrid[i][j] : '';
        body += `<td class="excel-list"><input type="number" step="any" data-excel="listGrid" data-r="${i}" data-c="${j}" value="${val}"></td>`;
      }
    }
    body += '</tr>';
  }

  panel.innerHTML = `
    <div class="section-title" style="margin-top:0">Calibration table
      <span class="tag">${nRows} rows · trim ${trimVals.length} cols${listVals.length ? ` · list ${listVals.length} cols` : ''}</span>
      <button type="button" class="btn small" id="btn-add-calib-row" style="margin-left:auto">+ row</button>
    </div>
    <div class="hint" style="color:var(--text-faint);font-size:12px;margin-bottom:8px">
      Matches workbook sheets Tank1–Tank4: left = ${escapeHtml(rowLabel)} × trim${isDirect ? ' volume' : ' correction'}; 
      ${isDirect ? '' : 'center = SOUNDING CM / VOLUME; '}right = list/heel table. Edit any cell, then Save.
    </div>
    <div class="scroll-x excel-scroll">
      <table class="calib-table excel-table" id="excel-calib-table">
        <thead>
          <tr class="excel-head-1">${head1}</tr>
          <tr class="excel-head-2">${head2}</tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;

  panel.querySelector('#btn-add-calib-row').onclick = () => {
    const table = panel.querySelector('#excel-calib-table tbody');
    const i = table.children.length;
    const trimN = panel.querySelectorAll('thead input[data-excel="trimVal"]').length;
    const listN = panel.querySelectorAll('thead input[data-excel="listVal"]').length;
    const tr = document.createElement('tr');
    let html = `<td class="excel-rowh"><input type="number" step="any" data-excel="rowAxis" data-i="${i}" value=""></td>`;
    for (let j = 0; j < trimN; j++) html += `<td class="excel-trim"><input type="number" step="any" data-excel="trimGrid" data-r="${i}" data-c="${j}" value=""></td>`;
    if (!isDirect) {
      html += `<td class="excel-vol"><input type="number" step="any" data-excel="volX" data-i="${i}" value=""></td>`;
      html += `<td class="excel-vol"><input type="number" step="any" data-excel="volV" data-i="${i}" value=""></td>`;
    } else html += '<td class="excel-gap"></td>';
    if (listN) {
      html += `<td class="excel-rowh"><input type="number" step="any" data-excel="listAxis" data-i="${i}" value=""></td>`;
      for (let j = 0; j < listN; j++) html += `<td class="excel-list"><input type="number" step="any" data-excel="listGrid" data-r="${i}" data-c="${j}" value=""></td>`;
    }
    tr.innerHTML = html;
    table.appendChild(tr);
  };
  return panel;
}

function readExcelCalibrationTable(tank) {
  const isDirect = document.getElementById('c-type')?.value === 'direct' || tank.calcType === 'direct';
  const trimVals = Array.from(document.querySelectorAll('input[data-excel="trimVal"]'))
    .map((el) => parseFloat(el.value)).filter((n) => !Number.isNaN(n));
  const listVals = Array.from(document.querySelectorAll('input[data-excel="listVal"]'))
    .map((el) => parseFloat(el.value)).filter((n) => !Number.isNaN(n));

  const rowInputs = Array.from(document.querySelectorAll('input[data-excel="rowAxis"]'));
  const trimAxis = [];
  const trimGrid = [];
  const listAxis = [];
  const listGrid = [];
  const volX = [];
  const volV = [];

  rowInputs.forEach((el, i) => {
    const ra = parseFloat(el.value);
    const hasTrim = trimVals.some((_, j) => {
      const cell = document.querySelector(`input[data-excel="trimGrid"][data-r="${i}"][data-c="${j}"]`);
      return cell && cell.value !== '';
    });
    const volXEl = document.querySelector(`input[data-excel="volX"][data-i="${i}"]`);
    const volVEl = document.querySelector(`input[data-excel="volV"][data-i="${i}"]`);
    const listAEl = document.querySelector(`input[data-excel="listAxis"][data-i="${i}"]`);
    if (Number.isNaN(ra) && !hasTrim && !(volXEl && volXEl.value !== '')) return;

    if (!Number.isNaN(ra)) {
      trimAxis.push(ra);
      const row = trimVals.map((_, j) => {
        const cell = document.querySelector(`input[data-excel="trimGrid"][data-r="${i}"][data-c="${j}"]`);
        const n = cell ? parseFloat(cell.value) : 0;
        return Number.isNaN(n) ? 0 : n;
      });
      trimGrid.push(row);
    }

    if (!isDirect && volXEl && volVEl && volXEl.value !== '' && volVEl.value !== '') {
      const x = parseFloat(volXEl.value);
      const v = parseFloat(volVEl.value);
      if (!Number.isNaN(x) && !Number.isNaN(v)) { volX.push(x); volV.push(v); }
    } else if (!isDirect && !Number.isNaN(ra) && volVEl && volVEl.value !== '') {
      const v = parseFloat(volVEl.value);
      if (!Number.isNaN(v)) { volX.push(ra); volV.push(v); }
    }

    if (listAEl && listAEl.value !== '') {
      const la = parseFloat(listAEl.value);
      if (!Number.isNaN(la)) {
        listAxis.push(la);
        listGrid.push(listVals.map((_, j) => {
          const cell = document.querySelector(`input[data-excel="listGrid"][data-r="${i}"][data-c="${j}"]`);
          const n = cell ? parseFloat(cell.value) : 0;
          return Number.isNaN(n) ? 0 : n;
        }));
      }
    }
  });

  return {
    trimAxis,
    trimVals,
    trimGrid,
    listAxis,
    listVals,
    listGrid,
    volumeCurve: { x: volX, v: volV },
  };
}

/* ---------- Calibration print / PDF ---------- */
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < (arr || []).length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function calibPrintFmtTs(iso) {
  if (!iso) return '—';
  return String(iso).replace('T', ' ').replace(/\.\d+Z$/, ' UTC').slice(0, 19) + (String(iso).includes('Z') ? ' UTC' : '');
}

function calibPrintMasthead(title, subtitle, opts) {
  const vessel = STATE.bundle?.vessel || {};
  const o = opts || {};
  if (typeof Branding !== 'undefined' && Branding.printDocHeader) {
    return Branding.printDocHeader({
      vessel: vessel.name || 'Vessel',
      title: title || 'Fuel Tank Calibration',
      subtitle: subtitle || '',
      badge: o.badge || 'LANDSCAPE A4',
      rightLabel: o.rightLabel || 'IMO',
      rightValue: o.rightValue || vessel.imo || '—',
    });
  }
  return `<header class="calib-print-masthead">
    <div>
      <h1>${escapeHtml(title || 'Fuel Tank Calibration')}</h1>
      <div class="sub">${escapeHtml(subtitle || '')}</div>
    </div>
    <div class="calib-print-badge">OFFICIAL · LANDSCAPE A4</div>
  </header>`;
}

function calibPrintFooter(pageLabel) {
  const vessel = STATE.bundle?.vessel || {};
  return `<footer class="calib-print-footer">
    <span>${escapeHtml(vessel.name || '')}${vessel.imo ? ` · IMO ${escapeHtml(vessel.imo)}` : ''}</span>
    <span>${escapeHtml(pageLabel || '')}</span>
    <span>Volumes m³ · Sounding/ullage m · Trim m · List °</span>
  </footer>`;
}

function calibPrintTankIdBar(tank, extra) {
  const bits = [
    `<strong>${escapeHtml(tank.name || tank.id || 'Tank')}</strong>`,
    `ID ${escapeHtml(tank.id || '—')}`,
    [tank.fuelRole, tank.side, tank.tankNo != null && tank.tankNo !== '' ? `No. ${tank.tankNo}` : '']
      .filter(Boolean).map((s) => escapeHtml(String(s))).join(' · '),
    tank.fuelGrade ? `Grade ${escapeHtml(tank.fuelGrade)}` : '',
    extra ? escapeHtml(extra) : '',
  ].filter(Boolean);
  return `<div class="calib-print-tank-id">${bits.map((b) => `<span>${b}</span>`).join('')}</div>`;
}

function calibPrintMetaGrid(entries) {
  if (typeof Branding !== 'undefined' && Branding.printMetaGrid) {
    return Branding.printMetaGrid(
      entries.map(([k, v]) => ({ label: k, value: escapeHtml(v) })),
      entries.length > 8 ? 4 : 4,
    );
  }
  return `<div class="calib-print-meta">${entries.map(([k, v]) =>
    `<div><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`
  ).join('')}</div>`;
}

function calibPrintTankMetaEntries(tank) {
  const vessel = STATE.bundle?.vessel || {};
  const trimN = (tank.trimVals || []).length;
  const rowN = (tank.trimAxis || []).length;
  const listN = (tank.listVals || []).length;
  const listRows = (tank.listAxis || []).length;
  const volN = (tank.volumeCurve?.x || []).length;
  const printedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  return [
    ['Vessel', vessel.name || '—'],
    ['IMO', vessel.imo || '—'],
    ['Call sign', vessel.callSign || '—'],
    ['Flag', vessel.flag || '—'],
    ['Vessel type', vessel.type || '—'],
    ['Tank name', tank.name || '—'],
    ['Tank ID', tank.id || '—'],
    ['Role', tank.fuelRole || '—'],
    ['Side', tank.side || '—'],
    ['Tank no.', tank.tankNo != null && tank.tankNo !== '' ? String(tank.tankNo) : '—'],
    ['Grade', tank.fuelGrade || '—'],
    ['Capacity 100%', `${fmt(tank.capacity, 3)} m³`],
    ['Capacity 85%', `${fmt((tank.capacity || 0) * 0.85, 3)} m³`],
    ['Calculation', tank.calcType || 'direct'],
    ['Divisor', tank.correctionDivisor != null ? String(tank.correctionDivisor) : '—'],
    ['Sounding method', tank.soundingMethod || '—'],
    ['Pipe height', (() => {
      // Was labelled metres while every axis and reading here is millimetres.
      const info = pipeHeightInfo(tank);
      if (!info.effective) return '—';
      return `${fmt(info.effective, 0)} mm ${info.overridden ? '(set)' : '(from table)'}`;
    })()],
    ['Sounding increment', tank.soundingIncrement != null ? String(tank.soundingIncrement) : '—'],
    ['Heel increment', tank.heelIncrement != null ? String(tank.heelIncrement) : '—'],
    ['Trim table', rowN && trimN ? `${rowN} × ${trimN}` : '—'],
    ['List / heel table', listRows && listN ? `${listRows} × ${listN}` : '—'],
    ['Volume curve pts', volN ? String(volN) : '—'],
    ['Import source', tank.pdfSource || '—'],
    ['Import format', tank.importFormat || '—'],
    ['Revision', calibPrintFmtTs(tank.updatedAt)],
    ['Printed', printedAt],
  ];
}

function renderCalibPrintGridPages(opts) {
  const {
    tank, title, rowLabel, colLabel, rowAxis, colVals, grid, valueDecimals = 3, colDecimals = 2, rowDecimals = 3,
  } = opts;
  if (!rowAxis?.length || !colVals?.length) {
    return `<section class="calib-print-section calib-print-page">
      ${calibPrintMasthead(title, tank.name)}
      ${calibPrintTankIdBar(tank)}
      <p class="calib-print-note">No ${escapeHtml(title.toLowerCase())} data for this tank.</p>
      ${calibPrintFooter(`${tank.name} · ${title}`)}
    </section>`;
  }
  const ROW_CHUNK = 45;
  const COL_CHUNK = 8;
  const rowChunks = chunkArray(rowAxis.map((s, i) => ({ s, i })), ROW_CHUNK);
  const colChunks = chunkArray(colVals.map((t, j) => ({ t, j })), COL_CHUNK);
  const pages = [];
  let pageNo = 0;
  for (const cols of colChunks) {
    for (const rows of rowChunks) {
      pageNo += 1;
      const head = cols.map((c) => {
        const even = Math.abs(Number(c.t) || 0) < 1e-9;
        return `<th class="${even ? 'even-keel' : ''}">${escapeHtml(fmt(c.t, colDecimals))}</th>`;
      }).join('');
      const body = rows.map(({ s, i }) => {
        const cells = cols.map((c) => {
          const v = grid?.[i]?.[c.j];
          const even = Math.abs(Number(c.t) || 0) < 1e-9;
          const text = v == null || v === '' || Number.isNaN(Number(v)) ? '—' : fmt(v, valueDecimals);
          return `<td class="${even ? 'even-keel' : ''}">${escapeHtml(text)}</td>`;
        }).join('');
        return `<tr><th scope="row">${escapeHtml(fmt(s, rowDecimals))}</th>${cells}</tr>`;
      }).join('');
      const colRange = `${fmt(cols[0].t, colDecimals)} … ${fmt(cols[cols.length - 1].t, colDecimals)}`;
      const rowRange = `${fmt(rows[0].s, rowDecimals)} … ${fmt(rows[rows.length - 1].s, rowDecimals)}`;
      pages.push(`<section class="calib-print-section calib-print-page">
        ${calibPrintMasthead(title, `${tank.name} · part ${pageNo}`)}
        ${calibPrintTankIdBar(tank, `${colLabel} ${colRange} · ${rowLabel} ${rowRange}`)}
        <table class="calib-print-table">
          <thead>
            <tr><th scope="col">${escapeHtml(rowLabel)} \\ ${escapeHtml(colLabel)}</th>${head}</tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
        <p class="calib-print-note">Zero column (even keel / upright) is emphasized. Continuation headers repeat tank identity.</p>
        ${calibPrintFooter(`${tank.name} · ${title} ${pageNo}`)}
      </section>`);
    }
  }
  return pages.join('');
}

function renderCalibPrintVolumeCurvePages(tank) {
  const xs = tank.volumeCurve?.x || [];
  const vs = tank.volumeCurve?.v || [];
  const n = Math.min(xs.length, vs.length);
  if (!n) return '';
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ x: xs[i], v: vs[i] });
  return chunkArray(rows, 50).map((chunk, idx) => {
    const body = chunk.map((r) => `<tr>
      <td>${r.x == null || r.x === '' ? '—' : escapeHtml(fmt(r.x, 3))}</td>
      <td>${r.v == null || r.v === '' ? '—' : escapeHtml(fmt(r.v, 3))}</td>
    </tr>`).join('');
    return `<section class="calib-print-section calib-print-page">
      ${calibPrintMasthead('Volume curve', `${tank.name} · part ${idx + 1}`)}
      ${calibPrintTankIdBar(tank, 'Correction basis / SOUNDING VOLUME')}
      <table class="calib-print-table calib-print-curve">
        <thead><tr><th>Sounding (m)</th><th>Volume (m³)</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      ${calibPrintFooter(`${tank.name} · Volume curve ${idx + 1}`)}
    </section>`;
  }).join('');
}

function renderCalibPrintTankBlock(tank, indexLabel) {
  const isDirect = tank.calcType === 'direct';
  const rowLabel = isDirect ? 'Depth (m)' : 'Snd/ullage (m)';
  const trimTitle = isDirect ? 'Capacity vs trim' : 'Trim correction table';
  const listTitle = isDirect ? 'Heel / list table' : 'List / heel correction';
  return `
    <section class="calib-print-section calib-print-page">
      ${calibPrintMasthead('Tank identity sheet', `${indexLabel || ''}${tank.name || tank.id || 'Tank'}`)}
      <h2 class="calib-print-title">${escapeHtml(indexLabel || '')}${escapeHtml(tank.name || tank.id || 'Tank')}</h2>
      ${calibPrintMetaGrid(calibPrintTankMetaEntries(tank))}
      <p class="calib-print-note">
        Calculation: <strong>${escapeHtml(tank.calcType || 'direct')}</strong>
        ${isDirect
          ? ' — tabulated values are absolute volumes (m³) at the stated trim/heel.'
          : ' — trim/list tables are corrections applied with the volume curve and divisor.'}
      </p>
      ${typeof FuelReport !== 'undefined' ? FuelReport.printSignatureBlock() : ''}
      ${calibPrintFooter(`${tank.name} · Identity`)}
    </section>
    ${renderCalibPrintGridPages({
      tank,
      title: trimTitle,
      rowLabel,
      colLabel: 'Trim (m)',
      rowAxis: tank.trimAxis || [],
      colVals: tank.trimVals || [],
      grid: tank.trimGrid || [],
    })}
    ${(tank.listVals || []).length
      ? renderCalibPrintGridPages({
          tank,
          title: listTitle,
          rowLabel: isDirect ? 'Depth (m)' : 'Snd/ullage (m)',
          colLabel: 'List (°)',
          rowAxis: tank.listAxis || [],
          colVals: tank.listVals || [],
          grid: tank.listGrid || [],
          colDecimals: 1,
        })
      : ''}
    ${!isDirect ? renderCalibPrintVolumeCurvePages(tank) : ''}
  `;
}

function renderCalibPrintCover(tanks, bookTitle) {
  const vessel = STATE.bundle?.vessel || {};
  const printedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const indexRows = tanks.map((t, i) => `<tr>
    <td>${i + 1}</td>
    <td>${escapeHtml(t.name || '')}</td>
    <td>${escapeHtml(t.id || '')}</td>
    <td>${escapeHtml(t.fuelRole || '')}</td>
    <td>${escapeHtml(t.side || '')}</td>
    <td>${escapeHtml(t.fuelGrade || '')}</td>
    <td>${escapeHtml(fmt(t.capacity, 3))}</td>
    <td>${escapeHtml(t.calcType || 'direct')}</td>
  </tr>`).join('');
  return `<section class="calib-print-section calib-print-page calib-print-index">
    ${calibPrintMasthead(bookTitle || 'Fuel Tank Calibration Tables', vessel.name || 'Vessel')}
    <h2 class="calib-print-title">${escapeHtml(vessel.name || 'Vessel')} — Calibration book</h2>
    ${calibPrintMetaGrid([
      ['Vessel', vessel.name || '—'],
      ['IMO', vessel.imo || '—'],
      ['Call sign', vessel.callSign || '—'],
      ['Flag', vessel.flag || '—'],
      ['Type', vessel.type || '—'],
      ['Fuel tanks', String(tanks.length)],
      ['Printed', printedAt],
    ])}
    <p class="calib-print-note">Index of fuel tanks included in this landscape A4 capacity book. Each tank follows with identity, trim tables, heel/list tables, and volume curves where applicable.</p>
    <table>
      <thead>
        <tr>
          <th>#</th><th>Tank</th><th>ID</th><th>Role</th><th>Side</th><th>Grade</th><th>Cap. 100% (m³)</th><th>Calc</th>
        </tr>
      </thead>
      <tbody>${indexRows}</tbody>
    </table>
    ${typeof FuelReport !== 'undefined' ? FuelReport.printSignatureBlock() : ''}
    ${calibPrintFooter('Cover & index')}
  </section>`;
}

function cleanupCalibPrint() {
  document.body.classList.remove('printing-calib');
  document.getElementById('calib-print-root')?.remove();
}

function printCalibrationDocuments(tanks, opts = {}) {
  const list = (tanks || []).filter(Boolean);
  if (!list.length) {
    showToast('No tanks to print');
    return;
  }
  cleanupCalibPrint();
  const bookTitle = opts.bookTitle || 'Fuel Tank Calibration Tables';
  const includeCover = list.length > 1;
  const html = [
    includeCover ? renderCalibPrintCover(list, bookTitle) : '',
    ...list.map((t, i) => renderCalibPrintTankBlock(t, includeCover ? `${i + 1}. ` : '')),
  ].join('');
  try {
    Branding.printLiveDocument(
      () => {
        const root = document.createElement('div');
        root.id = 'calib-print-root';
        root.className = 'calib-print-doc';
        root.innerHTML = html + Branding.printCredit();
        document.body.appendChild(root);
        document.body.classList.add('printing-calib');
      },
      cleanupCalibPrint,
    );
  } catch (err) {
    console.warn(err);
    cleanupCalibPrint();
    showToast('Print failed');
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function parseNumList(text) {
  return String(text || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

function parseGrid(text) {
  return String(text || '')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseNumList(line));
}

function gridToText(grid) {
  if (!Array.isArray(grid)) return '';
  return grid.map((row) => (Array.isArray(row) ? row.join(', ') : '')).join('\n');
}

/* ---------- Voyage fuel calculation ---------- */
function legMetrics(leg) {
  const distance = parseFloat(leg.distance) || 0;
  const speed = parseFloat(leg.speed) || 0;
  const daily = parseFloat(leg.daily) || 0;
  const days = speed > 0 ? distance / speed / 24 : 0;
  return { days, consumption: daily * days };
}

function renderVoyage(main) {
  main.innerHTML += `<div class="page-head"><div><h1>Voyage Fuel Calculation</h1>
    <div class="desc">Plan consumption by leg. Arrival ROB = Departure ROB + Received − Consumed − Safety margin.</div></div>
    <button class="btn primary" id="btn-save-voyage-plan">Save plan</button></div>`;

  const fuels = [
    ['hfo', 'HFO'],
    ['lsfo', 'LSFO / VLSFO'],
    ['mdo', 'MDO'],
    ['mgo', 'MGO'],
  ];
  if (!STATE.bundle.bunkering) STATE.bundle.bunkering = {};
  const panels = document.createElement('div');
  panels.className = 'fuel-panels';

  for (const [key, label] of fuels) {
    if (!STATE.bundle.bunkering[key]) {
      STATE.bundle.bunkering[key] = {
        departureRob: 0, received: 0, margin: 0,
        legs: Array.from({ length: 8 }, () => ({ from:'', to:'', distance:'', speed:'', daily:'', port:false })),
      };
    }
    const b = STATE.bundle.bunkering[key];
    let totalC = 0, totalD = 0;
    let legRows = '';
    b.legs.forEach((leg, i) => {
      const { days, consumption } = legMetrics(leg);
      totalC += consumption; totalD += days;
      legRows += `<tr>
        <td><input data-k="${key}" data-i="${i}" data-f="from" value="${leg.from||''}"></td>
        <td><input data-k="${key}" data-i="${i}" data-f="to" value="${leg.to||''}"></td>
        <td><input data-k="${key}" data-i="${i}" data-f="distance" type="number" value="${leg.distance||''}"></td>
        <td><input data-k="${key}" data-i="${i}" data-f="speed" type="number" value="${leg.speed||''}"></td>
        <td><input data-k="${key}" data-i="${i}" data-f="daily" type="number" value="${leg.daily||''}"></td>
        <td>${fmt(days,2)}</td><td>${fmt(consumption,2)}</td></tr>`;
    });
    const arrival = (Number(b.departureRob)||0) + (Number(b.received)||0) - totalC - (Number(b.margin)||0);
    const panel = document.createElement('div');
    panel.className = 'form-panel';
    panel.innerHTML = `<div class="section-title" style="margin-top:0">${label}</div>
      <div class="kv-row"><span class="k">Departure ROB (MT)</span><input type="number" data-bk="${key}" data-bf="departureRob" value="${b.departureRob||0}"></div>
      <div class="kv-row"><span class="k">Received (MT)</span><input type="number" data-bk="${key}" data-bf="received" value="${b.received||0}"></div>
      <div class="kv-row"><span class="k">Safety margin (MT)</span><input type="number" data-bk="${key}" data-bf="margin" value="${b.margin||0}"></div>
      <div class="scroll-x" style="margin-top:10px"><table class="leg-table">
        <thead><tr><th>From</th><th>To</th><th>Dist</th><th>Spd</th><th>Daily</th><th>Days</th><th>Used</th></tr></thead>
        <tbody>${legRows}</tbody></table></div>
      <div class="kv-row"><span class="k">Voyage days</span><span class="v">${fmt(totalD,2)}</span></div>
      <div class="kv-row"><span class="k">Total consumption</span><span class="v">${fmt(totalC,2)} MT</span></div>
      <div class="kv-row total"><span class="k">Projected arrival ROB</span>
        <span class="v" style="color:${arrival<0?'var(--bad)':'var(--accent-2)'}">${fmt(arrival,2)} MT</span></div>`;
    panels.appendChild(panel);
  }
  main.appendChild(panels);

  const bind = () => {
    main.querySelectorAll('input[data-k]').forEach((inp) => {
      inp.onchange = () => {
        const { k, i, f } = inp.dataset;
        STATE.bundle.bunkering[k].legs[Number(i)][f] = inp.value;
        renderVoyage(main); // refresh computed
        // re-bind after re-render happens inside navigate-like clear — handled by full re-render:
      };
    });
  };

  // Use event delegation on panels to avoid full re-render loops
  panels.querySelectorAll('input[data-k]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const { k, i, f } = inp.dataset;
      STATE.bundle.bunkering[k].legs[Number(i)][f] = inp.value;
      navigate('voyage');
    });
  });
  panels.querySelectorAll('input[data-bk]').forEach((inp) => {
    inp.addEventListener('change', () => {
      STATE.bundle.bunkering[inp.dataset.bk][inp.dataset.bf] = parseFloat(inp.value) || 0;
      navigate('voyage');
    });
  });

  document.getElementById('btn-save-voyage-plan').onclick = async () => {
    await persistPart('bunkering', STATE.bundle.bunkering);
    showToast('Voyage fuel plan saved');
  };
}

/* ---------- Voyage report ---------- */

/**
 * Report types come from the fuel report, which is the screen that actually
 * uses them: it reads voyage.reportType and prints it as the sheet's condition.
 * Keeping a second list here meant this form offered "Weekly Monitoring" while
 * the fuel report understood "Monitoring", so a value set on one screen was not
 * in the other's dropdown. A stored value is always included, so saving this
 * form can never quietly change a type it did not offer.
 */
function voyageReportTypes(current) {
  const Core = window.FuelReportCore;
  const list = (Core && Core.REPORT_TYPES ? Core.REPORT_TYPES : ['Arrival', 'Departure', 'Monitoring']).slice();
  const cur = String(current || '').trim();
  if (cur && !list.includes(cur)) list.unshift(cur);
  return list;
}

function renderReport(main) {
  const v = STATE.bundle.voyage || {};

  let sections = '';
  let gVol = 0, gWt = 0, gUnknown = 0;
  for (const c of CATS) {
    const tanks = (STATE.bundle.tanks[c.id] || []).filter((t) => getReading(t.id));
    if (!tanks.length) continue;
    let sVol = 0, sWt = 0, unknown = 0;
    let rows = '';
    for (const t of tanks) {
      const r = getReading(t.id);
      sVol += r.result.volumeObserved || 0;
      if (r.result.weightMT == null) unknown += 1;
      else sWt += r.result.weightMT;
      rows += `<tr><td>${escapeHtml(t.name)}</td><td>${fmt(t.capacity, 1)}</td><td>${fmt(r.reading, 1)}</td>
        <td>${fmt(r.tempC, 1)}</td><td>${r.density15 != null ? fmt(r.density15, 4) : '–'}</td>
        <td>${fmt(r.result.volumeObserved, 2)}</td><td>${r.result.weightMT != null ? fmt(r.result.weightMT, 2) : '–'}</td></tr>`;
    }
    gVol += sVol; gWt += sWt; gUnknown += unknown;
    /* A tank with no density has no weight, and adding it in as zero would
       understate the subtotal by however much it holds while its own row shows
       a dash. The tanks it covers are named instead of assumed. */
    const note = unknown
      ? `<div class="hint">${unknown} tank${unknown === 1 ? '' : 's'} without a density — no weight for ${unknown === 1 ? 'it' : 'them'}, so ${unknown === 1 ? 'it is' : 'they are'} not in the MT subtotal.</div>`
      : '';
    sections += `<div class="section-title"><span class="cat-dot cat-${c.id}"></span>${c.label}</div>
      <div class="scroll-x"><table class="data-table"><thead><tr><th>Tank</th><th>Cap</th><th>Reading</th><th>Temp</th><th>Dens</th><th>Vol</th><th>MT</th></tr></thead>
      <tbody>${rows}
      <tr><td colspan="5"><b>Subtotal${unknown ? ` (${tanks.length - unknown} of ${tanks.length} tanks)` : ''}</b></td>
        <td><b>${fmt(sVol, 2)}</b></td><td><b>${fmt(sWt, 2)}</b></td></tr></tbody></table></div>${note}`;
  }

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="page-head no-print"><div><h1>Voyage Report</h1>
      <div class="desc">Printable ROB summary</div></div>
      <div class="btn-row"><button class="btn primary" id="btn-print-voy">Print / PDF</button>
      <button class="btn" id="btn-save-voy">Save voyage details</button></div></div>

    <div class="form-panel no-print">
      <div class="form-row-2">
        <div class="form-row"><label>Voyage No.</label><input id="v-voyage" value="${escapeHtml(v.voyageNo || '')}"></div>
        <div class="form-row"><label>Port</label><input id="v-port" value="${escapeHtml(v.port || '')}"></div>
      </div>
      <div class="form-row-2">
        <div class="form-row"><label>Report type</label>
          <select id="v-type">${voyageReportTypes(v.reportType).map((o) =>
            `<option ${v.reportType === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select></div>
        <div class="form-row"><label>Date</label><input id="v-date" type="date" value="${escapeHtml(v.date || '')}"></div>
      </div>
      <div class="form-row-2">
        <div class="form-row"><label>Trim (m)</label><input id="v-trim" type="number" step="any" value="${v.trim ?? 0}"></div>
        <div class="form-row"><label>Heel (°)</label><input id="v-heel" type="number" step="any" value="${v.heel ?? 0}"></div>
      </div>
      <div class="form-row-2">
        <div class="form-row"><label>Draft Fwd</label><input id="v-dfwd" type="number" step="any" value="${v.draftFwd ?? 0}"></div>
        <div class="form-row"><label>Draft Aft</label><input id="v-daft" type="number" step="any" value="${v.draftAft ?? 0}"></div>
      </div>
    </div>

    <div class="form-panel"><h2 style="margin-top:0">${escapeHtml(vesselName())}</h2>
      <div style="color:var(--text-dim);margin-bottom:12px">${escapeHtml(v.reportType || '')} · Voy ${escapeHtml(v.voyageNo || '')} · ${escapeHtml(v.port || '')} · ${escapeHtml(v.date || '')}
        · Trim ${fmt(v.trim, 2)} m · Heel ${fmt(v.heel, 2)}°</div>
      ${sections}
      <div class="section-title">All categories: ${fmt(gVol, 2)} m³ · ${fmt(gWt, 2)} MT</div>
      <div class="hint">Fuel, lube, misc and fresh water added together.${gUnknown
        ? ` ${gUnknown} tank${gUnknown === 1 ? ' without a density is' : 's without a density are'} outside the MT figure.` : ''}</div>
    </div>`;

  // Bound after the markup is in place. This used to be assigned before a
  // trailing `main.innerHTML +=`, which re-parses everything already in main
  // and throws away its listeners — the save button did nothing at all.
  main.appendChild(wrap);

  wrap.querySelector('#btn-print-voy').onclick = () => {
    const parts = [...wrap.querySelectorAll('.form-panel:not(.no-print)')]
      .map((el) => el.outerHTML)
      .join('');
    try {
      Branding.beginPrintHold();
      Branding.printLiveDocument(
        null,
        null,
        {
          title: 'Voyage Report',
          bodyClass: '',
          bodyHtml: `<div class="report-print-doc">${parts}</div>${Branding.printCredit()}`,
        },
      );
    } catch (err) {
      Branding.endPrintHold();
      console.warn(err);
      showToast('Print failed');
    }
  };
  wrap.querySelector('#btn-save-voy').onclick = async () => {
    const voyage = {
      ...v,
      vessel: vesselName(),
      voyageNo: wrap.querySelector('#v-voyage').value,
      port: wrap.querySelector('#v-port').value,
      reportType: wrap.querySelector('#v-type').value,
      date: wrap.querySelector('#v-date').value,
      trim: parseFloat(wrap.querySelector('#v-trim').value) || 0,
      heel: parseFloat(wrap.querySelector('#v-heel').value) || 0,
      draftFwd: parseFloat(wrap.querySelector('#v-dfwd').value) || 0,
      draftAft: parseFloat(wrap.querySelector('#v-daft').value) || 0,
    };
    await persistPart('voyage', voyage);
    showToast('Voyage details saved');
    navigate('report');
  };
}

/* ---------- Vessel setup ---------- */
function renderSetup(main) {
  const embedded = !!(window.parent && window.parent !== window && window.parent.ChengPro)
    || !!window.ChengPro
    || (typeof localStorage !== 'undefined' && localStorage.getItem('chengAioEmbedded') === '1');

  main.innerHTML += `<div class="page-head"><div><h1>Vessel Setup</h1>
    <div class="desc">${embedded
      ? 'Ship identity is managed in <strong>ChEng AIO → Vessel Setup</strong>. Use this page to switch the active tank database folder and edit Chief Engineer / notes for tank printouts. Tank tables stay here.'
      : 'Create multiple vessel records. Each vessel is stored in its own database folder and can be selected anytime.'}</div></div></div>`;

  if (embedded) {
    const banner = document.createElement('div');
    banner.className = 'form-panel';
    banner.innerHTML = `<div class="section-title" style="margin-top:0">ChEng AIO vessel hub</div>
      <p class="hint" style="margin:0">Name, IMO, call sign, flag, company, type and DWT are edited in the ChEng AIO shell.
      Changes there update this tank database. Standalone Tank Chief backups can still be imported into AIO.</p>`;
    main.appendChild(banner);
  }

  const list = document.createElement('div');
  list.className = 'form-panel';
  list.innerHTML = `<div class="section-title" style="margin-top:0">Saved vessels</div>
    <div class="scroll-x"><table class="data-table"><thead><tr><th>Name</th><th>IMO</th><th>Updated</th><th></th></tr></thead>
    <tbody>${STATE.vessels.map((v)=>`<tr>
      <td class="tname">${v.name}${v.id===STATE.activeVesselId?' <span class="pill good">active</span>':''}</td>
      <td>${v.imo||'–'}</td><td>${(v.updatedAt||'').slice(0,16).replace('T',' ')}</td>
      <td class="btn-row">
        <button class="btn small" data-load="${v.id}">Load</button>
        <button class="btn small danger" data-del="${v.id}">Delete</button>
      </td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">No vessels yet</td></tr>'}
    </tbody></table></div>`;
  main.appendChild(list);

  list.querySelectorAll('[data-load]').forEach((btn) => {
    btn.onclick = async () => {
      await Api.setActive(btn.dataset.load);
      STATE.activeVesselId = btn.dataset.load;
      await reloadBundle();
      const st = await Api.getStatus();
      STATE.vessels = st.vessels;
      showToast('Vessel loaded');
      navigate('dashboard');
    };
  });
  list.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Delete this vessel database folder?')) return;
      await Api.deleteVessel(btn.dataset.del);
      const st = await Api.getStatus();
      STATE.vessels = st.vessels;
      STATE.activeVesselId = st.activeVesselId;
      if (STATE.activeVesselId) await reloadBundle();
      else STATE.bundle = null;
      navigate('setup');
    };
  });

  const form = document.createElement('div');
  form.className = 'form-panel';
  form.style.marginTop = '16px';
  const cur = STATE.bundle?.vessel || {};
  const ro = embedded ? ' readonly' : '';
  const dis = embedded ? ' disabled' : '';
  form.innerHTML = `<div class="section-title" style="margin-top:0">${cur.id ? 'Edit active vessel' : 'Create new vessel'}</div>
    <div class="form-row-2">
      <div class="form-row"><label>Vessel name</label><input id="s-name" value="${cur.name||''}"${ro}></div>
      <div class="form-row"><label>IMO</label><input id="s-imo" value="${cur.imo||''}"${ro}></div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label>Call sign</label><input id="s-call" value="${cur.callSign||''}"${ro}></div>
      <div class="form-row"><label>Flag</label><input id="s-flag" value="${cur.flag||''}"${ro}></div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label>Type</label><input id="s-type" value="${cur.type||''}"${ro}></div>
      <div class="form-row"><label>Owner / manager</label><input id="s-owner" value="${cur.owner||''}"${ro}></div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label>DWT</label><input id="s-dwt" value="${cur.dwt||''}"${ro}></div>
      <div class="form-row"><label>Chief Engineer</label><input id="s-cheng" value="${cur.chiefEngineer||''}">
        <div class="hint">Signs the printed documents. Signatures are filed under this name.</div></div>
    </div>
    <div class="form-row"><label>Notes</label><textarea id="s-notes" class="textarea-json" style="min-height:80px">${cur.notes||''}</textarea></div>
    <div class="btn-row">
      <button class="btn primary" id="btn-save-vessel">${cur.id ? (embedded ? 'Save Chief Engineer / notes' : 'Save vessel details') : 'Create vessel'}</button>
      <button class="btn" id="btn-new-vessel"${dis}>Create blank vessel</button>
      <button class="btn" id="btn-clone-vessel"${dis}>Clone active as new</button>
    </div>`;
  main.appendChild(form);

  document.getElementById('btn-save-vessel').onclick = async () => {
    if (embedded) {
      /* Identity fields are hub-owned; still allow CE + notes updates. */
      const details = {
        name: document.getElementById('s-name').value.trim(),
        imo: document.getElementById('s-imo').value.trim(),
        callSign: document.getElementById('s-call').value.trim(),
        flag: document.getElementById('s-flag').value.trim(),
        type: document.getElementById('s-type').value.trim(),
        owner: document.getElementById('s-owner').value.trim(),
        dwt: document.getElementById('s-dwt').value.trim(),
        chiefEngineer: document.getElementById('s-cheng').value.trim(),
        notes: document.getElementById('s-notes').value.trim(),
      };
      if (!STATE.activeVesselId) { showToast('No active vessel'); return; }
      await Api.updateVessel(STATE.activeVesselId, {
        chiefEngineer: details.chiefEngineer,
        notes: details.notes,
      });
      await reloadBundle();
      showToast('Chief Engineer / notes saved (identity is in ChEng AIO)');
      navigate('setup');
      return;
    }
    const details = {
      name: document.getElementById('s-name').value.trim(),
      imo: document.getElementById('s-imo').value.trim(),
      callSign: document.getElementById('s-call').value.trim(),
      flag: document.getElementById('s-flag').value.trim(),
      type: document.getElementById('s-type').value.trim(),
      owner: document.getElementById('s-owner').value.trim(),
      dwt: document.getElementById('s-dwt').value.trim(),
      chiefEngineer: document.getElementById('s-cheng').value.trim(),
      notes: document.getElementById('s-notes').value.trim(),
    };
    if (!details.name) { showToast('Vessel name required'); return; }
    if (STATE.activeVesselId && STATE.bundle?.vessel) {
      await Api.updateVessel(STATE.activeVesselId, details);
      await reloadBundle();
    } else {
      const v = await Api.createVessel(details);
      await Api.setActive(v.id);
      STATE.activeVesselId = v.id;
      await reloadBundle();
    }
    const st = await Api.getStatus();
    STATE.vessels = st.vessels;
    showToast('Vessel saved');
    navigate('setup');
  };

  document.getElementById('btn-new-vessel').onclick = async () => {
    if (embedded) { showToast('Create vessels in ChEng AIO → Vessel Setup'); return; }
    const name = prompt('New vessel name?');
    if (!name) return;
    const v = await Api.createVessel({ name });
    await Api.setActive(v.id);
    STATE.activeVesselId = v.id;
    await reloadBundle();
    const st = await Api.getStatus();
    STATE.vessels = st.vessels;
    showToast('Blank vessel created');
    navigate('setup');
  };

  document.getElementById('btn-clone-vessel').onclick = async () => {
    if (embedded) { showToast('Clone vessels in ChEng AIO → Vessel Setup'); return; }
    if (!STATE.bundle) { showToast('No active vessel'); return; }
    const name = prompt('Name for cloned vessel?', vesselName() + ' (copy)');
    if (!name) return;
    const v = await Api.createVessel({
      name,
      imo: STATE.bundle.vessel.imo,
      tanks: STATE.bundle.tanks,
      readings: {},
      voyage: { ...STATE.bundle.voyage, vessel: name },
      bunkering: STATE.bundle.bunkering,
    });
    await Api.setActive(v.id);
    STATE.activeVesselId = v.id;
    await reloadBundle();
    const st = await Api.getStatus();
    STATE.vessels = st.vessels;
    showToast('Vessel cloned');
    navigate('setup');
  };

  if (STATE.bundle) main.appendChild(buildPrintIdentityPanel());
}

/* ---------- Vessel logo & Chief Engineer signature ---------- */

function vesselAssets() {
  const b = STATE.bundle;
  if (!b) return { vesselLogo: null, chEngSignatures: {} };
  if (!b.assets || typeof b.assets !== 'object') b.assets = { vesselLogo: null, chEngSignatures: {} };
  if (!b.assets.chEngSignatures || typeof b.assets.chEngSignatures !== 'object') {
    b.assets.chEngSignatures = {};
  }
  return b.assets;
}

function signatureKeyFor(name) {
  return String(name || '').trim().toLowerCase();
}

function currentChEngName() {
  const field = document.getElementById('s-cheng');
  const typed = field ? field.value.trim() : '';
  return typed || (STATE.bundle?.vessel?.chiefEngineer || '').trim();
}

async function saveVesselAssets() {
  await persistPart('assets', vesselAssets());
}

/**
 * Upload panel for the two images every printout carries: the Chief Engineer's
 * signature, printed in the space above the signature line, and the vessel logo
 * printed just after it.
 *
 * Photographs of a signature on paper are the normal case, so the white
 * background is lifted and the image cropped to the ink by default — the same
 * treatment the voyage-manager app gives them.
 */
function buildPrintIdentityPanel() {
  const panel = document.createElement('div');
  panel.className = 'form-panel';
  panel.style.marginTop = '16px';
  panel.innerHTML = `
    <div class="section-title" style="margin-top:0">Printed document identity</div>
    <p class="hint" style="margin-top:0">Used on every printout: the signature sits on the signature line,
      the logo just after it. Photograph a signature on white paper — the paper is made transparent and the
      image trimmed to the ink. Stored with this vessel and included in backups and peer sync.</p>

    <div class="section-title">Chief Engineer signature</div>
    <div class="stamp-row">
      <div class="stamp-preview" id="sig-preview"></div>
      <div class="stamp-controls">
        <div class="form-row"><label>Signature image (PNG or JPG)</label>
          <input type="file" accept="image/*" id="sig-file"></div>
        <label class="stamp-check"><input type="checkbox" id="sig-cutout" checked>
          Remove background and trim to the signature</label>
        <div class="hint" id="sig-for"></div>
        <div class="btn-row">
          <button class="btn small" id="sig-draw">Sign on screen</button>
          <button class="btn small" id="sig-recut" style="display:none">Remove background now</button>
          <button class="btn small danger" id="sig-remove" style="display:none">Remove signature</button>
        </div>
        <div class="hint">Signing on screen needs no photograph: the strokes are already ink on a
          transparent background, so nothing has to be lifted off.</div>
      </div>
    </div>

    <div class="section-title">Vessel logo</div>
    <div class="stamp-row">
      <div class="stamp-preview" id="logo-preview"></div>
      <div class="stamp-controls">
        <div class="form-row"><label>Logo image (PNG or JPG)</label>
          <input type="file" accept="image/*" id="logo-file"></div>
        <label class="stamp-check"><input type="checkbox" id="logo-cutout">
          Remove background and trim to the mark</label>
        <div class="hint">Leave the box unticked for a logo that already has a transparent background.</div>
        <div class="btn-row">
          <button class="btn small" id="logo-recut" style="display:none">Remove background now</button>
          <button class="btn small danger" id="logo-remove" style="display:none">Remove logo</button>
        </div>
      </div>
    </div>`;

  const renderPreviews = () => {
    const assets = vesselAssets();
    const name = currentChEngName();
    const sig = assets.chEngSignatures[signatureKeyFor(name)] || null;
    const sigBox = panel.querySelector('#sig-preview');
    sigBox.innerHTML = sig
      ? `<img src="${sig}" alt="Chief Engineer signature">`
      : `<span class="stamp-empty">${name
        ? 'No signature stored for ' + escapeHtml(name) + '.'
        : 'Enter the Chief Engineer name above, save the vessel, then upload their signature.'}</span>`;
    panel.querySelector('#sig-for').textContent = name ? `Signature on file for: ${name}` : '';
    panel.querySelector('#sig-recut').style.display = sig ? '' : 'none';
    panel.querySelector('#sig-remove').style.display = sig ? '' : 'none';

    const logoBox = panel.querySelector('#logo-preview');
    logoBox.innerHTML = assets.vesselLogo
      ? `<img src="${assets.vesselLogo}" alt="Vessel logo">`
      : '<span class="stamp-empty">No logo uploaded — printouts show the signature block only.</span>';
    panel.querySelector('#logo-recut').style.display = assets.vesselLogo ? '' : 'none';
    panel.querySelector('#logo-remove').style.display = assets.vesselLogo ? '' : 'none';
  };

  panel.querySelector('#sig-file').onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const name = currentChEngName();
    if (!name) {
      showToast('Enter the Chief Engineer name first — signatures are filed under it');
      return;
    }
    const track = Progress.start(panel, 'Reading signature…');
    try {
      let url = await ImageCutout.toPngDataUrl(file, 900, (pct, msg) => Progress.set(pct, msg));
      if (panel.querySelector('#sig-cutout').checked) {
        url = await ImageCutout.removeBackground(url, {
          onProgress: (pct, msg) => Progress.set(pct, msg),
        });
      }
      Progress.set(null, 'Saving…');
      vesselAssets().chEngSignatures[signatureKeyFor(name)] = url;
      await saveVesselAssets();
      renderPreviews();
      Progress.done('Signature saved');
      showToast('Signature saved for ' + name);
    } catch (err) {
      console.warn(err);
      Progress.done();
      showToast('Could not read that image — use a PNG or JPG');
    }
    if (track) track.scrollIntoView({ block: 'nearest' });
  };
  panel.querySelector('#sig-draw').onclick = async () => {
    const name = currentChEngName();
    if (!name) {
      showToast('Enter the Chief Engineer name first — signatures are filed under it');
      return;
    }
    if (!window.SignaturePad || !SignaturePad.isSupported()) {
      showToast('This device cannot capture a drawn signature — upload a photo instead');
      return;
    }
    const url = await SignaturePad.open({ signerName: name });
    if (!url) return;
    Progress.start(panel, 'Saving signature…');
    try {
      vesselAssets().chEngSignatures[signatureKeyFor(name)] = url;
      await saveVesselAssets();
      renderPreviews();
      Progress.done('Signature saved');
      showToast('Signature saved for ' + name);
    } catch (err) {
      console.warn(err);
      Progress.done();
      showToast('Could not save that signature');
    }
  };

  panel.querySelector('#sig-recut').onclick = async () => {
    const key = signatureKeyFor(currentChEngName());
    const cur = vesselAssets().chEngSignatures[key];
    if (!cur) return;
    Progress.start(panel, 'Removing background…');
    try {
      vesselAssets().chEngSignatures[key] = await ImageCutout.removeBackground(cur, {
        onProgress: (pct, msg) => Progress.set(pct, msg),
      });
      Progress.set(null, 'Saving…');
      await saveVesselAssets();
      renderPreviews();
      Progress.done('Background removed');
    } catch (err) {
      console.warn(err);
      Progress.done();
      showToast('Could not process that image');
    }
  };
  panel.querySelector('#sig-remove').onclick = async () => {
    delete vesselAssets().chEngSignatures[signatureKeyFor(currentChEngName())];
    await saveVesselAssets();
    renderPreviews();
  };

  panel.querySelector('#logo-file').onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const track = Progress.start(panel, 'Reading logo…');
    try {
      let url = await ImageCutout.toPngDataUrl(file, 900, (pct, msg) => Progress.set(pct, msg));
      if (panel.querySelector('#logo-cutout').checked) {
        url = await ImageCutout.removeBackground(url, {
          onProgress: (pct, msg) => Progress.set(pct, msg),
        });
      }
      Progress.set(null, 'Saving…');
      vesselAssets().vesselLogo = url;
      await saveVesselAssets();
      renderPreviews();
      Progress.done('Logo saved');
      showToast('Vessel logo saved');
    } catch (err) {
      console.warn(err);
      Progress.done();
      showToast('Could not read that image — use a PNG or JPG');
    }
    if (track) track.scrollIntoView({ block: 'nearest' });
  };
  panel.querySelector('#logo-recut').onclick = async () => {
    const cur = vesselAssets().vesselLogo;
    if (!cur) return;
    Progress.start(panel, 'Removing background…');
    try {
      vesselAssets().vesselLogo = await ImageCutout.removeBackground(cur, {
        onProgress: (pct, msg) => Progress.set(pct, msg),
      });
      Progress.set(null, 'Saving…');
      await saveVesselAssets();
      renderPreviews();
      Progress.done('Background removed');
    } catch (err) {
      console.warn(err);
      Progress.done();
      showToast('Could not process that image');
    }
  };
  panel.querySelector('#logo-remove').onclick = async () => {
    vesselAssets().vesselLogo = null;
    await saveVesselAssets();
    renderPreviews();
  };

  // Signatures follow the name, so the preview follows the field.
  document.getElementById('s-cheng')?.addEventListener('input', renderPreviews);
  renderPreviews();
  return panel;
}

/* ---------- Settings / backup / sync ---------- */
function setSettingsBusy(busy) {
  for (const id of [
    'btn-backup', 'btn-import', 'btn-pull', 'btn-push', 'btn-flush',
    'btn-export-vessel', 'btn-import-vessel', 'btn-save-sync', 'api-transport', 'import-file', 'import-merge',
  ]) {
    const el = document.getElementById(id);
    if (el) el.disabled = !!busy;
  }
}

function renderSettings(main) {
  const s = STATE.settings || {};
  main.innerHTML += `<div class="page-head"><div><h1>Backup, Import & Sync</h1>
    <div class="desc">Save database offline, import backups, and sync between local and Proxmox LXC when the server is online.</div></div></div>
    <div id="settings-progress-host"></div>`;

  const cols = document.createElement('div');
  cols.className = 'two-col';
  cols.innerHTML = `
    <div class="form-panel">
      <div class="section-title" style="margin-top:0">Backup</div>
      <p style="color:var(--text-dim);font-size:13px">Download a full JSON backup of all vessels, tanks, calibrations, readings, and settings. On desktop you choose the save folder; on Android use Share → <strong>Save to Files / Drive / USB</strong> (dismissing the sheet saves nothing).</p>
      <button class="btn primary" id="btn-backup">Download backup</button>
    </div>
    <div class="form-panel">
      <div class="section-title" style="margin-top:0">Import backup</div>
      <p style="color:var(--text-dim);font-size:13px">Merge or restore from a previously saved backup file.</p>
      <input type="file" id="import-file" accept="application/json,.json">
      <label style="display:block;margin:8px 0;font-size:13px;color:var(--text-dim)">
        <input type="checkbox" id="import-merge" checked> Merge with existing vessels</label>
      <button class="btn primary" id="btn-import">Import</button>
    </div>
    <div class="form-panel">
      <div class="section-title" style="margin-top:0">Where this device keeps its records</div>
      <div class="form-row"><label>Database</label>
        <select id="api-transport">
          <option value="local">On this device — works with no network</option>
          <option value="server">On the server that served this page</option>
        </select></div>
      <div class="hint" data-transport-note style="margin-top:8px;color:var(--text-faint);font-size:12px"></div>
    </div>
    <div class="form-panel">
      <div class="section-title" style="margin-top:0">Remote sync (Proxmox / office)</div>
      <div class="form-row"><label>Peer sync URL</label>
        <input id="sync-url" value="${s.syncUrl||''}" placeholder="http://192.168.1.50:8080 or :3080"></div>
      <div class="form-row"><label>Sync API token</label>
        <input id="sync-token" type="password" value="${s.syncApiToken||''}" placeholder="Optional — required when peer uses SYNC_API_TOKEN"></div>
      <div class="btn-row">
        <button class="btn" id="btn-save-sync">Save settings</button>
        <button class="btn" id="btn-probe-sync">Test connection</button>
        <button class="btn" id="btn-pull">Pull from peer</button>
        <button class="btn primary" id="btn-push">Push to peer</button>
        <button class="btn" id="btn-flush">Flush offline queue</button>
      </div>
      <div class="hint" style="margin-top:8px;color:var(--text-faint);font-size:12px">
        ChEng AIO peer: <code>http://host:8080</code>. Standalone Tank Chief: <code>http://host:3080</code>.
        Local and LXC instances can sync when either becomes reachable. Offline edits stay in IndexedDB until flushed.
      </div>
    </div>
    <div class="form-panel">
      <div class="section-title" style="margin-top:0">Single vessel backup</div>
      <p style="color:var(--text-dim);font-size:13px">Export or import one vessel as JSON — works offline on this device or via the server.</p>
      <div class="btn-row">
        <button class="btn" id="btn-export-vessel">Export active vessel</button>
        <button class="btn" id="btn-import-vessel">Import vessel JSON…</button>
        <input type="file" id="import-vessel-file" accept="application/json,.json" hidden>
      </div>
    </div>`;
  main.appendChild(cols);

  const progressHost = () => document.getElementById('settings-progress-host');

  document.getElementById('btn-backup').onclick = async () => {
    setSettingsBusy(true);
    Progress.start(progressHost(), 'Downloading backup…', 'Preparing the full database…');
    try {
      const backup = await Api.backup((pct, phase) => {
        if (phase === 'starting' || phase === 'reading') {
          Progress.set(null, 'Preparing the full database…');
        } else if (pct == null) {
          Progress.set(null, 'Downloading backup…');
        } else {
          Progress.set(pct, `Downloading backup… ${pct}%`);
        }
      });
      Progress.set(95, 'Saving file…');
      await Progress.yieldToPaint();
      const saved = await downloadJson(`tank-chief-backup-${Date.now()}.json`, backup);
      const vessels = backup?.vessels ? Object.keys(backup.vessels).length : 0;
      const where = downloadWhereLabel(saved);
      Progress.done(vessels
        ? `Backup ${where} (${vessels} vessel${vessels === 1 ? '' : 's'})`
        : `Backup ${where}`);
      showToast(`Backup ${where}`);
    } catch (e) {
      Progress.done();
      showToast(e.message || 'Backup failed');
    } finally {
      setSettingsBusy(false);
    }
  };

  document.getElementById('btn-import').onclick = async () => {
    const file = document.getElementById('import-file').files[0];
    if (!file) { showToast('Choose a backup file'); return; }
    const merge = document.getElementById('import-merge').checked;
    setSettingsBusy(true);
    Progress.start(progressHost(), merge ? 'Restoring backup (merge)…' : 'Restoring backup…',
      `Reading ${file.name}…`);
    try {
      const result = await Api.importBackup(file, merge, (pct, phase) => {
        if (phase === 'uploading') {
          Progress.set(pct, pct == null ? 'Uploading backup…' : `Uploading backup… ${pct}%`);
        } else {
          Progress.set(null, 'Applying vessels, tanks and settings…');
        }
      });
      Progress.set(80, 'Refreshing vessel list…');
      const st = await Api.getStatus();
      STATE.vessels = st.vessels || [];
      STATE.activeVesselId = st.activeVesselId;
      STATE.settings = st.settings || STATE.settings;
      if (STATE.activeVesselId) {
        Progress.set(90, 'Loading active vessel…');
        await reloadBundle();
      }
      const n = result?.imported != null ? result.imported : (result?.vesselCount || 0);
      const tanks = result?.tankCount || 0;
      Progress.done(merge
        ? `Fleet backup merged (${n} vessel${n === 1 ? '' : 's'}, ${tanks} tank${tanks === 1 ? '' : 's'})`
        : `Fleet backup restored (${n} vessel${n === 1 ? '' : 's'}, ${tanks} tank${tanks === 1 ? '' : 's'})`);
      showToast(n
        ? `Imported ${n} vessel${n === 1 ? '' : 's'}${tanks ? ` · ${tanks} tanks` : ''}`
        : 'Backup imported (no new vessels in file)');
      navigate('setup');
    } catch (e) {
      Progress.done();
      showToast(e.message || 'Import failed');
    } finally {
      setSettingsBusy(false);
    }
  };

  /* Switching database is not a per-request fallback: the two hold separate
     records, and a sounding saved to one is not in the other. So it asks, and
     it reloads, rather than leaving the previous database's figures on screen
     under the new one's name. */
  const transportBox = document.getElementById('api-transport');
  const transportNote = document.querySelector('[data-transport-note]');
  if (transportBox) {
    transportBox.value = Api.getTransport();
    transportBox.disabled = !Api.canUseLocal();
    transportNote.textContent = Api.getTransport() === 'local'
      ? 'Records are on this device. Nothing is sent anywhere — use Push below to copy them to a server.'
      : 'Records are on the server. This device shows a cached copy when the server is out of reach.';
    transportBox.onchange = () => {
      const mode = transportBox.value;
      if (mode === Api.getTransport()) return;
      const ask = mode === 'local'
        ? 'Use this device\u2019s own records? The server\u2019s records are not copied across — '
          + 'use Pull first if you want them here.'
        : 'Use the server\u2019s records? Anything saved on this device stays here — '
          + 'use Push first if you want it on the server.';
      if (!confirm(ask)) { transportBox.value = Api.getTransport(); return; }
      Api.setTransport(mode);
      location.reload();
    };
  }

  document.getElementById('btn-save-sync').onclick = async () => {
    STATE.settings = await Api.saveSettings({
      syncUrl: document.getElementById('sync-url').value.trim(),
      syncApiToken: document.getElementById('sync-token').value.trim(),
      syncEnabled: true,
    });
    showToast('Sync settings saved');
  };

  document.getElementById('btn-probe-sync').onclick = async () => {
    const url = document.getElementById('sync-url').value.trim();
    const token = document.getElementById('sync-token').value.trim();
    if (!url) { showToast('Enter a peer sync URL'); return; }
    setSettingsBusy(true);
    Progress.start(progressHost(), 'Testing peer…', `Connecting to ${url}…`);
    try {
      const res = await Api.syncProbe(url, token);
      Progress.done(res.hint || 'Peer reachable');
      showToast(res.hint || 'Peer connection OK');
    } catch (e) {
      Progress.done();
      showToast(e.message || 'Peer test failed');
    } finally {
      setSettingsBusy(false);
    }
  };

  document.getElementById('btn-pull').onclick = async () => {
    const url = document.getElementById('sync-url').value.trim();
    const token = document.getElementById('sync-token').value.trim();
    if (!url) { showToast('Enter a peer sync URL'); return; }
    setSettingsBusy(true);
    Progress.start(progressHost(), 'Pulling from peer…', `Connecting to ${url}…`);
    try {
      Progress.set(null, 'Downloading vessels from peer…');
      const res = await Api.syncPull(url, token);
      if (res.warning) {
        Progress.done(res.warning);
        showToast(res.warning);
        return;
      }
      const results = res.results || [];
      const pulled = results.filter((r) => r.action === 'pulled').length;
      const kept = results.filter((r) => r.action === 'kept-local').length;
      const remoteCount = res.remoteCount != null ? res.remoteCount : results.length;
      Progress.set(70, pulled
        ? `Applying ${pulled} vessel${pulled === 1 ? '' : 's'}…`
        : 'Applying peer data…');
      const st = await Api.getStatus();
      STATE.vessels = st.vessels;
      STATE.activeVesselId = st.activeVesselId;
      if (STATE.activeVesselId) {
        Progress.set(90, 'Loading active vessel…');
        await reloadBundle();
      }
      if (remoteCount === 0) {
        Progress.done('Peer returned 0 vessels');
        showToast('Peer returned 0 vessels — check URL/token or add vessels on the peer');
      } else if (pulled === 0) {
        Progress.done(`Peer has ${remoteCount} vessel(s); all up to date locally`);
        showToast(`Peer has ${remoteCount} vessel(s); ${kept} already up to date locally`);
      } else {
        Progress.done(`Pulled ${pulled} vessel${pulled === 1 ? '' : 's'}`);
        showToast(`Pulled ${pulled} vessel${pulled === 1 ? '' : 's'}${kept ? ` (${kept} kept local)` : ''}`);
      }
    } catch (e) {
      Progress.done();
      showToast(e.message);
    } finally {
      setSettingsBusy(false);
    }
  };

  document.getElementById('btn-push').onclick = async () => {
    const url = document.getElementById('sync-url').value.trim();
    const token = document.getElementById('sync-token').value.trim();
    if (!url) { showToast('Enter a peer sync URL'); return; }
    setSettingsBusy(true);
    Progress.start(progressHost(), 'Pushing to peer…', 'Preparing local vessels…');
    try {
      Progress.set(null, `Uploading to ${url}…`);
      const res = await Api.syncPush(url, token);
      const remoteCount = (res.remote && res.remote.results) ? res.remote.results.length : null;
      Progress.set(90, 'Confirming on peer…');
      await Progress.yieldToPaint();
      Progress.done(remoteCount != null
        ? `Pushed ${remoteCount} vessel${remoteCount === 1 ? '' : 's'}`
        : 'Pushed to peer');
      showToast('Pushed to peer');
    } catch (e) {
      Progress.done();
      showToast(e.message);
    } finally {
      setSettingsBusy(false);
    }
  };

  document.getElementById('btn-flush').onclick = async () => {
    setSettingsBusy(true);
    Progress.start(progressHost(), 'Syncing offline changes…', 'Checking the queue…');
    try {
      const r = await Api.flushQueue((step) => {
        Progress.set(step.pct, step.message || `Sending ${step.index} of ${step.total}…`);
      });
      if (r.busy) {
        Progress.done();
        showToast('A sync is already running');
        return;
      }
      if (STATE.activeVesselId) {
        Progress.set(95, 'Refreshing vessel…');
        await reloadBundle();
      }
      const bits = [];
      if (r.flushed) bits.push(`${r.flushed} sent`);
      if (r.dropped) bits.push(`${r.dropped} dropped`);
      if (r.pending) bits.push(`${r.pending} still waiting`);
      Progress.done(bits.length ? bits.join(' · ') : 'Nothing queued');
      showToast(r.flushed
        ? `Flushed ${r.flushed} queued change(s)`
        : (r.pending ? `${r.pending} change(s) still waiting` : 'Nothing queued'));
      render();
    } catch (e) {
      Progress.done();
      showToast(e.message || 'Sync failed');
    } finally {
      setSettingsBusy(false);
    }
  };

  document.getElementById('btn-export-vessel').onclick = async () => {
    if (!STATE.activeVesselId) { showToast('No active vessel'); return; }
    setSettingsBusy(true);
    try {
      let backup;
      if (Api.getTransport() === 'local' && Api.canUseLocal() && window.StoreCore && StoreCore.exportVesselBackup) {
        backup = StoreCore.exportVesselBackup(STATE.activeVesselId);
      } else {
        backup = await Api.request(`/api/vessels/${encodeURIComponent(STATE.activeVesselId)}/backup`);
      }
      const saved = await downloadJson(`tank-chief-vessel-${STATE.activeVesselId}-${Date.now()}.json`, backup);
      showToast(`Vessel backup ${downloadWhereLabel(saved)}`);
    } catch (e) {
      showToast(e.message || 'Export failed');
    } finally {
      setSettingsBusy(false);
    }
  };

  document.getElementById('btn-import-vessel').onclick = () => {
    document.getElementById('import-vessel-file').click();
  };

  document.getElementById('import-vessel-file').onchange = async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    setSettingsBusy(true);
    Progress.start(progressHost(), 'Importing vessel…', `Reading ${file.name}…`);
    try {
      const result = await Api.importBackup(file, true, (pct, phase) => {
        if (phase === 'uploading') {
          Progress.set(pct, pct == null ? 'Uploading…' : `Uploading… ${pct}%`);
        } else {
          Progress.set(null, 'Applying vessel data…');
        }
      });
      Progress.set(80, 'Refreshing vessel list…');
      const st = await Api.getStatus();
      STATE.vessels = st.vessels || [];
      STATE.activeVesselId = st.activeVesselId;
      STATE.settings = st.settings || STATE.settings;
      if (STATE.activeVesselId) {
        Progress.set(90, 'Loading active vessel…');
        await reloadBundle();
      }
      const n = result?.imported != null ? result.imported : (result?.vesselCount || 0);
      const tanks = result?.tankCount || 0;
      if (!n) {
        Progress.done('No vessel data found in file');
        showToast('No vessel data found in file — try a full Download backup export');
        return;
      }
      Progress.done(`Imported ${n} vessel${n === 1 ? '' : 's'}${tanks ? ` · ${tanks} tanks` : ''}`);
      showToast(`Imported ${n} vessel${n === 1 ? '' : 's'}${tanks ? ` with ${tanks} tanks` : ' with tanks and readings'}`);
      navigate('setup');
    } catch (e) {
      Progress.done();
      showToast(e.message || 'Import failed');
    } finally {
      setSettingsBusy(false);
    }
  };
}

/* ---------- VCF / WCF manual calculator + reference tables ---------- */
function renderVcfWcf(main) {
  main.innerHTML += `<div class="page-head"><div><h1>VCF / WCF Calculator</h1>
    <div class="desc">Single manual ASTM Table 54B (VCF) and Table 56-style (WCF) calculation, plus reference tables.</div></div></div>
    <div class="help-box"><b>VCF</b> corrects observed volume to 15°C. <b>WCF</b> = density@15 − 0.0011 (air buoyancy).
    Weight MT = (observed m³ × VCF) × WCF. Enter density + temperature; optionally volume <i>or</i> MT.</div>`;

  const panel = document.createElement('div');
  panel.className = 'form-panel';
  panel.style.maxWidth = '820px';
  panel.innerHTML = `
    <div class="section-title" style="margin-top:0">Manual calculation</div>
    <div class="form-row-3">
      <div class="form-row"><label>Density @15°C (kg/L)</label><input id="vw-dens" type="number" step="any" placeholder="0.9584" value="0.9584"></div>
      <div class="form-row"><label>Temperature (°C)</label><input id="vw-temp" type="number" step="any" value="25"></div>
      <div class="form-row"><label>Observed volume (m³)</label><input id="vw-vol" type="number" step="any" placeholder="optional"></div>
    </div>
    <div class="form-row-3">
      <div class="form-row"><label>Quantity (MT)</label><input id="vw-mt" type="number" step="any" placeholder="optional — or volume above"></div>
      <div class="form-row"><label>SG → density</label>
        <div style="display:flex;gap:6px">
          <input id="vw-sg" type="number" step="any" placeholder="SG / RD">
          <button type="button" class="btn small" id="btn-vw-sg">SG→ρ</button>
        </div></div>
      <div class="form-row" style="display:flex;align-items:flex-end">
        <button class="btn primary" id="btn-vw-calc" style="width:100%">Calculate VCF / WCF</button>
      </div>
    </div>
    <div id="vw-result" style="margin-top:14px"></div>`;
  main.appendChild(panel);

  const tablesWrap = document.createElement('div');
  tablesWrap.className = 'form-panel';
  tablesWrap.style.marginTop = '18px';
  tablesWrap.innerHTML = `
    <div class="section-title" style="margin-top:0">Reference tables</div>
    <div class="form-row-3">
      <div class="form-row"><label>Density min</label><input id="vw-dmin" type="number" step="0.01" value="0.85"></div>
      <div class="form-row"><label>Density max</label><input id="vw-dmax" type="number" step="0.01" value="0.99"></div>
      <div class="form-row" style="display:flex;align-items:flex-end">
        <button class="btn" id="btn-vw-tables" style="width:100%">Refresh tables</button>
      </div>
    </div>
    <div class="section-title">WCF (density → weight correction)</div>
    <div class="scroll-x" id="vw-wcf-table"></div>
    <div class="section-title">VCF (ASTM 54B) — density × temperature</div>
    <div class="scroll-x" id="vw-vcf-table"></div>
    <p class="hint">Highlighted row/column match the density and temperature used in the manual calculation above (when tables are refreshed after calculating).</p>`;
  main.appendChild(tablesWrap);

  async function runCalc() {
    const dens = parseFloat(document.getElementById('vw-dens').value);
    const temp = parseFloat(document.getElementById('vw-temp').value);
    const vol = document.getElementById('vw-vol').value;
    const mt = document.getElementById('vw-mt').value;
    if (!(dens > 0)) { showToast('Enter density @15°C'); return null; }
    if (Number.isNaN(temp)) { showToast('Enter temperature'); return null; }

    let result;
    try {
      result = await Api.vcfWcfCalc({
        density15: dens,
        tempC: temp,
        volumeObserved: vol === '' ? null : parseFloat(vol),
        quantityMT: mt === '' ? null : parseFloat(mt),
      });
    } catch (e) {
      // Offline / local fallback
      if (typeof vcf54B !== 'function') { showToast(e.message); return null; }
      const vcf = vcf54B(dens, temp);
      const wcf = wcf56(dens);
      result = { density15: dens, tempC: temp, vcf, wcf };
      if (vol !== '') {
        result.volumeObserved = parseFloat(vol);
        result.volume15 = result.volumeObserved * vcf;
        result.weightMT = result.volume15 * wcf;
      } else if (mt !== '' && typeof volumeFromMT === 'function') {
        result.quantityMT = parseFloat(mt);
        result.volumeObserved = volumeFromMT(result.quantityMT, dens, temp);
        result.volume15 = wcf > 0 ? result.quantityMT / wcf : null;
      }
    }

    const box = document.getElementById('vw-result');
    box.innerHTML = `<div class="bunker-kpi-grid">
      <div class="bunker-stat accent"><div class="bunker-stat-label">VCF (54B)</div><div class="bunker-stat-value">${fmt(result.vcf, 4)}</div></div>
      <div class="bunker-stat accent"><div class="bunker-stat-label">WCF (56)</div><div class="bunker-stat-value">${fmt(result.wcf, 4)}</div></div>
      <div class="bunker-stat"><div class="bunker-stat-label">Density @15</div><div class="bunker-stat-value">${fmt(result.density15, 4)}</div></div>
      <div class="bunker-stat"><div class="bunker-stat-label">Temp</div><div class="bunker-stat-value">${fmt(result.tempC, 1)} <span class="unit">°C</span></div></div>
      ${result.volumeObserved != null ? `<div class="bunker-stat"><div class="bunker-stat-label">Observed vol</div><div class="bunker-stat-value">${fmt(result.volumeObserved, 3)} <span class="unit">m³</span></div></div>` : ''}
      ${result.volume15 != null ? `<div class="bunker-stat"><div class="bunker-stat-label">Volume @15°C</div><div class="bunker-stat-value">${fmt(result.volume15, 3)} <span class="unit">m³</span></div></div>` : ''}
      ${result.weightMT != null ? `<div class="bunker-stat"><div class="bunker-stat-label">Weight in air</div><div class="bunker-stat-value">${fmt(result.weightMT, 3)} <span class="unit">MT</span></div></div>` : ''}
      ${result.quantityMT != null && result.volumeObserved != null ? `<div class="bunker-stat"><div class="bunker-stat-label">From MT → obs vol</div><div class="bunker-stat-value">${fmt(result.volumeObserved, 3)} <span class="unit">m³</span></div></div>` : ''}
    </div>
    <p class="hint" style="margin-top:10px">Vol@15 = obs × VCF · Weight MT = Vol@15 × WCF · WCF = ρ15 − 0.0011</p>`;
    return result;
  }

  async function loadTables(highlight) {
    const dmin = parseFloat(document.getElementById('vw-dmin').value) || 0.85;
    const dmax = parseFloat(document.getElementById('vw-dmax').value) || 0.99;
    const q = `densMin=${dmin}&densMax=${dmax}&densStep=0.01&temps=0,5,10,15,20,25,30,35,40,45,50`;
    let data;
    try {
      data = await Api.vcfWcfTables(q);
    } catch (e) {
      // Build locally
      if (typeof vcf54B !== 'function') { showToast(e.message); return; }
      const temps = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
      const wcf = []; const vcf = [];
      for (let d = dmin; d <= dmax + 1e-9; d = Math.round((d + 0.01) * 1000) / 1000) {
        const dens = Math.round(d * 1000) / 1000;
        wcf.push({ density15: dens, wcf: wcf56(dens) });
        const row = { density15: dens };
        temps.forEach((t) => { row['t' + t] = vcf54B(dens, t); });
        vcf.push(row);
      }
      data = { temps, wcf, vcf };
    }

    const hlDens = highlight?.density15;
    const hlTemp = highlight?.tempC;

    const wcfEl = document.getElementById('vw-wcf-table');
    wcfEl.innerHTML = `<table class="data-table compact ref-table"><thead><tr><th>Density @15</th><th>WCF</th></tr></thead>
      <tbody>${data.wcf.map((r) => {
        const on = hlDens != null && Math.abs(r.density15 - hlDens) < 0.005;
        return `<tr class="${on ? 'row-hl' : ''}"><td>${fmt(r.density15, 3)}</td><td>${fmt(r.wcf, 4)}</td></tr>`;
      }).join('')}</tbody></table>`;

    const temps = data.temps || [];
    const vcfEl = document.getElementById('vw-vcf-table');
    vcfEl.innerHTML = `<table class="data-table compact ref-table sticky-head">
      <thead><tr><th>ρ15 \\ T°C</th>${temps.map((t) => {
        const on = hlTemp != null && Math.abs(t - hlTemp) < 0.01;
        return `<th class="${on ? 'col-hl' : ''}">${t}</th>`;
      }).join('')}</tr></thead>
      <tbody>${data.vcf.map((r) => {
        const onRow = hlDens != null && Math.abs(r.density15 - hlDens) < 0.005;
        return `<tr class="${onRow ? 'row-hl' : ''}"><td><b>${fmt(r.density15, 3)}</b></td>${temps.map((t) => {
          const onCol = hlTemp != null && Math.abs(t - hlTemp) < 0.01;
          const cell = r['t' + t];
          return `<td class="${onCol ? 'col-hl' : ''}${onRow && onCol ? ' cell-hl' : ''}">${cell != null ? fmt(cell, 4) : '–'}</td>`;
        }).join('')}</tr>`;
      }).join('')}</tbody></table>`;
  }

  document.getElementById('btn-vw-calc').onclick = async () => {
    const r = await runCalc();
    if (r) {
      showToast(`VCF ${fmt(r.vcf, 4)} · WCF ${fmt(r.wcf, 4)}`);
      await loadTables(r);
    }
  };
  document.getElementById('btn-vw-tables').onclick = async () => {
    const dens = parseFloat(document.getElementById('vw-dens').value);
    const temp = parseFloat(document.getElementById('vw-temp').value);
    await loadTables(Number.isFinite(dens) ? { density15: dens, tempC: temp } : null);
  };
  document.getElementById('btn-vw-sg').onclick = async () => {
    const sg = parseFloat(document.getElementById('vw-sg').value);
    if (Number.isNaN(sg)) { showToast('Enter SG'); return; }
    try {
      if (!STATE.conversionTable) STATE.conversionTable = await Api.request('/api/reference/conversion');
      const dens = sgToDensity15(sg, STATE.conversionTable.rdToDensity15);
      if (dens == null) { showToast('SG out of range'); return; }
      document.getElementById('vw-dens').value = dens;
      showToast(`Density ≈ ${dens}`);
    } catch (e) { showToast(e.message); }
  };

  loadTables({ density15: 0.9584, tempC: 25 });
}

/* ---------- ISO 8217 marine fuel specification ---------- */
function formatIsoLimit(lim) {
  if (!lim) return '—';
  if (lim.text) return lim.text;
  if (lim.note && lim.min == null && lim.max == null) return lim.note;
  const parts = [];
  if (lim.min != null) parts.push(`min ${lim.min}`);
  if (lim.max != null) parts.push(`max ${lim.max}`);
  if (!parts.length && lim.note) return lim.note;
  return parts.join(' · ') || '—';
}

function renderIsoSpecTable(block) {
  if (!block) return '<div class="empty-state">No data</div>';
  const grades = block.grades || [];
  const params = block.parameters || [];
  return `<div class="scroll-x"><table class="data-table compact ref-table sticky-head iso-table">
    <thead><tr><th>Parameter</th><th>Unit</th>${grades.map((g) => `<th>${escapeHtml(g)}</th>`).join('')}</tr></thead>
    <tbody>${params.map((p) => `<tr>
      <td class="tname">${escapeHtml(p.name)}${p.note ? `<div class="hint">${escapeHtml(p.note)}</div>` : ''}</td>
      <td>${escapeHtml(p.unit || '—')}</td>
      ${grades.map((g) => `<td>${escapeHtml(formatIsoLimit(p.limits?.[g]))}</td>`).join('')}
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function renderIso8217(main) {
  main.innerHTML += `<div class="page-head"><div><h1>ISO 8217 Marine Fuel Specs</h1>
    <div class="desc">Reference limits for distillate and residual marine fuels (ISO 8217:2017).</div></div></div>
    <div class="help-box" id="iso-note">Loading specification tables…</div>`;

  const tabs = document.createElement('div');
  tabs.className = 'btn-row';
  tabs.style.marginBottom = '12px';
  tabs.innerHTML = `
    <button class="btn primary small" data-iso-tab="dist">Distillates (DMX–DMB)</button>
    <button class="btn small" data-iso-tab="res">Residuals (RMA–RMK)</button>
    <button class="btn small" data-iso-tab="both">Both tables</button>`;
  main.appendChild(tabs);

  const body = document.createElement('div');
  body.id = 'iso-body';
  main.appendChild(body);

  let data = null;

  function paint(tab) {
    if (!data) return;
    tabs.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('primary', b.dataset.isoTab === tab);
    });
    let html = '';
    if (tab === 'dist' || tab === 'both') {
      html += `<div class="form-panel"><div class="section-title" style="margin-top:0">${escapeHtml(data.distillates.caption)}</div>
        ${renderIsoSpecTable(data.distillates)}</div>`;
    }
    if (tab === 'res' || tab === 'both') {
      html += `<div class="form-panel" style="margin-top:14px"><div class="section-title" style="margin-top:0">${escapeHtml(data.residuals.caption)}</div>
        ${renderIsoSpecTable(data.residuals)}</div>`;
    }
    body.innerHTML = html;
  }

  tabs.querySelectorAll('button').forEach((b) => {
    b.onclick = () => paint(b.dataset.isoTab);
  });

  (async () => {
    try {
      data = await Api.iso8217();
      document.getElementById('iso-note').innerHTML =
        `<b>${escapeHtml(data.standard)}</b> — ${escapeHtml(data.title)}.<br>${escapeHtml(data.note || '')}`;
      paint('dist');
    } catch (e) {
      document.getElementById('iso-note').textContent = e.message;
    }
  })();
}

function renderAbout(main) {
  const ver = (typeof Branding !== 'undefined' && Branding.APP_VERSION)
    ? Branding.APP_VERSION
    : (document.querySelector('meta[name="app-version"]')?.content || '');
  const pkgVer = ver || '2.1.35';
  main.innerHTML += `<div class="page-head"><div>
    <h1>About</h1>
    <div class="desc">${Branding.APP_NAME} · v${pkgVer}</div>
  </div></div>
  <div class="form-panel about-copy">
    <div class="about-authors">
      <span>Written by</span>
      ${Branding.AUTHORS.map((a) => `<b>${a}</b>`).join('')}
    </div>
    <p style="color:var(--text)"><b>${Branding.APP_NAME}</b> is a multi-vessel app for sounding tanks,
      printing tank-condition reports, planning and monitoring bunkering, and keeping each ship’s calibration
      tables in one place. It runs in the browser on a ship or office server and can be installed on a phone
      or tablet.</p>

    <div class="about-install">
      <button type="button" class="btn primary" id="btn-install-app">Install on phone or tablet</button>
      <button type="button" class="btn" id="btn-check-update">Check for latest release</button>
      <p class="about-install-hint" id="about-install-hint"></p>
    </div>
    <p class="hint" id="about-update-status" role="status" aria-live="polite"></p>
    <p><a id="about-update-link" href="https://github.com/tsogs66/tank-management/releases/latest" target="_blank" rel="noopener" style="display:none;">Open latest release</a></p>

    <h2>Tank sounding</h2>
    <p>Enter ullage or dip with trim and heel. <b>Correction tanks</b> interpolate trim, then list, then read
      a volume curve. <b>Direct tanks</b> read a trim × heel volume grid. Weight uses ASTM Table 54B VCF and
      Table 56 WCF. Specific gravity and density @15°C convert both ways on the sounding and bunkering pages.</p>

    <h2>Fuel Report (TANK CONDITION)</h2>
    <p>The voyage sheet: header (vessel, IMO, port, date, drafts, trim, heel, temperatures), fuel-oil and
      diesel-oil tables, log-book comparison, lube oil, received quantities, and daily consumption
      (At sea, At Anchorage, In Port). Print as a two-page A4 portrait document — the face sheet plus the
      calculation annex.</p>

    <h2>Bunkering</h2>
    <p>One operation across three screens. <b>Bunker Plan</b> sets the fill sequence, target ullages, delivery
      rate and live pumping clock. <b>After Bunkering</b> re-sounds the tanks. <b>Bunker Summary</b> compares
      BDN figures with measured intake.</p>

    <h2>Calibration and import</h2>
    <p>Edit sounding × trim grids in Calibration DB. Import capacity-book PDFs (including scanned books with
      OCR), tank-list CSV, per-tank CSV/Excel tables, and Giorgis-style fuel, lube, misc and water workbooks.
      Sample vessels ship with the app so a new install is ready to try.</p>

    <h2>Voyage and reference</h2>
    <p><b>Bunker Consumption Calculation</b> plans legs by distance, speed and daily burn to arrival ROB.
      <b>VCF / WCF Calc</b> is a standalone ASTM 54B / 56 calculator with tables.
      <b>ISO 8217 Specs</b> lists 2017 distillate and residual marine-fuel limits.</p>

    <h2>Ships, offline and backup</h2>
    <p>Each vessel has its own database. The layout fits phones, tablets and desktop. Offline edits stay on
      the device and sync when the server is reachable. Backup / Sync can push or pull a full vessel
      database between machines.</p>
  </div>`;
  document.getElementById('btn-install-app')?.addEventListener('click', promptAppInstall);
  document.getElementById('btn-check-update')?.addEventListener('click', checkTankAppUpdate);
  paintInstallButton();
}

function parseSemverParts(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function isNewerVersion(latest, current) {
  const a = parseSemverParts(latest);
  const b = parseSemverParts(current);
  if (!a || !b) return String(latest) !== String(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}
async function checkTankAppUpdate() {
  const status = document.getElementById('about-update-status');
  const link = document.getElementById('about-update-link');
  const current = '2.1.35';
  if (status) status.textContent = 'Checking GitHub for the latest Tank Chief release…';
  if (link) link.style.display = 'none';
  try {
    const res = await fetch('https://api.github.com/repos/tsogs66/tank-management/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('GitHub returned HTTP ' + res.status);
    const data = await res.json();
    const tag = String(data.tag_name || '').replace(/^v/i, '');
    const url = data.html_url || 'https://github.com/tsogs66/tank-management/releases/latest';
    if (link) {
      link.href = url;
      link.style.display = 'inline';
    }
    if (!tag) {
      if (status) status.textContent = 'Could not read the latest release tag.';
      return;
    }
    if (isNewerVersion(tag, current)) {
      if (status) status.textContent = `Update available: v${tag} (this device: v${current}). Open the release page to download.`;
    } else {
      if (status) status.textContent = `You are on the latest release (v${current}).`;
    }
  } catch (err) {
    if (status) {
      status.textContent = 'Could not check for updates (' + (err && err.message ? err.message : 'offline') + ').';
    }
    if (link) link.style.display = 'inline';
  }
}

/* ---------- Boot ---------- */
async function boot() {
  try {
    if (window.ChengLicense) await ChengLicense.ensureLicensed();
  } catch (e) {
    console.warn('License gate', e);
  }
  try {
    if (window.StoreCore && typeof StoreCore.setUserScope === 'function' && window.ChengLicense) {
      StoreCore.setUserScope({
        email: ChengLicense.licenseEmail() || null,
        master: !!ChengLicense.isMaster(),
      });
    }
  } catch (e) {
    console.warn('User scope', e);
  }

  Api.onStatus((online) => {
    STATE.online = online;
    const dot = document.querySelector('.status-dot');
    if (dot) {
      dot.classList.toggle('online', online);
      dot.classList.toggle('offline', !online);
    }
  });

  const toggle = document.getElementById('menu-toggle');
  if (toggle) {
    toggle.setAttribute('aria-controls', 'sidebar');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar');
      setMobileNavOpen(!sidebar?.classList.contains('open'));
    });
  }
  document.getElementById('sidebar-backdrop')?.addEventListener('click', closeMobileNav);
  document.getElementById('bnMoreSheet')?.addEventListener('click', (e) => {
    if (e.target.id === 'bnMoreSheet') closeMoreSheet();
  });
  document.getElementById('bottomNav')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.bn-item');
    if (!btn) return;
    const page = btn.dataset.page;
    if (page === 'more') {
      const sheet = document.getElementById('bnMoreSheet');
      if (sheet?.classList.contains('open')) closeMoreSheet();
      else openMoreSheet();
      return;
    }
    closeMoreSheet();
    navigate(page);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeMobileNav(); closeMoreSheet(); }
  });
  window.addEventListener('orientationchange', () => {
    window.setTimeout(closeMobileNav, 150);
  });

  try {
    const st = await Api.getStatus();
    STATE.vessels = st.vessels || [];
    STATE.activeVesselId = st.activeVesselId;
    STATE.settings = st.settings || {};
    STATE.online = true;
    if (STATE.activeVesselId) await reloadBundle();
    await Api.flushQueue();
  } catch (e) {
    STATE.online = false;
    const st = await OfflineDB.idbGet('status');
    if (st) {
      STATE.vessels = st.vessels || [];
      STATE.activeVesselId = st.activeVesselId;
      STATE.settings = st.settings || {};
    }
    if (STATE.activeVesselId) {
      STATE.bundle = await OfflineDB.idbGet('vessel:' + STATE.activeVesselId);
    }
  }

  if ('serviceWorker' in navigator) {
    // No ?v here on purpose: the browser re-fetches this URL and compares the
    // bytes, so a pinned version only ever goes stale. The cache name inside
    // the worker is what versions the cached files.
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  render();
  if (isBunkerOpsEmbed()) {
    navigate('bunker-plan');
  }
  startSyncLoop();
}

/**
 * Keep the local database and the server in step.
 *
 * navigator.onLine only says whether the device has a network; it says nothing
 * about whether the server at the other end is up, and aboard a ship the common
 * case is exactly that — the tablet is on the vessel's wifi while the server box
 * is off. So reachability is asked of the server itself, and the queue is
 * retried on that answer rather than on the browser's opinion.
 *
 * While there is nothing waiting the check is cheap and infrequent. While there
 * is queued work it runs often, so a server coming back is picked up in seconds
 * rather than half a minute.
 */
function startSyncLoop() {
  const IDLE_MS = 30000;
  const PENDING_MS = 5000;
  let timer = null;

  Api.afterFlush(async ({ flushed, dropped, pending }) => {
    // Pull the server's copy back down so both sides agree — the server may
    // have merged our history into work of its own while we were away.
    try {
      await reloadBundle();
      const st = await Api.getStatus();
      STATE.vessels = st.vessels || [];
      STATE.settings = st.settings || {};
      render();
    } catch { /* it went away again; the next tick will retry */ }
    const parts = [`Synced ${flushed} offline change${flushed === 1 ? '' : 's'}`];
    if (dropped) parts.push(`${dropped} rejected by the server`);
    if (pending) parts.push(`${pending} still waiting`);
    showToast(parts.join(' · '));
  });

  const tick = async () => {
    let pending = 0;
    try {
      pending = (await OfflineDB.queueAll()).length;
      if (pending) {
        if (await Api.reachable()) await Api.flushQueue();
      } else {
        await Api.reachable();
      }
      pending = (await OfflineDB.queueAll()).length;
    } catch { /* nothing to do but wait for the next tick */ }
    timer = window.setTimeout(tick, pending ? PENDING_MS : IDLE_MS);
  };

  window.addEventListener('online', () => {
    window.clearTimeout(timer);
    tick();
  });
  timer = window.setTimeout(tick, PENDING_MS);
}

/* Tank ROB bridge: respond to parent/AIO requests for current fuel ROB by grade. */
window.addEventListener('message', (ev) => {
  const msg = ev.data || {};
  if (msg.type !== 'request-tank-rob') return;
  const rob = {};
  try {
    const fuelTanks = STATE.bundle?.tanks?.fuel || [];
    for (const t of fuelTanks) {
      const r = getReading(t.id);
      const wt = r?.result?.weightMT;
      if (wt != null && wt > 0) {
        const grade = t.fuelGrade || 'Unknown';
        rob[grade] = (rob[grade] || 0) + wt;
      }
    }
  } catch (_) { /* bundle not ready */ }
  const target = ev.source || window.parent;
  try { target.postMessage({ type: 'tank-rob-response', rob }, '*'); } catch (_) {}
});

document.addEventListener('DOMContentLoaded', boot);
