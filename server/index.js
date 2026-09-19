/**
 * Tank Chief — local / Proxmox LXC web server
 * Serves SPA + REST API. Works offline; syncs when a remote peer is configured.
 */
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const store = require('./store');
const voyageInventory = require('./voyage-inventory');
const { parseScopedEntitlement, requireSyncAuth } = require('./license-scope');
const {
  computeTank,
  blendFuels,
  bunkerProgress,
  sgToDensity15,
  density15ToSg,
  apiToDensity15,
  lerpLookupInverse,
  vcf54B,
  wcf56,
  volumeFromMT,
} = require('./calc');
const calc = require('./calc');
const excelImport = require('./excel-import');
const pdfImport = require('./pdf-import');
const tankTableIo = require('./tank-table-io');
const giorgisFuelCsv = require('./giorgis-fuel-csv');
const giorgisLubeXlsx = require('./giorgis-lube-xlsx');
const flagEviXlsx = require('./flag-evi-xlsx');
const bunkerLive = require('./bunker-live');
const fuelReport = require('../public/js/fuel-report-core');
const bunkeringCore = require('../public/js/bunkering-core');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3080;
const HOST = process.env.HOST || '0.0.0.0';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

store.ensureDirs();

app.use(cors({
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-license-email',
    'x-license-master',
    'x-act-as-user',
    'x-license-entitlement',
  ],
}));
app.use(express.json({ limit: '50mb' }));

/* Per-request license email scope — requires signed entitlement when scoped.
 * Peer sync orchestration (probe/pull/push) is local UI → this device → peer
 * with SYNC_API_TOKEN only. Do not require license entitlement on these routes
 * or Backup peer sync fails with "Invalid entitlement signature" when the
 * browser still attaches X-License-* from a licensed session. */
app.use((req, res, next) => {
  const p = String(req.path || '');
  if (p === '/api/sync/probe' || p === '/api/sync/pull' || p === '/api/sync/push') {
    return store.runWithUserScope({ email: null, master: false, actAs: null }, () => next());
  }
  const scope = parseScopedEntitlement(req, res);
  if (scope === null) return;
  store.runWithUserScope({
    email: scope.email,
    master: scope.master,
    actAs: scope.actAs,
  }, () => next());
});

app.get('/api/admin/users', (req, res) => {
  if (!store.isMasterScope()) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json({ users: store.listUserDatabases() });
});

app.get('/api/vessel-library', (req, res) => {
  try {
    res.json({ vessels: store.listVesselLibrary() });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to list vessel library' });
  }
});

app.post('/api/vessel-library/import', (req, res) => {
  try {
    const ownerSlug = (req.body && req.body.ownerSlug) || null;
    const vesselId = req.body && req.body.vesselId;
    if (!vesselId) return res.status(400).json({ error: 'vesselId is required' });
    const vessel = store.importVesselProfileFromOwner(ownerSlug, vesselId);
    let voyageLeg = null;
    let voyageCopy = null;
    try {
      const sourceVessel = store.runWithUserScope(
        ownerSlug
          ? { email: ownerSlug, master: true, actAs: ownerSlug }
          : { email: null, master: false, actAs: null },
        () => {
          try {
            return store.getVesselBundle(vesselId).vessel;
          } catch (_) {
            return vessel;
          }
        }
      );
      const leg = voyageInventory.findLatestLegForVessel(ownerSlug, sourceVessel || vessel);
      if (leg) {
        voyageLeg = {
          ownerSlug: leg.ownerSlug,
          vesselSlug: leg.vesselSlug,
          voyageNo: leg.voyageNo,
          condition: leg.condition,
          updatedAt: leg.updatedAt,
          data: leg.data,
        };
        const destScope = store.getUserScope && store.getUserScope();
        const destSlug = destScope && (destScope.actAs || destScope.email)
          ? store.emailSlug(destScope.actAs || destScope.email)
          : null;
        if (destSlug) {
          voyageCopy = voyageInventory.copyLegToOwner(
            leg,
            destSlug,
            (sourceVessel && (sourceVessel.voyageSlug || sourceVessel.id || sourceVessel.name)) || vessel.id
          );
        }
      }
    } catch (legErr) {
      console.warn('[vessel-library] voyage leg copy skipped:', legErr.message);
    }
    res.json({
      ok: true,
      vessel,
      voyageLeg,
      voyageCopy,
      message: voyageCopy
        ? 'Ship particulars imported and latest voyage leg copied into your server database.'
        : (voyageLeg
          ? 'Ship particulars imported. Latest voyage leg was found but could not be scoped to your account.'
          : 'Ship particulars imported. No voyage leg found on the server for this vessel.'),
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Import failed' });
  }
});

app.get('/api/admin/inventory', (req, res) => {
  if (!store.isMasterScope()) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const users = store.listUserDatabases().map((u) => {
      let vessels = [];
      try {
        vessels = store.runWithUserScope(
          { email: u.emailSlug, master: true, actAs: u.emailSlug },
          () => store.listVessels()
        );
      } catch (_) {
        vessels = [];
      }
      return {
        emailSlug: u.emailSlug,
        vesselCount: u.vesselCount,
        vessels: (vessels || []).map((v) => ({
          id: v.id,
          name: v.name,
          imo: v.imo,
          updatedAt: v.updatedAt,
        })),
      };
    });
    /* Also include unscoped root vessels when present. */
    let rootVessels = [];
    try {
      rootVessels = store.runWithUserScope(
        { email: null, master: false, actAs: null },
        () => store.listVessels()
      );
    } catch (_) {
      rootVessels = [];
    }
    const voyageLegs = voyageInventory.listAllVoyageLegs().map((leg) => ({
      ownerSlug: leg.ownerSlug,
      vesselSlug: leg.vesselSlug,
      voyageNo: leg.voyageNo,
      condition: leg.condition,
      updatedAt: leg.updatedAt,
    }));
    res.json({
      users,
      rootVessels: (rootVessels || []).map((v) => ({
        id: v.id,
        name: v.name,
        imo: v.imo,
        updatedAt: v.updatedAt,
      })),
      voyageLegs,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Inventory failed' });
  }
});


/* Points standalone EXE / portable builds at the production license host. */
app.get('/js/license-config.js', (req, res) => {
  const raw = (process.env.LICENSE_SERVER_URL || process.env.CHENG_LICENSE_API || '').replace(/\/$/, '');
  let api = '';
  if (raw) {
    api = /\/api\/license$/i.test(raw) ? raw : `${raw}/api/license`;
  }
  res.type('application/javascript');
  res.setHeader('Cache-Control', 'no-store');
  res.send(`window.CHENG_LICENSE_API=${JSON.stringify(api)};\n`);
});

app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
    }
  },
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

/* ---------- Fuel oil report (TANK CONDITION sheet) ---------- */
function conversionTable() {
  const p = path.join(__dirname, '..', 'seed', 'conversion.json');
  if (!fs.existsSync(p)) return { apiToDensity15: [], rdToDensity15: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function buildFuelReport(vesselId, form) {
  const bundle = store.getVesselBundle(vesselId);
  const source = form !== undefined && form !== null ? form : bundle.fuelReport;
  return { bundle, computed: fuelReport.computeFuelReport(bundle, source, conversionTable()) };
}

/** Selectors, labels and constants the report form is built from. */
app.get('/api/reference/fuel-report-options', (req, res) => {
  res.json({
    reportTypes: fuelReport.REPORT_TYPES,
    fuelTypes: fuelReport.FUEL_TYPES,
    unitStandards: fuelReport.UNIT_STANDARDS,
    methods: fuelReport.METHODS,
    heelOptions: fuelReport.HEEL_OPTIONS,
    sections: fuelReport.SECTIONS,
    lubeFields: fuelReport.LUBE_FIELDS,
    receivedFields: fuelReport.RECEIVED_FIELDS,
    consumptionFields: fuelReport.CONSUMPTION_FIELDS,
    capacityMtFactor: fuelReport.CAPACITY_MT_FACTOR,
    safeFillRatio: fuelReport.SAFE_FILL_RATIO,
    lubeDensity: fuelReport.LUBE_DENSITY,
  });
});

/** Saved report form + everything computed from it. */
app.get('/api/vessels/:id/fuel-report', (req, res) => {
  try {
    const { bundle, computed } = buildFuelReport(req.params.id);
    res.json({ form: computed.form, computed, history: bundle.reportHistory || [] });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

/** Recompute a posted form without saving anything (live preview / offline sync). */
app.post('/api/vessels/:id/fuel-report/compute', (req, res) => {
  try {
    const { computed } = buildFuelReport(req.params.id, (req.body && req.body.form) || req.body || {});
    res.json({ computed });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * Save the report form ("PRINT & SAVE").
 * Optionally writes the soundings back as tank readings and appends a snapshot
 * to the report history.
 */
app.put('/api/vessels/:id/fuel-report', (req, res) => {
  try {
    const body = req.body || {};
    const { bundle, computed } = buildFuelReport(req.params.id, body.form || body);
    const form = { ...computed.form, updatedAt: new Date().toISOString() };
    store.saveVesselPart(req.params.id, 'fuelReport', form);

    if (body.syncReadings !== false) {
      store.saveVesselPart(req.params.id, 'readings', fuelReport.readingsFromReport(bundle, computed));
    }

    let history = bundle.reportHistory || [];
    let snapshot = null;
    if (body.snapshot) {
      snapshot = fuelReport.snapshotFromReport(computed);
      history = [snapshot, ...history].slice(0, 50);
      store.saveVesselPart(req.params.id, 'reportHistory', history);
    }

    const voyage = {
      ...(bundle.voyage || {}),
      voyageNo: form.header.voyageNo,
      port: form.header.port,
      reportType: form.header.reportType,
      date: form.header.date,
      time: form.header.time,
      draftFwd: computed.header.draftFwd,
      draftAft: computed.header.draftAft,
      trim: computed.header.trim,
      heel: computed.header.heel,
      seaTemp: form.header.seaTemp,
      engineRoomTemp: form.header.engineRoomTemp,
    };
    store.saveVesselPart(req.params.id, 'voyage', voyage);

    res.json({ form, computed, snapshot, history });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Saved report snapshots, newest first. */
app.get('/api/vessels/:id/fuel-report/history', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    res.json({ history: bundle.reportHistory || [] });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.delete('/api/vessels/:id/fuel-report/history/:snapshotId', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const history = (bundle.reportHistory || []).filter((s) => s.id !== req.params.snapshotId);
    store.replaceVesselPart(req.params.id, 'reportHistory', history);
    res.json({ history });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

/* ---------- Voyage / tank-summary print histories ---------- */
app.delete('/api/vessels/:id/voyage-history/:entryId', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const history = (bundle.voyageHistory || []).filter((s) => s.id !== req.params.entryId);
    store.replaceVesselPart(req.params.id, 'voyageHistory', history);
    res.json({ history });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.delete('/api/vessels/:id/tank-summary-history/:entryId', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const history = (bundle.tankSummaryHistory || []).filter((s) => s.id !== req.params.entryId);
    store.replaceVesselPart(req.params.id, 'tankSummaryHistory', history);
    res.json({ history });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

/* ---------- Bunkering plan, after-bunkering report, report summary ---------- */

/** Read a bunkering history list, newest first. */
function bunkerHistory(bundle) {
  return { plans: [], after: [], summaries: [], ...(bundle.bunkerHistory || {}) };
}

function pushHistory(vesselId, bundle, key, entry) {
  const history = bunkerHistory(bundle);
  history[key] = [entry, ...(history[key] || [])].slice(0, 50);
  store.saveVesselPart(vesselId, 'bunkerHistory', history);
  return history;
}

/** Selectors and constants the bunkering screens are built from. */
app.get('/api/reference/bunkering-options', (req, res) => {
  res.json({
    planSlots: bunkeringCore.PLAN_SLOTS,
    shipConditions: bunkeringCore.SHIP_CONDITIONS,
    summaryEvents: bunkeringCore.SUMMARY_EVENTS,
    commonFuelGrades: bunkeringCore.COMMON_FUEL_GRADES,
    fuelTypes: fuelReport.FUEL_TYPES,
    safeFillRatio: fuelReport.SAFE_FILL_RATIO,
  });
});

/* --- plan + live monitoring --- */

app.get('/api/vessels/:id/bunker-plan', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const computed = bunkeringCore.computeBunkerPlan(bundle, bundle.bunkerPlan, conversionTable());
    res.json({ form: computed.form, computed, history: bunkerHistory(bundle).plans });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.post('/api/vessels/:id/bunker-plan/compute', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const body = req.body || {};
    const computed = bunkeringCore.computeBunkerPlan(bundle, body.form || body, conversionTable());
    res.json({ computed });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/vessels/:id/bunker-plan', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const body = req.body || {};
    const computed = bunkeringCore.computeBunkerPlan(bundle, body.form || body, conversionTable());
    const form = { ...computed.form, updatedAt: new Date().toISOString() };
    store.saveVesselPart(req.params.id, 'bunkerPlan', form);

    let snapshot = null;
    let history = bunkerHistory(bundle).plans;
    if (body.snapshot) {
      snapshot = bunkeringCore.planSnapshot(computed);
      history = pushHistory(req.params.id, bundle, 'plans', snapshot).plans;
    }
    res.json({ form, computed, snapshot, history });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* --- after-bunkering tank condition --- */

app.get('/api/vessels/:id/bunker-after', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const computed = bunkeringCore.computeAfterBunkering(bundle, bundle.bunkerAfter, conversionTable());
    res.json({ form: computed.form, computed, history: bunkerHistory(bundle).after });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.post('/api/vessels/:id/bunker-after/compute', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const body = req.body || {};
    const computed = bunkeringCore.computeAfterBunkering(bundle, body.form || body, conversionTable());
    res.json({ computed });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * "GET DATA" — reseed the after-report from the saved fuel report: prior ROB
 * per grade, and the tank rows to sound again.
 */
app.post('/api/vessels/:id/bunker-after/get-data', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const conversion = conversionTable();
    const body = req.body || {};
    const keepSoundings = body.keepSoundings === true;
    const base = bunkeringCore.emptyAfterReport(bundle, conversion);
    const form = keepSoundings && bundle.bunkerAfter
      ? { ...bundle.bunkerAfter, priorRob: base.priorRob }
      : base;
    const computed = bunkeringCore.computeAfterBunkering(bundle, form, conversion);
    res.json({ form: computed.form, computed });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/vessels/:id/bunker-after', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const body = req.body || {};
    const computed = bunkeringCore.computeAfterBunkering(bundle, body.form || body, conversionTable());
    const form = { ...computed.form, updatedAt: new Date().toISOString() };
    store.saveVesselPart(req.params.id, 'bunkerAfter', form);

    // After bunkering these soundings are the vessel's current condition.
    if (body.syncReadings !== false) {
      store.saveVesselPart(req.params.id, 'readings', fuelReport.readingsFromReport(bundle, computed));
    }

    let snapshot = null;
    let history = bunkerHistory(bundle).after;
    if (body.snapshot) {
      snapshot = bunkeringCore.afterSnapshot(computed);
      history = pushHistory(req.params.id, bundle, 'after', snapshot).after;
    }
    res.json({ form, computed, snapshot, history });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* --- bunkering report summary (BDN paperwork) --- */

app.get('/api/vessels/:id/bunker-summary', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const computed = bunkeringCore.computeBunkerSummary(bundle, bundle.bunkerSummary, null, conversionTable());
    res.json({ form: computed.form, computed, history: bunkerHistory(bundle).summaries });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.post('/api/vessels/:id/bunker-summary/compute', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const body = req.body || {};
    const computed = bunkeringCore.computeBunkerSummary(bundle, body.form || body, null, conversionTable());
    res.json({ computed });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/vessels/:id/bunker-summary', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const body = req.body || {};
    const computed = bunkeringCore.computeBunkerSummary(bundle, body.form || body, null, conversionTable());
    const form = { ...computed.form, updatedAt: new Date().toISOString() };
    store.saveVesselPart(req.params.id, 'bunkerSummary', form);

    let snapshot = null;
    let history = bunkerHistory(bundle).summaries;
    if (body.snapshot) {
      snapshot = bunkeringCore.summarySnapshot(computed);
      history = pushHistory(req.params.id, bundle, 'summaries', snapshot).summaries;
    }
    res.json({ form, computed, snapshot, history });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Everything the bunkering chain holds, for one round trip on page load. */
app.get('/api/vessels/:id/bunkering-chain', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const conversion = conversionTable();
    res.json({
      plan: bunkeringCore.computeBunkerPlan(bundle, bundle.bunkerPlan, conversion),
      after: bunkeringCore.computeAfterBunkering(bundle, bundle.bunkerAfter, conversion),
      summary: bunkeringCore.computeBunkerSummary(bundle, bundle.bunkerSummary, null, conversion),
      history: bunkerHistory(bundle),
    });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.delete('/api/vessels/:id/bunker-history/:list/:entryId', (req, res) => {
  try {
    const list = req.params.list;
    if (!['plans', 'after', 'summaries'].includes(list)) {
      return res.status(400).json({ error: 'Unknown history list' });
    }
    const bundle = store.getVesselBundle(req.params.id);
    const history = bunkerHistory(bundle);
    history[list] = (history[list] || []).filter((e) => e.id !== req.params.entryId);
    store.replaceVesselPart(req.params.id, 'bunkerHistory', history);
    res.json({ history });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.put('/api/vessels/:id/:part', (req, res) => {
  const allowed = [
    'tanks', 'readings', 'voyage', 'bunkering', 'transfers', 'bunkerOps',
    'fuelReport', 'reportHistory', 'voyageHistory', 'tankSummaryHistory', 'tankSummaryDraft',
    'bunkerPlan', 'bunkerAfter', 'bunkerSummary', 'bunkerHistory', 'assets',
  ];
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

/**
 * What arrangement each tank's calibration tables are actually in.
 *
 * Books differ from ship to ship, and a tank imported before the app could
 * tell them apart carries whatever the importer guessed. This reads the
 * stored tables and says what they hold. Nothing is written unless `apply`
 * is set, and then only where the tables are unambiguous — anything the
 * tables leave open is reported and left exactly as it is.
 */
app.post('/api/vessels/:id/tanks/recheck-calc-type', (req, res) => {
  try {
    const apply = String(req.query.apply || req.body?.apply || '') === '1'
      || req.body?.apply === true;
    const bundle = store.getVesselBundle(req.params.id);
    const tanks = Object.values(bundle.tanks || {})
      .filter(Array.isArray).reduce((a, b) => a.concat(b), []);
    const report = [];
    for (const tank of tanks) {
      const verdict = calc.detectCalcType(tank);
      const was = tank.calcType || null;
      const change = !!(verdict.confident && verdict.calcType && verdict.calcType !== was);
      if (change && apply) {
        // The whole tank goes back, not just the changed field: upsertTank
        // fills anything absent with its own empty defaults, so a partial
        // write would take the calibration grids with it.
        store.upsertTank(req.params.id, {
          ...tank, calcType: verdict.calcType,
          calcTypeReason: verdict.reason, calcTypeConfident: true,
        });
      }
      report.push({
        id: tank.id, name: tank.name, category: tank.category,
        was, now: change ? verdict.calcType : was,
        changed: change, confident: !!verdict.confident, reason: verdict.reason,
      });
    }
    res.json({
      applied: apply,
      total: report.length,
      changed: report.filter((r) => r.changed).length,
      unsure: report.filter((r) => !r.confident).length,
      tanks: report,
    });
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

function computeBunkerDistribution(bundle, body = {}) {
  const {
    quantityMT,
    fuelGrade = 'hfo',
    mode = 'equal-storage',
    density15 = null,
    tempC = 15,
    manual = {},
    bdn = {},
  } = body;

  const qty = Number(quantityMT) || 0;
  if (qty <= 0) throw new Error('Enter bunker quantity (MT) to be received');

  const fuelTanks = (bundle.tanks.fuel || []).filter((t) => {
    if (fuelGrade && t.fuelGrade && t.fuelGrade !== 'other' && t.fuelGrade !== fuelGrade) {
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
    throw new Error('No matching tanks for distribution mode: ' + mode);
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
      throw new Error(`Manual total ${sum.toFixed(3)} MT does not match received ${qty.toFixed(3)} MT`);
    }
  } else {
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
    plannedMT: qty,
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

  return { operation: op, allocations };
}

app.post('/api/vessels/:id/bunker-distribute', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const apply = !!req.body?.apply;
    const { operation: op, allocations } = computeBunkerDistribution(bundle, req.body || {});
    const density15 = op.density15;
    const fuelGrade = op.fuelGrade;
    const tempC = op.tempC;
    const qty = op.quantityMT;

    if (apply) {
      for (const a of allocations) {
        const tank = store.findTankInBundle(bundle.tanks, a.tankId);
        if (!tank) continue;
        const dens = density15 || store.getSettings().defaultDensity?.[fuelGrade] || 0.95;
        const wcf = dens - 0.0011;
        const addVol15 = wcf > 0 ? a.mt / wcf : 0;
        const addObs = addVol15;
        const prev = bundle.readings[a.tankId];
        const prevVol = prev?.result?.volumeObserved || 0;
        const newVol = Math.min((tank.capacity || Infinity) * 1.02, prevVol + addObs);
        const inputs = {
          reading: newVol,
          trim: (() => {
            const v = bundle.voyage || {};
            const fwd = Number(v.draftFwd);
            const aft = Number(v.draftAft);
            if (Number.isFinite(fwd) && Number.isFinite(aft)) return aft - fwd;
            return Number(v.trim) || 0;
          })(),
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
      op.status = 'completed';
      op.receivedMT = qty;
      op.completedAt = new Date().toISOString();
      const ops = bundle.bunkerOps || [];
      ops.unshift(op);
      store.saveVesselPart(req.params.id, 'readings', bundle.readings);
      store.saveVesselPart(req.params.id, 'bunkerOps', ops);

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

/* ---------- Live bunkering operation ---------- */
app.get('/api/vessels/:id/bunker-ops/active', (req, res) => {
  try {
    const op = bunkerLive.getActiveOp(req.params.id);
    if (!op) return res.json({ active: null });
    res.json({ active: bunkerLive.enrichOp(op) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/vessels/:id/bunker-ops/start', (req, res) => {
  try {
    const existing = bunkerLive.getActiveOp(req.params.id);
    if (existing) {
      return res.status(409).json({
        error: 'A bunkering operation is already in progress',
        active: bunkerLive.enrichOp(existing),
      });
    }
    const bundle = store.getVesselBundle(req.params.id);
    const dist = computeBunkerDistribution(bundle, req.body || {});
    const op = bunkerLive.buildOpFromDistribute(dist, {
      rateMTPerHour: req.body?.rateMTPerHour,
      intakeMode: req.body?.intakeMode,
    });
    const ops = bundle.bunkerOps || [];
    ops.unshift(op);
    store.saveVesselPart(req.params.id, 'bunkerOps', ops);
    res.status(201).json({ operation: bunkerLive.enrichOp(op) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch('/api/vessels/:id/bunker-ops/:opId', (req, res) => {
  try {
    const op = bunkerLive.updateOp(req.params.id, req.params.opId, req.body || {});
    res.json({ operation: op });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/vessels/:id/bunker-ops/:opId/complete', (req, res) => {
  try {
    const op = bunkerLive.completeOp(req.params.id, req.params.opId, req.body || {});
    res.json({ operation: op });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/vessels/:id/bunker-ops/:opId/cancel', (req, res) => {
  try {
    const op = bunkerLive.cancelOp(req.params.id, req.params.opId);
    res.json({ operation: op });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/vessels/:id/bunker-blend', (req, res) => {
  try {
    const method = req.body?.method || 'wcf';
    const result = blendFuels(req.body?.parts || [], method);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/vessels/:id/bunker-progress', (req, res) => {
  try {
    res.json({ ok: true, ...bunkerProgress(req.body || {}) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

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

app.get('/api/vessels/:id/backup', (req, res) => {
  try {
    const backup = store.exportVesselBackup(req.params.id);
    res.setHeader('Content-Disposition', `attachment; filename="fuel-tms-vessel-${req.params.id}-${Date.now()}.json"`);
    res.json(backup);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

/* ---------- Sync (local <-> Proxmox / remote peer) ---------- */

/** Cheng-Pro serves Tank Chief at /tanks; standalone Tank Chief uses the root.
 *  Prefer root first for dedicated Tank hosts; otherwise /tanks first on HTTPS.
 *  Callers must skip HTML 200 responses and try the next base. */
function peerSyncBases(url) {
  const base = normalizePeerUrl(url);
  if (!base) return [];
  const root = base.replace(/\/tanks$/i, '');
  const withTanks = /\/tanks$/i.test(base) ? base : `${root}/tanks`;
  let host = '';
  try { host = new URL(root).hostname || ''; } catch { /* ignore */ }
  const tankHost = /tank/i.test(host);
  const https = /^https:/i.test(root);
  if (tankHost) return [...new Set([root, withTanks])];
  return https ? [...new Set([withTanks, root])] : [...new Set([root, withTanks])];
}

function peerResponseLooksLikeHtml(resp, text) {
  const ct = String(resp.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('text/html')) return true;
  const trimmed = String(text || '').trim();
  return /^<!doctype|<html/i.test(trimmed);
}

/** Trim, strip trailing slash, and add http:// when the scheme is missing. */
function normalizePeerUrl(url) {
  let s = String(url || '').trim();
  if (!s) return '';
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) s = 'http://' + s;
  return s.replace(/\/$/, '');
}

function describePeerFetchError(err, url) {
  const msg = (err && err.message) ? String(err.message) : String(err || 'unknown error');
  const target = String(url || '').trim() || '(no URL)';
  if (/Failed to fetch|fetch failed|NetworkError|Load failed|getaddrinfo|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|certificate|SSL|TLS/i.test(msg)) {
    return (
      'Could not reach peer at ' + target + '. ' +
      'Use your ChEng AIO LAN address (e.g. http://192.168.0.132:8080) while on ship Wi‑Fi, ' +
      'or a public hostname that actually resolves and serves ChEng AIO. ' +
      'HTTPS needs a valid certificate. Standalone Tank Chief uses port 3080. ' +
      '(' + msg + ')'
    );
  }
  return msg + ' (' + target + ')';
}

function peerScopeFromRequest(req) {
  /* Peer Tank/AIO authenticates with SYNC_API_TOKEN only. Do not forward
   * license entitlement headers — the peer may use a different signing secret
   * and answers "Invalid entitlement signature", which blocked peer sync. */
  return {};
}

function peerAuthHeadersFromBody(body) {
  /* Token only — never forward license entitlement to a peer. */
  const headers = {};
  const token = String(body?.syncApiToken || body?.apiToken || '').trim();
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

async function fetchPeerSync(url, apiPath, init) {
  const bases = peerSyncBases(url);
  if (!bases.length) throw new Error('No sync URL configured');
  const auth = peerAuthHeadersFromBody(init && init.authBody);
  const reqInit = { ...(init || {}) };
  delete reqInit.authBody;
  reqInit.headers = { ...(reqInit.headers || {}), ...auth };
  let lastErr = null;
  let lastResp = null;
  let lastHtml = false;
  for (const base of bases) {
    try {
      const resp = await fetch(`${base}${apiPath}`, reqInit);
      if (resp.status === 404) {
        lastResp = resp;
        continue;
      }
      let bodyText = '';
      try { bodyText = await resp.clone().text(); } catch { /* ignore */ }
      const html = peerResponseLooksLikeHtml(resp, bodyText);
      /* Wrong mount (SPA HTML) — try the other base before giving up. */
      if (html) {
        lastResp = resp;
        lastHtml = true;
        continue;
      }
      if (resp.ok || resp.status !== 404) return resp;
      lastResp = resp;
    } catch (err) {
      lastErr = err;
      lastErr.peerUrl = base;
    }
  }
  if (lastHtml && lastResp) {
    throw new Error(
      'Peer returned an HTML page (HTTP ' + lastResp.status + ') — use the ChEng AIO or Tank Chief API root '
      + '(e.g. http://192.168.x.x:8080 or :3080), not a login page or web app URL.'
    );
  }
  if (lastResp) return lastResp;
  throw new Error(describePeerFetchError(lastErr, bases[0]));
}

async function readPeerSyncJson(resp, url) {
  const bodyText = await resp.text();
  if (peerResponseLooksLikeHtml(resp, bodyText)) {
    throw new Error(
      'Peer returned an HTML page (HTTP ' + resp.status + ') — check sync URL points at ChEng AIO (:8080) '
      + 'or Tank Chief (:3080), not a login page or wrong path.'
    );
  }
  let payload = null;
  try { payload = bodyText ? JSON.parse(bodyText) : null; } catch { /* below */ }
  if (!resp.ok) {
    const detail = (payload && payload.error) || ('HTTP ' + resp.status);
    throw new Error('Remote sync failed: ' + detail + ' from ' + url);
  }
  return payload;
}

app.get('/api/sync/ping', (req, res) => {
  const bundle = store.syncPushBundle();
  res.json({
    ok: true,
    format: 'vessel-fuel-tms-sync',
    product: 'tank-chief',
    vesselCount: (bundle.index && bundle.index.vessels) ? bundle.index.vessels.length : store.listVessels().length,
    time: new Date().toISOString(),
  });
});

app.get('/api/sync/export', requireSyncAuth, (req, res) => {
  res.json(store.syncPushBundle());
});

app.post('/api/sync/import', requireSyncAuth, (req, res) => {
  try {
    const results = store.applySyncPayload(req.body || {});
    res.json({ ok: true, results });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/sync/probe', asyncHandler(async (req, res) => {
  const settings = store.getSettings();
  const url = normalizePeerUrl(req.body?.syncUrl || settings.syncUrl || '');
  if (!url) return res.status(400).json({ error: 'No sync URL configured' });
  const bases = peerSyncBases(url);
  const tried = [];
  for (const base of bases) {
    for (const apiPath of ['/api/sync/ping', '/api/health', '/api/sync/export']) {
      const full = base + apiPath;
      try {
        const resp = await fetch(full, {
          method: 'GET',
          cache: 'no-store',
          headers: peerAuthHeadersFromBody({
            syncApiToken: req.body?.syncApiToken || settings.syncApiToken || '',
            ...peerScopeFromRequest(req),
          }),
        });
        let product = null;
        let format = null;
        let bodyText = '';
        try {
          bodyText = await resp.clone().text();
        } catch { /* ignore */ }
        if (peerResponseLooksLikeHtml(resp, bodyText)) {
          tried.push({ url: full, status: resp.status, ok: false, error: 'HTML page (wrong mount or SPA)' });
          continue;
        }
        try {
          const body = bodyText ? JSON.parse(bodyText) : null;
          product = body && (body.product || (body.ok ? 'tank-chief' : null));
          format = (body && body.format) || null;
        } catch { /* ignore non-JSON */ }
        tried.push({ url: full, status: resp.status, ok: resp.ok, product, format });
        if (resp.ok && (
          format === 'vessel-fuel-tms-sync'
          || apiPath === '/api/sync/ping'
          || (apiPath === '/api/health' && product === 'tank-chief')
        )) {
          return res.json({
            ok: true,
            base,
            path: apiPath,
            product: product || 'reachable',
            format,
            tried,
            hint: 'Peer Tank sync is reachable. Keep this phone on “On this device” and use Pull/Push.',
          });
        }
      } catch (err) {
        tried.push({ url: full, ok: false, error: err.message || String(err) });
      }
    }
  }
  res.status(502).json({
    ok: false,
    tried,
    error: describePeerFetchError(
      new Error((tried.find((t) => t.error) || {}).error || 'Failed to fetch'),
      url
    ),
  });
}));

app.post('/api/sync/pull', asyncHandler(async (req, res) => {
  const settings = store.getSettings();
  const url = normalizePeerUrl(req.body?.syncUrl || settings.syncUrl || '');
  if (!url) return res.status(400).json({ error: 'No sync URL configured' });
  const authBody = {
    syncApiToken: req.body?.syncApiToken || settings.syncApiToken || '',
    ...peerScopeFromRequest(req),
  };
  const resp = await fetchPeerSync(url, '/api/sync/export', { authBody });
  const payload = await readPeerSyncJson(resp, url);
  if (!payload || payload.format !== 'vessel-fuel-tms-sync') {
    throw new Error('Peer did not return a Tank sync bundle — check URL (AIO :8080, Tank :3080) and token');
  }
  const remoteCount = Object.keys(payload.vessels || {}).length;
  if (!remoteCount) {
    return res.json({
      ok: true,
      results: [],
      from: url,
      warning: 'Peer returned 0 vessels — add vessels on the peer or check its data folder',
    });
  }
  const results = store.applySyncPayload(payload);
  if (payload.settings) {
    const { syncUrl, syncApiToken, ...rest } = payload.settings;
    store.saveSettings(rest);
  }
  res.json({ ok: true, results, from: url, remoteCount });
}));

app.post('/api/sync/push', asyncHandler(async (req, res) => {
  const settings = store.getSettings();
  const url = normalizePeerUrl(req.body?.syncUrl || settings.syncUrl || '');
  if (!url) return res.status(400).json({ error: 'No sync URL configured' });
  const payload = store.syncPushBundle();
  const authBody = {
    syncApiToken: req.body?.syncApiToken || settings.syncApiToken || '',
    ...peerScopeFromRequest(req),
  };
  const resp = await fetchPeerSync(url, '/api/sync/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    authBody,
  });
  const result = await readPeerSyncJson(resp, url);
  res.json({ ok: true, remote: result, to: url });
}));

/* ---------- Excel workbook import (Tank1–Tank4 or FLAG EVI dual-sheet) ---------- */
app.post('/api/vessels/:id/import-excel', upload.single('file'), asyncHandler(async (req, res) => {
  /* FLAG EVI Trim + Heeling Correction workbooks share this endpoint from Calibration. */
  if (req.file && flagEviXlsx.looksLikeFlagEviName(req.file.originalname)) {
    try {
      const flagParsed = await flagEviXlsx.parseFlagEviXlsx(req.file.buffer);
      if (flagParsed?.format === 'flag-evi-xlsx' && (flagParsed.tanks || []).length) {
        const createMissing = req.body?.createMissing !== false && req.body?.createMissing !== 'false';
        const replaceExisting = req.body?.replaceExisting !== false && req.body?.replaceExisting !== 'false';
        const bundle = store.getVesselBundle(req.params.id);
        const norm = (s) => String(s || '').toUpperCase().replace(/TANK/g, 'TK').replace(/[^A-Z0-9]/g, '');
        function findExisting(name) {
          const n = norm(name);
          for (const cat of Object.keys(bundle.tanks || {})) {
            const hit = (bundle.tanks[cat] || []).find((t) => {
              const tn = norm(t.name);
              return tn === n || (n.length > 6 && (tn.includes(n) || n.includes(tn)));
            });
            if (hit) return hit;
          }
          return null;
        }
        let updated = 0;
        let created = 0;
        let skipped = 0;
        const existingTanks = [];
        for (const incoming of flagParsed.tanks) {
          const existing = findExisting(incoming.name);
          if (existing) {
            existingTanks.push({
              sheetName: incoming.name,
              id: existing.id,
              name: existing.name,
              category: existing.category,
            });
            if (!replaceExisting) {
              skipped++;
              continue;
            }
            store.upsertTank(req.params.id, {
              ...incoming,
              id: existing.id,
              category: incoming.category || existing.category || 'fuel',
            });
            updated++;
          } else if (createMissing) {
            store.upsertTank(req.params.id, incoming);
            created++;
          } else {
            skipped++;
          }
        }
        return res.json({
          ok: true,
          format: 'flag-evi-xlsx',
          found: flagParsed.tanks.map((t) => t.name),
          updated,
          created,
          skipped,
          existingTanks,
          warnings: flagParsed.warnings || [],
        });
      }
    } catch {
      /* fall through to Tank1–Tank4 importer */
    }
  }

  let result;
  if (req.file) {
    result = await excelImport.importWorkbookBuffer(req.file.buffer, req.file.originalname || 'upload.xlsm');
  } else if (req.body?.useRepoFile) {
    result = await excelImport.importWorkbook(excelImport.defaultWorkbookPath());
  } else if (req.body?.path) {
    return res.status(400).json({ error: 'path upload is disabled; upload the workbook file instead' });
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

/** Convert between SG (relative density), density @15°C, and API gravity */
app.post('/api/reference/convert-density', (req, res) => {
  try {
    const p = path.join(__dirname, '..', 'seed', 'conversion.json');
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'conversion.json not found' });
    const table = JSON.parse(fs.readFileSync(p, 'utf8'));
    const { from, value } = req.body || {};
    const v = Number(value);
    if (!Number.isFinite(v)) return res.status(400).json({ error: 'Enter a numeric value' });

    let density15 = null;
    let sg = null;
    let api = null;

    if (from === 'sg' || from === 'rd') {
      density15 = sgToDensity15(v, table.rdToDensity15);
      sg = v;
      api = table.apiToDensity15 ? lerpLookupInverse(table.apiToDensity15, density15) : null;
    } else if (from === 'density' || from === 'density15') {
      density15 = v;
      sg = density15ToSg(v, table.rdToDensity15);
      api = table.apiToDensity15 ? lerpLookupInverse(table.apiToDensity15, density15) : null;
    } else if (from === 'api') {
      density15 = apiToDensity15(v, table.apiToDensity15);
      sg = density15ToSg(density15, table.rdToDensity15);
      api = v;
    } else {
      return res.status(400).json({ error: 'from must be sg, density, or api' });
    }

    if (density15 == null) return res.status(400).json({ error: 'Value out of conversion table range' });
    res.json({
      ok: true,
      from,
      input: v,
      density15: Math.round(density15 * 1e6) / 1e6,
      sg: sg != null ? Math.round(sg * 1e6) / 1e6 : null,
      api: api != null ? Math.round(api * 100) / 100 : null,
      note: table.note || 'From workbook Conversion sheet (RD/SG ↔ density @15°C)',
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Single manual VCF (54B) + WCF (56) calculation */
app.post('/api/reference/vcf-wcf', (req, res) => {
  try {
    const density15 = Number(req.body?.density15);
    const tempC = req.body?.tempC != null && req.body?.tempC !== '' ? Number(req.body.tempC) : 15;
    if (!(density15 > 0)) return res.status(400).json({ error: 'Enter density @15°C (kg/L)' });
    if (!Number.isFinite(tempC)) return res.status(400).json({ error: 'Enter a valid temperature °C' });

    const vcf = vcf54B(density15, tempC);
    const wcf = wcf56(density15);
    const out = {
      ok: true,
      density15,
      tempC,
      vcf,
      wcf,
      formula: {
        vcf: 'ASTM Table 54B (workbook reconstruction)',
        wcf: 'ASTM Table 56 style: density15 − 0.0011',
      },
    };

    const volObs = req.body?.volumeObserved != null && req.body.volumeObserved !== ''
      ? Number(req.body.volumeObserved) : null;
    const mtIn = req.body?.quantityMT != null && req.body.quantityMT !== ''
      ? Number(req.body.quantityMT) : null;

    if (volObs != null && Number.isFinite(volObs)) {
      out.volumeObserved = volObs;
      out.volume15 = Math.round(volObs * vcf * 1000) / 1000;
      out.weightMT = Math.round(out.volume15 * wcf * 1000) / 1000;
    } else if (mtIn != null && Number.isFinite(mtIn)) {
      out.quantityMT = mtIn;
      out.volume15 = wcf > 0 ? Math.round((mtIn / wcf) * 1000) / 1000 : null;
      out.volumeObserved = volumeFromMT(mtIn, density15, tempC);
      if (out.volumeObserved != null) out.volumeObserved = Math.round(out.volumeObserved * 1000) / 1000;
    }

    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Reference VCF / WCF lookup tables for display */
app.get('/api/reference/vcf-wcf-tables', (req, res) => {
  const densMin = Number(req.query.densMin) || 0.80;
  const densMax = Number(req.query.densMax) || 1.01;
  const densStep = Number(req.query.densStep) || 0.01;
  const temps = String(req.query.temps || '0,5,10,15,20,25,30,35,40,45,50')
    .split(',')
    .map((t) => Number(t))
    .filter((t) => Number.isFinite(t));

  const wcfRows = [];
  const vcfRows = [];
  for (let d = densMin; d <= densMax + 1e-9; d = Math.round((d + densStep) * 1000) / 1000) {
    const dens = Math.round(d * 1000) / 1000;
    wcfRows.push({ density15: dens, wcf: Math.round(wcf56(dens) * 10000) / 10000 });
    const row = { density15: dens };
    for (const t of temps) row['t' + t] = vcf54B(dens, t);
    vcfRows.push(row);
  }

  res.json({
    ok: true,
    temps,
    wcf: wcfRows,
    vcf: vcfRows,
    note: 'VCF = ASTM Table 54B; WCF = density15 − 0.0011 (workbook Table 56 style)',
  });
});

app.get('/api/reference/iso8217', (req, res) => {
  const p = path.join(__dirname, '..', 'seed', 'iso8217.json');
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'iso8217.json not found' });
  res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
});

/* ---------- PDF table extract / apply to tank calibration ---------- */
function parsePdfImportOpts(body = {}) {
  const pages = String(body.pages || '')
    .split(/[,;\s]+/)
    .map((n) => parseInt(n, 10))
    .filter((n) => n > 0);
  const pageFrom = parseInt(body.pageFrom, 10);
  const pageTo = parseInt(body.pageTo, 10);
  const ocr = body.ocr !== false && body.ocr !== 'false';
  const includeRaw = body.includeRaw === true || body.includeRaw === 'true';
  const spanUntilNextTank = body.spanUntilNextTank !== false && body.spanUntilNextTank !== 'false';
  let tableRole = String(body.tableRole || 'auto').toLowerCase();
  if (!['auto', 'trim', 'heel', 'volume'].includes(tableRole)) tableRole = 'auto';
  const pageMode = String(body.pageMode || (pageFrom || pageTo ? 'range' : 'auto')).toLowerCase();
  return {
    pages: pages.length ? pages : undefined,
    pageFrom: pageMode === 'range' && pageFrom > 0 ? pageFrom : undefined,
    pageTo: pageMode === 'range' && pageTo > 0 ? pageTo : (pageMode === 'range' && pageFrom > 0 ? pageFrom : undefined),
    ocr,
    includeRaw,
    spanUntilNextTank,
    tableRole,
    pageMode,
  };
}

app.post('/api/vessels/:id/import-pdf/jobs', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF file (field name: file)' });
  store.getVesselBundle(req.params.id); // ensure vessel exists
  const opts = parsePdfImportOpts(req.body || {});
  const job = pdfImport.startExtractJob(req.file.buffer, opts);
  res.status(202).json({ ok: true, ...job });
}));

app.get('/api/vessels/:id/import-pdf/jobs/:jobId', asyncHandler(async (req, res) => {
  store.getVesselBundle(req.params.id);
  const job = pdfImport.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired' });
  res.json({ ok: true, ...job });
}));

app.post('/api/vessels/:id/import-pdf', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF file (field name: file)' });
  const opts = parsePdfImportOpts(req.body || {});
  const result = await pdfImport.extractFromBuffer(req.file.buffer, opts);
  const summary = pdfImport.summarizeTables(result, opts.includeRaw);

  const createTanks = req.body?.createTanks === true || req.body?.createTanks === 'true';
  if (!createTanks) {
    return res.json({ ok: true, ...summary });
  }

  let tankNames = req.body?.tankNames;
  if (typeof tankNames === 'string') {
    try { tankNames = JSON.parse(tankNames); } catch (_) {
      tankNames = tankNames.split(/\n|;/).map((s) => s.trim()).filter(Boolean);
    }
  }
  const updateExisting = req.body?.updateExisting !== false && req.body?.updateExisting !== 'false';
  const plans = pdfImport.planTankCreates(result, {
    tankNames: Array.isArray(tankNames) ? tankNames : undefined,
    target: req.body?.target || 'auto',
  });

  const bundle = store.getVesselBundle(req.params.id);
  const tanks = bundle.tanks || store.emptyTanks();
  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  function findExisting(name) {
    const n = norm(name);
    for (const cat of Object.keys(tanks)) {
      const hit = (tanks[cat] || []).find((t) => {
        const tn = norm(t.name);
        return tn === n || (n.length > 6 && (tn.includes(n) || n.includes(tn)));
      });
      if (hit) return hit;
    }
    return null;
  }

  let created = 0;
  let updated = 0;
  let failed = 0;
  const applied = [];
  for (const plan of plans) {
    if (plan.error || !plan.tank) {
      failed++;
      applied.push({ name: plan.name, ok: false, error: plan.error || 'No table' });
      continue;
    }
    const existing = findExisting(plan.name);
    if (existing) {
      if (!updateExisting) {
        applied.push({ name: plan.name, ok: false, error: 'Tank already exists', tankId: existing.id });
        failed++;
        continue;
      }
      const saved = store.updateCalibration(req.params.id, existing.id, plan.patch);
      updated++;
      applied.push({
        name: plan.name,
        ok: true,
        action: 'updated',
        tankId: existing.id,
        tableId: plan.tableId,
        kind: plan.kind,
        capacity: saved.capacity,
      });
    } else {
      const saved = store.upsertTank(req.params.id, plan.tank);
      created++;
      applied.push({
        name: plan.name,
        ok: true,
        action: 'created',
        tankId: saved.id,
        tableId: plan.tableId,
        kind: plan.kind,
        capacity: saved.capacity,
      });
    }
  }

  res.json({
    ok: true,
    ...summary,
    createTanks: true,
    created,
    updated,
    failed,
    applied,
  });
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
    const opts = parsePdfImportOpts(req.body || {});
    const result = await pdfImport.extractFromBuffer(req.file.buffer, opts);
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

/* ---------- Per-tank calibration table CSV / Excel export & import ---------- */
app.get('/api/vessels/:id/tanks/:tankId/calibration.csv', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const tank = store.findTankInBundle(bundle.tanks, req.params.tankId);
    if (!tank) return res.status(404).json({ error: 'Tank not found' });
    const csv = tankTableIo.exportCsv(tank);
    const safe = String(tank.id || 'tank').replace(/[^\w.-]+/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}-calibration.csv"`);
    res.send(csv);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/vessels/:id/tanks/:tankId/calibration.xlsx', asyncHandler(async (req, res) => {
  const bundle = store.getVesselBundle(req.params.id);
  const tank = store.findTankInBundle(bundle.tanks, req.params.tankId);
  if (!tank) return res.status(404).json({ error: 'Tank not found' });
  const buf = await tankTableIo.exportXlsxBuffer(tank);
  const safe = String(tank.id || 'tank').replace(/[^\w.-]+/g, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}-calibration.xlsx"`);
  res.send(buf);
}));

app.post('/api/vessels/:id/tanks/:tankId/import-table', upload.single('file'), asyncHandler(async (req, res) => {
  const vesselId = req.params.id;
  const tankId = req.params.tankId;
  const bundle = store.getVesselBundle(vesselId);
  const tank = store.findTankInBundle(bundle.tanks, tankId);
  if (!tank) return res.status(404).json({ error: 'Tank not found' });

  let patch;
  if (req.file) {
    patch = await tankTableIo.importTableBuffer(req.file.buffer, req.file.originalname || 'table.csv');
  } else if (req.body?.csv) {
    patch = tankTableIo.importCsv(req.body.csv);
  } else if (req.body?.calibration) {
    patch = req.body.calibration;
  } else {
    return res.status(400).json({ error: 'Upload a .csv / .xlsx file, or pass csv / calibration JSON' });
  }

  const apply = req.body?.apply !== false && req.body?.apply !== 'false';
  if (apply) {
    const updated = store.updateCalibration(vesselId, tankId, patch);
    return res.json({ ok: true, applied: true, patch, tank: updated });
  }
  res.json({ ok: true, applied: false, patch });
}));

app.get('/api/templates/calibration.csv', (req, res) => {
  const sample = {
    id: 'example',
    name: 'EXAMPLE TANK',
    calcType: 'correction',
    capacity: 100,
    correctionDivisor: 10,
    pipeHeight: 0,
    soundingMethod: 'ullage',
    soundingIncrement: 50,
    heelIncrement: 50,
    trimAxis: [0, 50, 100],
    trimVals: [2, 1, 0, -1, -2],
    trimGrid: [
      [0, 0, 0, 0, 0],
      [12.1, 12.5, 13.0, 12.4, 11.9],
      [25.0, 25.8, 26.5, 25.6, 24.8],
    ],
    volumeCurve: { x: [0, 50, 100], v: [0, 13, 26.5] },
    listAxis: [0, 50, 100],
    listVals: [-2, -1, 0, 1, 2],
    listGrid: [
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ],
  };
  const csv = tankTableIo.exportCsv(sample);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="calibration-table-template.csv"');
  res.send(csv);
});

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

app.post('/api/vessels/:id/tanks/import-csv', upload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file && !req.body?.csv) {
      return res.status(400).json({ error: 'Upload a CSV or XLSX workbook' });
    }
    const vesselId = req.params.id;
    const updateExisting = req.body?.updateExisting !== false && req.body?.updateExisting !== 'false';
    const replaceExisting = req.body?.replaceExisting === true || req.body?.replaceExisting === 'true';
    const previewOnly = req.body?.preview === true || req.body?.preview === 'true';
    const bundle = store.getVesselBundle(vesselId);
    const norm = (s) => String(s || '').toUpperCase().replace(/TANK/g, 'TK').replace(/[^A-Z0-9]/g, '');
    function findByName(name, { exact = false, category = null } = {}) {
      const n = norm(name);
      const cats = category ? [category] : Object.keys(bundle.tanks || {});
      for (const cat of cats) {
        const list = bundle.tanks?.[cat] || [];
        const exactHit = list.find((t) => norm(t.name) === n);
        if (exactHit) return exactHit;
      }
      if (exact) return null;
      for (const cat of Object.keys(bundle.tanks || {})) {
        const hit = (bundle.tanks[cat] || []).find((t) => {
          const tn = norm(t.name);
          return n.length > 6 && (tn.includes(n) || n.includes(tn));
        });
        if (hit) return hit;
      }
      return null;
    }

    function summarizeIncoming(tank, existing) {
      return {
        name: tank.name,
        category: tank.category || 'fuel',
        calcType: tank.calcType || 'direct',
        capacity: tank.capacity,
        fuelRole: tank.fuelRole,
        side: tank.side,
        tankNo: tank.tankNo,
        soundingMethod: tank.soundingMethod,
        trimRows: (tank.trimAxis || []).length,
        listRows: (tank.listAxis || []).length,
        existing: existing
          ? {
              id: existing.id,
              name: existing.name,
              category: existing.category,
              capacity: existing.capacity,
              calcType: existing.calcType,
            }
          : null,
      };
    }

    function applyWorkbookTanks(parsed, { forceCategory = null, defaultFormat = 'workbook' } = {}) {
      const created = [];
      const updated = [];
      const replaced = [];
      const skipped = [];
      const preview = [];
      for (const tank of parsed.tanks || []) {
        const existing = findByName(tank.name, { category: tank.category || forceCategory })
          || findByName(tank.name);
        preview.push(summarizeIncoming(tank, existing));
        if (previewOnly) continue;
        if (existing) {
          if (replaceExisting || updateExisting) {
            const saved = store.upsertTank(vesselId, {
              ...tank,
              id: existing.id,
              category: forceCategory || tank.category || existing.category || 'fuel',
            });
            if (replaceExisting) replaced.push(saved);
            else updated.push(saved);
          } else {
            skipped.push({ name: tank.name, reason: 'exists', existingId: existing.id, existingName: existing.name });
          }
        } else {
          created.push(store.upsertTank(vesselId, {
            ...tank,
            category: forceCategory || tank.category || 'fuel',
          }));
        }
      }
      if (previewOnly) {
        const existingList = preview.filter((t) => t.existing);
        return {
          ok: true,
          preview: true,
          format: parsed.format || defaultFormat,
          tankCount: preview.length,
          existingCount: existingList.length,
          newCount: preview.length - existingList.length,
          warnings: parsed.warnings || [],
          sheets: parsed.sheets || [],
          tanks: preview,
          existingTanks: existingList.map((t) => ({
            sheetName: t.name,
            id: t.existing.id,
            name: t.existing.name,
            category: t.existing.category,
            capacity: t.existing.capacity,
            calcType: t.existing.calcType,
            trimRows: t.trimRows,
            listRows: t.listRows,
          })),
        };
      }
      return {
        ok: true,
        format: parsed.format || defaultFormat,
        imported: created.length + updated.length + replaced.length,
        created: created.length,
        updated: updated.length,
        replaced: replaced.length,
        skipped: skipped.length,
        skippedTanks: skipped,
        warnings: parsed.warnings || [],
        sheets: parsed.sheets || [],
        existingTanks: preview.filter((t) => t.existing).map((t) => ({
          sheetName: t.name,
          id: t.existing.id,
          name: t.existing.name,
          category: t.existing.category,
        })),
        tanks: [...replaced, ...updated, ...created].map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category,
          capacity: t.capacity,
          fuelRole: t.fuelRole,
          calcType: t.calcType,
          trimRows: (t.trimAxis || []).length,
          listRows: (t.listAxis || []).length,
        })),
      };
    }

    const filename = String(req.file?.originalname || '').toLowerCase();
    const isWorkbook = /\.(xlsx|xlsm|xls)$/.test(filename);
    if (isWorkbook) {
      if (filename.endsWith('.xls')) {
        return res.status(400).json({ error: 'Legacy .xls is not supported; save it as .xlsx first' });
      }

      /* FLAG EVI dual-sheet (Trim Correction + Heeling Correction) first. */
      let flagErrLast = null;
      try {
        const flagParsed = await flagEviXlsx.parseFlagEviXlsx(req.file.buffer);
        if (flagParsed?.format === 'flag-evi-xlsx' && (flagParsed.tanks || []).length) {
          return res.json(applyWorkbookTanks(flagParsed, { defaultFormat: 'flag-evi-xlsx' }));
        }
      } catch (flagErr) {
        flagErrLast = flagErr;
        /* Not FLAG EVI — fall through to Giorgis lube parser unless the file
           clearly is a Trim+Heeling workbook (or named like one). Masking that
           as a lube parse error hid empty/asar Python failures on Windows. */
        const hint = `${filename} ${flagErr && flagErr.message ? flagErr.message : ''}`;
        if (/flag\s*evi|trim\s*correction|heeling\s*correction|fo\s*tanks?/i.test(hint)) {
          return res.status(400).json({
            error: flagErr.message || 'FLAG EVI workbook import failed',
          });
        }
      }

      try {
        const parsed = await giorgisLubeXlsx.parseGiorgisLubeXlsx(req.file.buffer);
        return res.json(applyWorkbookTanks(parsed, { forceCategory: 'lube', defaultFormat: 'giorgis-lube-xlsx' }));
      } catch (lubeErr) {
        if (flagErrLast) {
          return res.status(400).json({
            error: flagErrLast.message || lubeErr.message || 'Workbook import failed',
          });
        }
        throw lubeErr;
      }
    }

    const text = req.file
      ? req.file.buffer.toString('utf8')
      : (req.body?.csv || '');
    if (!String(text || '').trim()) return res.status(400).json({ error: 'No CSV content' });

    // Giorgis multi-tank workbook CSV (fuel / lube / misc / fresh water)
    if (giorgisFuelCsv.looksLikeGiorgisWorkbookCsv(text)) {
      const parsed = giorgisFuelCsv.parseGiorgisWorkbookCsv(text, { filename });
      return res.json(applyWorkbookTanks(parsed, { defaultFormat: parsed.format || 'giorgis-workbook-csv' }));
    }

    const rows = parseCsv(text);
    if (!rows.length) return res.status(400).json({ error: 'No rows found' });
    const created = [];
    const updated = [];
    for (const row of rows) {
      if (!row.name && !row.id) continue;
      const existing = row.id
        ? store.findTankInBundle(bundle.tanks, row.id)
        : findByName(row.name);
      const tank = {
        id: row.id || existing?.id || undefined,
        name: row.name || existing?.name,
        category: row.category || existing?.category || 'fuel',
        fuelRole: row.fuelRole || existing?.fuelRole || 'storage',
        side: row.side || existing?.side || 'center',
        tankNo: row.tankNo !== undefined && row.tankNo !== ''
          ? Number(row.tankNo)
          : (existing?.tankNo ?? null),
        fuelGrade: row.fuelGrade || existing?.fuelGrade || 'hfo',
        calcType: row.calcType || existing?.calcType || 'correction',
        capacity: row.capacity !== undefined && row.capacity !== ''
          ? Number(row.capacity)
          : (existing?.capacity || 0),
        pipeHeight: row.pipeHeight !== undefined && row.pipeHeight !== ''
          ? Number(row.pipeHeight)
          : (existing?.pipeHeight || 0),
        soundingMethod: row.soundingMethod || existing?.soundingMethod || 'ullage',
        correctionDivisor: row.correctionDivisor !== undefined && row.correctionDivisor !== ''
          ? Number(row.correctionDivisor)
          : (existing?.correctionDivisor || 10),
        // Preserve calibration tables when editing tank list CSV
        trimAxis: existing?.trimAxis || [],
        trimVals: existing?.trimVals || [],
        trimGrid: existing?.trimGrid || [],
        listAxis: existing?.listAxis || [],
        listVals: existing?.listVals || [],
        listGrid: existing?.listGrid || [],
        volumeCurve: existing?.volumeCurve || { x: [0], v: [0] },
        soundingIncrement: existing?.soundingIncrement,
        heelIncrement: existing?.heelIncrement,
      };
      if (!tank.name) continue;
      const saved = store.upsertTank(vesselId, tank);
      if (existing) updated.push(saved);
      else created.push(saved);
    }
    res.json({
      ok: true,
      format: 'tank-list-csv',
      imported: created.length + updated.length,
      created: created.length,
      updated: updated.length,
      tanks: [...updated, ...created],
    });
}));

/** Export tank list (metadata) as CSV for edit → re-import */
app.get('/api/vessels/:id/tanks.csv', (req, res) => {
  try {
    const bundle = store.getVesselBundle(req.params.id);
    const headers = [
      'id', 'name', 'category', 'fuelRole', 'side', 'tankNo', 'fuelGrade',
      'calcType', 'capacity', 'pipeHeight', 'soundingMethod', 'correctionDivisor',
    ];
    const lines = [headers.join(',')];
    for (const cat of Object.keys(bundle.tanks || {})) {
      for (const t of bundle.tanks[cat] || []) {
        const row = headers.map((h) => {
          let v = t[h];
          if (v == null) v = '';
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        });
        lines.push(row.join(','));
      }
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}-tanks.csv"`);
    res.send(lines.join('\n') + '\n');
  } catch (e) {
    res.status(404).json({ error: e.message });
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
/* The server files the device runs when it has no server. Served so a browser
   can pick them up in development; the phone build has them in its bundle. */
app.use('/embedded', express.static(path.join(__dirname, '..', 'public', 'embedded')));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

/**
 * Start listening, and say where.
 *
 * Port 0 asks the operating system for a free one and reports back which it
 * got. The desktop build uses that: a fixed port is a collision waiting to
 * happen on a machine that may already be running something on 3080, and
 * nobody types the address anyway — the window is handed the real one.
 */
function start({ port = PORT, host = HOST } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const actual = server.address().port;
      console.log(`Tank Chief listening on http://${host}:${actual}`);
      console.log(`Data directory: ${store.DATA_DIR}`);
      resolve({ server, port: actual, host });
    });
    server.on('error', reject);
  });
}

module.exports = { app, start };

// Run directly (npm start) and it serves straight away; required by the
// desktop wrapper, it waits to be told.
if (require.main === module) start();
