/**
 * Saving a monitoring fuel report.
 *
 * What went wrong: a report just saved was filed at the BOTTOM of the saved list (so the newest
 * looked like the oldest and a long list showed it nowhere), the screen kept a "Draft" row beside
 * every report just saved, and a save that reached the server late (an offline queue, a print that
 * ended after the next edit) was stamped "now" and so put the OLD report back in the form.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-save-'));
let pass = 0; let failed = 0;
async function check(name, fn) {
  try { await fn(); pass += 1; console.log('  ok   ' + name); } catch (e) {
    failed += 1; console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n').slice(0, 5).join('\n       '));
  }
}

(async () => {
  const dir = path.join(TMP, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const seeded = spawnSync(process.execPath, ['-e',
    "const s=require('./server/store');const v=s.createVessel({name:'MV SAVE TEST',imo:'9100100'});s.setActiveVessel(v.id);console.log(v.id)"],
  { cwd: ROOT, env: Object.assign({}, process.env, { TMS_DATA_DIR: dir }), encoding: 'utf8' });
  const id = seeded.stdout.trim();
  const child = spawn(process.execPath, ['-e',
    "require('./server/index').start({ port: 0, host: '127.0.0.1' }).then((r) => console.log('PORT ' + r.port))"],
  { cwd: ROOT, env: Object.assign({}, process.env, { TMS_DATA_DIR: dir }), stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; const m = buf.match(/PORT (\d+)/); if (m) resolve(Number(m[1])); });
    setTimeout(() => reject(new Error('server did not start')), 20000);
  });
  const call = async (method, url, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const view = async () => (await call('GET', `/api/vessels/${id}/fuel-report`)).body;
  /** What the app sends when Save is pressed. */
  const save = async (voyage, date, opts = {}) => {
    const f = JSON.parse(JSON.stringify((await view()).form));
    f.header.voyageNo = voyage;
    f.header.date = date;
    f.header.time = '12:00';
    f.updatedAt = opts.stamp || new Date().toISOString();
    const body = { form: f, snapshot: opts.snapshot !== false, syncReadings: true };
    if (opts.snapshot !== false) body.snapshotEntry = { id: opts.id || ('rep_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)), savedAt: opts.savedAt || new Date().toISOString() };
    const r = await call('PUT', `/api/vessels/${id}/fuel-report`, body);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    return { body, res: r.body };
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    await check('each report saved goes to the TOP of the saved list, and the form is that report', async () => {
      await save('A', '2026-11-01'); await wait(20);
      await save('B', '2026-11-02'); await wait(20);
      await save('C', '2026-11-03');
      const v = await view();
      assert.deepStrictEqual(v.history.map((h) => h.voyageNo), ['C', 'B', 'A']);
      assert.strictEqual(v.form.header.voyageNo, 'C');
    });

    await check('a saved report carries the date that is in the form as well as the date it was saved', async () => {
      const top = (await view()).history[0];
      assert.strictEqual(top.date, '2026-11-03');
      assert.strictEqual(top.time, '12:00');
      assert.ok(/^\d{4}-\d\d-\d\dT/.test(top.savedAt), top.savedAt);
    });

    await check('the draft is no newer than the newest report just saved, so nothing shows as a draft', async () => {
      const v = await view();
      assert.ok(String(v.form.updatedAt) <= String(v.history[0].savedAt), `${v.form.updatedAt} vs ${v.history[0].savedAt}`);
    });

    await check('a report saved with its own id is filed under that id, and sending the same save again files nothing new', async () => {
      const first = await save('D', '2026-11-04', { id: 'rep_fixedid1' });
      await wait(20);
      assert.strictEqual(first.res.snapshot.id, 'rep_fixedid1');
      const before = (await view()).history.length;
      await call('PUT', `/api/vessels/${id}/fuel-report`, first.body);   // a retry, or an offline queue replaying it
      assert.strictEqual((await view()).history.length, before, 'a replay must not file a second report');
    });

    await check('an OLD save arriving late does not put the old report back in the form', async () => {
      const old = await save('OLD', '2026-10-01', { stamp: '2026-10-01T08:00:00.000Z', savedAt: '2026-10-01T08:00:00.000Z', snapshot: true });
      // the form stays as the newest report, not the late arrival
      const v = await view();
      assert.strictEqual(old.res.stale, true);
      assert.strictEqual(v.form.header.voyageNo, 'D');
      // ...and the late save is still filed, in its place by date saved, not lost
      assert.ok(v.history.some((h) => h.voyageNo === 'OLD'));
      assert.strictEqual(v.history[0].voyageNo, 'D');
    });

    await check('a stale save does not touch the gaugings or the voyage either', async () => {
      const b = (await call('GET', `/api/vessels/${id}`)).body;
      assert.notStrictEqual(b.voyage && b.voyage.voyageNo, 'OLD');
    });

    await check('a clock set far in the future is not believed, so it cannot lock out later saves', async () => {
      await save('FUTURE', '2026-11-05', { stamp: '2099-01-01T00:00:00.000Z' });
      await wait(20);
      assert.ok(String((await view()).form.updatedAt) < '2030', 'the stored stamp must be near now');
      await save('AFTER', '2026-11-06');
      assert.strictEqual((await view()).form.header.voyageNo, 'AFTER');
    });

    await check('a draft kept without filing a report is newer than the newest report: that is what a draft is', async () => {
      await wait(20);
      await save('EDITED', '2026-11-07', { snapshot: false });
      const v = await view();
      assert.strictEqual(v.form.header.voyageNo, 'EDITED');
      assert.ok(String(v.form.updatedAt) > String(v.history[0].savedAt));
    });

    await check('the history from a merge keeps newest first (the order the screen reads it in)', async () => {
      const store = spawnSync(process.execPath, ['-e', `
        const s=require('./server/store');
        const id=${JSON.stringify(id)};
        s.saveVesselPart(id,'reportHistory',[{id:'x1',savedAt:'2020-01-01T00:00:00.000Z'},{id:'x2',savedAt:'2030-01-01T00:00:00.000Z'}]);
        const h=s.getVesselBundle(id).reportHistory;
        const stamps=h.map(r=>r.savedAt);
        console.log(h[0].id+' '+(stamps.every((x,i)=>i===0||stamps[i-1]>=x)));`],
      { cwd: ROOT, env: Object.assign({}, process.env, { TMS_DATA_DIR: dir }), encoding: 'utf8' });
      assert.strictEqual(store.stdout.trim(), 'x2 true', store.stdout + store.stderr);
    });

    /* Print & Save used to send the report to the database only AFTER the printer dialog closed. A
       dialog that never reports back (the Android print screen, a closed window) left the new report
       on the screen only, and the next load read the database: the OLD report came back. */
    await check('Print & Save writes the report to the database before the printer dialog opens', () => {
      const src = fs.readFileSync(path.join(ROOT, 'public/js/fuel-report.js'), 'utf8');
      const body = src.slice(src.indexOf('async function saveReport('), src.indexOf('async function flushIfDirty'));
      const push = body.indexOf('await pushServer();');
      const print = body.indexOf('printReport(computed)');
      assert.ok(push > 0 && print > 0, 'saveReport pushes and prints');
      assert.ok(push < print, 'the push to the database comes before the print');
      assert.ok(!/afterPrintHold\(\(\) => \{ pushServer\(\); \}\)/.test(body), 'the push is not left waiting for the print dialog');
    });
    await check('the bunkering reports (plan, after, summary) are written before the print dialog, too', () => {
      const src = fs.readFileSync(path.join(ROOT, 'public/js/bunkering-report.js'), 'utf8');
      const body = src.slice(src.indexOf('async function saveChainPart('), src.indexOf('function sameSavedForm'));
      assert.ok(!/afterPrintHold\(\(\) => \{ pushServer\(\); \}\)/.test(body), 'the push is not left waiting for the print dialog');
      assert.ok(/return pushServer\(\);/.test(body), 'the push is sent now');
    });
  } finally {
    child.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(`\n${pass}/${pass + failed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
