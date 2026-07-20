/**
 * Vessel Fuel Tank Management — local / Proxmox LXC web server
 * Serves SPA + REST API. Works offline; syncs when a remote peer is configured.
 */
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const store = require('./store');
const { computeTank } = require('./calc');
const excelImport = require('./excel-import');
const pdfImport = require('./pdf-import');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3080;
const HOST = process.env.HOST || '0.0.0.0';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

store.ensureDirs();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
}));

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function resolveVesselId(req) {
  return req.params.id || req.query.vesselId || store.getActiveVesselId();
}

/* ---------- Health / status ---------- */
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    offlineCapable: true,
    time: new Date().toISOString(),
    activeVesselId: store.getActiveVesselId(),
    vesselCount: store.listVessels().length,
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    settings: store.getSettings(),
    vessels: store.listVessels(),
    activeVesselId: store.getActiveVesselId(),
  });
});

/* ---------- Settings ---------- */
app.get('/api/settings', (req, res) => res.json(store.getSettings()));
app.put('/api/settings', (req, res) => res.json(store.saveSettings(req.body || {})));

/* ---------- Vessels ---------- */
app.get('/api/vessels', (req, res) => {
  res.json({
    vessels: store.listVessels(),
    activeVesselId: store.getActiveVesselId(),
  });
});

app.post('/api/vessels', asyncHandler(async (req, res) => {
  const vessel = store.createVessel(req.body || {});
  res.status(201).json(vessel);
}));

app.post('/api/vessels/active', (req, res) => {
  const { id } = req.body || {};
  res.json(store.setActiveVessel(id));
});

app.get('/api/vessels/:id', (req, res) => {
  try {
    res.json(store.getVesselBundle(req.params.id));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.put('/api/vessels/:id', (req, res) => {
  try {
    res.json(store.updateVesselDetails(req.params.id, req.body || {}));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.delete('/api/vessels/:id', (req, res) => {
  try {
    res.json(store.deleteVessel(req.params.id));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.put('/api/vessels/:id/:part', (req, res) => {
  const allowed = ['tanks', 'readings', 'voyage', 'bunkering', 'transfers', 'bunkerOps'];
  if (!allowed.includes(req.params.part)) {
    return res.status(400).json({ error: 'Invalid part' });
  }
  try {
    res.json(store.saveVesselPart(req.params.id, req.params.part, req.body));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

/* ---------- Tanks ---------- */
app.post('/api/vessels/:id/tanks', (req, res) => {
  try {
    res.status(201).json(store.upsertTank(req.params.id, req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/vessels/:id/tanks/:tankId', (req, res) => {
  try {
    res.json(store.upsertTank(req.params.id, { ...req.body, id: req.params.tankId }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/vessels/:id/tanks/:tankId', (req, res) => {
  try {
    res.json(store.deleteTank(req.params.id, req.params.tankId));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.put('/api/vessels/:id/tanks/:tankId/calibration', (req, res) => {
  try {
    res.json(store.updateCalibration(req.params.id, req.params.tankId, req.body || {}));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

/* ---------- Calculate ---------- */
app.post('/api/vessels/:id/calculate', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const { tankId, inputs } = req.body || {};
    const tank = store.findTankInBundle(bundle.tanks, tankId);
    if (!tank) return res.status(404).json({ error: 'Tank not found' });
    const result = computeTank(tank, inputs || {});
    const reading = {
      ...inputs,
      result,
      savedAt: new Date().toISOString(),
    };
    if (req.body?.save !== false) {
      bundle.readings[tankId] = reading;
      store.saveVesselPart(req.params.id, 'readings', bundle.readings);
    }
    res.json({ result, reading });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ---------- Bunkering distribution ---------- */
app.post('/api/vessels/:id/bunker-distribute', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const {
      quantityMT,
      fuelGrade = 'hfo',
      mode = 'equal-storage',
      density15 = null,
      tempC = 15,
      manual = {},
      apply = false,
      bdn = {},
    } = req.body || {};

    const qty = Number(quantityMT) || 0;
    if (qty <= 0) return res.status(400).json({ error: 'Enter bunker quantity (MT)' });

    const fuelTanks = (bundle.tanks.fuel || []).filter((t) => {
      if (fuelGrade && t.fuelGrade && t.fuelGrade !== 'other' && t.fuelGrade !== fuelGrade) {
        // allow overflow/settling of same family loosely
        if (fuelGrade === 'hfo' && (t.fuelGrade === 'lsfo' || t.fuelGrade === 'hfo')) return true;
        return t.fuelGrade === fuelGrade;
      }
      return t.category === 'fuel';
    });

    let targets = [];
    switch (mode) {
      case 'equal-storage':
        targets = fuelTanks.filter((t) => t.fuelRole === 'storage');
        break;
      case 'port-storage':
        targets = fuelTanks.filter((t) => t.fuelRole === 'storage' && t.side === 'port');
        break;
      case 'starboard-storage':
        targets = fuelTanks.filter((t) => t.fuelRole === 'storage' && t.side === 'starboard');
        break;
      case 'no1-storage':
        targets = fuelTanks.filter((t) => t.fuelRole === 'storage' && t.tankNo === 1);
        break;
      case 'no2-storage':
        targets = fuelTanks.filter((t) => t.fuelRole === 'storage' && t.tankNo === 2);
        break;
      case 'settling':
        targets = fuelTanks.filter((t) => t.fuelRole === 'settling');
        break;
      case 'service':
        targets = fuelTanks.filter((t) => t.fuelRole === 'service');
        break;
      case 'manual':
        targets = fuelTanks.filter((t) => manual[t.id] != null && Number(manual[t.id]) > 0);
        break;
      default:
        targets = fuelTanks.filter((t) => t.fuelRole === 'storage');
    }

    if (!targets.length) {
      return res.status(400).json({ error: 'No matching tanks for distribution mode: ' + mode });
    }

    const allocations = [];
    if (mode === 'manual') {
      let sum = 0;
      for (const t of targets) {
        const mt = Number(manual[t.id]) || 0;
        sum += mt;
        allocations.push(makeAlloc(t, mt, bundle, density15));
      }
      if (Math.abs(sum - qty) > 0.05) {
        return res.status(400).json({
          error: `Manual total ${sum.toFixed(3)} MT does not match received ${qty.toFixed(3)} MT`,
        });
      }
    } else {
      // Capacity-weighted equal fill of remaining space, fallback equal split
      const free = targets.map((t) => {
        const r = bundle.readings[t.id];
        const currentVol = r?.result?.volumeObserved || 0;
        const freeVol = Math.max(0, (t.capacity || 0) - currentVol);
        return { tank: t, freeVol };
      });
      const totalFree = free.reduce((s, x) => s + x.freeVol, 0);
      let remaining = qty;
      free.forEach((x, i) => {
        let mt;
        if (totalFree > 0.01) {
          mt = i === free.length - 1 ? remaining : (qty * x.freeVol) / totalFree;
        } else {
          mt = qty / free.length;
        }
        mt = Math.round(mt * 1000) / 1000;
        remaining = Math.round((remaining - mt) * 1000) / 1000;
        allocations.push(makeAlloc(x.tank, mt, bundle, density15));
      });
    }

    const op = {
      id: 'bop_' + Date.now().toString(36),
      createdAt: new Date().toISOString(),
      quantityMT: qty,
      fuelGrade,
      mode,
      density15,
      tempC,
      bdn: {
        supplier: bdn.supplier || '',
        barge: bdn.barge || '',
        bdnNo: bdn.bdnNo || '',
        port: bdn.port || '',
        sulfur: bdn.sulfur || '',
        date: bdn.date || new Date().toISOString().slice(0, 10),
      },
      allocations,
      applied: false,
    };

    if (apply) {
      // Convert MT → observed m3 approx using density/WCF and add to readings
      for (const a of allocations) {
        const tank = store.findTankInBundle(bundle.tanks, a.tankId);
        if (!tank) continue;
        const dens = density15 || store.getSettings().defaultDensity?.[fuelGrade] || 0.95;
        const wcf = dens - 0.0011;
        const addVol15 = wcf > 0 ? a.mt / wcf : 0;
        // Use VCF~1 at 15C for planning add — observed ≈ vol15 when temp unknown
        const addObs = addVol15;
        const prev = bundle.readings[a.tankId];
        const prevVol = prev?.result?.volumeObserved || 0;
        const newVol = Math.min((tank.capacity || Infinity) * 1.02, prevVol + addObs);
        const inputs = {
          reading: newVol,
          trim: bundle.voyage?.trim || 0,
          list: bundle.voyage?.heel || 0,
          tempC: tempC ?? 15,
          density15: dens,
          gaugeType: 'volume',
        };
        const result = computeTank(tank, inputs);
        bundle.readings[a.tankId] = {
          ...inputs,
          result,
          savedAt: new Date().toISOString(),
          fromBunkerOp: op.id,
        };
        a.afterVolume = result.volumeObserved;
        a.afterWeight = result.weightMT;
      }
      op.applied = true;
      const ops = bundle.bunkerOps || [];
      ops.unshift(op);
      store.saveVesselPart(req.params.id, 'readings', bundle.readings);
      store.saveVesselPart(req.params.id, 'bunkerOps', ops);

      // Update bunkering received totals
      const bunk = bundle.bunkering || store.emptyBunkering();
      if (bunk[fuelGrade]) {
        bunk[fuelGrade].received = (Number(bunk[fuelGrade].received) || 0) + qty;
        store.saveVesselPart(req.params.id, 'bunkering', bunk);
      }
    }

    res.json({ operation: op, allocations });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function makeAlloc(tank, mt, bundle, density15) {
  const r = bundle.readings[tank.id];
  return {
    tankId: tank.id,
    name: tank.name,
    side: tank.side,
    tankNo: tank.tankNo,
    fuelRole: tank.fuelRole,
    capacity: tank.capacity,
    beforeVolume: r?.result?.volumeObserved || 0,
    beforeWeight: r?.result?.weightMT || 0,
    mt,
    density15,
  };
}

/* ---------- Backup / import ---------- */
app.get('/api/backup', (req, res) => {
  const backup = store.exportBackup();
  res.setHeader('Content-Disposition', `attachment; filename="fuel-tms-backup-${Date.now()}.json"`);
  res.json(backup);
});

app.post('/api/backup/import', upload.single('file'), (req, res) => {
  try {
    let backup = req.body?.backup;
    if (req.file) backup = JSON.parse(req.file.buffer.toString('utf8'));
    else if (typeof backup === 'string') backup = JSON.parse(backup);
    const result = store.importBackup(backup, { merge: req.body?.merge !== 'false' });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ---------- Sync (local <-> Proxmox / remote peer) ---------- */
app.get('/api/sync/export', (req, res) => {
  res.json(store.syncPushBundle());
});

app.post('/api/sync/import', (req, res) => {
  try {
    const results = store.applySyncPayload(req.body || {});
    res.json({ ok: true, results });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/sync/pull', asyncHandler(async (req, res) => {
  const settings = store.getSettings();
  const url = (req.body?.syncUrl || settings.syncUrl || '').replace(/\/$/, '');
  if (!url) return res.status(400).json({ error: 'No sync URL configured' });
  const resp = await fetch(`${url}/api/sync/export`);
  if (!resp.ok) throw new Error('Remote sync failed: HTTP ' + resp.status);
  const payload = await resp.json();
  const results = store.applySyncPayload(payload);
  if (payload.settings) {
    // keep local syncUrl
    const { syncUrl, ...rest } = payload.settings;
    store.saveSettings(rest);
  }
  res.json({ ok: true, results, from: url });
}));

app.post('/api/sync/push', asyncHandler(async (req, res) => {
  const settings = store.getSettings();
  const url = (req.body?.syncUrl || settings.syncUrl || '').replace(/\/$/, '');
  if (!url) return res.status(400).json({ error: 'No sync URL configured' });
  const payload = store.syncPushBundle();
  const resp = await fetch(`${url}/api/sync/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error('Remote sync push failed: HTTP ' + resp.status);
  const result = await resp.json();
  res.json({ ok: true, remote: result, to: url });
}));

/* ---------- Excel workbook import (Tank1–Tank4) ---------- */
app.post('/api/vessels/:id/import-excel', upload.single('file'), asyncHandler(async (req, res) => {
  let result;
  if (req.file) {
    result = await excelImport.importWorkbookBuffer(req.file.buffer, req.file.originalname || 'upload.xlsm');
  } else if (req.body?.useRepoFile) {
    result = await excelImport.importWorkbook(excelImport.defaultWorkbookPath());
  } else if (req.body?.path) {
    result = await excelImport.importWorkbook(req.body.path);
  } else {
    return res.status(400).json({ error: 'Upload a .xlsm/.xlsx file or pass useRepoFile:true' });
  }

  // Merge imported tanks into vessel (match by fuzzy name across categories)
  const bundle = store.getVesselBundle(req.params.id);
  const tanks = bundle.tanks || store.emptyTanks();
  const createMissing = req.body?.createMissing === true || req.body?.createMissing === 'true';
  let updated = 0;
  let created = 0;
  let skipped = 0;
  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  function findExisting(name) {
    const n = norm(name);
    for (const cat of Object.keys(tanks)) {
      const idx = (tanks[cat] || []).findIndex((t) => {
        const tn = norm(t.name);
        return tn === n || tn.includes(n) || n.includes(tn);
      });
      if (idx >= 0) return { cat, idx };
    }
    return null;
  }

  for (const [cat, arr] of Object.entries(result.tanks || {})) {
    if (!tanks[cat]) tanks[cat] = [];
    for (const incoming of arr) {
      const hit = findExisting(incoming.name);
      if (hit) {
        const prev = tanks[hit.cat][hit.idx];
        // Refresh calibration grids from Excel; keep validated local metadata/calcType
        tanks[hit.cat][hit.idx] = {
          ...prev,
          trimAxis: incoming.trimAxis,
          trimVals: incoming.trimVals,
          trimGrid: incoming.trimGrid,
          listAxis: incoming.listAxis,
          listVals: incoming.listVals,
          listGrid: incoming.listGrid,
          volumeCurve: incoming.volumeCurve,
          soundingIncrement: incoming.soundingIncrement || prev.soundingIncrement,
          heelIncrement: incoming.heelIncrement || prev.heelIncrement,
          pipeHeight: incoming.pipeHeight != null ? incoming.pipeHeight : prev.pipeHeight,
          capacity: incoming.capacity || prev.capacity,
          updatedAt: new Date().toISOString(),
          excelSource: incoming.name,
        };
        updated++;
      } else if (createMissing) {
        const id = incoming.id || `${cat}${Date.now().toString(36)}${created}`;
        tanks[cat].push({ ...incoming, id, category: cat });
        created++;
      } else {
        skipped++;
      }
    }
  }
  store.saveVesselPart(req.params.id, 'tanks', tanks);
  res.json({
    ok: true,
    found: result.found,
    setup: result.setup,
    updated,
    created,
    skipped,
  });
}));

app.get('/api/reference/conversion', (req, res) => {
  const p = path.join(__dirname, '..', 'seed', 'conversion.json');
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'conversion.json not found' });
  res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
});

/* ---------- PDF table extract / apply to tank calibration ---------- */
app.post('/api/vessels/:id/import-pdf', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF file (field name: file)' });
  const pages = String(req.body?.pages || '')
    .split(/[,;\s]+/)
    .map((n) => parseInt(n, 10))
    .filter((n) => n > 0);
  const result = await pdfImport.extractFromBuffer(req.file.buffer, {
    pages: pages.length ? pages : undefined,
  });
  const includeRaw = req.body?.includeRaw === true || req.body?.includeRaw === 'true';
  res.json({ ok: true, ...pdfImport.summarizeTables(result, includeRaw) });
}));

app.post('/api/vessels/:id/tanks/:tankId/import-pdf', upload.single('file'), asyncHandler(async (req, res) => {
  const vesselId = req.params.id;
  const tankId = req.params.tankId;
  const bundle = store.getVesselBundle(vesselId);
  const tank = store.findTankInBundle(bundle.tanks, tankId);
  if (!tank) return res.status(404).json({ error: 'Tank not found' });

  let tables;
  let pagesMeta;
  if (req.file) {
    const pages = String(req.body?.pages || '')
      .split(/[,;\s]+/)
      .map((n) => parseInt(n, 10))
      .filter((n) => n > 0);
    const result = await pdfImport.extractFromBuffer(req.file.buffer, {
      pages: pages.length ? pages : undefined,
    });
    tables = result.tables || [];
    pagesMeta = result.pages;
  } else if (req.body?.table) {
    let t = req.body.table;
    if (typeof t === 'string') {
      try { t = JSON.parse(t); } catch (_) {
        return res.status(400).json({ error: 'Invalid table JSON' });
      }
    }
    tables = [t];
  } else {
    return res.status(400).json({ error: 'Upload a PDF or pass a previously extracted table object' });
  }

  if (!tables.length) return res.status(400).json({ error: 'No tables found in PDF' });

  const tableId = req.body?.tableId;
  const tableIndex = req.body?.tableIndex != null ? Number(req.body.tableIndex) : 0;
  const table = tableId
    ? tables.find((t) => t.id === tableId)
    : tables[tableIndex] || tables[0];
  if (!table) return res.status(400).json({ error: 'Selected table not found' });

  const target = req.body?.target || 'auto';
  const patch = pdfImport.tableToCalibration(table, target, tank);
  if (patch.raw && !patch.trimAxis && !patch.volumeCurve) {
    return res.status(422).json({
      error: patch.note || 'Could not parse table as calibration data',
      preview: table.preview,
      kind: table.parsed?.kind || 'unknown',
      tables: pdfImport.summarizeTables({ pages: pagesMeta, tables }).tables,
    });
  }

  const apply = req.body?.apply !== false && req.body?.apply !== 'false';
  if (apply) {
    const updated = store.updateCalibration(vesselId, tankId, patch);
    return res.json({
      ok: true,
      applied: true,
      target,
      tableId: table.id,
      kind: table.parsed?.kind,
      patch,
      tank: updated,
      tables: pagesMeta != null
        ? pdfImport.summarizeTables({ pages: pagesMeta, tables }).tables
        : undefined,
    });
  }

  res.json({
    ok: true,
    applied: false,
    target,
    tableId: table.id,
    kind: table.parsed?.kind,
    patch,
    tables: pagesMeta != null
      ? pdfImport.summarizeTables({ pages: pagesMeta, tables }).tables
      : undefined,
  });
}));

/* ---------- CSV tank template / import ---------- */
app.get('/api/templates/tanks.csv', (req, res) => {
  const csv = [
    'id,name,category,fuelRole,side,tankNo,fuelGrade,calcType,capacity,pipeHeight,soundingMethod,correctionDivisor',
    'fuel_new1,NO.3 H.F.O. TANK (P),fuel,storage,port,3,hfo,correction,500,800,ullage,10',
    'fuel_new2,NO.3 H.F.O. TANK (S),fuel,storage,starboard,3,hfo,correction,500,800,ullage,10',
    'fuel_sett_new,H.F.O. SETTLING TANK 2,fuel,settling,center,,hfo,direct,50,0,sounding,1',
    'fuel_svc_new,H.F.O. SERVICE TANK 2,fuel,service,center,,hfo,direct,50,0,sounding,1',
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="tank-import-template.csv"');
  res.send(csv);
});

app.post('/api/vessels/:id/tanks/import-csv', upload.single('file'), (req, res) => {
  try {
    const text = req.file
      ? req.file.buffer.toString('utf8')
      : (req.body?.csv || '');
    const rows = parseCsv(text);
    if (!rows.length) return res.status(400).json({ error: 'No rows found' });
    const created = [];
    for (const row of rows) {
      const tank = {
        id: row.id || undefined,
        name: row.name,
        category: row.category || 'fuel',
        fuelRole: row.fuelRole || 'storage',
        side: row.side || 'center',
        tankNo: row.tankNo ? Number(row.tankNo) : null,
        fuelGrade: row.fuelGrade || 'hfo',
        calcType: row.calcType || 'correction',
        capacity: Number(row.capacity) || 0,
        pipeHeight: Number(row.pipeHeight) || 0,
        soundingMethod: row.soundingMethod || 'ullage',
        correctionDivisor: Number(row.correctionDivisor) || 10,
        trimAxis: [],
        trimVals: [],
        trimGrid: [],
        listAxis: [],
        listVals: [],
        listGrid: [],
        volumeCurve: { x: [0], v: [0] },
      };
      if (!tank.name) continue;
      created.push(store.upsertTank(req.params.id, tank));
    }
    res.json({ ok: true, imported: created.length, tanks: created });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (cols[i] || '').trim(); });
    return row;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/* ---------- Legacy single-file calculator ---------- */
app.get('/legacy', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'tank-management.html'));
});

/* ---------- SPA fallback ---------- */
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`Vessel Fuel TMS listening on http://${HOST}:${PORT}`);
  console.log(`Data directory: ${store.DATA_DIR}`);
});
