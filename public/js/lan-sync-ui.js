/**
 * Settings panel for live sync with another device on the same Wi-Fi or hotspot.
 * The work is done by the server's /api/lan routes (server/lan-sync.js); this only
 * shows what they report and sends the user's choices.
 */
(function () {
  'use strict';

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const STATUS = {
    connected: ['ok', 'Connected'],
    offline: ['warn', 'Not reachable'],
    unpaired: ['bad', 'Pair again'],
    'different-vessel': ['warn', 'Different vessel'],
    error: ['bad', 'Problem'],
    unknown: ['dim', 'Checking…'],
  };

  function mount(parent, ctx) {
    const toast = (ctx && ctx.toast) || (() => {});
    const host = document.createElement('div');
    host.className = 'form-panel';
    host.id = 'lan-sync-panel';
    parent.appendChild(host);
    let timer = null;
    let state = null;
    let busy = false;

    const api = () => window.Api;

    async function refresh() {
      try { state = await api().lanState(); } catch (e) { state = null; }
      if (!document.body.contains(host)) { clearInterval(timer); return; }
      draw();
    }

    function peerRow(p) {
      const [tone, label] = STATUS[p.status] || STATUS.unknown;
      const d = p.differences || {};
      const miss = [];
      (d.missingOnPeer || []).forEach((v) => miss.push(`<div class="lan-miss">${esc(p.name)} does not have <b>${esc(v.name)}</b>
        <button class="btn" data-copy="push" data-dev="${esc(p.deviceId)}" data-vessel="${esc(v.id)}">Copy to ${esc(p.name)}</button></div>`));
      (d.missingHere || []).forEach((v) => miss.push(`<div class="lan-miss">This device does not have <b>${esc(v.name)}</b>
        <button class="btn" data-copy="pull" data-dev="${esc(p.deviceId)}" data-vessel="${esc(v.id)}">Copy here</button></div>`));
      const last = p.lastSync ? `Last sync ${new Date(p.lastSync.at).toLocaleTimeString()} — received ${p.lastSync.pulled}, sent ${p.lastSync.pushed}` : '';
      return `<div class="lan-peer" style="border:1px solid var(--border,#445);border-radius:6px;padding:8px 10px;margin:6px 0">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <b>${esc(p.name)}</b>
          <span class="lan-badge lan-${tone}" style="font-size:12px;padding:1px 8px;border-radius:10px;background:var(--${tone === 'ok' ? 'ok' : tone === 'bad' ? 'danger' : 'warn'},#555);color:#fff">${esc(label)}</span>
          <span style="color:var(--text-faint);font-size:12px">${esc(p.url)}</span>
          <button class="btn" data-forget="${esc(p.deviceId)}" style="margin-left:auto">Forget</button>
        </div>
        <div style="font-size:12px;color:var(--text-dim);margin-top:4px">${esc(p.message || '')}${last ? ' · ' + esc(last) : ''}</div>
        ${miss.join('')}
      </div>`;
    }

    function draw() {
      const s = state;
      if (!s) { host.innerHTML = '<div class="section-title" style="margin-top:0">Live sync (Wi-Fi / hotspot)</div><p style="color:var(--text-faint)">Not available here.</p>'; return; }
      const pair = s.pairing
        ? `<div style="font-size:26px;letter-spacing:6px;font-weight:700;margin:6px 0">${esc(s.pairing.code)}</div>
           <div style="font-size:12px;color:var(--text-dim)">Type this code on the other device. It works once, for five minutes.${s.address ? ' This device is at <code>' + esc(s.address) + '</code>.' : ''}</div>`
        : '';
      const found = (s.discovered || []).map((d) => `<div style="display:flex;gap:8px;align-items:center;margin:4px 0">
          <span><b>${esc(d.name)}</b> <span style="color:var(--text-faint);font-size:12px">${esc(d.url)}</span></span>
          <input data-code-for="${esc(d.url)}" placeholder="code" inputmode="numeric" maxlength="6" style="width:90px">
          <button class="btn primary" data-pair="${esc(d.url)}">Pair</button></div>`).join('');
      host.innerHTML = `
        <div class="section-title" style="margin-top:0">Live sync (Wi-Fi / hotspot)</div>
        <p style="color:var(--text-dim);font-size:13px;margin:0 0 8px">Keep this device level with another one on the same Wi-Fi or phone hotspot. Whatever one lacks, the other has is copied across; the newest copy of a record wins, and nothing is deleted.</p>
        <label style="display:block;margin:6px 0"><input type="checkbox" id="lan-enabled" ${s.enabled ? 'checked' : ''}> Sync automatically while both devices are open</label>
        <div class="form-row"><label>This device is called</label><input id="lan-name" value="${esc(s.deviceName)}"></div>
        <div style="margin:6px 0;font-size:13px">
          <label style="display:block"><input type="radio" name="lan-scope" value="active" ${s.scope === 'active' ? 'checked' : ''}> Only the vessel both devices have open</label>
          <label style="display:block"><input type="radio" name="lan-scope" value="all" ${s.scope === 'all' ? 'checked' : ''}> The whole database — a vessel one device is missing is copied to it</label>
        </div>
        <div class="btn-row">
          <button class="btn" id="lan-show-code">Show pairing code</button>
          <button class="btn" id="lan-scan">Find devices</button>
          <button class="btn primary" id="lan-now">Sync now</button>
        </div>
        ${pair}
        <div id="lan-found" style="margin-top:8px">${found}</div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <input id="lan-url" placeholder="or type its address: http://192.168.43.1:3080" style="flex:1;min-width:200px">
          <input id="lan-code" placeholder="code" inputmode="numeric" maxlength="6" style="width:90px">
          <button class="btn" id="lan-pair-url">Pair</button>
        </div>
        <div id="lan-peers" style="margin-top:10px">${(s.peers || []).map(peerRow).join('') || '<div style="color:var(--text-faint);font-size:13px">No device paired yet. On one device press “Show pairing code”; on the other press “Find devices” and type the code.</div>'}</div>
        ${(s.events || []).length ? `<div style="margin-top:8px;font-size:12px;color:var(--text-faint)">${s.events.slice(0, 4).map((e) => esc(new Date(e.at).toLocaleTimeString() + ' ' + e.text)).join('<br>')}</div>` : ''}
        <div class="hint" style="margin-top:8px;color:var(--text-faint);font-size:12px">Both devices must have the same vessel open for the vessel to sync. A phone always makes the connection; two PCs can each find the other. Bluetooth is not used.</div>`;
      wire();
    }

    function wire() {
      const q = (sel) => host.querySelector(sel);
      const act = async (fn, okMsg) => {
        if (busy) return;
        busy = true;
        try { const r = await fn(); if (r && r.peers) state = r; if (okMsg) toast(okMsg); } catch (e) { toast((e && e.message) || 'Failed'); } finally { busy = false; refresh(); }
      };
      q('#lan-enabled').onchange = (e) => act(() => api().lanConfig({ enabled: e.target.checked, deviceName: q('#lan-name').value }));
      q('#lan-name').onchange = (e) => act(() => api().lanConfig({ deviceName: e.target.value }));
      host.querySelectorAll('input[name="lan-scope"]').forEach((r) => { r.onchange = () => act(() => api().lanConfig({ scope: r.value }), r.value === 'all' ? 'Whole database will be kept level' : 'Only the shared vessel will be kept level'); });
      q('#lan-show-code').onclick = () => act(async () => { await api().lanPairStart(); }, '');
      q('#lan-scan').onclick = () => act(async () => { toast('Looking for devices…'); const r = await api().lanScan(); if (!(r.found || []).length) toast('Nobody found. Check both are on the same Wi-Fi or hotspot, or type the address.'); return r.state; });
      q('#lan-now').onclick = () => act(() => api().lanSyncNow(true), 'Synced');
      q('#lan-pair-url').onclick = () => act(() => api().lanPair(q('#lan-url').value.trim(), q('#lan-code').value.trim()), 'Paired');
      host.querySelectorAll('[data-pair]').forEach((b) => { b.onclick = () => {
        const url = b.getAttribute('data-pair');
        const code = host.querySelector(`[data-code-for="${url}"]`).value.trim();
        act(() => api().lanPair(url, code), 'Paired');
      }; });
      host.querySelectorAll('[data-forget]').forEach((b) => { b.onclick = () => act(() => api().lanForget(b.getAttribute('data-forget')), 'Forgotten'); });
      host.querySelectorAll('[data-copy]').forEach((b) => { b.onclick = () => act(async () => { await api().lanCopy(b.getAttribute('data-dev'), b.getAttribute('data-vessel'), b.getAttribute('data-copy')); }, 'Copied'); });
    }

    refresh();
    timer = setInterval(() => {
      /* Do not redraw under someone who is typing an address or a code. */
      const typing = host.contains(document.activeElement) || Array.from(host.querySelectorAll('#lan-url,#lan-code,[data-code-for]')).some((i) => i.value);
      if (!busy && !typing) refresh();
    }, 4000);
  }

  window.LanSyncUI = { mount };
})();
