/**
 * The order a chief puts the tanks in.
 *
 * Every page that lists tanks reads the stored array in order, so the order
 * is the array. These are the things that has to survive: a list sent from a
 * page that has since gone stale, a tank added after the order was set, and
 * the round trip back to the arrangement the app chose.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tank-order-'));
process.env.TMS_DATA_DIR = dataDir;

const store = require('../server/store.js');

let pass = 0;
const is = (got, want, what) => { assert.deepStrictEqual(got, want, what); pass += 1; };

const vessel = store.createVessel({ name: 'MV Order Test' });
const vesselId = vessel.id || vessel;

const named = (name, id) => store.upsertTank(vesselId, {
  name, id, category: 'fuel', capacity: 100, calcType: 'direct',
});
const a = named('NO.1 H.F.O. TK (P)', 'fuel-a');
const b = named('NO.1 H.F.O. TK (S)', 'fuel-b');
const c = named('M.D.O. SERVICE TK', 'fuel-c');

const fuelNames = () => store.getVesselBundle(vesselId).tanks.fuel.map((t) => t.name);
const fuelIndexes = () => store.getVesselBundle(vesselId).tanks.fuel.map((t) => t.sortIndex);

is(fuelNames(), ['NO.1 H.F.O. TK (P)', 'NO.1 H.F.O. TK (S)', 'M.D.O. SERVICE TK'],
  'tanks start in the order they were added');

/* ---- The order a chief sets is the order the pages read ---- */
store.reorderTanks(vesselId, 'fuel', [c.id, a.id, b.id]);
is(fuelNames(), ['M.D.O. SERVICE TK', 'NO.1 H.F.O. TK (P)', 'NO.1 H.F.O. TK (S)'],
  'the array is written in the order given');
is(fuelIndexes(), [0, 1, 2], 'and each tank is stamped with its place');

/* ---- A page that has gone stale must not lose a tank ----
 * Someone reorders on a tablet that was opened before the last tank was
 * added, or after one was deleted. Neither may drop a tank off the list. */
store.reorderTanks(vesselId, 'fuel', [b.id, 'a-tank-that-was-deleted']);
is(fuelNames(), ['NO.1 H.F.O. TK (S)', 'M.D.O. SERVICE TK', 'NO.1 H.F.O. TK (P)'],
  'an id it does not know is ignored, and the tanks left unmentioned keep their order behind it');
is(fuelIndexes(), [0, 1, 2], 'every tank still has its place');

store.reorderTanks(vesselId, 'fuel', [a.id, a.id, b.id]);
is(fuelNames()[0], 'NO.1 H.F.O. TK (P)', 'the same id twice does not duplicate a tank');
is(store.getVesselBundle(vesselId).tanks.fuel.length, 3, 'and nothing is lost to it');

/* ---- A tank added later joins the end rather than the middle ---- */
const late = named('NO.2 H.F.O. TK (P)', 'fuel-late');
is(fuelNames()[3], 'NO.2 H.F.O. TK (P)', 'a new tank is listed last');

/* ---- Putting it back ---- */
store.clearTankOrder(vesselId, 'fuel');
is(store.getVesselBundle(vesselId).tanks.fuel.every((t) => t.sortIndex === undefined), true,
  'clearing the order takes the stamps off, so the pages that sort on their own account do so again');

/* ---- A category that is not a category ---- */
assert.throws(() => store.reorderTanks(vesselId, 'nonsense', []), /Unknown tank category/,
  'an unknown category is refused rather than quietly creating one');
pass += 1;

/* ---- Route order: "order" must not be read as a tank id ----
 * Express matches routes in the order they are declared, so this is a
 * property of the source, and the fault it guards against is silent: a PUT
 * to /tanks/order would edit a tank. */
const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
const orderAt = server.indexOf("app.put('/api/vessels/:id/tanks/order'");
const tankAt = server.indexOf("app.put('/api/vessels/:id/tanks/:tankId'");
assert.ok(orderAt > 0 && tankAt > 0, 'both routes are registered');
assert.ok(orderAt < tankAt,
  'PUT /tanks/order must be declared before /tanks/:tankId, or "order" is read as a tank id');
pass += 1;

/* ---- Dragging a row with a finger ----
 *
 * Where a dragged row lands is decided by how many neighbours the pointer has
 * passed the middle of. It is the one piece of the drag that can be checked
 * without a browser, and the one worth checking: on a phone the rows are
 * under the thumb that is moving them.
 */
const TankOrder = require('../public/js/tank-order.js');

/* Three rows 40 high at y = 0, 40, 80 — middles at 20, 60, 100. */
const middles = [20, 60, 100];
is(TankOrder.dropIndex(middles, 0), 0, 'above every row: first place');
is(TankOrder.dropIndex(middles, 19), 0, 'just short of the first middle: still first');
is(TankOrder.dropIndex(middles, 21), 1, 'past the first middle: second place');
is(TankOrder.dropIndex(middles, 61), 2, 'past the second');
is(TankOrder.dropIndex(middles, 400), 3, 'below every row: last place');
is(TankOrder.dropIndex([], 50), 0, 'a list of one row has one place to be');

/* Rows are not all the same height — a long tank name wraps — so the answer
   follows the middles it is given rather than a row height. */
is(TankOrder.dropIndex([20, 100, 260], 150), 2, 'uneven rows are read from their own middles');

/* The pointer runs up the list as well as down. */
is(TankOrder.dropIndex(middles, 100), 2, 'exactly on a middle does not count as past it');

fs.rmSync(dataDir, { recursive: true, force: true });
console.log(`tank order: ${pass} checks passed`);
