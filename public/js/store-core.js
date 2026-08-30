/**
 * Multi-vessel database.
 *
 * Each vessel is a folder of separate JSON documents, so a record can be
 * synced, backed up or copied on its own.
 *
 * This runs in two places and must behave identically in both: on the server
 * against real files, and inside the phone application against a small
 * in-memory filesystem kept in IndexedDB. That is the whole reason it lives
 * here rather than under server/ — a second implementation for the phone would
 * be a second set of defaults, a second merge rule and eventually a second set
 * of numbers. Same file, same behaviour, different drawer to put it in.
 *
 * The host supplies fs, path and crypto. Node hands over its own; the browser
 * hands over the shim in node-shim.js, which implements exactly the handful of
 * calls used below.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // Two levels up from public/js is the project root, where data/ sits.
    module.exports = factory(require('fs'), require('path'), require('crypto'),
      require('path').join(__dirname, '..', '..'), process.env);
  } else {
    // A browser has no process; the device's root is a fixed virtual path.
    root.StoreCore = factory(root.NodeShim.fs, root.NodeShim.path, root.NodeShim.crypto, '/app', {});
  }
}(typeof self !== 'undefined' ? self : this, function (fs, path, crypto, ROOT, env) {

/* Where the vessel files live.
 *
 * Beside the source when running from a checkout, but an installed desktop
 * build sits in Program Files, which is read-only to the user who runs it, so
 * the installer points this at the per-user application data directory.
 *
 * With a license-email scope active, vessel data is isolated under
 * data/users/<email-slug>/. Without a scope, the legacy root data/ paths are
 * used so existing installs keep working. */
const ROOT_DATA_DIR = env.CHENG_PRO_DATA_DIR || env.TMS_DATA_DIR || path.join(ROOT, 'data');

let asyncLocalStorage = null;
if (typeof require === 'function') {
  try {
    const { AsyncLocalStorage } = require('async_hooks');
    asyncLocalStorage = new AsyncLocalStorage();
  } catch (_) {
    /* browser / environments without async_hooks */
  }
}
const browserScope = { email: null, master: false, actAs: null };

function emailSlug(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 128) || 'user';
}

function normalizeScope(scope) {
  const s = scope && typeof scope === 'object' ? scope : {};
  return {
    email: s.email ? String(s.email).trim() : null,
    master: !!s.master,
    actAs: s.actAs ? String(s.actAs).trim() : null,
  };
}

function setUserScope(scope) {
  const next = normalizeScope(scope);
  if (asyncLocalStorage) {
    const store = asyncLocalStorage.getStore();
    if (store) {
      Object.assign(store, next);
      return getUserScope();
    }
  }
  Object.assign(browserScope, next);
  return getUserScope();
}

function getUserScope() {
  const store = asyncLocalStorage ? asyncLocalStorage.getStore() : null;
  const s = store || browserScope;
  return {
    email: s.email || null,
    master: !!s.master,
    actAs: s.actAs || null,
  };
}

function runWithUserScope(scope, fn) {
  const next = normalizeScope(scope);
  if (asyncLocalStorage) {
    return asyncLocalStorage.run(next, fn);
  }
  const prev = { email: browserScope.email, master: browserScope.master, actAs: browserScope.actAs };
  Object.assign(browserScope, next);
  try {
    return fn();
  } finally {
    Object.assign(browserScope, prev);
  }
}

function isMasterScope() {
  return !!getUserScope().master;
}

/** Effective email for path isolation (master may act-as another user). */
function scopedEmail() {
  const scope = getUserScope();
  if (scope.master && scope.actAs) return scope.actAs;
  return scope.email || null;
}

function rootDataDir() {
  return ROOT_DATA_DIR;
}

function activeDataDir() {
  const email = scopedEmail();
  if (!email) return rootDataDir();
  return path.join(rootDataDir(), 'users', emailSlug(email));
}

function getDataDir() {
  return activeDataDir();
}

function getVesselsDir() {
  return path.join(activeDataDir(), 'vessels');
}

function settingsPath() {
  return path.join(activeDataDir(), 'settings.json');
}

function indexPath() {
  return path.join(activeDataDir(), 'vessels-index.json');
}

const VESSEL_FILES = [
  'vessel.json',
  'tanks.json',
  'readings.json',
  'voyage.json',
  'bunkering.json',
  'transfers.json',
  'bunker-ops.json',
  'fuel-report.json',
  'report-history.json',
  'bunker-plan.json',
  'bunker-after.json',
  'bunker-summary.json',
  'bunker-history.json',
  'assets.json',
  'meta.json',
];

function ensureDirs() {
  fs.mkdirSync(getVesselsDir(), { recursive: true });
  if (!fs.existsSync(settingsPath())) {
    writeJson(settingsPath(), defaultSettings());
  }
  if (!fs.existsSync(indexPath())) {
    writeJson(indexPath(), { vessels: [], activeVesselId: null, updatedAt: now() });
  }
}

/**
 * Master helper: scan data/users/* folders that look like license databases.
 * Returns [{ emailSlug, path, vesselCount }].
 */
function listUserDatabases() {
  const usersDir = path.join(rootDataDir(), 'users');
  if (!fs.existsSync(usersDir)) return [];
  const out = [];
  let names;
  try {
    names = fs.readdirSync(usersDir);
  } catch (_) {
    return [];
  }
  for (const name of names) {
    const userPath = path.join(usersDir, name);
    let st;
    try {
      st = fs.statSync(userPath);
    } catch (_) {
      continue;
    }
    if (!st.isDirectory()) continue;
    const idxFile = path.join(userPath, 'vessels-index.json');
    if (!fs.existsSync(idxFile)) continue;
    const index = readJson(idxFile, { vessels: [] });
    out.push({
      emailSlug: name,
      path: userPath,
      vesselCount: Array.isArray(index.vessels) ? index.vessels.length : 0,
    });
  }
  return out;
}

function now() {
  return new Date().toISOString();
}

function slugify(name) {
  return String(name || 'vessel')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'vessel';
}

function defaultSettings() {
  return {
    syncUrl: '',
    syncEnabled: false,
    autoSave: true,
    units: { volume: 'm3', weight: 'MT', density: 'kg/L' },
    defaultDensity: { hfo: 0.96, lsfo: 0.95, mdo: 0.89, mgo: 0.85 },
    offlineQueueFlushIntervalSec: 30,
    updatedAt: now(),
  };
}

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error('readJson failed', file, err.message);
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function vesselDir(id) {
  const safe = String(id || '');
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(safe) || safe.includes('..')) {
    const err = new Error('Invalid vessel id');
    err.status = 400;
    throw err;
  }
  return path.join(getVesselsDir(), safe);
}

function vesselPath(id, file) {
  return path.join(vesselDir(id), file);
}

function loadIndex() {
  ensureDirs();
  return readJson(indexPath(), { vessels: [], activeVesselId: null, updatedAt: now() });
}

function saveIndex(index) {
  index.updatedAt = now();
  writeJson(indexPath(), index);
}

function getSettings() {
  ensureDirs();
  return readJson(settingsPath(), defaultSettings());
}

function saveSettings(patch) {
  const current = getSettings();
  const next = { ...current, ...patch, updatedAt: now() };
  writeJson(settingsPath(), next);
  return next;
}

function listVessels() {
  return loadIndex().vessels;
}

function getActiveVesselId() {
  return loadIndex().activeVesselId;
}

function setActiveVessel(id) {
  const index = loadIndex();
  if (id && !index.vessels.find((v) => v.id === id)) {
    throw new Error('Vessel not found: ' + id);
  }
  index.activeVesselId = id || null;
  saveIndex(index);
  return index;
}

function emptyTanks() {
  return { fuel: [], lube: [], misc: [], water: [] };
}

function emptyVoyage() {
  return {
    vessel: '',
    voyageNo: '',
    port: '',
    reportType: 'Departure',
    date: new Date().toISOString().slice(0, 10),
    time: '08:00',
    draftFwd: 0,
    draftAft: 0,
    trim: 0,
    heel: 0,
    seaTemp: 25,
    engineRoomTemp: 35,
  };
}

function emptyLegs(n = 10) {
  return Array.from({ length: n }, () => ({
    from: '',
    to: '',
    distance: '',
    speed: '',
    daily: '',
    port: false,
  }));
}

/**
 * Printed-document identity: the vessel logo and a signature per Chief Engineer
 * name, so a report reprinted after a crew change still carries the signature of
 * the officer named on it.
 */
function emptyAssets() {
  return { vesselLogo: null, chEngSignatures: {} };
}

/** Saved bunkering paperwork, newest first in each list. */
function emptyBunkerHistory() {
  return { plans: [], after: [], summaries: [] };
}

function emptyBunkering() {
  return {
    hfo: { departureRob: 0, received: 0, margin: 0, legs: emptyLegs(10) },
    mgo: { departureRob: 0, received: 0, margin: 0, legs: emptyLegs(10) },
    mdo: { departureRob: 0, received: 0, margin: 0, legs: emptyLegs(10) },
    lsfo: { departureRob: 0, received: 0, margin: 0, legs: emptyLegs(10) },
  };
}

function createVessel(details = {}) {
  ensureDirs();
  const base = slugify(details.name || details.id || 'new-vessel');
  let id = slugify(details.id || base);
  if (details.id && slugify(details.id) !== details.id) {
    id = base;
  }
  let n = 1;
  while (fs.existsSync(vesselDir(id))) {
    id = `${base}-${++n}`;
  }

  const vessel = {
    id,
    name: details.name || 'New Vessel',
    imo: details.imo || '',
    callSign: details.callSign || '',
    flag: details.flag || '',
    type: details.type || '',
    owner: details.owner || '',
    dwt: details.dwt || '',
    notes: details.notes || '',
    createdAt: now(),
    updatedAt: now(),
  };

  const dir = vesselDir(id);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(vesselPath(id, 'vessel.json'), vessel);
  writeJson(vesselPath(id, 'tanks.json'), details.tanks || emptyTanks());
  writeJson(vesselPath(id, 'readings.json'), details.readings || {});
  writeJson(
    vesselPath(id, 'voyage.json'),
    { ...(details.voyage || emptyVoyage()), vessel: vessel.name }
  );
  writeJson(vesselPath(id, 'bunkering.json'), details.bunkering || emptyBunkering());
  writeJson(vesselPath(id, 'transfers.json'), details.transfers || []);
  writeJson(vesselPath(id, 'bunker-ops.json'), details.bunkerOps || []);
  writeJson(vesselPath(id, 'fuel-report.json'), details.fuelReport || null);
  writeJson(vesselPath(id, 'report-history.json'), details.reportHistory || []);
  writeJson(vesselPath(id, 'bunker-plan.json'), details.bunkerPlan || null);
  writeJson(vesselPath(id, 'bunker-after.json'), details.bunkerAfter || null);
  writeJson(vesselPath(id, 'bunker-summary.json'), details.bunkerSummary || null);
  writeJson(vesselPath(id, 'bunker-history.json'), details.bunkerHistory || emptyBunkerHistory());
  writeJson(vesselPath(id, 'assets.json'), details.assets || emptyAssets());
  writeJson(vesselPath(id, 'meta.json'), {
    version: 1,
    revision: 1,
    lastSyncedAt: null,
    updatedAt: now(),
  });

  const index = loadIndex();
  index.vessels.push({
    id: vessel.id,
    name: vessel.name,
    imo: vessel.imo,
    updatedAt: vessel.updatedAt,
  });
  if (!index.activeVesselId) index.activeVesselId = id;
  saveIndex(index);
  return vessel;
}

function deleteVessel(id) {
  const dir = vesselDir(id);
  if (!fs.existsSync(dir)) throw new Error('Vessel not found');
  fs.rmSync(dir, { recursive: true, force: true });
  const index = loadIndex();
  index.vessels = index.vessels.filter((v) => v.id !== id);
  if (index.activeVesselId === id) {
    index.activeVesselId = index.vessels[0]?.id || null;
  }
  saveIndex(index);
  return { ok: true };
}

function touchVessel(id) {
  const vessel = readJson(vesselPath(id, 'vessel.json'));
  if (!vessel) throw new Error('Vessel not found');
  vessel.updatedAt = now();
  writeJson(vesselPath(id, 'vessel.json'), vessel);

  const meta = readJson(vesselPath(id, 'meta.json'), { version: 1, revision: 0 });
  meta.revision = (meta.revision || 0) + 1;
  meta.updatedAt = now();
  writeJson(vesselPath(id, 'meta.json'), meta);

  const index = loadIndex();
  const entry = index.vessels.find((v) => v.id === id);
  if (entry) {
    entry.name = vessel.name;
    entry.imo = vessel.imo;
    entry.updatedAt = vessel.updatedAt;
    saveIndex(index);
  }
  return vessel;
}

function getVesselBundle(id) {
  if (!fs.existsSync(vesselDir(id))) throw new Error('Vessel not found');
  return {
    vessel: readJson(vesselPath(id, 'vessel.json')),
    tanks: readJson(vesselPath(id, 'tanks.json'), emptyTanks()),
    readings: readJson(vesselPath(id, 'readings.json'), {}),
    voyage: readJson(vesselPath(id, 'voyage.json'), emptyVoyage()),
    bunkering: readJson(vesselPath(id, 'bunkering.json'), emptyBunkering()),
    transfers: readJson(vesselPath(id, 'transfers.json'), []),
    bunkerOps: readJson(vesselPath(id, 'bunker-ops.json'), []),
    fuelReport: readJson(vesselPath(id, 'fuel-report.json'), null),
    reportHistory: readJson(vesselPath(id, 'report-history.json'), []),
    bunkerPlan: readJson(vesselPath(id, 'bunker-plan.json'), null),
    bunkerAfter: readJson(vesselPath(id, 'bunker-after.json'), null),
    bunkerSummary: readJson(vesselPath(id, 'bunker-summary.json'), null),
    bunkerHistory: readJson(vesselPath(id, 'bunker-history.json'), emptyBunkerHistory()),
    assets: readJson(vesselPath(id, 'assets.json'), emptyAssets()),
    meta: readJson(vesselPath(id, 'meta.json'), {}),
  };
}

function saveVesselPart(id, part, data) {
  const allowed = {
    vessel: 'vessel.json',
    tanks: 'tanks.json',
    readings: 'readings.json',
    voyage: 'voyage.json',
    bunkering: 'bunkering.json',
    transfers: 'transfers.json',
    bunkerOps: 'bunker-ops.json',
    fuelReport: 'fuel-report.json',
    reportHistory: 'report-history.json',
    bunkerPlan: 'bunker-plan.json',
    bunkerAfter: 'bunker-after.json',
    bunkerSummary: 'bunker-summary.json',
    bunkerHistory: 'bunker-history.json',
    assets: 'assets.json',
  };
  if (!allowed[part]) throw new Error('Unknown part: ' + part);
  if (!fs.existsSync(vesselDir(id))) throw new Error('Vessel not found');
  const merged = mergePartOnWrite(id, part, allowed[part], data);
  writeJson(vesselPath(id, allowed[part]), merged);
  touchVessel(id);
  return merged;
}

/**
 * Saved reports and bunkering history only ever grow, so a write of them is a
 * contribution rather than a replacement. A tablet that was offline for a week
 * replays its queue holding the history as it was a week ago; overwriting with
 * that would delete every report the server gained in between. Union by id
 * instead, newest copy of a given id winning.
 *
 * Removal still works, because deletions go through their own DELETE route
 * rather than by sending a shorter list.
 */
function mergePartOnWrite(id, part, file, data) {
  if (part === 'reportHistory') {
    return unionById(readJson(vesselPath(id, file), []), data, 'savedAt');
  }
  if (part === 'bunkerHistory') {
    const current = readJson(vesselPath(id, file), emptyBunkerHistory());
    const incoming = data && typeof data === 'object' ? data : {};
    const out = { ...current };
    for (const key of ['plans', 'after', 'summaries']) {
      out[key] = unionById(current[key], incoming[key], 'savedAt');
    }
    return out;
  }
  return data;
}

/** Union two id-keyed lists, keeping whichever copy of an id is newer. */
function unionById(currentList, incomingList, stampKey) {
  const current = Array.isArray(currentList) ? currentList : [];
  const incoming = Array.isArray(incomingList) ? incomingList : [];
  if (!current.length) return incoming;
  if (!incoming.length) return current;
  const byId = new Map();
  const order = [];
  const put = (item) => {
    if (!item || typeof item !== 'object') return;
    const key = item.id != null ? String(item.id) : null;
    if (key == null) { order.push({ key: Symbol('anon'), item }); return; }
    const seen = byId.get(key);
    if (!seen) {
      byId.set(key, item);
      order.push({ key, item });
      return;
    }
    // Same id on both sides: keep the one stamped later.
    const a = String(seen[stampKey] || '');
    const b = String(item[stampKey] || '');
    if (b > a) byId.set(key, item);
  };
  current.forEach(put);
  incoming.forEach(put);
  return order.map((e) => (typeof e.key === 'string' ? byId.get(e.key) : e.item))
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

function updateVesselDetails(id, patch) {
  const vessel = readJson(vesselPath(id, 'vessel.json'));
  if (!vessel) throw new Error('Vessel not found');
  Object.assign(vessel, patch, { id: vessel.id, updatedAt: now() });
  writeJson(vesselPath(id, 'vessel.json'), vessel);
  touchVessel(id);
  return vessel;
}

function findTankInBundle(tanks, tankId) {
  for (const cat of Object.keys(tanks)) {
    const t = (tanks[cat] || []).find((x) => x.id === tankId);
    if (t) return t;
  }
  return null;
}

function upsertTank(vesselId, tank) {
  const tanks = readJson(vesselPath(vesselId, 'tanks.json'), emptyTanks());
  const category = tank.category || 'fuel';
  if (!tanks[category]) tanks[category] = [];
  const idx = tanks[category].findIndex((t) => t.id === tank.id);
  const normalized = {
    calcType: 'correction',
    correctionDivisor: 10,
    trimAxis: [],
    trimVals: [],
    trimGrid: [],
    listAxis: [],
    listVals: [],
    listGrid: [],
    volumeCurve: { x: [], v: [] },
    capacity: 0,
    pipeHeight: 0,
    soundingMethod: 'ullage',
    fuelRole: 'storage',
    side: 'center',
    tankNo: null,
    fuelGrade: 'hfo',
    ...tank,
    category,
    updatedAt: now(),
  };
  if (idx >= 0) tanks[category][idx] = { ...tanks[category][idx], ...normalized };
  else {
    if (!normalized.id) {
      normalized.id = `${category}${Date.now().toString(36)}`;
    }
    tanks[category].push(normalized);
  }
  writeJson(vesselPath(vesselId, 'tanks.json'), tanks);
  touchVessel(vesselId);
  return normalized;
}

function deleteTank(vesselId, tankId) {
  const tanks = readJson(vesselPath(vesselId, 'tanks.json'), emptyTanks());
  let removed = false;
  for (const cat of Object.keys(tanks)) {
    const before = tanks[cat].length;
    tanks[cat] = tanks[cat].filter((t) => t.id !== tankId);
    if (tanks[cat].length !== before) removed = true;
  }
  if (!removed) throw new Error('Tank not found');
  const readings = readJson(vesselPath(vesselId, 'readings.json'), {});
  delete readings[tankId];
  writeJson(vesselPath(vesselId, 'tanks.json'), tanks);
  writeJson(vesselPath(vesselId, 'readings.json'), readings);
  touchVessel(vesselId);
  return { ok: true };
}

function updateCalibration(vesselId, tankId, calibration) {
  const tanks = readJson(vesselPath(vesselId, 'tanks.json'), emptyTanks());
  const tank = findTankInBundle(tanks, tankId);
  if (!tank) throw new Error('Tank not found');
  const fields = [
    'calcType',
    'correctionDivisor',
    'trimAxis',
    'trimVals',
    'trimGrid',
    'listAxis',
    'listVals',
    'listGrid',
    'volumeCurve',
    'capacity',
    'pipeHeight',
    'soundingMethod',
    'soundingIncrement',
    'heelIncrement',
  ];
  for (const f of fields) {
    if (calibration[f] !== undefined) tank[f] = calibration[f];
  }
  tank.updatedAt = now();
  writeJson(vesselPath(vesselId, 'tanks.json'), tanks);
  touchVessel(vesselId);
  return tank;
}

function exportBackup() {
  ensureDirs();
  const index = loadIndex();
  const settings = getSettings();
  const vessels = {};
  for (const v of index.vessels) {
    vessels[v.id] = getVesselBundle(v.id);
  }
  return {
    format: 'vessel-fuel-tms-backup',
    version: 1,
    exportedAt: now(),
    settings,
    index,
    vessels,
  };
}

function importBackup(backup, { merge = true } = {}) {
  if (!backup || backup.format !== 'vessel-fuel-tms-backup') {
    throw new Error('Invalid backup format');
  }
  ensureDirs();
  if (backup.settings) writeJson(settingsPath(), { ...defaultSettings(), ...backup.settings });

  const index = merge ? loadIndex() : { vessels: [], activeVesselId: null, updatedAt: now() };
  const byId = new Map(index.vessels.map((v) => [v.id, v]));

  for (const [id, bundle] of Object.entries(backup.vessels || {})) {
    const dir = vesselDir(id);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(vesselPath(id, 'vessel.json'), bundle.vessel);
    writeJson(vesselPath(id, 'tanks.json'), bundle.tanks || emptyTanks());
    writeJson(vesselPath(id, 'readings.json'), bundle.readings || {});
    writeJson(vesselPath(id, 'voyage.json'), bundle.voyage || emptyVoyage());
    writeJson(vesselPath(id, 'bunkering.json'), bundle.bunkering || emptyBunkering());
    writeJson(vesselPath(id, 'transfers.json'), bundle.transfers || []);
    writeJson(vesselPath(id, 'bunker-ops.json'), bundle.bunkerOps || []);
    writeJson(vesselPath(id, 'fuel-report.json'), bundle.fuelReport || null);
    writeJson(vesselPath(id, 'report-history.json'), bundle.reportHistory || []);
    writeJson(vesselPath(id, 'bunker-plan.json'), bundle.bunkerPlan || null);
    writeJson(vesselPath(id, 'bunker-after.json'), bundle.bunkerAfter || null);
    writeJson(vesselPath(id, 'bunker-summary.json'), bundle.bunkerSummary || null);
    writeJson(vesselPath(id, 'bunker-history.json'), bundle.bunkerHistory || emptyBunkerHistory());
    writeJson(vesselPath(id, 'assets.json'), bundle.assets || emptyAssets());
    writeJson(vesselPath(id, 'meta.json'), {
      ...(bundle.meta || {}),
      updatedAt: now(),
      lastImportedAt: now(),
    });
    byId.set(id, {
      id,
      name: bundle.vessel?.name || id,
      imo: bundle.vessel?.imo || '',
      updatedAt: now(),
    });
  }

  index.vessels = Array.from(byId.values());
  if (backup.index?.activeVesselId && byId.has(backup.index.activeVesselId)) {
    index.activeVesselId = backup.index.activeVesselId;
  } else if (!index.activeVesselId && index.vessels.length) {
    index.activeVesselId = index.vessels[0].id;
  }
  saveIndex(index);
  return { ok: true, vesselCount: index.vessels.length };
}

function applySyncPayload(payload) {
  // Merge remote vessel revisions if newer
  const results = [];
  for (const [id, remote] of Object.entries(payload.vessels || {})) {
    const localMeta = fs.existsSync(vesselPath(id, 'meta.json'))
      ? readJson(vesselPath(id, 'meta.json'), { revision: 0 })
      : null;
    const remoteRev = remote.meta?.revision || 0;
    const localRev = localMeta?.revision || 0;
    if (!localMeta || remoteRev >= localRev) {
      const dir = vesselDir(id);
      fs.mkdirSync(dir, { recursive: true });
      for (const file of VESSEL_FILES) {
        const key = file.replace('.json', '');
        const map = {
          vessel: 'vessel',
          tanks: 'tanks',
          readings: 'readings',
          voyage: 'voyage',
          bunkering: 'bunkering',
          transfers: 'transfers',
          'bunker-ops': 'bunkerOps',
          'fuel-report': 'fuelReport',
          'report-history': 'reportHistory',
          'bunker-plan': 'bunkerPlan',
          'bunker-after': 'bunkerAfter',
          'bunker-summary': 'bunkerSummary',
          'bunker-history': 'bunkerHistory',
          assets: 'assets',
          meta: 'meta',
        };
        const dataKey = map[key];
        if (remote[dataKey] !== undefined) {
          writeJson(vesselPath(id, file), remote[dataKey]);
        }
      }
      const index = loadIndex();
      if (!index.vessels.find((v) => v.id === id)) {
        index.vessels.push({
          id,
          name: remote.vessel?.name || id,
          imo: remote.vessel?.imo || '',
          updatedAt: now(),
        });
        saveIndex(index);
      } else {
        touchVessel(id);
      }
      results.push({ id, action: 'pulled', revision: remoteRev });
    } else {
      results.push({ id, action: 'kept-local', revision: localRev });
    }
  }
  return results;
}

function syncPushBundle() {
  const index = loadIndex();
  const vessels = {};
  for (const v of index.vessels) {
    vessels[v.id] = getVesselBundle(v.id);
  }
  return {
    format: 'vessel-fuel-tms-sync',
    version: 1,
    pushedAt: now(),
    clientId: getSettings().clientId || (saveSettings({ clientId: crypto.randomUUID() }).clientId),
    settings: getSettings(),
    index,
    vessels,
  };
}

const api = {
  ensureDirs,
  getDataDir,
  getVesselsDir,
  rootDataDir,
  activeDataDir,
  emailSlug,
  setUserScope,
  getUserScope,
  runWithUserScope,
  isMasterScope,
  listUserDatabases,
  getSettings,
  saveSettings,
  listVessels,
  getActiveVesselId,
  setActiveVessel,
  createVessel,
  deleteVessel,
  getVesselBundle,
  saveVesselPart,
  updateVesselDetails,
  upsertTank,
  deleteTank,
  updateCalibration,
  exportBackup,
  importBackup,
  applySyncPayload,
  syncPushBundle,
  emptyTanks,
  emptyBunkerHistory,
  emptyAssets,
  emptyVoyage,
  emptyBunkering,
  findTankInBundle,
  now,
};

Object.defineProperty(api, 'DATA_DIR', {
  enumerable: true,
  configurable: true,
  get: () => activeDataDir(),
});
Object.defineProperty(api, 'VESSELS_DIR', {
  enumerable: true,
  configurable: true,
  get: () => getVesselsDir(),
});

return api;
}));
