/**
 * API client with offline fallback + mutation queue flush when online.
 */
const Api = (() => {
  let online = navigator.onLine;
  const listeners = new Set();

  function setOnline(v) {
    online = v;
    listeners.forEach((fn) => fn(online));
  }
  window.addEventListener('online', () => { setOnline(true); flushQueue(); });
  window.addEventListener('offline', () => setOnline(false));

  function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function isOnline() { return online; }

  async function request(path, opts = {}) {
    const init = {
      method: opts.method || 'GET',
      headers: { ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
      body: opts.body instanceof FormData || typeof opts.body === 'string'
        ? opts.body
        : opts.body != null ? JSON.stringify(opts.body) : undefined,
    };
    try {
      const res = await fetch(path, init);
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!res.ok) throw new Error((data && data.error) || res.statusText || 'Request failed');
      setOnline(true);
      return data;
    } catch (err) {
      if (!navigator.onLine) setOnline(false);
      throw err;
    }
  }

  async function getStatus() {
    try {
      return await request('/api/status');
    } catch {
      const cached = await OfflineDB.idbGet('status');
      if (cached) { setOnline(false); return cached; }
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

  async function mutate(path, opts, offlineApply) {
    if (!navigator.onLine) {
      if (typeof offlineApply === 'function') await offlineApply();
      await OfflineDB.queuePush({ path, opts });
      setOnline(false);
      return { queued: true, offline: true };
    }
    try {
      const result = await request(path, opts);
      return result;
    } catch (err) {
      if (typeof offlineApply === 'function') await offlineApply();
      await OfflineDB.queuePush({ path, opts });
      setOnline(false);
      return { queued: true, offline: true, error: err.message };
    }
  }

  async function flushQueue() {
    if (!navigator.onLine) return { flushed: 0 };
    const items = await OfflineDB.queueAll();
    let flushed = 0;
    for (const item of items) {
      try {
        await request(item.path, item.opts || {});
        await OfflineDB.queueDelete(item.id);
        flushed++;
      } catch (e) {
        console.warn('Queue flush failed', e);
        break;
      }
    }
    if (flushed) setOnline(true);
    return { flushed };
  }

  return {
    request, getStatus, getVessel, mutate, flushQueue, onStatus, isOnline,
    listVessels: () => request('/api/vessels'),
    createVessel: (body) => request('/api/vessels', { method: 'POST', body }),
    setActive: (id) => request('/api/vessels/active', { method: 'POST', body: { id } }),
    updateVessel: (id, body) => request('/api/vessels/' + id, { method: 'PUT', body }),
    deleteVessel: (id) => request('/api/vessels/' + id, { method: 'DELETE' }),
    savePart: (id, part, body) => request(`/api/vessels/${id}/${part}`, { method: 'PUT', body }),
    upsertTank: (id, body) => request(`/api/vessels/${id}/tanks`, { method: 'POST', body }),
    deleteTank: (id, tankId) => request(`/api/vessels/${id}/tanks/${tankId}`, { method: 'DELETE' }),
    saveCalibration: (id, tankId, body) => request(`/api/vessels/${id}/tanks/${tankId}/calibration`, { method: 'PUT', body }),
    calculate: (id, body) => request(`/api/vessels/${id}/calculate`, { method: 'POST', body }),
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
    backup: () => request('/api/backup'),
    syncPull: (syncUrl) => request('/api/sync/pull', { method: 'POST', body: { syncUrl } }),
    syncPush: (syncUrl) => request('/api/sync/push', { method: 'POST', body: { syncUrl } }),
    importCsv: async (vesselId, file) => {
      const fd = new FormData();
      fd.append('file', file);
      return request(`/api/vessels/${vesselId}/tanks/import-csv`, { method: 'POST', body: fd });
    },
    importBackup: async (file, merge = true) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('merge', String(merge));
      return request('/api/backup/import', { method: 'POST', body: fd });
    },
  };
})();

window.Api = Api;
