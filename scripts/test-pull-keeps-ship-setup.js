#!/usr/bin/env node
/*
 * A pull never empties a ship. Backup's Update creates the ship on a server
 * that has never seen it as a bare record (no tanks, no plan), then merges the
 * saved reports into it, and every merge raises that record's revision. Once
 * it matched the device's, Pull from peer wrote the bare record over the
 * device's whole tank setup: Tank Chief showed no tanks and an empty plan.
 * Run: node scripts/test-pull-keeps-ship-setup.js
 */
'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VID = 'captain-veniamis';

let checks = 0, failures = 0;
function check(label, cond, detail) {
  checks++;
  const ok = !!cond;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail != null ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function dataDir(name, seed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tank-pull-' + name + '-'));
  if (seed) execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'seed-vessel.js')], { env: { ...process.env, TMS_DATA_DIR: dir }, stdio: 'ignore' });
  return dir;
}
function start(dir) {
  const p = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, TMS_DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let out = '';
    p.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/listening on http:\/\/[^:]+:(\d+)/);
      if (m) resolve({ p, port: Number(m[1]) });
    });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (c) => reject(new Error('tank server exited ' + c + '\n' + out)));
  });
}
const client = (port) => async (p, opts = {}) => {
  const r = await fetch('http://127.0.0.1:' + port + p, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const t = await r.text();
  if (!r.ok) throw new Error(p + ' ' + r.status + ' ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
};
const post = (body) => ({ method: 'POST', body: JSON.stringify(body) });
const tankCount = (b) => Object.values(b.tanks || {}).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);

(async () => {
  const a = await start(dataDir('device', true));
  const b = await start(dataDir('server', false));
  const L = client(a.port), S = client(b.port);
  try {
    const before = await L(`/api/vessels/${VID}`);
    await L(`/api/vessels/${VID}/bunkering`, { method: 'PUT', body: JSON.stringify({ ...(before.bunkering || {}), plan: [{ id: 'bp1', tank: 'fo1', qty: 500 }] }) });
    const device = await L(`/api/vessels/${VID}`);

    /* What Backup's Update does for a ship the server has never seen. */
    await S('/api/vessels', post({ id: VID, name: device.vessel.name, imo: device.vessel.imo || '' }));
    const [lb, sb] = await Promise.all([L(`/api/vessels/${VID}/saved-reports`), S(`/api/vessels/${VID}/saved-reports`)]);
    await L(`/api/vessels/${VID}/saved-reports/merge`, post(sb));
    await S(`/api/vessels/${VID}/saved-reports/merge`, post(lb));
    await S(`/api/vessels/${VID}/saved-reports/merge`, post(await L(`/api/vessels/${VID}/saved-reports`)));
    await L(`/api/vessels/${VID}/sounding-report/load-latest`, post({}));
    await S(`/api/vessels/${VID}/sounding-report/load-latest`, post({}));
    const server = await S(`/api/vessels/${VID}`);
    check('the server record is bare (the case being guarded)', tankCount(server) === 0, tankCount(server));
    const revs = [device.meta.revision, server.meta.revision, (await L(`/api/vessels/${VID}`)).meta.revision];
    check('its revision has caught up with the device', revs[1] >= revs[2], revs.join(' / '));

    console.log('\nPull from that server');
    const pulled = await L('/api/sync/pull', post({ syncUrl: 'http://127.0.0.1:' + b.port, syncApiToken: '' }));
    check('the pull took the server copy', (pulled.results || []).some((r) => r.id === VID && r.action === 'pulled'), JSON.stringify(pulled.results));
    const after = await L(`/api/vessels/${VID}`);
    check('every tank kept', tankCount(after) === tankCount(device) && tankCount(device) > 0, `${tankCount(after)} of ${tankCount(device)}`);
    check('bunker plan kept', JSON.stringify((after.bunkering || {}).plan) === JSON.stringify(device.bunkering.plan), JSON.stringify((after.bunkering || {}).plan));
    check('assets kept', JSON.stringify(after.assets) === JSON.stringify(device.assets));
    check('ship particulars kept', after.vessel.name === device.vessel.name && after.vessel.flag === device.vessel.flag
      && JSON.stringify(Object.keys(after.vessel).sort()) === JSON.stringify(Object.keys(device.vessel).sort()), JSON.stringify(after.vessel));
    check('gaugings kept', Object.keys(after.readings || {}).length === Object.keys(device.readings || {}).length);
    check('ship still listed', ((await L('/api/status')).vessels || []).some((v) => v.id === VID));

    console.log('\nPull files uploaded for the same vessel under another id');
    await L(`/api/vessels/${VID}`, { method: 'PUT', body: JSON.stringify({ imo: '9619799' }) });
    const named = (await L(`/api/vessels/${VID}`)).vessel;
    await S('/api/vessels', post({ id: 'server-copy', name: named.name, imo: '9619799' }));
    await S('/api/vessels/server-copy/saved-reports/merge', post({
      reportHistory: [{ id: 'uploaded-for-ship', savedAt: '2026-10-29T00:00:00.000Z', title: 'Uploaded' }],
    }));
    await S('/api/vessels', post({ id: 'other-ship', name: 'MV Other Ship', imo: '1234567' }));
    await S('/api/vessels/other-ship/saved-reports/merge', post({
      reportHistory: [{ id: 'not-this-ship', savedAt: '2026-10-29T00:00:00.000Z', title: 'Other' }],
    }));
    const again = await L('/api/sync/pull', post({
      syncUrl: 'http://127.0.0.1:' + b.port,
      syncApiToken: '',
      vessel: { id: VID, name: named.name, imo: '9619799' },
    }));
    check('the other ship was not pulled', !(again.results || []).some((r) => r.id === 'other-ship' || r.fromId === 'other-ship'), JSON.stringify(again.results));
    check('the uploaded copy landed on this ship', (again.results || []).some((r) => r.id === VID && r.fromId === 'server-copy'), JSON.stringify(again.results));
    const home = await L(`/api/vessels/${VID}`);
    check('the uploaded report is on this ship', (home.reportHistory || []).some((r) => r.id === 'uploaded-for-ship'));
    check('no second ship was opened', !((await L('/api/status')).vessels || []).some((v) => v.id === 'server-copy' || v.id === 'other-ship'));
    check('tanks still kept after the vessel pull', tankCount(home) === tankCount(device) && tankCount(device) > 0, tankCount(home));
  } finally {
    a.p.kill(); b.p.kill();
  }
  console.log(`\n${checks - failures}/${checks} passed`);
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
