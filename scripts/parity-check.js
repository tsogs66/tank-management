#!/usr/bin/env node
/**
 * Does the phone answer the same as the server?
 *
 * The phone runs the server's own route code over its own database rather than
 * a second implementation of the API, and this is what holds that claim up. It
 * loads the same vessel into both, asks both the same questions, and diffs the
 * answers field by field.
 *
 * It matters more here than the usual regression test would. A divergence
 * would not announce itself: it would be a tonnage a little different on the
 * phone from the one on the ship's computer, on a sheet somebody signs. So the
 * reads cover every computed sheet, and the writes cover saving, history and
 * deletion, because agreeing on what to read is worth nothing if the two
 * stores write differently.
 *
 * Volatile fields — timestamps, and anything derived from a running clock —
 * are excluded by name. The two calls are microseconds apart and this vessel's
 * pumping clock is live; that is the clock ticking, not a disagreement.
 *
 * Needs a server running on :3080 and a browser:
 *   npm start &
 *   node scripts/parity-check.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = require('path').join(__dirname, '..');
const VESSEL = 'mv-giorgis';
const BASE = process.env.TMS_BASE_URL || 'http://localhost:3080';

// Fields that legitimately differ between two runs.
/* The two calls are microseconds apart, and this vessel's pumping clock is
   running, so anything derived from "now" differs in the last decimal. That is
   the clock ticking between the calls, not the device disagreeing. */
const VOLATILE = /^(generatedAt|time|updatedAt|createdAt|savedAt|id|etcAtIso|estimatedEtcAtIso|estimatedTargetAtIso|estimatedLimitAtIso|elapsedHours|expectedMT|varianceMT|estimatedAgeHours|estimatedToTargetHours|estimatedToLimitHours|estimatedLimitSoonestHours|etcHours|estimatedEtcHours|estimatedVolumeM3|estimatedVolumePercent|estimatedReadingMM|estimatedUllageMM|estimatedSoundingMM|estimatedAddedMT|estimatedReceivedMT|estimatedAheadMT|estimatedRemainingMT|estimatedPercentComplete)$/;

function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (VOLATILE.test(k)) continue;
      out[k] = scrub(v[k]);
    }
    return out;
  }
  // Clocks move between the two calls; compare figures, not the second hand.
  if (typeof v === 'string' && /^\d+h \d\dm( \d\ds)?$/.test(v)) return '<elapsed>';
  return v;
}

function firstDiff(a, b, at = '') {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) === !Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const k of keys) {
      const d = firstDiff(a[k], b[k], at ? `${at}.${k}` : k);
      if (d) return d;
    }
  }
  return { at: at || '(root)', server: sa && sa.slice(0, 120), device: sb && sb.slice(0, 120) };
}

(async () => {
  // Every file of the vessel, keyed the way the device's filesystem wants it.
  const vdir = path.join(ROOT, 'data', 'vessels', VESSEL);
  const files = {};
  for (const name of fs.readdirSync(vdir)) {
    files[`/app/data/vessels/${VESSEL}/${name}`] = fs.readFileSync(path.join(vdir, name), 'utf8');
  }
  for (const name of ['settings.json', 'vessels-index.json']) {
    const p = path.join(ROOT, 'data', name);
    if (fs.existsSync(p)) files[`/app/data/${name}`] = fs.readFileSync(p, 'utf8');
  }

  const b = await chromium.launch(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.evaluate(async (f) => { await LocalApi.start(); await LocalApi.restore(f); }, files);

  const V = `/api/vessels/${VESSEL}`;
  const CASES = [
    ['GET', '/api/status'], ['GET', '/api/settings'], ['GET', '/api/vessels'],
    ['GET', V],
    ['GET', `${V}/fuel-report`], ['GET', `${V}/fuel-report/history`],
    ['GET', `${V}/bunker-plan`], ['GET', `${V}/bunker-after`], ['GET', `${V}/bunker-summary`],
    ['GET', `${V}/bunkering-chain`], ['GET', `${V}/bunker-ops/active`],
    ['GET', '/api/reference/fuel-report-options'], ['GET', '/api/reference/bunkering-options'],
    ['GET', '/api/reference/conversion'], ['GET', '/api/reference/iso8217'],
    ['GET', '/api/reference/vcf-wcf-tables?type=fuel'],
    ['POST', '/api/reference/vcf-wcf', { density15: 0.9526, tempC: 42.5 }],
    ['POST', '/api/reference/convert-density', { sg: 0.9526 }],
    ['POST', `${V}/fuel-report/compute`, {}],
    ['POST', `${V}/bunker-plan/compute`, {}],
    ['POST', `${V}/bunker-after/compute`, {}],
    ['POST', `${V}/bunker-summary/compute`, {}],
    ['POST', `${V}/bunker-blend`, { parcels: [{ density15: 0.98, quantityMT: 200, tempC: 15 },
      { density15: 0.91, quantityMT: 300, tempC: 15 }] }],
    ['POST', `${V}/bunker-distribute`, { mode: 'level-storage', fuelType: 'lsfo', quantityMT: 300 }],
  ];

  let pass = 0; const fails = [];
  for (const [method, p, body] of CASES) {
    const srv = await fetch(BASE + p, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

    const dev = await page.evaluate(([m, pp, bb]) => LocalApi.handle(m, pp, bb), [method, p, body || undefined]);

    const d = firstDiff(scrub(srv.body), scrub(dev.body));
    if (srv.status === dev.status && !d) { pass += 1; console.log(`  ok    ${method} ${p}`); }
    else {
      fails.push({ method, p, srvStatus: srv.status, devStatus: dev.status, d });
      console.log(`  FAIL  ${method} ${p}  (server ${srv.status} / device ${dev.status})`);
      if (d) console.log(`        at ${d.at}\n          server: ${d.server}\n          device: ${d.device}`);
    }
  }
  console.log(`\n${pass}/${CASES.length} identical (reads)`);

  /* Writes. Reads matching proves the compute agrees; this proves the two
     stores agree — that a save lands in the same shape, the history grows the
     same way, and reading it back gives the same answer on both. Done on a
     scratch vessel so nothing real is touched. */
  console.log('\nwrites:');
  const SCRATCH = 'parity-scratch';
  const W = `/api/vessels/${SCRATCH}`;
  const WRITES = [
    ['POST', '/api/vessels', { id: SCRATCH, name: 'PARITY SCRATCH', imo: '9999999' }],
    ['POST', `${W}/tanks`, { id: 'p1', name: 'TEST TANK 1', category: 'fuel', capacity: 100,
      soundingMethod: 'ullage', fuelType: 'lsfo' }],
    ['PUT', `${W}/tanks/p1`, { name: 'TEST TANK 1A', capacity: 120 }],
    ['GET', W],
    ['PUT', `${W}/voyage`, { voyageNo: '77', port: 'PARITY', date: '2026-01-02' }],
    ['PUT', `${W}/fuel-report`, { header: { date: '2026-01-02', draftFwd: 5, draftAft: 6 }, rows: [] }],
    ['GET', `${W}/fuel-report`],
    ['GET', `${W}/fuel-report/history`],
    ['PUT', `${W}/bunker-plan`, { header: { date: '2026-01-02', deliveryRateMTPerHour: 100,
      bunkerQuantityMT: 50, fuelType: 'lsfo' }, sequence: [] }],
    ['GET', `${W}/bunker-plan`],
    ['GET', `${W}/bunkering-chain`],
    ['DELETE', W],
    ['GET', '/api/vessels'],
  ];
  let wpass = 0; const wfails = [];
  for (const [method, p, body] of WRITES) {
    const srv = await fetch(BASE + p, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
    const dev = await page.evaluate(([m, pp, bb]) => LocalApi.handle(m, pp, bb), [method, p, body || undefined]);
    const d = firstDiff(scrub(srv.body), scrub(dev.body));
    if (srv.status === dev.status && !d) { wpass += 1; console.log(`  ok    ${method} ${p}`); }
    else {
      wfails.push(p);
      console.log(`  FAIL  ${method} ${p}  (server ${srv.status} / device ${dev.status})`);
      if (d) console.log(`        at ${d.at}\n          server: ${d.server}\n          device: ${d.device}`);
    }
  }
  console.log(`\n${wpass}/${WRITES.length} identical (writes)`);
  fails.push(...wfails);
  if (errs.length) console.log('page errors:', errs.slice(0, 3).join(' | '));
  await b.close();
  process.exit(fails.length ? 1 : 0);
})();
