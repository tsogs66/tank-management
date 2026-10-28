/**
 * Gaugings, filed reports and open drafts survive a merge.
 *
 * A backup merge and a sync used to replace the readings map and the open
 * sheet. A sounding that existed on only one side disappeared, and a draft
 * did too. These checks are the rule: keep the side that has it, and where
 * both have it keep the newer stamp.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tank-live-'));
process.env.TMS_DATA_DIR = dataDir;
process.env.CHENG_PRO_DATA_DIR = dataDir;

const store = require('../server/store.js');

let pass = 0;
const is = (got, want, what) => {
  assert.deepStrictEqual(got, want, what);
  pass += 1;
};

const vessel = store.createVessel({ name: 'MV Live Parts' });
const id = vessel.id;

store.saveVesselPart(id, 'readings', {
  a: { reading: 1, savedAt: '2026-10-01T00:00:00.000Z' },
  b: { reading: 2, savedAt: '2026-10-02T00:00:00.000Z' },
});
store.saveVesselPart(id, 'readings', {
  a: { reading: 9, savedAt: '2026-09-01T00:00:00.000Z' },
  c: { reading: 3, savedAt: '2026-10-03T00:00:00.000Z' },
});
const readings = store.getVesselBundle(id).readings;
is(readings.a.reading, 1, 'an older gauging does not replace a newer one');
is(readings.b.reading, 2, 'a tank sounded on only one side stays');
is(readings.c.reading, 3, 'a tank sounded on the incoming side is added');

store.saveVesselPart(id, 'fuelReport', { header: { voyageNo: '1' }, updatedAt: '2026-10-04T00:00:00.000Z' });
store.saveVesselPart(id, 'fuelReport', { header: { voyageNo: '2' }, updatedAt: '2026-10-05T00:00:00.000Z' });
store.saveVesselPart(id, 'fuelReport', { header: { voyageNo: '0' }, updatedAt: '2026-10-03T00:00:00.000Z' });
store.saveVesselPart(id, 'fuelReport', null);
is(store.getVesselBundle(id).fuelReport.header.voyageNo, '2', 'a blank or older sheet does not erase the open draft');

store.saveVesselPart(id, 'reportHistory', [{ id: 'r1', savedAt: '2026-10-01T00:00:00.000Z', title: 'local' }]);
store.saveVesselPart(id, 'tankSummaryDraft', { note: 'open summary', updatedAt: '2026-10-06T00:00:00.000Z' });

const backup = store.exportBackup();
const copy = JSON.parse(JSON.stringify(backup));
const row = copy.vessels[id];
row.readings = { d: { reading: 4, savedAt: '2026-10-07T00:00:00.000Z' } };
row.reportHistory = [{ id: 'r2', savedAt: '2026-10-02T00:00:00.000Z', title: 'file' }];
row.fuelReport = null;
row.tankSummaryDraft = null;
store.importBackup(copy, { merge: true });

const after = store.getVesselBundle(id);
is(after.readings.b.reading, 2, 'merge restore keeps gaugings the file does not carry');
is(after.readings.d.reading, 4, 'merge restore adds gaugings the file carries');
is(after.reportHistory.map((r) => r.id).sort(), ['r1', 'r2'], 'merge restore unions saved reports');
is(after.fuelReport.header.voyageNo, '2', 'merge restore keeps a draft the file leaves blank');
is(after.tankSummaryDraft.note, 'open summary', 'merge restore keeps the tank-summary draft');

const remote = JSON.parse(JSON.stringify(store.syncPushBundle()));
remote.vessels[id].meta = { ...(remote.vessels[id].meta || {}), revision: 0 };
remote.vessels[id].readings = {
  e: { reading: 5, savedAt: '2026-10-08T00:00:00.000Z' },
};
remote.vessels[id].reportHistory = [
  { id: 'r3', savedAt: '2026-10-09T00:00:00.000Z', title: 'peer' },
];
const results = store.applySyncPayload(remote);
is(results[0].action, 'kept-local', 'a lower peer revision does not replace the vessel');
const synced = store.getVesselBundle(id);
is(synced.readings.e.reading, 5, 'a lower revision still brings a gauging that exists only on the peer');
is(synced.readings.b.reading, 2, 'keeping the local revision still keeps local gaugings');
is(synced.reportHistory.some((r) => r.id === 'r3'), true, 'a lower revision still brings a saved report');

console.log('live parts merge ok (' + pass + ')');
