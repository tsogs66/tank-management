/**
 * API client with offline fallback + mutation queue flush when online.
 */
const Api = (() => {
  let online = navigator.onLine;
  let flushing = false;
  const listeners = new Set();

  /* ChEng AIO mounts Tank Chief under /tanks (API at /tanks/api/*).
   * Standalone Tank Chief serves from /. Prefer an explicit prefix; otherwise
   * detect from the page path so the AIO iframe does not hit the shell /api. */
  function detectApiPrefix() {
    if (typeof window.CHENG_PRO_TANKS_PREFIX === 'string') {
      return String(window.CHENG_PRO_TANKS_PREFIX).replace(/\/$/, '');
    }
    const path = location.pathname || '';
    if (path === '/tanks' || path.startsWith('/tanks/')) return '/tanks';
    return '';
  }
  const API_PREFIX = detectApiPrefix();
  function withPrefix(path) {
    if (!path) return path;
    if (API_PREFIX && path.startsWith('/api')) return API_PREFIX + path;
    return path;
  }

  function setOnline(v) {
    online = v;
    listeners.forEach((fn) => fn(online));
  }
  window.addEventListener('online', () => {
    setOnline(true);
    /* Do not flush immediately — wait for operator idle so reconnect
       cannot stall an active sounding / bunkering entry. */
    if (window.Branding && Branding.isPrintHold && Branding.isPrintHold()) {
      Branding.afterPrintHold(() => { requestIdleFlush(); });
      return;
    }
    requestIdleFlush();
  });
  window.addEventListener('offline', () => setOnline(false));

  function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function isOnline() { return online; }

  /* ------------------------------------------------------------ transport --
   *
   * Two ways to reach the API, and which one is in use is a setting rather
   * than a per-request guess.
   *
   *   server   the usual thing: HTTP to whatever served the page.
   *   local    the routes run on this device, over its own database.
   *
   * Falling back from one to the other on a failed request would be worse than
   * useless: the two have separate databases, and a request silently answered
   * by the other one puts today's soundings in a place the user is not looking
   * at. So the choice is explicit, it sticks, and moving records between the
   * two is what Backup / Sync is for.
   *
   * The default is local where there is no server to talk to at all — the
   * phone application, loaded from its own bundle rather than over http.
   */
  const TRANSPORT_KEY = 'apiTransport';
  const servedOverHttp = /^https?:$/.test(location.protocol);
  let transport = (() => {
    try {
      const saved = localStorage.getItem(TRANSPORT_KEY);
      if (saved === 'local' || saved === 'server') return saved;
    } catch { /* private mode: fall through to the default */ }
    return servedOverHttp ? 'server' : 'local';
  })();

  function getTransport() { return transport; }
  function canUseLocal() { return typeof LocalApi !== 'undefined'; }
  function setTransport(mode) {
    if (mode !== 'local' && mode !== 'server') throw new Error(`Unknown transport: ${mode}`);
    if (mode === 'local' && !canUseLocal()) throw new Error('This build has no on-device database');
    transport = mode;
    try { localStorage.setItem(TRANSPORT_KEY, mode); } catch { /* not fatal */ }
    setOnline(mode === 'local' ? true : navigator.onLine);
    return transport;
  }

  /** Answer from the device, in the shape request() hands back. */
  async function localRequest(path, opts = {}) {
    const method = opts.method || 'GET';
    let body = opts.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* leave as text */ } }
    if (body instanceof FormData) {
      const err = new Error('Uploading a file needs the desktop application');
      err.status = 501;
      err.rejected = true;
      throw err;
    }
    const res = await LocalApi.handle(method, path, body);
    if (res.status >= 400) {
      const err = new Error((res.body && res.body.error) || 'Request failed');
      err.status = res.status;
      err.rejected = res.status >= 400 && res.status < 500;
      throw err;
    }
    return res.body;
  }

  async function request(path, opts = {}) {
    if (transport === 'local' && canUseLocal()) return localRequest(path, opts);
    const init = {
      method: opts.method || 'GET',
      headers: {
        ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(typeof ChengLicense !== 'undefined' && ChengLicense.authHeaders ? ChengLicense.authHeaders() : {}),
        ...(opts.headers || {}),
      },
      body: opts.body instanceof FormData || typeof opts.body === 'string'
        ? opts.body
        : opts.body != null ? JSON.stringify(opts.body) : undefined,
    };
    try {
      const res = await fetch(withPrefix(path), init);
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!res.ok) {
        const err = new Error((data && data.error) || res.statusText || 'Request failed');
        err.status = res.status;
        // 4xx is the server saying no; retrying cannot change its mind. 503 is
        // the worker's own offline stand-in, which is not a rejection.
        err.rejected = res.status >= 400 && res.status < 500;
        throw err;
      }
      setOnline(true);
      return data;
    } catch (err) {
      if (!navigator.onLine) setOnline(false);
      throw err;
    }
  }

  async function getStatus() {
    try {
      const st = await request('/api/status');
      try { await OfflineDB.idbSet('status', st); } catch { /* private mode */ }
      return st;
    } catch (err) {
      const cached = await OfflineDB.idbGet('status');
      if (cached) { setOnline(false); return cached; }
      if (transport === 'local' && canUseLocal()) {
        throw new Error(err.message || 'Could not read the on-device database');
      }
      throw new Error('Offline and no cached status');
    }
  }

  async function getVessel(id) {
    try {
      const bundle = await request('/api/vessels/' + id);
      await OfflineDB.idbSet('vessel:' + id, bundle);
      const status = await request('/api/status');
      await OfflineDB.idbSet('status', status);
      return bundle;
    } catch (err) {
      const cached = await OfflineDB.idbGet('vessel:' + id);
      if (cached) { setOnline(false); return cached; }
      throw err;
    }
  }

  /**
   * Import a backup JSON file on the device (LocalApi has no multipart upload).
   */
  async function importBackupLocal(file, merge, onProgress) {
    if (onProgress) onProgress(null, 'reading');
    const text = await file.text();
    let backup;
    try {
      backup = JSON.parse(text);
    } catch {
      throw new Error('Backup file is not valid JSON');
    }
    if (onProgress) {
      onProgress(100, 'uploading');
      onProgress(null, 'processing');
    }
    const result = await localRequest('/api/backup/import', {
      method: 'POST',
      body: { backup, merge: String(merge) },
    });
    try {
      const st = await localRequest('/api/status', { method: 'GET' });
      await OfflineDB.idbSet('status', st);
    } catch { /* import succeeded; UI will retry status */ }
    return result;
  }

  /**
   * Upload a FormData with real progress. fetch() cannot report how much of a
   * body has gone out, so this one call uses XMLHttpRequest: a capacity book is
   * tens of megabytes over a ship's link and the bar has to mean something.
   *
   * onProgress(pct|null, phase) — pct is null once the body is sent and we are
   * waiting on the server, which is not measurable from here.
   */
  function upload(path, formData, onProgress) {
    if (transport === 'local' && canUseLocal() && path === '/api/backup/import') {
      const file = formData.get('file');
      const merge = formData.get('merge') !== 'false';
      if (!file) return Promise.reject(new Error('Choose a backup file'));
      return importBackupLocal(file, merge, onProgress);
    }
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', withPrefix(path));
      try {
        if (typeof ChengLicense !== 'undefined' && ChengLicense.authHeaders) {
          const headers = ChengLicense.authHeaders();
          Object.keys(headers).forEach((k) => xhr.setRequestHeader(k, headers[k]));
        }
      } catch { /* ignore */ }
      xhr.upload.onprogress = (e) => {
        if (!onProgress) return;
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100), 'uploading');
        else onProgress(null, 'uploading');
      };
      xhr.upload.onload = () => { if (onProgress) onProgress(null, 'processing'); };
      xhr.onload = () => {
        let data = null;
        try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { data = xhr.responseText; }
        if (xhr.status >= 200 && xhr.status < 300) {
          setOnline(true);
          resolve(data);
        } else {
          reject(new Error((data && data.error) || xhr.statusText || 'Upload failed'));
        }
      };
      xhr.onerror = () => {
        if (!navigator.onLine) setOnline(false);
        reject(new Error('Network error during upload'));
      };
      xhr.onabort = () => reject(new Error('Upload cancelled'));
      xhr.send(formData);
    });
  }

  /**
   * Download a JSON API response with byte progress when the server sends a
   * Content-Length (backups can be large once every vessel is included).
   * onProgress(pct|null, phase).
   */
  function download(path, onProgress) {
    if (transport === 'local' && canUseLocal()) {
      if (onProgress) onProgress(null, 'reading');
      return localRequest(path, { method: 'GET' });
    }
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', withPrefix(path));
      xhr.responseType = 'text';
      xhr.onprogress = (e) => {
        if (!onProgress) return;
        if (e.lengthComputable && e.total > 0) {
          onProgress(Math.round((e.loaded / e.total) * 100), 'downloading');
        } else {
          onProgress(null, 'downloading');
        }
      };
      xhr.onload = () => {
        let data = null;
        try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { data = xhr.responseText; }
        if (xhr.status >= 200 && xhr.status < 300) {
          setOnline(true);
          resolve(data);
        } else {
          reject(new Error((data && data.error) || xhr.statusText || 'Download failed'));
        }
      };
      xhr.onerror = () => {
        if (!navigator.onLine) setOnline(false);
        reject(new Error('Network error during download'));
      };
      xhr.onabort = () => reject(new Error('Download cancelled'));
      if (onProgress) onProgress(null, 'starting');
      xhr.send();
    });
  }

  /* Server writes are queued and flushed only after the UI has been idle,
     so a slow sync cannot freeze soundings / bunkering mid-entry. Local
     transport still writes immediately (no network). Manual Flush / Push
     still call flushQueue() directly. */
  let idleFlushHandler = null;
  function onIdleFlushRequest(fn) { idleFlushHandler = fn; }
  function requestIdleFlush() {
    if (typeof idleFlushHandler === 'function') idleFlushHandler();
  }

  async function queueWrite(path, opts) {
    if (transport === 'local' && canUseLocal()) return request(path, opts);
    await OfflineDB.queuePush({ path, opts });
    requestIdleFlush();
    return { queued: true, deferred: true };
  }

  async function mutate(path, opts, offlineApply) {
    // On the device there is nothing to be offline from: the write has already
    // landed in the only database there is, so it must not also be queued for
    // some server to replay later.
    if (transport === 'local' && canUseLocal()) return request(path, opts);
    if (typeof offlineApply === 'function') await offlineApply();
    /* Always queue for server transport — idle loop delivers the PUT. */
    await OfflineDB.queuePush({ path, opts });
    if (!navigator.onLine) setOnline(false);
    requestIdleFlush();
    return { queued: true, deferred: true, offline: !navigator.onLine };
  }

  /**
   * Send everything that was written while the server was out of reach.
   *
   * Order is kept, because a later edit of the same part has to land after the
   * earlier one. But a single item is not allowed to wedge the queue forever:
   * a request the server actively rejects (a 4xx — malformed, or about a vessel
   * that no longer exists) will never succeed no matter how often it is tried,
   * so it is dropped and reported rather than retried until the end of time.
   * Anything that merely could not be delivered — no server, a 5xx — stops the
   * run and is tried again on the next one, still in order.
   */
  async function flushQueue(onProgress) {
    if (window.Branding && Branding.isPrintHold && Branding.isPrintHold()) {
      return { flushed: 0, pending: -1, held: true };
    }
    if (transport === 'local') return { flushed: 0, pending: 0, dropped: 0 };
    if (flushing) return { flushed: 0, busy: true };
    flushing = true;
    try {
      const items = await OfflineDB.queueAll();
      if (!items.length) return { flushed: 0, dropped: 0, pending: 0 };
      const total = items.length;
      let flushed = 0;
      let dropped = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (typeof onProgress === 'function') {
          onProgress({
            index: i + 1,
            total,
            path: item.path,
            pct: Math.round((i / total) * 100),
            message: `Sending change ${i + 1} of ${total}…`,
          });
        }
        try {
          await request(item.path, item.opts || {});
          await OfflineDB.queueDelete(item.id);
          flushed += 1;
        } catch (err) {
          if (err && err.rejected) {
            console.warn('Dropping a queued change the server rejected', item.path, err.message);
            await OfflineDB.queueDelete(item.id);
            dropped += 1;
            continue;
          }
          break; // undeliverable — keep it, and everything after it, in order
        }
      }
      const pending = (await OfflineDB.queueAll()).length;
      if (flushed) setOnline(true);
      if (flushed && typeof onFlushed === 'function') await onFlushed({ flushed, dropped, pending });
      return { flushed, dropped, pending };
    } finally {
      flushing = false;
    }
  }

  /** Is the server itself reachable? Being on a network says nothing about it. */
  async function reachable() {
    if (transport === 'local' && canUseLocal()) { setOnline(true); return true; }
    try {
      const res = await fetch(withPrefix('/api/health'), { cache: 'no-store' });
      const ok = res.ok;
      setOnline(ok);
      return ok;
    } catch {
      setOnline(false);
      return false;
    }
  }

  /** Called after a flush actually delivered something, so the app can re-pull. */
  let onFlushed = null;
  function afterFlush(fn) { onFlushed = fn; }

  return {
    request, upload, download, getStatus, getVessel, mutate, queueWrite, flushQueue, onStatus, isOnline,
    reachable, afterFlush, onIdleFlushRequest, requestIdleFlush, getTransport, setTransport, canUseLocal, withPrefix, apiPrefix: API_PREFIX,
    listVessels: () => request('/api/vessels'),
    createVessel: (body) => request('/api/vessels', { method: 'POST', body }),
    setActive: (id) => request('/api/vessels/active', { method: 'POST', body: { id } }),
    updateVessel: (id, body) => request('/api/vessels/' + id, { method: 'PUT', body }),
    deleteVessel: (id) => request('/api/vessels/' + id, { method: 'DELETE' }),
    savePart: (id, part, body) => queueWrite(`/api/vessels/${id}/${part}`, { method: 'PUT', body }),
    upsertTank: (id, body) => request(`/api/vessels/${id}/tanks`, { method: 'POST', body }),
    deleteTank: (id, tankId) => request(`/api/vessels/${id}/tanks/${tankId}`, { method: 'DELETE' }),
    saveCalibration: (id, tankId, body) => request(`/api/vessels/${id}/tanks/${tankId}/calibration`, { method: 'PUT', body }),
    calculate: (id, body) => request(`/api/vessels/${id}/calculate`, { method: 'POST', body }),
    getFuelReport: (id) => request(`/api/vessels/${id}/fuel-report`),
    bunkeringChain: (id) => request(`/api/vessels/${id}/bunkering-chain`),
    saveBunkerPlan: (id, body) => queueWrite(`/api/vessels/${id}/bunker-plan`, { method: 'PUT', body }),
    saveBunkerAfter: (id, body) => queueWrite(`/api/vessels/${id}/bunker-after`, { method: 'PUT', body }),
    bunkerAfterGetData: (id, body) =>
      request(`/api/vessels/${id}/bunker-after/get-data`, { method: 'POST', body }),
    saveBunkerSummary: (id, body) => queueWrite(`/api/vessels/${id}/bunker-summary`, { method: 'PUT', body }),
    saveFuelReport: (id, body) => queueWrite(`/api/vessels/${id}/fuel-report`, { method: 'PUT', body }),
    deleteFuelReportSnapshot: (id, snapshotId) =>
      request(`/api/vessels/${id}/fuel-report/history/${snapshotId}`, { method: 'DELETE' }),
    bunkerDistribute: (id, body) => request(`/api/vessels/${id}/bunker-distribute`, { method: 'POST', body }),
    bunkerStart: (id, body) => request(`/api/vessels/${id}/bunker-ops/start`, { method: 'POST', body }),
    bunkerActive: (id) => request(`/api/vessels/${id}/bunker-ops/active`),
    bunkerUpdate: (id, opId, body) => request(`/api/vessels/${id}/bunker-ops/${opId}`, { method: 'PATCH', body }),
    bunkerComplete: (id, opId, body) => request(`/api/vessels/${id}/bunker-ops/${opId}/complete`, { method: 'POST', body }),
    bunkerCancel: (id, opId) => request(`/api/vessels/${id}/bunker-ops/${opId}/cancel`, { method: 'POST', body: {} }),
    bunkerBlend: (id, body) => request(`/api/vessels/${id}/bunker-blend`, { method: 'POST', body }),
    convertDensity: (body) => request('/api/reference/convert-density', { method: 'POST', body }),
    vcfWcfCalc: (body) => request('/api/reference/vcf-wcf', { method: 'POST', body }),
    vcfWcfTables: (q = '') => request('/api/reference/vcf-wcf-tables' + (q ? '?' + q : '')),
    iso8217: () => request('/api/reference/iso8217'),
    getSettings: () => request('/api/settings'),
    saveSettings: (body) => request('/api/settings', { method: 'PUT', body }),
    backup: (onProgress) => download('/api/backup', onProgress),
    syncPull: (syncUrl, syncApiToken) => request('/api/sync/pull', {
      method: 'POST',
      body: { syncUrl, syncApiToken },
    }),
    syncPush: (syncUrl, syncApiToken) => request('/api/sync/push', {
      method: 'POST',
      body: { syncUrl, syncApiToken },
    }),
    syncProbe: (syncUrl, syncApiToken) => request('/api/sync/probe', {
      method: 'POST',
      body: { syncUrl, syncApiToken },
    }),
    importCsv: async (vesselId, file) => {
      const fd = new FormData();
      fd.append('file', file);
      return request(`/api/vessels/${vesselId}/tanks/import-csv`, { method: 'POST', body: fd });
    },
    importBackup: async (file, merge = true, onProgress) => {
      if (transport === 'local' && canUseLocal()) {
        return importBackupLocal(file, merge, onProgress);
      }
      const fd = new FormData();
      fd.append('file', file);
      fd.append('merge', String(merge));
      if (typeof onProgress === 'function') {
        return upload('/api/backup/import', fd, onProgress);
      }
      return request('/api/backup/import', { method: 'POST', body: fd });
    },
  };
})();

window.Api = Api;
