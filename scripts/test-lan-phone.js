/**
 * The phone's side of live sync, run in a real browser.
 *
 * On the phone the server code runs inside the app, over its own database. This
 * starts a real server as "the PC", opens the app in Chromium as "the phone", pairs
 * them with a code and checks the records travel both ways — through the phone's
 * shimmed crypto, filesystem and Buffer, which a plain Node test cannot exercise.
 *
 * Needs a Chromium: set PW_EXE to its path if Playwright's own is not installed.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { console.log('playwright not installed — skipped'); process.exit(0); }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-phone-'));
let pass = 0; let failed = 0;
async function check(name, fn) {
  try { await fn(); pass += 1; console.log('  ok   ' + name); } catch (e) {
    failed += 1; console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n').slice(0, 4).join('\n       '));
  }
}
function seed(dir, code) {
  const r = spawnSync(process.execPath, ['-e', `const store=require('./server/store');${code}`], {
    cwd: ROOT, env: Object.assign({}, process.env, { TMS_DATA_DIR: dir }), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

(async () => {
  const dir = path.join(TMP, 'pc');
  fs.mkdirSync(dir, { recursive: true });
  const pcId = seed(dir, "const v=store.createVessel({name:'MV TEST ONE',imo:'9000001'});store.setActiveVessel(v.id);console.log(v.id)");
  const only = seed(dir, "const v=store.createVessel({name:'MV ONLY ON PC',imo:'9000009'});console.log(v.id)");
  const child = spawn(process.execPath, ['-e',
    "require('./server/index').start({ port: 0, host: '127.0.0.1' }).then((r) => console.log('PORT ' + r.port))"],
  { cwd: ROOT, env: Object.assign({}, process.env, { TMS_DATA_DIR: dir }), stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; const m = buf.match(/PORT (\d+)/); if (m) resolve(Number(m[1])); });
    setTimeout(() => reject(new Error('server did not start')), 20000);
  });
  const base = `http://127.0.0.1:${port}`;
  const pc = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  const browser = await chromium.launch(process.env.PW_EXE ? { executablePath: process.env.PW_EXE, args: ['--no-sandbox'] } : {});
  try {
    const page = await browser.newPage();
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    const phone = (method, p, body) => page.evaluate(([m, pp, bb]) => LocalApi.handle(m, pp, bb), [method, p, body || undefined]);
    await page.evaluate(async () => { await LocalApi.start(); await LocalApi.restore({}); });
    const created = await phone('POST', '/api/vessels', { name: 'MV TEST ONE', imo: '9000001' });
    const phoneId = created.body.id || (created.body.vessel && created.body.vessel.id);
    assert.ok(phoneId, JSON.stringify(created));
    await phone('POST', '/api/vessels/active', { id: phoneId });

    await check('the phone engine answers the live-sync routes', async () => {
      const r = await phone('GET', '/api/lan/state');
      assert.strictEqual(r.status, 200, JSON.stringify(r));
      assert.strictEqual(r.body.canBeCalled, false, 'a phone cannot be called by another device');
      assert.ok(r.body.deviceId);
    });

    const LIC = { email: 'chief@example.com', licenseId: 'lic-test-1' };
    await pc('POST', '/api/lan/license', LIC);
    await check('a phone on another license is refused by the PC, and the same license is accepted', async () => {
      await phone('POST', '/api/lan/license', { email: 'other@example.com', licenseId: 'lic-other' });
      const code = (await pc('POST', '/api/lan/pair/start')).body.code;
      const refused = await phone('POST', '/api/lan/peers/pair', { url: base, code });
      assert.strictEqual(refused.status, 403, JSON.stringify(refused));
      assert.strictEqual(refused.body.code, 'different-license');
      await phone('POST', '/api/lan/license', { email: '', licenseId: '' });
      const none = await phone('POST', '/api/lan/peers/pair', { url: base, code });
      assert.strictEqual(none.status, 403, JSON.stringify(none));
      assert.strictEqual(none.body.code, 'no-license');
      await phone('POST', '/api/lan/license', LIC);
    });

    await check('a phone finds the PC by scanning, with no beacon and no listening of its own', async () => {
      const r = await phone('POST', '/api/lan/scan', { hosts: ['127.0.0.1'], ports: [port] });
      assert.strictEqual(r.status, 200, JSON.stringify(r));
      assert.ok(r.body.found.some((d) => d.url === base), JSON.stringify(r.body));
    });

    await check('the phone pairs with the code showing on the PC', async () => {
      const code = (await pc('POST', '/api/lan/pair/start')).body.code;
      const bad = await phone('POST', '/api/lan/peers/pair', { url: base, code: '000000' });
      assert.notStrictEqual(bad.status, 200);
      const code2 = (await pc('POST', '/api/lan/pair/start')).body.code;
      const r = await phone('POST', '/api/lan/peers/pair', { url: base, code: code2 });
      assert.strictEqual(r.status, 200, JSON.stringify(r));
      assert.strictEqual(r.body.peers.length, 1);
      assert.ok(code);
    });

    await check('records travel both ways between the phone and the PC on the same vessel', async () => {
      seed(dir, `store.saveVesselPart(${JSON.stringify(pcId)},'reportHistory',[{id:'pc-1',savedAt:'2026-11-01T00:00:00.000Z',title:'from PC'}])`);
      await page.evaluate(([id]) => StoreCore.saveVesselPart(id, 'reportHistory', [{ id: 'ph-1', savedAt: '2026-11-02T00:00:00.000Z', title: 'from phone' }]), [phoneId]);
      await phone('POST', '/api/lan/config', { enabled: true, intervalSec: 60 });
      const r = await phone('POST', '/api/lan/sync-now', { force: true });
      assert.strictEqual(r.status, 200, JSON.stringify(r));
      const onPhone = (await phone('GET', '/api/vessels/' + phoneId)).body.reportHistory.map((x) => x.title).sort();
      const onPc = (await pc('GET', '/api/vessels/' + pcId)).body.reportHistory.map((x) => x.title).sort();
      assert.deepStrictEqual(onPhone, ['from PC', 'from phone']);
      assert.deepStrictEqual(onPc, ['from PC', 'from phone']);
    });

    await check('the phone is told the PC has a vessel it lacks, and can copy it across', async () => {
      const st = (await phone('GET', '/api/lan/state')).body.peers[0];
      assert.ok(st.differences.missingHere.some((v) => v.name === 'MV ONLY ON PC'), JSON.stringify(st.differences));
      const r = await phone('POST', '/api/lan/copy', { deviceId: st.deviceId, vesselId: only, direction: 'pull' });
      assert.strictEqual(r.status, 200, JSON.stringify(r));
      const list = (await phone('GET', '/api/vessels')).body;
      assert.ok((list.vessels || list).some((v) => v.name === 'MV ONLY ON PC'));
    });
  } finally {
    await browser.close();
    child.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(`\n${pass}/${pass + failed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
