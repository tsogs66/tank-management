/**
 * Live sync between two devices, tested with two real servers.
 *
 * Each "device" is a separate Tank Chief server process with its own data folder,
 * started on the loopback address. They are paired with a code, then kept level.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-sync-'));
let pass = 0;
let failed = 0;
async function check(name, fn) {
  try { await fn(); pass += 1; console.log('  ok   ' + name); } catch (e) {
    failed += 1; console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n').slice(0, 4).join('\n       '));
  }
}

/** Run a little script against a device's data folder, the way the app itself would write it. */
function seed(dir, code) {
  const r = spawnSync(process.execPath, ['-e', `const store=require('./server/store');${code}`], {
    cwd: ROOT, env: Object.assign({}, process.env, { TMS_DATA_DIR: dir }), encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error('seed failed: ' + r.stderr);
  return r.stdout.trim();
}

const LICENSE = { email: 'Chief@Example.com', licenseId: 'lic-test-1' };

async function boot(name, license) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['-e',
    "require('./server/index').start({ port: 0, host: '127.0.0.1' }).then((r) => console.log('PORT ' + r.port))"],
  { cwd: ROOT, env: Object.assign({}, process.env, { TMS_DATA_DIR: dir }), stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; const m = buf.match(/PORT (\d+)/); if (m) resolve(Number(m[1])); });
    child.on('exit', (c) => reject(new Error(name + ' exited ' + c)));
    setTimeout(() => reject(new Error(name + ' did not start')), 20000);
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, url, body, headers) => {
    const res = await fetch(base + url, {
      method,
      headers: Object.assign(body ? { 'content-type': 'application/json' } : {}, headers || {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const dev = { name, dir, child, port, base, call, stop: () => child.kill() };
  /* The screen tells the server whose license the device is on; a device with none says nothing. */
  if (license !== null) await call('POST', '/api/lan/license', license || LICENSE);
  return dev;
}

function mkVessel(dir, name, imo, extra) {
  return seed(dir, `const v=store.createVessel({name:${JSON.stringify(name)},imo:${JSON.stringify(imo)}});
    ${extra || ''}console.log(v.id)`);
}

(async () => {
  console.log('Pairing');
  const A = await boot('device-a');
  const B = await boot('device-b');
  const idA = mkVessel(A.dir, 'MV TEST ONE', '9000001');
  const idB = mkVessel(B.dir, 'MV TEST ONE', '9000001');   // same ship, its own id on this device
  const onlyA = mkVessel(A.dir, 'MV ONLY HERE', '9000002');
  const onlyB = mkVessel(B.dir, 'MV ONLY THERE', '9000003');
  seed(A.dir, `store.setActiveVessel(${JSON.stringify(idA)})`);
  seed(B.dir, `store.setActiveVessel(${JSON.stringify(idB)})`);

  try {
    await check('a device answers hello without a pairing, and says what it is', async () => {
      const r = await B.call('GET', '/api/lan/hello');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.format, 'cheng-lan-sync');
      assert.ok(r.body.deviceId);
      assert.strictEqual(r.body.canBeCalled, true);
    });

    await check('nothing but hello is open: status, a vessel and apply refuse an unpaired caller', async () => {
      assert.strictEqual((await B.call('GET', '/api/lan/status')).status, 401);
      assert.strictEqual((await B.call('GET', '/api/lan/vessel/' + idB)).status, 401);
      assert.strictEqual((await B.call('POST', '/api/lan/apply', { payload: { vessels: {} } })).status, 401);
      assert.strictEqual((await B.call('GET', '/api/lan/status', null, { authorization: 'Bearer guess' })).status, 401);
    });

    await check('a pairing needs a code showing on the device, and a wrong code is refused', async () => {
      const none = await B.call('POST', '/api/lan/pair', { code: '123456', deviceId: 'x', deviceName: 'x' });
      assert.strictEqual(none.status, 403);
      await B.call('POST', '/api/lan/pair/start');
      const bad = await B.call('POST', '/api/lan/pair', { code: '000000', deviceId: 'x', deviceName: 'x' });
      assert.strictEqual(bad.status, 403);
    });

    await check('five wrong codes lock the code out: the right one is refused afterwards', async () => {
      const code = (await B.call('POST', '/api/lan/pair/start')).body.code;
      for (let i = 0; i < 5; i++) await B.call('POST', '/api/lan/pair', { code: '999999' === code ? '999998' : '999999', deviceId: 'x', deviceName: 'x' });
      const late = await B.call('POST', '/api/lan/pair', { code, deviceId: 'x', deviceName: 'x' });
      assert.ok(late.status === 429 || late.status === 403, String(late.status));
    });

    await check('the code is typed on the other device: both end up trusting each other', async () => {
      const code = (await B.call('POST', '/api/lan/pair/start')).body.code;
      const r = await A.call('POST', '/api/lan/peers/pair', { url: B.base, code });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.peers.length, 1);
      const bs = await B.call('GET', '/api/lan/state');
      assert.strictEqual(bs.body.peers.length, 1, 'B can call A back (two PCs)');
    });

    await check('a code can be chosen by the caller, so one code can serve more than one program', async () => {
      const r = await B.call('POST', '/api/lan/pair/start', { code: '424242' });
      assert.strictEqual(r.body.code, '424242');
      const bad = await B.call('POST', '/api/lan/pair/start', { code: '12' });
      assert.strictEqual(bad.body.code.length, 6, 'a code that is not six digits is replaced by a random one');
      assert.notStrictEqual(bad.body.code, '12');
      const again = await B.call('POST', '/api/lan/pair/start', { code: '424242' });
      const paired = await A.call('POST', '/api/lan/peers/pair', { url: B.base, code: again.body.code });
      assert.strictEqual(paired.status, 200, JSON.stringify(paired.body));
    });

    await check('a code is good once', async () => {
      const code = (await B.call('POST', '/api/lan/pair/start')).body.code;
      const first = await A.call('POST', '/api/lan/peers/pair', { url: B.base, code });
      assert.strictEqual(first.status, 200);
      const second = await A.call('POST', '/api/lan/peers/pair', { url: B.base, code });
      assert.notStrictEqual(second.status, 200);
    });

    await check('pairing can only be started on the device itself, never by another device', async () => {
      // a request that does not come from the loopback address would be refused; here we assert the rule is in place
      const src = fs.readFileSync(path.join(ROOT, 'server', 'lan-sync.js'), 'utf8');
      assert.ok(/pair\/start', localOnly/.test(src) && /config', localOnly/.test(src) && /peers\/pair', localOnly/.test(src));
    });

    console.log('Only devices on the same license');
    await check('a device with no license cannot pair, in either direction', async () => {
      const C = await boot('device-c', null);
      try {
        const codeC = (await C.call('POST', '/api/lan/pair/start')).body.code;
        const toC = await A.call('POST', '/api/lan/peers/pair', { url: C.base, code: codeC });
        assert.strictEqual(toC.status, 403, JSON.stringify(toC.body));
        const codeA = (await A.call('POST', '/api/lan/pair/start')).body.code;
        const fromC = await C.call('POST', '/api/lan/peers/pair', { url: A.base, code: codeA });
        assert.strictEqual(fromC.status, 403, JSON.stringify(fromC.body));
        assert.strictEqual(fromC.body.code, 'no-license');
        assert.strictEqual((await C.call('GET', '/api/lan/state')).body.license.active, false);
      } finally { C.stop(); }
    });
    await check('a different email is refused, and the code stays good for the right device', async () => {
      const D = await boot('device-d', { email: 'someone.else@example.com', licenseId: LICENSE.licenseId });
      try {
        const code = (await D.call('POST', '/api/lan/pair/start')).body.code;
        const r = await A.call('POST', '/api/lan/peers/pair', { url: D.base, code });
        assert.strictEqual(r.status, 403, JSON.stringify(r.body));
        assert.strictEqual(r.body.code, 'different-license');
        assert.ok(/different licenses/i.test(r.body.error), r.body.error);
        assert.strictEqual((await D.call('GET', '/api/lan/state')).body.peers.length, 0, 'nothing was trusted');
        assert.ok((await D.call('GET', '/api/lan/state')).body.pairing, 'the code was not spent on the wrong device');
      } finally { D.stop(); }
    });
    await check('the same email on a different license is refused', async () => {
      const E = await boot('device-e', { email: LICENSE.email, licenseId: 'lic-test-OTHER' });
      try {
        const code = (await E.call('POST', '/api/lan/pair/start')).body.code;
        const r = await A.call('POST', '/api/lan/peers/pair', { url: E.base, code });
        assert.strictEqual(r.status, 403, JSON.stringify(r.body));
        assert.strictEqual(r.body.code, 'different-license');
      } finally { E.stop(); }
    });
    await check('the email is matched however it is typed (case, spaces)', async () => {
      const F = await boot('device-f', { email: '  CHIEF@example.COM ', licenseId: LICENSE.licenseId });
      try {
        const code = (await F.call('POST', '/api/lan/pair/start')).body.code;
        const r = await A.call('POST', '/api/lan/peers/pair', { url: F.base, code });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        await A.call('POST', '/api/lan/peers/forget', { deviceId: (await F.call('GET', '/api/lan/hello')).body.deviceId });
      } finally { F.stop(); }
    });
    await check('a device that does not send a license (an older version) is refused', async () => {
      await B.call('POST', '/api/lan/pair/start');
      const code = (await B.call('GET', '/api/lan/state')).body.pairing.code;
      const r = await B.call('POST', '/api/lan/pair', { code, deviceId: 'old', deviceName: 'Old build' });
      assert.strictEqual(r.status, 403);
      assert.ok(/older|update/i.test(r.body.error), r.body.error);
    });
    await check('a call from a trusted device without the right license is refused', async () => {
      const code = (await B.call('POST', '/api/lan/pair/start')).body.code;
      const paired = await A.call('POST', '/api/lan/peers/pair', { url: B.base, code });
      assert.strictEqual(paired.status, 200, JSON.stringify(paired.body));
      const token = (JSON.parse(fs.readFileSync(path.join(A.dir, 'lan-sync.json'), 'utf8')).peers.find((p) => p.url === B.base) || {}).token;
      assert.ok(token, 'A holds a token for B');
      const noTag = await B.call('GET', '/api/lan/status', null, { authorization: 'Bearer ' + token });
      assert.strictEqual(noTag.status, 403, 'the right token alone is not enough');
      assert.strictEqual(noTag.body.code, 'different-license');
      const wrong = await B.call('GET', '/api/lan/status', null, { authorization: 'Bearer ' + token, 'x-lan-license': 'deadbeef' });
      assert.strictEqual(wrong.status, 403);
    });
    await check('the license id itself is never stored or sent: only a hash of it', async () => {
      const raw = fs.readFileSync(path.join(A.dir, 'lan-sync.json'), 'utf8');
      assert.ok(!raw.includes(LICENSE.licenseId), 'the license id is not on disk');
      const hello = JSON.stringify((await A.call('GET', '/api/lan/hello')).body);
      assert.ok(!hello.includes(LICENSE.licenseId) && !/chief@example/i.test(hello), 'hello tells nobody whose license it is');
    });

    console.log('Staying level on the same vessel');
    const rec = (id, n, who) => `store.saveVesselPart(${JSON.stringify(id)},'reportHistory',[{id:'r-${n}',savedAt:'2026-11-0${n}T00:00:00.000Z',title:'${who} report ${n}'}])`;
    await check('records one device lacks are copied to it, from both sides, and nothing is lost', async () => {
      seed(A.dir, rec(idA, 1, 'A'));
      seed(B.dir, rec(idB, 2, 'B'));
      await A.call('POST', '/api/lan/config', { enabled: true, intervalSec: 5, deviceName: 'Laptop A' });
      await A.call('POST', '/api/lan/sync-now');
      const a = (await A.call('GET', '/api/vessels/' + idA)).body;
      const b = (await B.call('GET', '/api/vessels/' + idB)).body;
      const titlesA = (a.reportHistory || []).map((x) => x.title).sort();
      const titlesB = (b.reportHistory || []).map((x) => x.title).sort();
      assert.deepStrictEqual(titlesA, ['A report 1', 'B report 2']);
      assert.deepStrictEqual(titlesB, ['A report 1', 'B report 2']);
    });

    await check('the two have the same digest afterwards, so a quiet sync moves nothing', async () => {
      const st1 = (await A.call('GET', '/api/lan/state')).body;
      await A.call('POST', '/api/lan/sync-now');
      const st2 = (await A.call('GET', '/api/lan/state')).body;
      if (st2.peers[0].message !== 'Up to date') {
        const a = (await A.call('GET', '/api/vessels/' + idA)).body;
        const b = (await B.call('GET', '/api/vessels/' + idB)).body;
        const keys = ['vessel', 'tanks', 'readings', 'voyage', 'bunkering', 'transfers', 'bunkerOps', 'fuelReport', 'reportHistory', 'voyageHistory', 'tankSummaryHistory', 'tankSummaryDraft', 'bunkerPlan', 'bunkerAfter', 'bunkerSummary', 'bunkerHistory', 'assets', 'meta'];
        for (const k of keys) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log('   differs:', k, JSON.stringify(a[k]).slice(0, 160), '|', JSON.stringify(b[k]).slice(0, 160));
      }
      assert.strictEqual(st2.peers[0].status, 'connected');
      assert.strictEqual(st2.peers[0].message, 'Up to date', JSON.stringify(st2.peers[0]));
      assert.deepStrictEqual(st1.peers[0].lastSync && st1.peers[0].lastSync.at, st2.peers[0].lastSync && st2.peers[0].lastSync.at);
    });

    await check('a gauging made on the second device later reaches the first', async () => {
      seed(B.dir, `store.saveVesselPart(${JSON.stringify(idB)},'readings',{t1:{reading:5,savedAt:'2026-11-05T00:00:00.000Z'}})`);
      await A.call('POST', '/api/lan/sync-now');
      const a = (await A.call('GET', '/api/vessels/' + idA)).body;
      assert.strictEqual(a.readings.t1.reading, 5);
    });

    await check('the timer does it without anyone pressing anything', async () => {
      seed(A.dir, `store.saveVesselPart(${JSON.stringify(idA)},'readings',{t2:{reading:7,savedAt:'2026-11-06T00:00:00.000Z'}})`);
      const deadline = Date.now() + 20000;
      let got = null;
      while (Date.now() < deadline) {
        got = (await B.call('GET', '/api/vessels/' + idB)).body.readings || {};
        if (got.t2) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      assert.ok(got && got.t2 && got.t2.reading === 7, 'B did not receive it within 20 s');
    });

    console.log('Different vessels, and the whole database');
    await check('when the two are on different vessels nothing is exchanged, and it says why', async () => {
      seed(B.dir, `store.setActiveVessel(${JSON.stringify(onlyB)})`);
      seed(A.dir, rec(idA, 3, 'A'));
      await A.call('POST', '/api/lan/sync-now');
      const st = (await A.call('GET', '/api/lan/state')).body.peers[0];
      assert.strictEqual(st.status, 'different-vessel', JSON.stringify(st));
      assert.match(st.message, /MV TEST ONE/);
      const b = (await B.call('GET', '/api/vessels/' + idB)).body;
      assert.ok(!(b.reportHistory || []).some((x) => x.title === 'A report 3'), 'must not leak across vessels');
    });

    await check('a vessel the other device lacks is reported, not copied, while only the active vessel syncs', async () => {
      const st = (await A.call('GET', '/api/lan/state')).body.peers[0];
      assert.ok(st.differences.missingOnPeer.some((v) => v.name === 'MV ONLY HERE'), JSON.stringify(st.differences));
      assert.ok(st.differences.missingHere.some((v) => v.name === 'MV ONLY THERE'));
      const list = (await B.call('GET', '/api/vessels')).body;
      assert.ok(!(list.vessels || list).some((v) => v.name === 'MV ONLY HERE'));
    });

    await check('"copy to the other device" copies that one vessel, on request', async () => {
      const peer = (await A.call('GET', '/api/lan/state')).body.peers[0];
      const r = await A.call('POST', '/api/lan/copy', { deviceId: peer.deviceId, vesselId: onlyA, direction: 'push' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      const list = (await B.call('GET', '/api/vessels')).body;
      assert.ok((list.vessels || list).some((v) => v.name === 'MV ONLY HERE'), 'vessel should now exist on B');
    });

    await check('sync the whole database: a vessel missing on either device is created there, and all vessels are level', async () => {
      await A.call('POST', '/api/lan/config', { scope: 'all', enabled: true, intervalSec: 5 });
      await A.call('POST', '/api/lan/sync-now');
      const la = ((await A.call('GET', '/api/vessels')).body.vessels || (await A.call('GET', '/api/vessels')).body).map((v) => v.name).sort();
      const lb = ((await B.call('GET', '/api/vessels')).body.vessels || (await B.call('GET', '/api/vessels')).body).map((v) => v.name).sort();
      assert.deepStrictEqual(la, lb, 'both devices hold the same vessels');
      assert.ok(la.includes('MV ONLY THERE') && la.includes('MV ONLY HERE'));
      const b = (await B.call('GET', '/api/vessels/' + idB)).body;
      assert.ok((b.reportHistory || []).some((x) => x.title === 'A report 3'), 'the held-back report arrives once everything syncs');
    });

    console.log('Finding each other');
    await check('a scan finds a device by asking each address (how a phone finds a PC)', async () => {
      const r = await A.call('POST', '/api/lan/scan', { hosts: ['127.0.0.1'], ports: [A.port, B.port, 1] });
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.found.some((d) => d.url === B.base), JSON.stringify(r.body.found));
      assert.ok(!r.body.found.some((d) => d.url === A.base), 'a device never finds itself');
    });

    await check('if a device changes to another license after pairing, nothing moves until they match again', async () => {
      seed(A.dir, `store.setActiveVessel(${JSON.stringify(idA)})`);
      seed(B.dir, `store.setActiveVessel(${JSON.stringify(idB)})`);
      const peerId = (await A.call('GET', '/api/lan/state')).body.peers[0].deviceId;
      await B.call('POST', '/api/lan/license', { email: 'someone.else@example.com', licenseId: 'lic-other' });
      seed(B.dir, `store.saveVesselPart(${JSON.stringify(idB)},'reportHistory',[{id:'r-9',savedAt:'2026-11-09T00:00:00.000Z',title:'B report 9'}])`);
      await A.call('POST', '/api/lan/config', { scope: 'active', enabled: true, intervalSec: 5 });
      await A.call('POST', '/api/lan/sync-now', { force: true });
      const st = (await A.call('GET', '/api/lan/state')).body.peers.find((p) => p.deviceId === peerId);
      assert.strictEqual(st.status, 'different-license', JSON.stringify(st));
      const a = (await A.call('GET', '/api/vessels/' + idA)).body;
      assert.ok(!(a.reportHistory || []).some((x) => x.title === 'B report 9'), 'B\'s new report did not reach A');
      /* and the other way: A's records do not reach B either */
      const callBack = await B.call('GET', '/api/lan/status', null, { authorization: 'Bearer nope' });
      assert.strictEqual(callBack.status, 401);
      await B.call('POST', '/api/lan/license', LICENSE);
      let arrived = false;
      for (let i = 0; i < 40 && !arrived; i++) {
        await A.call('POST', '/api/lan/sync-now', { force: true });
        const a2 = (await A.call('GET', '/api/vessels/' + idA)).body;
        arrived = (a2.reportHistory || []).some((x) => x.title === 'B report 9');
        if (!arrived) await new Promise((r) => setTimeout(r, 500));
      }
      assert.ok(arrived, 'on the same license again, it arrives: ' + JSON.stringify((await A.call('GET', '/api/lan/state')).body.peers.map((p) => [p.status, p.message, p.differences])));
    });
    await check('a device whose license is removed stops syncing', async () => {
      const peerId = (await A.call('GET', '/api/lan/state')).body.peers[0].deviceId;
      await A.call('POST', '/api/lan/license', { email: '', licenseId: '' });
      await A.call('POST', '/api/lan/sync-now', { force: true });
      const st = (await A.call('GET', '/api/lan/state')).body.peers.find((p) => p.deviceId === peerId);
      assert.strictEqual(st.status, 'no-license', JSON.stringify(st));
      const copy = await A.call('POST', '/api/lan/copy', { deviceId: peerId, vesselId: onlyA, direction: 'push' });
      assert.strictEqual(copy.status, 403);
      await A.call('POST', '/api/lan/license', LICENSE);
    });

    await check('forgetting a device removes the trust on this side, and its calls are refused', async () => {
      const peer = (await A.call('GET', '/api/lan/state')).body.peers[0];
      await B.call('POST', '/api/lan/peers/forget', { deviceId: (await A.call('GET', '/api/lan/hello')).body.deviceId });
      await A.call('POST', '/api/lan/sync-now');
      const st = (await A.call('GET', '/api/lan/state')).body.peers[0];
      assert.strictEqual(st.status, 'unpaired', JSON.stringify(st));
      await A.call('POST', '/api/lan/peers/forget', { deviceId: peer.deviceId });
      assert.strictEqual((await A.call('GET', '/api/lan/state')).body.peers.length, 0);
    });

    await check('what a device pairs with is never written into the settings a sync sends', async () => {
      const settings = JSON.stringify(JSON.parse(fs.readFileSync(path.join(A.dir, 'settings.json'), 'utf8')));
      assert.ok(!/tokenHash|"token"/.test(settings));
      assert.ok(fs.existsSync(path.join(A.dir, 'lan-sync.json')));
    });
  } finally {
    A.stop(); B.stop();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(`\n${pass}/${pass + failed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
