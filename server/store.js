/**
 * File-based multi-vessel database.
 * Each vessel lives under data/vessels/<vessel-id>/ as separate JSON files
 * so records can be synced, backed up, or copied independently.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const VESSELS_DIR = path.join(DATA_DIR, 'vessels');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const INDEX_PATH = path.join(DATA_DIR, 'vessels-index.json');

const VESSEL_FILES = [
  'vessel.json',
  'tanks.json',
  'readings.json',
  'voyage.json',
  'bunkering.json',
  'transfers.json',
  'bunker-ops.json',
  'meta.json',
];

function ensureDirs() {
  fs.mkdirSync(VESSELS_DIR, { recursive: true });
  if (!fs.existsSync(SETTINGS_PATH)) {
    writeJson(SETTINGS_PATH, defaultSettings());
  }
  if (!fs.existsSync(INDEX_PATH)) {
    writeJson(INDEX_PATH, { vessels: [], activeVesselId: null, updatedAt: now() });
  }
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
  return path.join(VESSELS_DIR, id);
}

function vesselPath(id, file) {
  return path.join(vesselDir(id), file);
}

function loadIndex() {
  ensureDirs();
  return readJson(INDEX_PATH, { vessels: [], activeVesselId: null, updatedAt: now() });
}

function saveIndex(index) {
  index.updatedAt = now();
  writeJson(INDEX_PATH, index);
}

function getSettings() {
  ensureDirs();
  return readJson(SETTINGS_PATH, defaultSettings());
}

function saveSettings(patch) {
  const current = getSettings();
  const next = { ...current, ...patch, updatedAt: now() };
  writeJson(SETTINGS_PATH, next);
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
  let id = details.id || base;
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
  };
  if (!allowed[part]) throw new Error('Unknown part: ' + part);
  if (!fs.existsSync(vesselDir(id))) throw new Error('Vessel not found');
  writeJson(vesselPath(id, allowed[part]), data);
  touchVessel(id);
  return data;
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
  if (backup.settings) writeJson(SETTINGS_PATH, { ...defaultSettings(), ...backup.settings });

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

module.exports = {
  ensureDirs,
  DATA_DIR,
  VESSELS_DIR,
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
  emptyVoyage,
  emptyBunkering,
  findTankInBundle,
  now,
};
