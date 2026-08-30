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
  const DEVICE_KEY = 'chengAioLicenseDeviceId';
  const ENFORCE_CACHE_KEY = 'chengAioLicenseEnforce';

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
      const meta = document.querySelector('meta[name="license-api"]');
      if (meta && meta.content) return String(meta.content).replace(/\/$/, '');
    } catch { /* ignore */ }
    return '/api/license';
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
      let id = localStorage.getItem(DEVICE_KEY);
      if (id) return id;
      id = 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(DEVICE_KEY, id);
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
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveEntitlement(ent) {
    try {
      if (ent) localStorage.setItem(STORAGE_KEY, JSON.stringify(ent));
      else localStorage.removeItem(STORAGE_KEY);
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
  function resolveProgramAddons(sku, addons) {
    const ads = Array.isArray(addons) ? addons.map((a) => String(a).toLowerCase()) : [];
    if (sku === 'cheng-admin' || ads.includes('master')) {
      return ['voyage-chief', 'tank-chief', 'eorb', 'master'];
    }
    if (sku === 'cheng-aio') {
      /* Empty + not yet migrated client-side: treat as full suite for old keys. */
      if (ads.length === 0) return ['voyage-chief', 'tank-chief', 'eorb'];
      return ads;
    }
    if (sku === 'voyage-chief') {
      const out = ['voyage-chief'];
      if (ads.includes('eorb')) out.push('eorb');
      if (ads.includes('master')) out.push('master');
      return out;
    }
    if (sku === 'tank-chief') {
      const out = ['tank-chief'];
      if (ads.includes('master')) out.push('master');
      return out;
    }
    return ads;
  }

  /** Modules unlocked for an entitlement (AIO nav + home buttons). */
  function modulesForSku(sku, addons) {
    const ads = resolveProgramAddons(sku, addons);
    if (sku === 'cheng-admin' || ads.includes('master')) {
      return ['home', 'voyage', 'tanks', 'performance', 'eorb', 'vessel', 'license'];
    }
    if (sku === 'cheng-aio') {
      const mods = ['home', 'performance', 'vessel', 'license'];
      if (ads.includes('voyage-chief')) mods.push('voyage');
      if (ads.includes('tank-chief')) mods.push('tanks');
      if (ads.includes('eorb')) mods.push('eorb');
      return mods;
    }
    if (sku === 'voyage-chief') {
      const mods = ['home', 'voyage', 'performance', 'vessel', 'license'];
      if (ads.includes('eorb')) mods.push('eorb');
      return mods;
    }
    if (sku === 'tank-chief') {
      return ['home', 'tanks', 'vessel', 'license'];
    }
    return ['home', 'license'];
  }

  function modulesAllowed(ent) {
    const e = ent || loadEntitlement();
    if (!isValid(e)) return ['license'];
    return modulesForSku(e.sku, e.addons);
  }

  function moduleAllowed(moduleId, ent) {
    if (moduleId === 'license') return true;
    if (moduleId === 'home') return true;
    return modulesAllowed(ent).includes(moduleId);
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
    const res = await fetch(apiBase() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || res.statusText);
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
    return data;
  }

  async function fetchStatus() {
    try {
      const res = await fetch(apiBase() + '/status');
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
      if (cached === '0') return false;
      if (cached === '1') return true;
    } catch { /* ignore */ }
    /* Soft until the license host answers once (then cache). Production host defaults enforce on. */
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
    if (data.entitlement && !skuAllowed(data.entitlement)) {
      saveEntitlement(null);
      throw new Error('This key is for ' + data.entitlement.sku + ', not ' + productSku());
    }
    saveEntitlement(data.entitlement);
    hideLock();
    return data.entitlement;
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
    return data.entitlement;
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
    saveEntitlement(data.entitlement);
    hideLock();
    return data.entitlement;
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
    const el = document.createElement('div');
    el.id = 'chengLicenseLock';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:100000',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:16px', 'background:rgba(8,14,24,.92)', 'backdrop-filter:blur(3px)',
    ].join(';');
    el.innerHTML = `
      <div style="width:min(440px,100%);background:#122238;color:#e9e4d6;border:1px solid rgba(233,228,214,.24);
        border-radius:14px;padding:22px;box-shadow:0 18px 60px rgba(0,0,0,.55);font-family:Segoe UI,Helvetica Neue,sans-serif">
        <h2 style="margin:0 0 6px;font-size:1.15rem">${escapeHtml(productName())} — activation required</h2>
        <p style="margin:0 0 14px;color:#a9a292;font-size:.9rem;line-height:1.45">
          ${reason === 'grace_expired'
            ? 'Offline grace ended. Connect once to refresh, or enter your license key.'
            : 'Enter the license key emailed after purchase. Local data stays on this device.'}
        </p>
        <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#a9a292;margin-bottom:4px">Email</label>
        <input id="licLockEmail" type="email" style="width:100%;margin-bottom:10px;padding:9px 10px;border-radius:8px;
          border:1px solid rgba(233,228,214,.28);background:#0a1420;color:#e9e4d6">
        <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#a9a292;margin-bottom:4px">License key</label>
        <input id="licLockKey" style="width:100%;margin-bottom:12px;padding:9px 10px;border-radius:8px;text-transform:uppercase;
          border:1px solid rgba(233,228,214,.28);background:#0a1420;color:#e9e4d6" placeholder="${escapeHtml(placeholder)}">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" id="licLockActivate" style="flex:1;padding:10px 14px;border-radius:8px;border:0;background:#c99a53;color:#0a1420;font-weight:700;cursor:pointer">Activate</button>
        </div>
        <p id="licLockStatus" style="min-height:1.2em;margin:10px 0 0;font-size:.85rem;color:#a9a292"></p>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#licLockActivate').onclick = async () => {
      const st = el.querySelector('#licLockStatus');
      try {
        st.textContent = 'Activating…';
        await activate({
          email: el.querySelector('#licLockEmail').value.trim(),
          licenseKey: el.querySelector('#licLockKey').value.trim(),
        });
        st.textContent = 'Activated.';
        location.reload();
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
    const enforce = options.enforce != null ? !!options.enforce : enforceEnabled();
    const ent = loadEntitlement();
    if (isValid(ent)) {
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
    hasAddon,
    isMaster,
    licenseEmail,
    authHeaders,
  };
})(typeof window !== 'undefined' ? window : globalThis);
