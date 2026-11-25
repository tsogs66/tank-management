/**
 * The consumption plan reaches the server: it is a part of the vessel, so it is saved, read back, merged and synced
 * like the other drafts. The side saved later keeps the plan in hand; saved calculations from both sides are kept.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tank-cons-'));
process.env.TMS_DATA_DIR = dataDir;
process.env.CHENG_PRO_DATA_DIR = dataDir;
const store = require('../server/store.js');

let pass = 0;
const is = (got, want, what) => { assert.deepStrictEqual(got, want, what); pass += 1; };
const ok = (c, what) => { assert.ok(c, what); pass += 1; };

const v = store.createVessel({ name: 'MV Consumption' });
const id = v.id;
is(store.getVesselBundle(id).bunkerConsumption, null, 'a new vessel has no consumption plan');

const a = { plan: { v: 2, voyageNo: 'A', legs: [] }, history: [{ savedAt: '2026-01-01T00:00:00Z', saveName: 'one' }], updatedAt: '2026-01-01T10:00:00Z' };
store.saveVesselPart(id, 'bunkerConsumption', a);
is(store.getVesselBundle(id).bunkerConsumption.plan.voyageNo, 'A', 'the plan is saved and read back');

/* an older copy arrives: the plan stays, its saved calculation is added */
const old = { plan: { v: 2, voyageNo: 'OLD', legs: [] }, history: [{ savedAt: '2025-12-01T00:00:00Z', saveName: 'two' }], updatedAt: '2025-12-01T10:00:00Z' };
store.saveVesselPart(id, 'bunkerConsumption', old);
let got = store.getVesselBundle(id).bunkerConsumption;
is(got.plan.voyageNo, 'A', 'the plan saved later wins over an older one');
is(got.history.map((h) => h.saveName), ['one', 'two'], 'saved calculations from both sides are kept, newest first');

/* a newer copy replaces the plan, and a repeated calculation is not doubled */
store.saveVesselPart(id, 'bunkerConsumption', { plan: { v: 2, voyageNo: 'NEW', legs: [] }, history: [a.history[0]], updatedAt: '2026-02-01T00:00:00Z' });
got = store.getVesselBundle(id).bunkerConsumption;
is(got.plan.voyageNo, 'NEW', 'a newer plan replaces it');
is(got.history.length, 2, 'the same saved calculation is not listed twice');

/* a blank copy never wipes it */
store.saveVesselPart(id, 'bunkerConsumption', {});
is(store.getVesselBundle(id).bunkerConsumption.plan.voyageNo, 'NEW', 'a blank copy does not erase the plan');

/* the live-parts fan-out and import carry it */
const live = store.readLiveParts ? store.readLiveParts(id) : null;
ok(!live || 'bunkerConsumption' in live, 'the live parts include the consumption plan');

/* over HTTP: the PUT the app sends is accepted (it used to answer 400 Invalid part) */
(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', TMS_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = await new Promise((resolve, reject) => {
    let out = '';
    srv.stdout.on('data', (d) => { out += d; const m = out.match(/listening on http:\/\/[^:]+:(\d+)/); if (m) resolve(Number(m[1])); });
    srv.on('exit', (c) => reject(new Error('server exited ' + c + '\n' + out)));
    setTimeout(() => reject(new Error('server did not start\n' + out)), 15000);
  });
  try {
    const url = `http://127.0.0.1:${port}/api/vessels/${id}`;
    const put = await fetch(url + '/bunkerConsumption', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: { v: 2, voyageNo: 'HTTP' }, history: [], updatedAt: '2030-01-01T00:00:00Z' }) });
    is(put.status, 200, 'the server accepts the consumption plan part');
    const bundle = await (await fetch(url)).json();
    is(bundle.bunkerConsumption.plan.voyageNo, 'HTTP', 'and returns it with the vessel');
  } finally { srv.kill('SIGTERM'); }
  console.log(`consumption persist: ${pass} checks passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
