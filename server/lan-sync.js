/**
 * Live sync between two devices on the same Wi-Fi (or one phone's hotspot).
 *
 * What it does
 *   - finds the other device (a UDP beacon between PCs, a scan of the local
 *     network from a phone, or a typed address);
 *   - pairs with it once, with a six-digit code shown on one screen and typed on
 *     the other, after which each holds a token for the other;
 *   - while both are on the SAME vessel, keeps their records level: whatever
 *     one lacks, the other has is copied across, newest copy of a record wins,
 *     nothing is deleted by a sync;
 *   - optionally keeps the whole database level, so a vessel one device does not
 *     have is created on it from the other.
 *
 * It does not invent a second way of merging. A vessel travels as the same bundle
 * the Backup page's peer sync sends, and lands through store.applySyncPayload,
 * the same function: the vessel record by revision, saved reports and gaugings
 * as a union.
 *
 * Who talks to whom
 *   A phone's copy of this server runs inside the app and cannot listen for other
 *   devices, so the phone is always the one that calls. Two PCs can each call the
 *   other. Either way a single call moves data both ways.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let dgram = null;
let os = null;
try { dgram = require('dgram'); } catch (_) { dgram = null; }
try { os = require('os'); } catch (_) { os = null; }

const BEACON_PORT = 47615;
const FORMAT = 'cheng-lan-sync';
const PAIR_CODE_TTL_MS = 5 * 60 * 1000;
const PAIR_MAX_TRIES = 5;
const DISCOVERED_TTL_MS = 30 * 1000;
const DIGEST_KEYS = [
  'vessel', 'tanks', 'readings', 'voyage', 'bunkering', 'transfers', 'bunkerOps', 'fuelReport',
  'reportHistory', 'voyageHistory', 'tankSummaryHistory', 'tankSummaryDraft', 'bunkerPlan',
  'bunkerAfter', 'bunkerSummary', 'bunkerHistory', 'assets',
];
/* Where a phone looks for the other device when nothing has announced itself:
   typical router ranges, Android's hotspot (192.168.43.x), Windows' hotspot
   (192.168.137.x) and an iPhone's (172.20.10.x). */
const COMMON_SUBNETS = [
  '192.168.0', '192.168.1', '192.168.43', '192.168.137', '192.168.2', '192.168.8', '192.168.100',
  '172.20.10', '10.0.0', '10.0.1', '192.168.4', '192.168.10', '192.168.50', '192.168.68',
];

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

function imoOf(v) { return String((v && (v.imo || v.imoNo)) || '').replace(/\D/g, ''); }
function nameOf(v) { return String((v && (v.name || v.vesselName)) || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

/** Same ship? IMO number when both have one, otherwise the name. */
function hullSame(a, b) {
  if (!a || !b) return false;
  const ia = imoOf(a);
  const ib = imoOf(b);
  if (ia && ib) return ia === ib;
  const na = nameOf(a);
  const nb = nameOf(b);
  return !!na && na === nb;
}

function isLoopback(req) {
  const ip = String((req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '');
  /* No socket at all is the phone's in-app server: only the app itself can call it. */
  if (!ip) return true;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function create(opts) {
  const { app, store, product = 'tank-chief' } = opts;
  const sha256Hex = opts.sha256Hex || ((buf) => crypto.createHash('sha256').update(buf).digest('hex'));
  const toBytes = opts.toBytes || ((text) => Buffer.from(String(text), 'utf8'));
  const fetchImpl = opts.fetch || ((...a) => fetch(...a));
  const sha = (text) => sha256Hex(toBytes(String(text)));
  /* The phone's crypto shim has randomUUID only, so ask the browser for random bytes there. */
  const randomHex = (n) => {
    if (typeof crypto.randomBytes === 'function') return crypto.randomBytes(n).toString('hex');
    const a = new Uint8Array(n);
    (globalThis.crypto || self.crypto).getRandomValues(a);
    return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
  };
  const randomCode = () => {
    if (typeof crypto.randomInt === 'function') return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const a = new Uint32Array(1);
    (globalThis.crypto || self.crypto).getRandomValues(a);
    return String(a[0] % 1000000).padStart(6, '0');
  };
  const dataFile = () => path.join(store.rootDataDir(), 'lan-sync.json');

  /* ------------------------------------------------------------ persistence */

  let cache = null;
  function load() {
    if (cache) return cache;
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(dataFile(), 'utf8')) || {}; } catch (_) { raw = {}; }
    cache = {
      deviceId: raw.deviceId || crypto.randomUUID(),
      deviceName: raw.deviceName || '',
      enabled: !!raw.enabled,
      scope: raw.scope === 'all' ? 'all' : 'active',
      intervalSec: Math.min(300, Math.max(5, Number(raw.intervalSec) || 20)),
      userScope: raw.userScope || null,
      license: raw.license && raw.license.tag ? { tag: String(raw.license.tag), email: String(raw.license.email || '') } : null,
      paired: Array.isArray(raw.paired) ? raw.paired : [],   // devices allowed to call us: {deviceId,name,tokenHash,pairedAt}
      peers: Array.isArray(raw.peers) ? raw.peers : [],      // devices we call: {deviceId,name,url,token,pairedAt}
    };
    return cache;
  }
  function save() {
    try {
      fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
      fs.writeFileSync(dataFile(), JSON.stringify(load(), null, 2));
    } catch (_) { /* a read-only folder must not stop the sync running */ }
  }

  function deviceName() {
    const c = load();
    if (c.deviceName) return c.deviceName;
    try { return (os && os.hostname && os.hostname()) || 'Device'; } catch (_) { return 'Device'; }
  }

  /* ----------------------------------------------------------- license */

  /**
   * Two devices sync only when they hold the SAME license: the same email and the same license
   * (one key gives one licenseId, whichever device it was activated on). The screen tells this
   * server who is signed in; what is kept and sent to the other device is a hash of both, never
   * the license id itself. No license on this device (or an expired one) means no sync at all.
   */
  const licenseTagOf = (email, licenseId) => sha('lan-license|' + String(email || '').trim().toLowerCase() + '|' + String(licenseId || '').trim());
  const ownTag = () => (load().license && load().license.tag) || '';
  const sameTag = (a, b) => {
    a = String(a || ''); b = String(b || '');
    if (!a || !b || a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  };
  const LICENSE_MSG = {
    none: 'Activate your license on this device first: live sync works only between devices on the same license.',
    different: 'These two devices are on different licenses. Live sync works only when both use the same email and license.',
    older: 'The other device runs a version that does not check licenses. Update it, then pair again.',
  };

  /** Run in the same license folder the user works in, whichever request or timer calls. */
  function scoped(fn) {
    const s = load().userScope;
    if (s && typeof store.runWithUserScope === 'function') {
      return store.runWithUserScope({ email: s.email || null, master: !!s.master, actAs: s.actAs || null }, fn);
    }
    return fn();
  }

  /* ---------------------------------------------------------- local vessels */

  /**
   * A fingerprint of what a vessel holds, the same on two devices that hold the same records.
   * So it leaves out what is naturally different between devices — the revision counter (every
   * merge bumps it), created/updated times on the vessel record, and the order a union of saved
   * reports happens to come out in. Tanks keep their order: the order is something the user sets.
   */
  function digestOf(bundle) {
    const norm = (v, key) => {
      if (Array.isArray(v)) {
        const items = v.map((x) => norm(x));
        const byId = key !== 'tanks' && items.length > 1 && items.every((x) => x && typeof x === 'object' && !Array.isArray(x) && typeof x.id === 'string');
        return byId ? items.slice().sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)) : items;
      }
      if (v && typeof v === 'object') {
        const o = {};
        for (const k of Object.keys(v)) o[k] = norm(v[k], k);
        return o;
      }
      return v;
    };
    const o = {};
    for (const k of DIGEST_KEYS) o[k] = bundle[k] === undefined ? null : norm(bundle[k], k);
    if (o.vessel && typeof o.vessel === 'object') {
      const { id, createdAt, updatedAt, ...rest } = o.vessel;
      o.vessel = rest;
    }
    return sha(stableStringify(o));
  }

  /** Every vessel this device holds: {id, name, imo, revision, bundle}. */
  function localVessels() {
    const all = store.syncPushBundle();
    const rows = [];
    for (const [id, bundle] of Object.entries(all.vessels || {})) {
      const profile = (bundle && bundle.vessel) || {};
      const row = ((all.index && all.index.vessels) || []).find((v) => v.id === id) || {};
      rows.push({
        id,
        name: profile.name || row.name || id,
        imo: profile.imo || row.imo || '',
        revision: (bundle.meta && bundle.meta.revision) || 0,
        bundle,
      });
    }
    return rows;
  }

  function activeOf(rows) {
    let id = null;
    try { id = store.getActiveVesselId(); } catch (_) { id = null; }
    let row = rows.find((r) => r.id === id);
    if (!row && id) {
      /* the active id may belong to another copy of the same hull */
      const idx = (() => { try { return store.listVessels().find((v) => v.id === id); } catch (_) { return null; } })();
      if (idx) row = rows.find((r) => hullSame(r, idx));
    }
    return row || null;
  }

  /** What this device tells a peer about itself. Digests cost a hash of the whole vessel, so only on request. */
  function statusDoc(full) {
    const rows = localVessels();
    const active = activeOf(rows);
    return {
      format: FORMAT,
      product,
      deviceId: load().deviceId,
      deviceName: deviceName(),
      active: active ? { id: active.id, name: active.name, imo: active.imo } : null,
      vessels: rows.map((r) => ({
        id: r.id,
        name: r.name,
        imo: r.imo,
        revision: r.revision,
        digest: (full || (active && r.id === active.id)) ? digestOf(r.bundle) : undefined,
      })),
      time: new Date().toISOString(),
    };
  }

  /* --------------------------------------------------------------- pairing */

  let pairing = null; // {code, expiresAt, tries}

  /** One code can serve more than one program: the AIO shows a single code and hands it to Tank and Voyage. */
  function startPairing(wanted) {
    const given = String(wanted == null ? '' : wanted).replace(/\D/g, '');
    pairing = {
      code: given.length === 6 ? given : randomCode(),
      expiresAt: Date.now() + PAIR_CODE_TTL_MS,
      tries: 0,
    };
    return { code: pairing.code, expiresAt: new Date(pairing.expiresAt).toISOString() };
  }

  function tokenOk(req) {
    const auth = String(req.get ? (req.get('authorization') || '') : '');
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m) return null;
    const h = sha(m[1].trim());
    const hit = load().paired.find((p) => p.tokenHash === h);
    return hit || null;
  }

  function lanAuth(req, res, next) {
    const peer = tokenOk(req);
    if (!peer) return res.status(401).json({ error: 'Not paired with this device' });
    if (!ownTag()) return res.status(403).json({ error: LICENSE_MSG.none, code: 'no-license' });
    if (!sameTag(req.get ? req.get('x-lan-license') : '', ownTag())) {
      return res.status(403).json({ error: LICENSE_MSG.different, code: 'different-license' });
    }
    req.lanPeer = peer;
    return next();
  }

  function localOnly(req, res, next) {
    if (!isLoopback(req)) return res.status(403).json({ error: 'This can only be done on the device itself' });
    return next();
  }

  /* ----------------------------------------------------------------- routes */

  app.get('/api/lan/hello', (req, res) => {
    const c = load();
    res.json({
      format: FORMAT,
      v: 1,
      product,
      deviceId: c.deviceId,
      deviceName: deviceName(),
      canBeCalled: canBeCalled(),
      time: new Date().toISOString(),
    });
  });

  app.post('/api/lan/pair/start', localOnly, (req, res) => {
    res.json(startPairing(req.body && req.body.code));
  });

  app.post('/api/lan/pair', (req, res) => {
    const b = req.body || {};
    if (!pairing || Date.now() > pairing.expiresAt) {
      return res.status(403).json({ error: 'No pairing code is showing on this device. Open "Show pairing code" here first.' });
    }
    pairing.tries += 1;
    if (pairing.tries > PAIR_MAX_TRIES) {
      pairing = null;
      return res.status(429).json({ error: 'Too many wrong codes. Show a new pairing code on this device.' });
    }
    const given = String(b.code || '').replace(/\D/g, '');
    if (given !== pairing.code) {   // six digits and five tries: timing is not the weak point
      return res.status(403).json({ error: 'That code is not right.' });
    }
    if (!ownTag()) return res.status(403).json({ error: LICENSE_MSG.none, code: 'no-license' });
    if (!sameTag(b.license, ownTag())) {
      return res.status(403).json({ error: b.license ? LICENSE_MSG.different : LICENSE_MSG.older, code: 'different-license' });
    }
    pairing = null; // a code is good once
    const c = load();
    const callerId = String(b.deviceId || '').slice(0, 80) || crypto.randomUUID();
    const token = randomHex(32);
    c.paired = c.paired.filter((p) => p.deviceId !== callerId);
    c.paired.push({ deviceId: callerId, name: String(b.deviceName || 'Device').slice(0, 80), tokenHash: sha(token), pairedAt: new Date().toISOString() });
    /* A device that can be called (a PC) hands over where, and a token for us to call it back with. */
    if (b.url && b.backToken && String(b.url).length < 300) {
      c.peers = c.peers.filter((p) => p.deviceId !== callerId);
      c.peers.push({
        deviceId: callerId,
        name: String(b.deviceName || 'Device').slice(0, 80),
        url: String(b.url).replace(/\/$/, ''),
        token: String(b.backToken),
        pairedAt: new Date().toISOString(),
      });
    }
    save();
    res.json({ ok: true, token, deviceId: c.deviceId, deviceName: deviceName(), product, license: ownTag() });
  });

  app.get('/api/lan/status', lanAuth, (req, res) => {
    try {
      const full = req.query && (req.query.full === '1' || req.query.full === 'true');
      res.json(scoped(() => statusDoc(full)));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /** One vessel as the bundle Backup → peer sync sends. `id` is the id on this device. */
  app.get('/api/lan/vessel/:id', lanAuth, (req, res) => {
    try {
      const out = scoped(() => {
        const row = localVessels().find((r) => r.id === req.params.id);
        if (!row) return null;
        return { format: 'vessel-fuel-tms-sync', version: 1, vessels: { [row.id]: row.bundle } };
      });
      if (!out) return res.status(404).json({ error: 'This device does not have that vessel' });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/lan/apply', lanAuth, (req, res) => {
    try {
      const payload = (req.body && req.body.payload) || null;
      if (!payload || !payload.vessels) return res.status(400).json({ error: 'No vessel data' });
      const results = scoped(() => store.applySyncPayload(payload));
      res.json({ ok: true, results });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  /* ---- local control: the Settings screen talks to these ---- */

  /** The screen says whose license this device is on (or that there is none). Only the hash is kept. */
  app.post('/api/lan/license', localOnly, (req, res) => {
    const c = load();
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const id = String(b.licenseId || '').trim();
    const next = email && id ? { tag: licenseTagOf(email, id), email } : null;
    const changed = (c.license && c.license.tag) !== (next && next.tag);
    c.license = next;
    if (changed) { for (const st of peerState.values()) { st.status = 'unknown'; st.message = ''; } }
    save();
    if (changed && c.enabled && next) syncSoon();
    res.json(publicState(c));
  });

  app.get('/api/lan/state', localOnly, (req, res) => {
    const c = load();
    res.json(publicState(c));
  });

  app.post('/api/lan/config', localOnly, (req, res) => {
    const c = load();
    const b = req.body || {};
    if (typeof b.deviceName === 'string') c.deviceName = b.deviceName.trim().slice(0, 60);
    if (b.scope === 'all' || b.scope === 'active') c.scope = b.scope;
    if (b.intervalSec != null) c.intervalSec = Math.min(300, Math.max(5, Number(b.intervalSec) || 20));
    if (typeof b.enabled === 'boolean') c.enabled = b.enabled;
    /* remember whose license folder this screen reads, so a timer works in it too */
    try { c.userScope = store.getUserScope ? store.getUserScope() : null; } catch (_) { /* unscoped */ }
    save();
    applyEnabled();
    res.json(publicState(c));
  });

  /** Pair with a device found on the network: its address, and the code showing on its screen. */
  app.post('/api/lan/peers/pair', localOnly, async (req, res) => {
    try {
      const b = req.body || {};
      const url = String(b.url || '').replace(/\/$/, '');
      if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Give the other device address, like http://192.168.0.20:3080' });
      const c = load();
      if (!ownTag()) return res.status(403).json({ error: LICENSE_MSG.none, code: 'no-license' });
      const myUrl = ownUrl();
      const backToken = myUrl ? randomHex(32) : '';
      const body = { code: b.code, deviceId: c.deviceId, deviceName: deviceName(), license: ownTag() };
      if (myUrl) { body.url = myUrl; body.backToken = backToken; }
      const base = await resolveBase(url);
      const r = await timed(`${base}/api/lan/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, 10000);
      const out = await r.json().catch(() => ({}));
      if (!r.ok || !out.token) return res.status(r.status || 400).json({ error: out.error || 'Pairing failed', code: out.code });
      /* The other device must be on this license too (a device from before this check says nothing). */
      if (!sameTag(out.license, ownTag())) {
        return res.status(403).json({ error: out.license ? LICENSE_MSG.different : LICENSE_MSG.older, code: 'different-license' });
      }
      c.peers = c.peers.filter((p) => p.deviceId !== out.deviceId);
      c.peers.push({ deviceId: out.deviceId, name: out.deviceName || 'Device', url: base, token: out.token, pairedAt: new Date().toISOString() });
      if (backToken) {
        c.paired = c.paired.filter((p) => p.deviceId !== out.deviceId);
        c.paired.push({ deviceId: out.deviceId, name: out.deviceName || 'Device', tokenHash: sha(backToken), pairedAt: new Date().toISOString() });
      }
      save();
      if (c.enabled) syncSoon();
      res.json(publicState(c));
    } catch (e) { res.status(502).json({ error: e.message || 'Could not reach that device' }); }
  });

  app.post('/api/lan/peers/forget', localOnly, (req, res) => {
    const c = load();
    const id = String((req.body && req.body.deviceId) || '');
    c.peers = c.peers.filter((p) => p.deviceId !== id);
    c.paired = c.paired.filter((p) => p.deviceId !== id);
    peerState.delete(id);
    save();
    res.json(publicState(c));
  });

  app.post('/api/lan/scan', localOnly, async (req, res) => {
    try {
      const found = await scan((req.body && req.body.hosts) || null, (req.body && req.body.ports) || null);
      res.json({ found, state: publicState(load()) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /** Copy one vessel across now, whatever the sync scope says ("Peer does not have this vessel"). */
  app.post('/api/lan/copy', localOnly, async (req, res) => {
    try {
      const b = req.body || {};
      if (!ownTag()) return res.status(403).json({ error: LICENSE_MSG.none, code: 'no-license' });
      const peer = load().peers.find((p) => p.deviceId === b.deviceId);
      if (!peer) return res.status(404).json({ error: 'That device is not paired' });
      const done = await scoped(() => copyVessel(peer, String(b.vesselId || ''), b.direction === 'pull' ? 'pull' : 'push'));
      res.json({ ok: true, done, state: publicState(load()) });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  app.post('/api/lan/sync-now', localOnly, async (req, res) => {
    try {
      await runOnce(!!(req.body && req.body.force));
      res.json(publicState(load()));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ---------------------------------------------------------- talking to peers */

  async function timed(url, init, ms) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
    try {
      return await fetchImpl(url, Object.assign({}, init || {}, ctl ? { signal: ctl.signal } : {}));
    } finally { if (timer) clearTimeout(timer); }
  }

  /** The address that answers. An AIO serves the same routes at its root and under /tanks. */
  async function resolveBase(url) {
    const root = url.replace(/\/tanks$/i, '');
    for (const base of [url, root, `${root}/tanks`]) {
      try {
        const r = await timed(`${base}/api/lan/hello`, { method: 'GET' }, 4000);
        if (r.ok) {
          const j = await r.json().catch(() => null);
          if (j && j.format === FORMAT) return base;
        }
      } catch (_) { /* try the next */ }
    }
    throw new Error('Nothing answered at ' + url + '. Check the address and that both devices are on the same Wi-Fi or hotspot.');
  }

  let listenPort = Number(opts.port) || 0;
  let listenHost = '';
  /* Only a device that is really listening (a PC) can be called back; a phone's in-app server cannot. */
  const canBeCalled = () => listenPort > 0;
  function ownUrl() {
    /* Bound to this machine only (tests, a locked-down install): nobody else can reach it, say so truthfully. */
    if (listenPort && (listenHost === '127.0.0.1' || listenHost === 'localhost')) return `http://127.0.0.1:${listenPort}`;
    if (!listenPort || !os || !os.networkInterfaces) return '';
    const ip = lanAddresses()[0];
    return ip ? `http://${ip.address}:${listenPort}` : '';
  }

  function lanAddresses() {
    const out = [];
    try {
      const ifs = os.networkInterfaces();
      for (const name of Object.keys(ifs)) {
        for (const a of ifs[name] || []) {
          if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address, netmask: a.netmask });
        }
      }
    } catch (_) { /* no interfaces visible */ }
    return out;
  }

  function broadcastOf(a) {
    const ip = a.address.split('.').map(Number);
    const mask = a.netmask.split('.').map(Number);
    return ip.map((o, i) => (o | (~mask[i] & 255))).join('.');
  }

  /* -------------------------------------------------------------- discovery */

  const discovered = new Map(); // deviceId -> {deviceId,name,url,product,seen}
  let udp = null;
  let beaconTimer = null;

  function sendBeacon() {
    if (!udp) return;
    const c = load();
    const msg = Buffer.from(JSON.stringify({ f: FORMAT, v: 1, product, id: c.deviceId, name: deviceName(), port: listenPort }));
    const targets = new Set(['255.255.255.255']);
    for (const a of lanAddresses()) targets.add(broadcastOf(a));
    for (const t of targets) { try { udp.send(msg, BEACON_PORT, t); } catch (_) { /* that network is gone */ } }
  }

  function startBeacon() {
    if (udp || !dgram || !listenPort || listenHost === '127.0.0.1') return;
    try {
      udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      udp.on('error', () => { try { udp.close(); } catch (_) { /* ignore */ } udp = null; });
      udp.on('message', (buf, rinfo) => {
        let m = null;
        try { m = JSON.parse(buf.toString('utf8')); } catch (_) { return; }
        if (!m || m.f !== FORMAT || !m.id || m.id === load().deviceId || !m.port) return;
        discovered.set(m.id, { deviceId: m.id, name: String(m.name || 'Device'), url: `http://${rinfo.address}:${Number(m.port)}`, product: m.product, seen: Date.now() });
        followMovedPeer(m.id, `http://${rinfo.address}:${Number(m.port)}`);
      });
      udp.bind(BEACON_PORT, () => { try { udp.setBroadcast(true); } catch (_) { /* ignore */ } sendBeacon(); });
      beaconTimer = setInterval(sendBeacon, 5000);
      if (beaconTimer.unref) beaconTimer.unref();
    } catch (_) { udp = null; }
  }

  function stopBeacon() {
    if (beaconTimer) { clearInterval(beaconTimer); beaconTimer = null; }
    if (udp) { try { udp.close(); } catch (_) { /* ignore */ } udp = null; }
  }

  /** The router gave a paired PC a new address: follow it. */
  function followMovedPeer(deviceId, url) {
    const p = load().peers.find((x) => x.deviceId === deviceId);
    if (p && p.url !== url) { p.url = url; save(); }
  }

  /** Look for devices by asking each address; the way a phone finds a PC. */
  async function scan(hosts, ports) {
    const wantPorts = Array.isArray(ports) && ports.length ? ports : [3080, 8080];
    let candidates = [];
    if (Array.isArray(hosts) && hosts.length) {
      candidates = hosts;
    } else {
      const known = new Set();
      for (const p of load().peers) { try { known.add(new URL(p.url).hostname); } catch (_) { /* skip */ } }
      const subnets = new Set();
      for (const a of lanAddresses()) subnets.add(a.address.split('.').slice(0, 3).join('.'));
      for (const h of known) subnets.add(h.split('.').slice(0, 3).join('.'));
      for (const s of COMMON_SUBNETS) subnets.add(s);
      for (const h of known) candidates.push(h);
      for (const s of subnets) for (let i = 1; i < 255; i++) candidates.push(`${s}.${i}`);
    }
    const urls = [];
    for (const h of candidates) for (const p of wantPorts) urls.push(/^https?:/i.test(h) ? h : `http://${h}:${p}`);
    const found = [];
    let next = 0;
    async function worker() {
      while (next < urls.length) {
        const url = urls[next++];
        try {
          const r = await timed(`${url}/api/lan/hello`, { method: 'GET' }, 700);
          if (!r.ok) continue;
          const j = await r.json().catch(() => null);
          if (!j || j.format !== FORMAT || j.deviceId === load().deviceId) continue;
          const row = { deviceId: j.deviceId, name: j.deviceName || 'Device', url, product: j.product, seen: Date.now() };
          found.push(row);
          discovered.set(j.deviceId, row);
          followMovedPeer(j.deviceId, url);
        } catch (_) { /* nobody there */ }
      }
    }
    await Promise.all(Array.from({ length: 48 }, worker));
    return found;
  }

  /* ----------------------------------------------------------------- syncing */

  const peerState = new Map(); // deviceId -> {status, message, lastSync, differences, lastDigests}

  async function peerJson(peer, apiPath, init, ms) {
    const r = await timed(`${peer.url}${apiPath}`, Object.assign({}, init || {}, {
      headers: Object.assign({ authorization: `Bearer ${peer.token}`, 'x-lan-license': ownTag() }, (init && init.headers) || {}),
    }), ms || 15000);
    let body = null;
    try { body = await r.json(); } catch (_) { body = null; }
    if (r.status === 401) { const e = new Error('unpaired'); e.code = 'unpaired'; throw e; }
    if (r.status === 403 && body && (body.code === 'different-license' || body.code === 'no-license')) {
      const e = new Error(body.error || LICENSE_MSG.different); e.code = body.code; throw e;
    }
    if (!r.ok) throw new Error((body && body.error) || `HTTP ${r.status}`);
    return body;
  }

  /** Both directions for one pair of vessels (ids may differ: it is the same hull). */
  async function exchange(peer, localId, peerId) {
    let pulled = 0;
    let pushed = 0;
    const theirs = await peerJson(peer, `/api/lan/vessel/${encodeURIComponent(peerId)}`, null, 60000);
    if (theirs && theirs.vessels && Object.keys(theirs.vessels).length) {
      const r = store.applySyncPayload(theirs);
      pulled = (r || []).filter((x) => x.action === 'pulled').length || 1;
    }
    const mine = localVessels().find((r) => r.id === localId);
    if (mine) {
      await peerJson(peer, '/api/lan/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: { format: 'vessel-fuel-tms-sync', version: 1, vessels: { [mine.id]: mine.bundle } } }),
      }, 60000);
      pushed = 1;
    }
    return { pulled, pushed };
  }

  async function copyVessel(peer, vesselId, direction) {
    if (direction === 'pull') {
      const theirs = await peerJson(peer, `/api/lan/vessel/${encodeURIComponent(vesselId)}`, null, 60000);
      const r = store.applySyncPayload(theirs);
      return { direction, vesselId, results: r };
    }
    const mine = localVessels().find((r) => r.id === vesselId);
    if (!mine) throw new Error('This device does not have that vessel');
    await peerJson(peer, '/api/lan/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { format: 'vessel-fuel-tms-sync', version: 1, vessels: { [mine.id]: mine.bundle } } }),
    }, 60000);
    return { direction, vesselId };
  }

  async function syncPeer(peer, force) {
    const c = load();
    const st = peerState.get(peer.deviceId) || {};
    peerState.set(peer.deviceId, st);
    if (!ownTag()) { st.status = 'no-license'; st.message = LICENSE_MSG.none; return; }
    let theirs;
    try {
      const full = c.scope === 'all';
      theirs = await peerJson(peer, `/api/lan/status${full ? '?full=1' : ''}`, null, 12000);
    } catch (e) {
      if (e.code === 'unpaired') { st.status = 'unpaired'; st.message = 'This device no longer trusts us. Pair again.'; return; }
      if (e.code === 'different-license' || e.code === 'no-license') { st.status = e.code; st.message = e.message; return; }
      st.status = 'offline';
      st.message = 'Not reachable right now';
      return;
    }
    st.seen = Date.now();
    const rows = localVessels();
    const mineActive = activeOf(rows);
    const mine = statusDoc(c.scope === 'all');
    const theirActive = theirs.active;
    const activeSame = !!(mineActive && theirActive && hullSame(mineActive, theirActive));

    /* What each side lacks — reported always, copied only when the scope says so. */
    const missingOnPeer = rows.filter((r) => !(theirs.vessels || []).some((v) => hullSame(v, r)))
      .map((r) => ({ id: r.id, name: r.name, imo: r.imo }));
    const missingHere = (theirs.vessels || []).filter((v) => !rows.some((r) => hullSame(r, v)))
      .map((v) => ({ id: v.id, name: v.name, imo: v.imo }));
    st.differences = { missingOnPeer, missingHere, activeSame, mineActive: mineActive && mineActive.name, theirActive: theirActive && theirActive.name };

    const jobs = []; // {localId, peerId}
    if (c.scope === 'all') {
      for (const r of rows) {
        const there = (theirs.vessels || []).find((v) => hullSame(v, r));
        if (there) {
          const mineDigest = (mine.vessels.find((v) => v.id === r.id) || {}).digest;
          if (force || !there.digest || there.digest !== mineDigest) jobs.push({ localId: r.id, peerId: there.id });
        }
      }
    } else if (activeSame) {
      const there = (theirs.vessels || []).find((v) => v.id === theirActive.id) || theirActive;
      const mineDigest = (mine.vessels.find((v) => v.id === mineActive.id) || {}).digest;
      if (force || !there.digest || there.digest !== mineDigest) jobs.push({ localId: mineActive.id, peerId: theirActive.id });
    }

    let pulled = 0;
    let pushed = 0;
    const copied = [];
    try {
      if (c.scope === 'all') {
        for (const v of missingOnPeer) { await copyVessel(peer, v.id, 'push'); copied.push({ name: v.name, to: peer.name }); pushed += 1; }
        for (const v of missingHere) { await copyVessel(peer, v.id, 'pull'); copied.push({ name: v.name, to: 'this device' }); pulled += 1; }
      }
      for (const j of jobs) {
        const r = await exchange(peer, j.localId, j.peerId);
        pulled += r.pulled;
        pushed += r.pushed;
      }
    } catch (e) {
      if (e.code === 'unpaired') { st.status = 'unpaired'; st.message = 'This device no longer trusts us. Pair again.'; return; }
      if (e.code === 'different-license' || e.code === 'no-license') { st.status = e.code; st.message = e.message; return; }
      st.status = 'error';
      st.message = e.message || 'Sync failed';
      return;
    }

    if (c.scope !== 'all' && !activeSame) {
      st.status = 'different-vessel';
      st.message = mineActive && theirActive
        ? `Not syncing: this device is on ${mineActive.name}, the other is on ${theirActive.name}`
        : 'Not syncing: both devices need the same vessel open';
    } else {
      st.status = 'connected';
      st.message = (jobs.length || copied.length) ? 'Records level' : 'Up to date';
    }
    if (jobs.length || copied.length) {
      st.lastSync = { at: new Date().toISOString(), pulled, pushed, copied, vessels: jobs.length };
      log(`${peer.name}: pulled ${pulled}, pushed ${pushed}${copied.length ? ', copied ' + copied.map((x) => x.name).join(', ') : ''}`);
    }
  }

  const events = [];
  function log(text) {
    events.unshift({ at: new Date().toISOString(), text });
    if (events.length > 30) events.length = 30;
  }

  let running = false;
  async function runOnce(force) {
    if (running) return;
    running = true;
    try {
      await scoped(async () => {
        for (const peer of load().peers.slice()) {
          try { await syncPeer(peer, force); } catch (e) {
            const st = peerState.get(peer.deviceId) || {};
            peerState.set(peer.deviceId, st);
            st.status = 'error';
            st.message = e.message || 'Sync failed';
          }
        }
      });
    } finally { running = false; }
  }

  let timer = null;
  let lastScan = 0;
  function loop() {
    runOnce(false).catch(() => {}).then(async () => {
      /* A paired device that stopped answering may have a new address: look for it, not too often. */
      const lost = load().peers.some((p) => (peerState.get(p.deviceId) || {}).status === 'offline');
      if (lost && Date.now() - lastScan > 60000 && !opts.noScan) {
        lastScan = Date.now();
        try { await scan(null, null); } catch (_) { /* try again later */ }
      }
    });
  }
  function syncSoon() { setTimeout(() => runOnce(false).catch(() => {}), 200); }

  function applyEnabled() {
    const c = load();
    if (timer) { clearInterval(timer); timer = null; }
    if (c.enabled) {
      startBeacon();
      timer = setInterval(loop, c.intervalSec * 1000);
      if (timer.unref) timer.unref();
      setTimeout(loop, 500);
    } else {
      stopBeacon();
    }
  }

  function publicState(c) {
    for (const [id, d] of discovered) if (Date.now() - d.seen > DISCOVERED_TTL_MS * 4) discovered.delete(id);
    return {
      format: FORMAT,
      product,
      deviceId: c.deviceId,
      deviceName: deviceName(),
      enabled: c.enabled,
      scope: c.scope,
      intervalSec: c.intervalSec,
      canBeCalled: canBeCalled(),
      license: { active: !!ownTag(), email: (c.license && c.license.email) || '' },
      address: ownUrl(),
      pairing: pairing && Date.now() < pairing.expiresAt ? { code: pairing.code, expiresAt: new Date(pairing.expiresAt).toISOString() } : null,
      peers: c.peers.map((p) => {
        const st = peerState.get(p.deviceId) || {};
        return {
          deviceId: p.deviceId,
          name: p.name,
          url: p.url,
          status: st.status || 'unknown',
          message: st.message || '',
          lastSync: st.lastSync || null,
          differences: st.differences || null,
          seen: st.seen ? new Date(st.seen).toISOString() : null,
        };
      }),
      discovered: Array.from(discovered.values())
        .filter((d) => !c.peers.some((p) => p.deviceId === d.deviceId))
        .map((d) => ({ deviceId: d.deviceId, name: d.name, url: d.url, product: d.product })),
      events: events.slice(0, 10),
    };
  }

  load();
  if (opts.autostart !== false && load().enabled) setTimeout(applyEnabled, 1000);

  return {
    setPort(p, host) {
      listenPort = Number(p) || 0;
      listenHost = String(host || '');
      stopBeacon();
      if (load().enabled && listenHost !== '127.0.0.1') startBeacon();
    },
    state: () => publicState(load()),
    runOnce,
    stop() { if (timer) clearInterval(timer); timer = null; stopBeacon(); },
    _scan: scan,
    _hullSame: hullSame,
  };
}

module.exports = { create, hullSame, stableStringify, BEACON_PORT, FORMAT };
