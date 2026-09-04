/**
 * Shared license client — ChEng AIO / Voyage Chief / Tank Chief / Master Admin.
 *
 * Config (optional globals, set before this script):
 *   CHENG_LICENSE_API   — default '/api/license' or LICENSE_SERVER_URL
 *   CHENG_LICENSE_SKU   — 'cheng-aio' | 'voyage-chief' | 'tank-chief' | 'cheng-admin'
 *   CHENG_LICENSE_PRODUCT — display name
 *
 * Embedded in AIO (parent.ChengPro / ?chengaio=1): gate is skipped; AIO owns the seat.
 */
(function (global) {
  const STORAGE_KEY = 'chengAioLicenseEntitlement';
  const STORAGE_FALLBACK_KEY = 'chengAioLicenseEntitlementFb';
  const DEVICE_KEY = 'chengAioLicenseDeviceId';
  const ENFORCE_CACHE_KEY = 'chengAioLicenseEnforce';
  const LICENSE_API_KEY = 'chengLicenseApi';
  const SERVER_BASE_KEY = 'apiServerBase';

  function readStorage(key) {
    try {
      const v = localStorage.getItem(key);
      if (v != null) return v;
    } catch { /* ignore */ }
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStorage(key, value) {
    let ok = false;
    try {
      if (value == null) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      } else {
        localStorage.setItem(key, value);
        sessionStorage.setItem(key, value);
      }
      ok = true;
    } catch { /* ignore */ }
    if (!ok) {
      try {
        if (value == null) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, value);
        ok = true;
      } catch { /* ignore */ }
    }
    return ok;
  }

  const KEY_PLACEHOLDER_BY_SKU = {
    'cheng-aio': 'CA-XXXXXXXX-XXXXXXXX',
    'voyage-chief': 'VC-XXXXXXXX-XXXXXXXX',
    'tank-chief': 'TC-XXXXXXXX-XXXXXXXX',
    'cheng-admin': 'MA-XXXXXXXX-XXXXXXXX',
  };

  function productSku() {
    return global.CHENG_LICENSE_SKU || 'cheng-aio';
  }

  function productName() {
    return global.CHENG_LICENSE_PRODUCT
      || ({
        'voyage-chief': 'Voyage Chief',
        'tank-chief': 'Tank Chief',
        'cheng-admin': 'ChEng Admin',
      }[productSku()] || 'ChEng AIO');
  }

  function apiBase() {
    if (global.CHENG_LICENSE_API) return String(global.CHENG_LICENSE_API).replace(/\/$/, '');
    try {
      const lic = readStorage(LICENSE_API_KEY);
      if (lic && lic.trim()) return lic.trim().replace(/\/$/, '');
    } catch { /* ignore */ }
    try {
      const base = readStorage(SERVER_BASE_KEY);
      if (base && base.trim()) {
        const b = base.trim().replace(/\/$/, '');
        return /\/api\/license$/i.test(b) ? b : `${b}/api/license`;
      }
    } catch { /* ignore */ }
    try {
      const meta = document.querySelector('meta[name="license-api"]');
      if (meta && meta.content && meta.content.trim()) {
        return String(meta.content).trim().replace(/\/$/, '');
      }
    } catch { /* ignore */ }
    /* Same-origin /api/license only on ChEng AIO (license routes live there).
       Voyage/Tank hosts proxy /api to sync — forcing a license server URL. */
    try {
      if (productSku() === 'cheng-aio'
          && typeof location !== 'undefined' && /^https?:$/i.test(location.protocol || '')) {
        const host = location.hostname || '';
        if (host && host !== 'localhost' && host !== '127.0.0.1') {
          return '/api/license';
        }
      }
    } catch { /* ignore */ }
    return '';
  }

  function isBundledClient() {
    try {
      if (global.ChengProBundled && ChengProBundled.isBundledClient()) return true;
    } catch { /* ignore */ }
    try {
      if (!/^https?:$/i.test(location.protocol || '')) return true;
      const host = location.hostname || '';
      return host === 'localhost' || host === '127.0.0.1';
    } catch {
      return false;
    }
  }

  function setLicenseServerUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) {
      writeStorage(LICENSE_API_KEY, null);
      writeStorage(SERVER_BASE_KEY, null);
      try { delete global.CHENG_LICENSE_API; } catch { /* ignore */ }
      return '';
    }
    let base = raw.replace(/\/$/, '');
    if (/\/api\/license$/i.test(base)) {
      base = base.replace(/\/api\/license$/i, '');
    }
    if (!/^https?:\/\//i.test(base)) {
      throw new Error('Server URL must start with http:// or https://');
    }
    writeStorage(SERVER_BASE_KEY, base);
    writeStorage(LICENSE_API_KEY, null);
    const api = `${base}/api/license`;
    try { global.CHENG_LICENSE_API = api; } catch { /* ignore */ }
    return api;
  }

  function getLicenseServerUrl() {
    try {
      const base = readStorage(SERVER_BASE_KEY);
      if (base && base.trim()) return base.trim().replace(/\/$/, '');
    } catch { /* ignore */ }
    const api = apiBase();
    if (api && /^https?:\/\//i.test(api)) {
      return api.replace(/\/api\/license\/?$/i, '');
    }
    return '';
  }

  function requireApiBase() {
    const base = apiBase();
    if (base) return base;
    throw new Error(
      'License server URL is not set. Enter your ChEng AIO / license host (e.g. http://192.168.x.x:8080 or https://your-domain), then Activate.'
    );
  }

  function isEmbeddedInAio() {
    try {
      if (global.ChengPro || global.ChengProShell) return true;
      if (global.parent && global.parent !== global
        && (global.parent.ChengPro || global.parent.ChengProShell)) return true;
      if (/[?&]chengaio=1\b/.test(location.search)) return true;
      if (localStorage.getItem('chengAioEmbedded') === '1') return true;
    } catch { /* ignore */ }
    return false;
  }

  function deviceId() {
    try {
      let id = readStorage(DEVICE_KEY);
      if (id) return id;
      id = 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      writeStorage(DEVICE_KEY, id);
      return id;
    } catch {
      return 'dev-ephemeral';
    }
  }

  function detectSeat() {
    const ua = navigator.userAgent || '';
    if (/Android|iPhone|iPad/i.test(ua)) return 'android';
    return 'windows';
  }

  function loadEntitlement() {
    try {
      const raw = readStorage(STORAGE_KEY) || readStorage(STORAGE_FALLBACK_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveEntitlement(ent) {
    try {
      if (ent) {
        const payload = JSON.stringify(ent);
        if (!writeStorage(STORAGE_KEY, payload)) {
          throw new Error('Could not save license on this device — allow site storage (not private/incognito).');
        }
        writeStorage(STORAGE_FALLBACK_KEY, payload);
        return true;
      }
      writeStorage(STORAGE_KEY, null);
      writeStorage(STORAGE_FALLBACK_KEY, null);
      return true;
    } catch (e) {
      if (e && e.message && e.message.includes('Could not save')) throw e;
      throw new Error('Could not save license on this device — allow site storage (not private/incognito).');
    }
  }

  function notifyLicenseChanged() {
    try {
      global.dispatchEvent(new CustomEvent('chengpro:license-changed'));
    } catch { /* ignore */ }
  }

  function isMaster(ent) {
    const e = ent || loadEntitlement();
    if (!e) return false;
    if (e.master === true) return true;
    if (e.sku === 'cheng-admin') return true;
    return Array.isArray(e.addons) && e.addons.includes('master');
  }

  function licenseEmail(ent) {
    const e = ent || loadEntitlement();
    return (e && e.email) ? String(e.email).trim().toLowerCase() : '';
  }

  function authHeaders(ent) {
    const e = ent || loadEntitlement();
    const headers = {};
    const email = licenseEmail(e);
    if (email) headers['X-License-Email'] = email;
    if (isMaster(e)) headers['X-License-Master'] = '1';
    if (e && e.sig) {
      try {
        headers['X-License-Entitlement'] = btoa(unescape(encodeURIComponent(JSON.stringify(e))));
      } catch { /* ignore */ }
    }
    return headers;
  }

  function skuAllowed(ent) {
    if (!ent || !ent.sku) return true;
    /* Master admin unlocks every product. */
    if (isMaster(ent)) return true;
    const want = productSku();
    /* ChEng AIO key unlocks every product. */
    if (ent.sku === 'cheng-aio') return true;
    /* AIO shell also accepts standalone Voyage/Tank keys (modules limited). */
    if (want === 'cheng-aio') {
      return ent.sku === 'voyage-chief' || ent.sku === 'tank-chief';
    }
    /* Standalone app: own SKU only (AIO / master already accepted above). */
    return ent.sku === want;
  }

  /** Program add-ons resolved for an entitlement (AIO selects voyage/tank/eorb). */
  /**
   * Programs on a key. Beside the two suites and e-ORB, the two planning
   * screens are sold separately: 'consumption-plan' is the voyage fuel
   * consumption calculation (Consumption Plan / Tank Chief's Bunker
   * Consumption) and 'bunker-plan' is the bunkering fill sequence and
   * monitoring sheet.
   *
   * Keys issued before those two existed carry no add-on list at all, and
   * losing a screen after a renewal check would read as the program breaking.
   * So an empty list still means everything that key's SKU covers; a list the
   * office actually filled in is taken literally.
   */
  const PLAN_PROGRAMS = ['consumption-plan', 'bunker-plan'];

  function resolveProgramAddons(sku, addons) {
    const ads = Array.isArray(addons) ? addons.map((a) => String(a).toLowerCase()) : [];
    if (sku === 'cheng-admin' || ads.includes('master')) {
      return ['voyage-chief', 'tank-chief', 'eorb', ...PLAN_PROGRAMS, 'master'];
    }
    if (sku === 'cheng-aio') {
      /* Empty + not yet migrated client-side: treat as full suite for old keys. */
      if (ads.length === 0) return ['voyage-chief', 'tank-chief', 'eorb', ...PLAN_PROGRAMS];
      return ads;
    }
    if (sku === 'voyage-chief') {
      const out = ['voyage-chief'];
      if (ads.length === 0) return [...out, 'consumption-plan'];
      if (ads.includes('eorb')) out.push('eorb');
      if (ads.includes('consumption-plan')) out.push('consumption-plan');
      if (ads.includes('master')) out.push('master');
      return out;
    }
    if (sku === 'tank-chief') {
      const out = ['tank-chief'];
      if (ads.length === 0) return [...out, ...PLAN_PROGRAMS];
      if (ads.includes('consumption-plan')) out.push('consumption-plan');
      if (ads.includes('bunker-plan')) out.push('bunker-plan');
      if (ads.includes('master')) out.push('master');
      return out;
    }
    return ads;
  }

  /** Modules unlocked for an entitlement (AIO nav + home buttons). */
  function modulesForSku(sku, addons) {
    const ads = resolveProgramAddons(sku, addons);
    if (sku === 'cheng-admin' || ads.includes('master')) {
      return ['home', 'voyage', 'tanks', 'performance', 'eorb', 'bunkerplan', 'bunkeringplan',
        'vessel', 'license', 'about'];
    }
    if (sku === 'cheng-aio') {
      const mods = ['home', 'performance', 'vessel', 'license', 'about'];
      if (ads.includes('voyage-chief')) mods.push('voyage');
      if (ads.includes('tank-chief')) mods.push('tanks');
      if (ads.includes('eorb')) mods.push('eorb');
      if (ads.includes('consumption-plan')) mods.push('bunkerplan');
      if (ads.includes('bunker-plan')) mods.push('bunkeringplan');
      return mods;
    }
    if (sku === 'voyage-chief') {
      const mods = ['home', 'voyage', 'performance', 'vessel', 'license', 'about'];
      if (ads.includes('eorb')) mods.push('eorb');
      if (ads.includes('consumption-plan')) mods.push('bunkerplan');
      return mods;
    }
    if (sku === 'tank-chief') {
      const mods = ['home', 'tanks', 'vessel', 'license', 'about'];
      if (ads.includes('consumption-plan')) mods.push('bunkerplan');
      if (ads.includes('bunker-plan')) mods.push('bunkeringplan');
      return mods;
    }
    return ['home', 'license', 'about'];
  }

  function modulesAllowed(ent) {
    const e = ent || loadEntitlement();
    if (!isValid(e)) return ['license'];
    return modulesForSku(e.sku, e.addons);
  }

  function moduleAllowed(moduleId, ent) {
    if (moduleId === 'license' || moduleId === 'home' || moduleId === 'about') return true;
    return modulesAllowed(ent).includes(moduleId);
  }

  /** Consumption Plan — the voyage fuel calculation, on Voyage and Tank keys alike. */
  function consumptionPlanLicensed(ent) {
    return moduleAllowed('bunkerplan', ent);
  }

  /** Bunkering Plan — the fill sequence / monitoring sheet, a Tank Chief screen. */
  function bunkerPlanLicensed(ent) {
    return moduleAllowed('bunkeringplan', ent);
  }

  function hasAddon(name, ent) {
    const e = ent || loadEntitlement();
    if (!e || !isValid(e)) return false;
    return resolveProgramAddons(e.sku, e.addons).includes(String(name || '').toLowerCase());
  }

  /** e-ORB: master, AIO with eorb add-on, or Voyage key with eorb add-on. */
  function eorbLicensed(ent) {
    const e = ent || loadEntitlement();
    if (!isValid(e)) return false;
    if (e.sku === 'eorb') return true;
    return hasAddon('eorb', e);
  }

  function isValid(ent) {
    if (!ent || !ent.graceUntil) return false;
    if (!skuAllowed(ent)) return false;
    if (ent.expiresAt && ent.expiresAt < new Date().toISOString()) return false;
    return ent.graceUntil >= new Date().toISOString();
  }

  function daysLeft(ent) {
    if (!ent || !ent.graceUntil) return 0;
    const ms = new Date(ent.graceUntil).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86400000));
  }

  async function post(path, body) {
    const base = requireApiBase();
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      const err = new Error((data && data.error) || res.statusText || 'License request failed');
      err.status = res.status;
      err.code = data && data.code;
      throw err;
    }
    if (!data || typeof data !== 'object') {
      throw new Error(
        'License server returned a non-JSON response. Check the Server URL (should be your ChEng AIO host, e.g. http://192.168.x.x:8080).'
      );
    }
    return data;
  }

  async function fetchStatus() {
    const base = apiBase();
    if (!base) return null;
    try {
      const res = await fetch(base + '/status');
      const data = await res.json().catch(() => ({}));
      if (typeof data.enforce === 'boolean') {
        try { localStorage.setItem(ENFORCE_CACHE_KEY, data.enforce ? '1' : '0'); } catch { /* ignore */ }
      }
      return data;
    } catch {
      return null;
    }
  }

  function enforceEnabled() {
    try {
      const cached = localStorage.getItem(ENFORCE_CACHE_KEY);
      if (cached === '1') return true;
      if (cached === '0') {
        /* Standalone Voyage/Tank must always activate — soft cache is ignored. */
        const sku = productSku();
        if (sku === 'voyage-chief' || sku === 'tank-chief') return true;
        return false;
      }
    } catch { /* ignore */ }
    /* Standalone Voyage/Tank: hard gate even before a license host answers. */
    const sku = productSku();
    if (sku === 'voyage-chief' || sku === 'tank-chief') return true;
    /* ChEng AIO: soft until /status answers once (then cache). */
    return false;
  }

  async function activate({ licenseKey, email, seat }) {
    const data = await post('/activate', {
      licenseKey,
      email,
      seat: seat || detectSeat(),
      deviceId: deviceId(),
      deviceLabel: (navigator.userAgent || '').slice(0, 120),
    });
    const ent = data && data.entitlement;
    if (!ent || !ent.graceUntil) {
      throw new Error('Activation succeeded but the server did not return a valid license — retry or update ChEng AIO.');
    }
    if (!skuAllowed(ent)) {
      saveEntitlement(null);
      throw new Error('This key is for ' + ent.sku + ', not ' + productSku());
    }
    saveEntitlement(ent);
    if (!isValid(loadEntitlement())) {
      throw new Error('License could not be stored on this device — allow site storage and try again.');
    }
    hideLock();
    notifyLicenseChanged();
    return loadEntitlement();
  }

  async function heartbeat() {
    const ent = loadEntitlement();
    if (!ent) throw new Error('No license on this device');
    const data = await post('/heartbeat', {
      licenseId: ent.licenseId,
      seat: ent.deviceSeat || detectSeat(),
      deviceId: deviceId(),
      entitlement: ent,
    });
    saveEntitlement(data.entitlement);
    notifyLicenseChanged();
    return loadEntitlement();
  }

  async function pairStart({ licenseKey, email }) {
    return post('/pair/start', {
      licenseKey,
      email,
      deviceId: deviceId(),
    });
  }

  async function pairComplete({ code }) {
    const data = await post('/pair/complete', {
      code,
      deviceId: deviceId(),
      deviceLabel: (navigator.userAgent || '').slice(0, 120),
    });
    const ent = data && data.entitlement;
    if (!ent || !ent.graceUntil) {
      throw new Error('Pairing succeeded but no license was returned — try again.');
    }
    saveEntitlement(ent);
    hideLock();
    notifyLicenseChanged();
    return loadEntitlement();
  }

  async function requestTransfer({ licenseKey, email, seat, reason }) {
    return post('/transfer', {
      licenseKey,
      email,
      seat: seat || detectSeat(),
      reason,
    });
  }

  function hideLock() {
    const el = document.getElementById('chengLicenseLock');
    if (el) el.remove();
  }

  function showLock(reason) {
    hideLock();
    const placeholder = KEY_PLACEHOLDER_BY_SKU[productSku()] || 'CA-XXXXXXXX-XXXXXXXX';
    const savedServer = getLicenseServerUrl();
    const el = document.createElement('div');
    el.id = 'chengLicenseLock';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:100000',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:16px', 'background:rgba(8,14,24,.92)', 'backdrop-filter:blur(3px)',
      'overflow:auto',
    ].join(';');
    el.innerHTML = `
      <div style="width:min(440px,100%);background:#122238;color:#e9e4d6;border:1px solid rgba(233,228,214,.24);
        border-radius:14px;padding:22px;box-shadow:0 18px 60px rgba(0,0,0,.55);font-family:Segoe UI,Helvetica Neue,sans-serif;margin:auto">
        <h2 style="margin:0 0 6px;font-size:1.15rem">${escapeHtml(productName())} — activation required</h2>
        <p style="margin:0 0 14px;color:#a9a292;font-size:.9rem;line-height:1.45">
          ${reason === 'grace_expired'
            ? 'Offline grace ended. Connect once to refresh, or enter your license key.'
            : 'Enter the license server URL (ChEng AIO host), then the email and key from your office. Local data stays on this device.'}
        </p>
        <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#a9a292;margin-bottom:4px">License server URL</label>
        <input id="licLockServer" type="url" style="width:100%;margin-bottom:10px;padding:9px 10px;border-radius:8px;
          border:1px solid rgba(233,228,214,.28);background:#0a1420;color:#e9e4d6"
          placeholder="http://192.168.x.x:8080 or https://your-aio-host"
          value="${escapeHtml(savedServer)}">
        <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#a9a292;margin-bottom:4px">Email</label>
        <input id="licLockEmail" type="email" style="width:100%;margin-bottom:10px;padding:9px 10px;border-radius:8px;
          border:1px solid rgba(233,228,214,.28);background:#0a1420;color:#e9e4d6">
        <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#a9a292;margin-bottom:4px">License key</label>
        <input id="licLockKey" style="width:100%;margin-bottom:12px;padding:9px 10px;border-radius:8px;text-transform:uppercase;
          border:1px solid rgba(233,228,214,.28);background:#0a1420;color:#e9e4d6" placeholder="${escapeHtml(placeholder)}">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" id="licLockTest" style="padding:10px 14px;border-radius:8px;border:1px solid rgba(233,228,214,.28);background:transparent;color:#e9e4d6;cursor:pointer">Test server</button>
          <button type="button" id="licLockActivate" style="flex:1;padding:10px 14px;border-radius:8px;border:0;background:#c99a53;color:#0a1420;font-weight:700;cursor:pointer">Activate</button>
        </div>
        <p id="licLockStatus" style="min-height:1.2em;margin:10px 0 0;font-size:.85rem;color:#a9a292"></p>
      </div>`;
    document.body.appendChild(el);

    async function applyServerFromForm() {
      const url = el.querySelector('#licLockServer').value.trim();
      if (!url) {
        throw new Error('Enter the license server URL first (your ChEng AIO host).');
      }
      setLicenseServerUrl(url);
    }

    el.querySelector('#licLockTest').onclick = async () => {
      const st = el.querySelector('#licLockStatus');
      try {
        st.textContent = 'Testing…';
        await applyServerFromForm();
        const data = await fetchStatus();
        if (!data || !data.ok) throw new Error('No response from license server — check URL and network.');
        st.textContent = 'Connected — ready to activate.';
      } catch (e) {
        st.textContent = e.message || 'Connection failed';
      }
    };

    el.querySelector('#licLockActivate').onclick = async () => {
      const st = el.querySelector('#licLockStatus');
      try {
        st.textContent = 'Activating…';
        await applyServerFromForm();
        await activate({
          email: el.querySelector('#licLockEmail').value.trim(),
          licenseKey: el.querySelector('#licLockKey').value.trim(),
        });
        st.textContent = 'Activated.';
        try {
          global.dispatchEvent(new CustomEvent('chengpro:toast', { detail: 'License activated' }));
          global.dispatchEvent(new CustomEvent('chengpro:navigate', { detail: 'license' }));
        } catch { /* ignore */ }
        setTimeout(() => { try { location.reload(); } catch { /* ignore */ } }, 400);
      } catch (e) {
        st.textContent = e.message || 'Activation failed';
      }
    };
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Boot gate. Returns { ok, entitlement, reason, enforced, skipped }.
   * When enforce is on and not licensed, shows lock overlay (hard).
   */
  async function ensureLicensed(opts) {
    const options = opts || {};
    if (isEmbeddedInAio() && productSku() !== 'cheng-aio') {
      return { ok: true, skipped: true, reason: 'embedded_aio' };
    }
    await fetchStatus();
    let enforce = options.enforce != null ? !!options.enforce : enforceEnabled();
    /* Always require activation for standalone Voyage / Tank. */
    if (options.enforce == null) {
      const sku = productSku();
      if (sku === 'voyage-chief' || sku === 'tank-chief') enforce = true;
    }
    const ent = loadEntitlement();
    if (isValid(ent) && skuAllowed(ent)) {
      if (daysLeft(ent) <= 7 && navigator.onLine) {
        try { await heartbeat(); } catch { /* keep cached grace */ }
      }
      hideLock();
      return { ok: true, entitlement: loadEntitlement(), enforced: enforce };
    }
    const reason = ent ? 'grace_expired' : 'missing';
    if (enforce && !options.soft) {
      showLock(reason);
      return { ok: false, entitlement: ent, reason, enforced: true };
    }
    return { ok: false, entitlement: ent, reason, enforced: false };
  }

  global.ChengLicense = {
    apiBase,
    requireApiBase,
    isBundledClient,
    setLicenseServerUrl,
    getLicenseServerUrl,
    deviceId,
    detectSeat,
    loadEntitlement,
    saveEntitlement,
    isValid,
    daysLeft,
    activate,
    heartbeat,
    pairStart,
    pairComplete,
    requestTransfer,
    ensureLicensed,
    fetchStatus,
    enforceEnabled,
    isEmbeddedInAio,
    productSku,
    productName,
    apiBase,
    showLock,
    hideLock,
    skuAllowed,
    modulesForSku,
    resolveProgramAddons,
    modulesAllowed,
    moduleAllowed,
    eorbLicensed,
    consumptionPlanLicensed,
    bunkerPlanLicensed,
    hasAddon,
    isMaster,
    licenseEmail,
    authHeaders,
  };
})(typeof window !== 'undefined' ? window : globalThis);
