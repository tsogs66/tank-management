#!/usr/bin/env node
/**
 * The checks a calibration table goes through before it is believed.
 *
 * Each case starts from a curve that is right, damages it the way an OCR pass
 * or a typist does (a shifted decimal, a digit read wrong, a row lost, two
 * pages disagreeing) and says what the review has to do about it. Repairs are
 * only allowed where the right answer is certain; everywhere else the table
 * has to be refused, because a quietly wrong curve is worse than none.
 */
const assert = require('assert');
const { reviewParsed, reviewCurve, reviewGrid, crossCheckCurves } = require('../server/table-check');

let failed = 0;
let total = 0;
function check(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${e.message.split('\n')[0]}`);
  }
}

/* A hopper-ish tank: wide at the bottom, narrower above. 1 cm steps, 0..300. */
function tankCurve(step = 1, top = 300, cap = 500) {
  const x = [];
  const v = [];
  for (let s = 0; s <= top; s += step) {
    const f = s / top;
    x.push(s);
    v.push(Math.round(cap * (0.9 * f + 0.1 * f * f) * 1000) / 1000);
  }
  return { x, v };
}
const codes = (r) => r.issues.map((i) => i.code);

console.log('Volume curves');

check('a clean curve passes with nothing changed', () => {
  const c = tankCurve();
  const r = reviewCurve(c.x, c.v, { capacity: 500 });
  assert.deepStrictEqual(r.issues, []);
  assert.deepStrictEqual(r.repairs, []);
  assert.deepStrictEqual(r.v, c.v);
});

check('a dropped decimal point is put back', () => {
  const c = tankCurve();
  const good = c.v[120];
  c.v[120] = good * 10; // 123.456 read as 1234.56
  const r = reviewCurve(c.x, c.v, { capacity: 500 });
  assert.ok(Math.abs(r.v[120] - good) < 0.01, `got ${r.v[120]} wanted ${good}`);
  assert.strictEqual(r.repairs.filter((x) => x.code === 'value-repaired').length, 1);
  assert.deepStrictEqual(r.repairedRows, [120]);
  assert.ok(!r.issues.some((i) => i.severity === 'error'));
});

check('a decimal point lost the other way is put back', () => {
  const c = tankCurve();
  const good = c.v[200];
  c.v[200] = good / 10;
  const r = reviewCurve(c.x, c.v, { capacity: 500 });
  assert.ok(Math.abs(r.v[200] - good) < 0.01);
});

check('one digit read wrong is estimated from the rows either side', () => {
  const c = tankCurve();
  const good = c.v[75];
  c.v[75] = good + 37; // 8 read as 3 somewhere in the tens
  const r = reviewCurve(c.x, c.v, { capacity: 500 });
  assert.ok(Math.abs(r.v[75] - good) < 0.5, `got ${r.v[75]} wanted ${good}`);
  assert.strictEqual(r.repairedRows.length, 1);
});

check('a figure that is wrong but still plausible is found by its neighbours (the pair that runs backwards)', () => {
  const c = tankCurve();
  const good = c.v[26];
  c.v[26] = good + 2.2; // 8 read as 9: higher than the next row, so the curve runs backwards for one step
  const r = reviewCurve(c.x, c.v, { capacity: 500 });
  assert.ok(Math.abs(r.v[26] - good) < 0.3, `got ${r.v[26]} wanted ${good}`);
  assert.deepStrictEqual(r.repairedRows, [26]);
  for (let i = 1; i < r.v.length; i++) assert.ok(r.v[i] >= r.v[i - 1]);
});

check('a curve that still runs backwards after correction fails: two neighbours wrong the same amount cannot be told apart', () => {
  const c = tankCurve();
  c.v[100] += 1.0;
  c.v[101] -= 1.0; // each is as far from the line as the other, and the pair runs backwards
  const r = reviewParsed({ volumeCurve: c }, { capacity: 500 });
  assert.ok(codes(r.review).includes('runs-backwards'), JSON.stringify(codes(r.review)));
  assert.strictEqual(r.review.status, 'fail');
});

check('a value that makes the curve fall is mended', () => {
  const c = tankCurve();
  c.v[50] = c.v[48] - 5;
  const r = reviewCurve(c.x, c.v, { capacity: 500 });
  for (let i = 1; i < r.v.length; i++) assert.ok(r.v[i] >= r.v[i - 1], `falls at ${i}`);
});

check('a bad first row is mended (high volume at zero sounding)', () => {
  const c = tankCurve();
  c.v[0] = 55;
  const r = reviewCurve(c.x, c.v, { capacity: 500 });
  // Nothing before it to interpolate from, so it is refused rather than guessed.
  assert.ok(codes(r).includes('value-bad') || r.v[0] === 0, JSON.stringify(r.issues));
});

check('a run of bad rows is refused, not guessed at', () => {
  const c = tankCurve();
  for (let i = 100; i < 108; i++) c.v[i] = c.v[i] * 7;
  const r = reviewParsed({ volumeCurve: c }, { capacity: 500 });
  assert.strictEqual(r.review.status, 'fail');
});

check('a fair number of corrections is a warning to compare with the book', () => {
  const c = tankCurve();
  for (let i = 20; i < 290; i += 24) c.v[i] = c.v[i] * 10; // 12 slips in 301 rows
  const r = reviewCurve(c.x, c.v, { capacity: 500 });
  assert.ok(codes(r).includes('many-repairs'), JSON.stringify(codes(r)));
  assert.ok(!codes(r).includes('too-many-repairs'));
});

check('a page that is mostly wrong fails and nothing is invented for it', () => {
  const c = tankCurve();
  for (let i = 5; i < 295; i += 4) c.v[i] = c.v[i] * 10; // one row in four
  const r = reviewParsed({ volumeCurve: c }, { capacity: 500 });
  assert.strictEqual(r.review.status, 'fail');
});

check('a table that starts well above the bottom of the tank says pages may be missing', () => {
  const c = tankCurve();
  const r = reviewCurve(c.x.slice(100), c.v.slice(100), { capacity: 500 });
  assert.ok(codes(r).includes('starts-mid-table'), JSON.stringify(codes(r)));
  assert.ok(!codes(reviewCurve(c.x, c.v, { capacity: 500 })).includes('starts-mid-table'));
});

check('a missing row is reported with where', () => {
  const c = tankCurve();
  c.x.splice(150, 3);
  c.v.splice(150, 3);
  const r = reviewCurve(c.x, c.v, { capacity: 500 });
  const gap = r.issues.find((i) => i.code === 'axis-gap');
  assert.ok(gap, 'no gap reported');
  assert.strictEqual(gap.gaps[0].missing, 3);
});

check('a sounding misread (105 for 10.5) is put back on the step', () => {
  const c = tankCurve();
  c.x[40] = 410;
  const r = reviewCurve(c.x, c.v, { capacity: 500 });
  assert.strictEqual(r.x[40], 40);
});

check('a minus sign that is not on the page is taken off', () => {
  const c = tankCurve();
  const good = c.v[100];
  c.v[100] = -good;
  const r = reviewCurve(c.x, c.v, { capacity: 500 });
  assert.ok(Math.abs(r.v[100] - good) < 0.01, `got ${r.v[100]}`);
  assert.ok(r.repairs.some((x) => /minus sign/.test(x.message)));
});

check('a decimal point read as a digit (3.225 as 32225) is brought back close', () => {
  const c = tankCurve();
  const good = c.v[5];
  c.v[5] = Number(String(good).replace('.', '2'));
  const r = reviewCurve(c.x, c.v, { capacity: 500 });
  assert.ok(Math.abs(r.v[5] - good) / good < 0.05, `got ${r.v[5]} wanted ~${good}`);
});

check('a decimal point read as a digit (50.983 as 507983) is restored exactly, not just scaled', () => {
  const c = tankCurve();
  const good = c.v[69];
  const text = String(good);          // e.g. "158.8133"
  const [a, b] = text.split('.');
  c.v[69] = Number(a + '7' + b);      // the point became a 7
  const r = reviewCurve(c.x, c.v, { capacity: 500 });
  assert.ok(Math.abs(r.v[69] - good) < 1e-6, `got ${r.v[69]} wanted ${good}`);
  assert.ok(r.repairs.some((q) => /digit that is not on the page/.test(q.message)), JSON.stringify(r.repairs));
});

check('a row whose sounding is nonsense (1324, -65) is left out, not sorted into the curve', () => {
  const c = tankCurve();
  const x = c.x.slice(); const v = c.v.slice();
  x.splice(40, 0, 1324); v.splice(40, 0, 4.392);
  x.splice(90, 0, -65); v.splice(90, 0, 20.858);
  const r = reviewCurve(x, v, { capacity: 500 });
  assert.ok(!r.x.includes(1324) && !r.x.includes(-65));
  assert.strictEqual(r.repairs.filter((q) => q.code === 'row-dropped').length, 2);
  assert.strictEqual(r.x.length, c.x.length);
});

check('one or two rows lost from a long table are filled and flagged', () => {
  const c = tankCurve();
  const good = c.v[120];
  c.x.splice(120, 1); c.v.splice(120, 1);
  const r = reviewCurve(c.x, c.v, { capacity: 500 });
  assert.strictEqual(r.x.length, c.x.length + 1);
  const i = r.x.indexOf(120);
  assert.ok(i >= 0 && Math.abs(r.v[i] - good) < 0.5, `filled ${r.v[i]} wanted ${good}`);
  assert.deepStrictEqual(r.repairedRows, [i]);
  assert.ok(codes(r).includes('row-filled'));
});

check('a bigger hole is reported, never invented', () => {
  const c = tankCurve();
  c.x.splice(100, 6); c.v.splice(100, 6);
  const r = reviewCurve(c.x, c.v, { capacity: 500 });
  assert.strictEqual(r.x.length, c.x.length);
  assert.ok(codes(r).includes('axis-gap'));
});

check('a swapped pair is sorted, not thrown away', () => {
  const c = tankCurve();
  [c.x[60], c.x[61]] = [c.x[61], c.x[60]];
  [c.v[60], c.v[61]] = [c.v[61], c.v[60]];
  const r = reviewCurve(c.x, c.v, { capacity: 500 });
  assert.strictEqual(r.x.length, c.x.length);
  assert.ok(!r.repairs.some((q) => q.code === 'row-dropped'));
});

check('rows out of order are sorted', () => {
  const c = tankCurve();
  const a = c.x[30]; const b = c.v[30];
  c.x[30] = c.x[31]; c.v[30] = c.v[31];
  c.x[31] = a; c.v[31] = b;
  const r = reviewCurve(c.x, c.v, { capacity: 500 });
  for (let i = 1; i < r.x.length; i++) assert.ok(r.x[i] > r.x[i - 1]);
});

check('a table printed from the top down is turned round', () => {
  const c = tankCurve(10);
  const r = reviewCurve(c.x.slice().reverse(), c.v.slice().reverse(), { capacity: 500 });
  assert.strictEqual(r.x[0], 0);
  assert.ok(r.repairs.some((x) => x.code === 'axis-reversed'));
});

check('repeated rows (a spliced page overlap) are removed', () => {
  const c = tankCurve();
  const x = c.x.slice(0, 101).concat(c.x.slice(95));
  const v = c.v.slice(0, 101).concat(c.v.slice(95));
  const r = reviewCurve(x, v, { capacity: 500 });
  assert.strictEqual(r.x.length, c.x.length);
  assert.ok(!codes(r).includes('axis-duplicate-conflict'));
});

check('an ullage book (volume falls as ullage grows) is not mistaken for a fault', () => {
  const c = tankCurve();
  const v = c.v.map((q) => 500 - q);
  const r = reviewCurve(c.x, v, { capacity: 500, direction: -1 });
  assert.deepStrictEqual(r.issues, []);
});

check('negative volumes are refused', () => {
  const c = tankCurve(10);
  c.v[10] = -4;
  c.v[11] = -4; c.v[12] = -4; c.v[13] = -4;
  const r = reviewParsed({ volumeCurve: c }, { capacity: 500 });
  assert.strictEqual(r.review.status, 'fail');
});

console.log('Capacity cross-check');

check('volumes ten times the capacity are refused', () => {
  const c = tankCurve();
  const big = { x: c.x, v: c.v.map((q) => q * 10) };
  const r = reviewParsed({ volumeCurve: big }, { capacity: 500 });
  assert.ok(r.review.issues.some((i) => i.code === 'capacity-mismatch' || i.code === 'value-bad'), JSON.stringify(codes(r.review)));
  assert.strictEqual(r.review.status, 'fail');
});

check('a table that stops well short of capacity says a page may be missing', () => {
  const c = tankCurve();
  const half = { x: c.x.slice(0, 150), v: c.v.slice(0, 150) };
  const r = reviewParsed({ volumeCurve: half }, { capacity: 500 });
  assert.ok(codes(r.review).includes('under-capacity'));
});

check('capacity from the tank in the store is used when the book gives none', () => {
  const c = tankCurve();
  const big = { x: c.x, v: c.v.map((q) => q * 10) };
  const r = reviewParsed({ volumeCurve: big }, { existing: { capacity: 500 } });
  assert.strictEqual(r.review.status, 'fail');
});

console.log('Sounding x trim grids');

function trimGrid() {
  const axis = [];
  const grid = [];
  const vals = [2, 1, 0, -1, -2];
  for (let s = 0; s <= 200; s += 2) {
    axis.push(s);
    grid.push(vals.map((t) => Math.round((s * 2.5 + t * Math.min(s, 40) * 0.4) * 100) / 100));
  }
  return { axis, vals, grid };
}

check('a trim header that was misread (1, 1, ...) fails: the columns cannot be told apart', () => {
  const g = trimGrid();
  const r = reviewParsed({ trimAxis: g.axis, trimVals: [1, 1, 0, -1, -2], trimGrid: g.grid }, {});
  assert.strictEqual(r.review.status, 'fail');
  assert.ok(codes(r.review).includes('trim-header'));
  assert.strictEqual(reviewParsed({ trimAxis: g.axis, trimVals: g.vals, trimGrid: g.grid }, {}).review.status, 'ok');
});

check('a clean volume grid passes', () => {
  const g = trimGrid();
  const r = reviewGrid(g.axis, g.vals, g.grid, { volume: true });
  assert.deepStrictEqual(r.issues, [], JSON.stringify(r.issues));
});

check('a blown-up cell in the grid is corrected', () => {
  const g = trimGrid();
  const good = g.grid[60][2];
  g.grid[60][2] = good * 100;
  const r = reviewGrid(g.axis, g.vals, g.grid, { volume: true });
  assert.ok(Math.abs(r.grid[60][2] - good) < 0.5, `got ${r.grid[60][2]} wanted ${good}`);
  assert.deepStrictEqual(r.repairedCells, [[60, 2]]);
});

check('correction grids are not held to the volume rules', () => {
  const axis = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const vals = [2, 1, 0, -1, -2];
  const grid = axis.map((s) => vals.map((t) => (s % 3 === 0 ? -0.2 : 0.3) * t));
  const r = reviewGrid(axis, vals, grid);
  assert.strictEqual(r.volume, false);
  assert.deepStrictEqual(r.issues, []);
});

check('a grid and a volume curve of the same tank are checked against each other', () => {
  const g = trimGrid();
  const c = { x: g.axis.slice(), v: g.grid.map((row) => row[2] * 1.2) }; // a curve that does not match the grid
  const r = reviewParsed({ volumeCurve: c }, { siblings: [{ trimAxis: g.axis, trimVals: g.vals, trimGrid: g.grid }] });
  assert.ok(r.review.cross.length === 1 && r.review.cross[0].status === 'fail', JSON.stringify(r.review.cross));
  assert.ok(codes(r.review).includes('cross-check'));
  assert.strictEqual(r.review.status, 'fail');
});

check('two sources a few percent apart are a warning, not a refusal', () => {
  const g = trimGrid();
  const c = { x: g.axis.slice(), v: g.grid.map((row) => row[2] * 1.03) };
  const r = reviewParsed({ volumeCurve: c }, { siblings: [{ trimAxis: g.axis, trimVals: g.vals, trimGrid: g.grid }] });
  assert.strictEqual(r.review.cross[0].status, 'warn', JSON.stringify(r.review.cross));
  assert.strictEqual(r.review.status, 'warn');
});

console.log('Cross-checks against other sources');

check('two pages that agree are fine', () => {
  const c = tankCurve();
  const x = crossCheckCurves(c, { x: c.x.slice(), v: c.v.map((q) => q * 1.001) });
  assert.strictEqual(x.status, 'ok');
});

check('a table that differs from the stored one by a few percent is a warning, not a refusal', () => {
  const c = tankCurve();
  const stored = { volumeCurve: { x: c.x, v: c.v.map((q) => q * 0.97) }, capacity: 500 };
  const r = reviewParsed({ volumeCurve: c }, { capacity: 500, existing: stored });
  const it = r.review.issues.find((i) => i.code === 'differs-from-stored');
  assert.ok(it && it.severity === 'warn', JSON.stringify(r.review.issues));
  assert.strictEqual(r.review.status, 'warn');
});

check('a table that matches the stored one says so', () => {
  const c = tankCurve();
  const r = reviewParsed({ volumeCurve: c }, { capacity: 500, existing: { volumeCurve: c, capacity: 500 } });
  assert.strictEqual(r.review.status, 'ok');
  assert.strictEqual(r.review.cross[0].status, 'ok');
});

check('pages that print the same row differently are reported', () => {
  const c = tankCurve();
  const r = reviewParsed({ volumeCurve: c }, { capacity: 500, overlap: [{ x: 100, a: 196, b: 169, pages: [3, 4] }] });
  assert.ok(codes(r.review).includes('splice-conflict'));
});

check('the input is never modified', () => {
  const c = tankCurve();
  c.v[80] *= 10;
  const before = JSON.stringify(c);
  reviewParsed({ volumeCurve: c }, { capacity: 500 });
  assert.strictEqual(JSON.stringify(c), before);
});

check('a heel column headed 0 must be zero: real corrections under it mean the headings are shifted', () => {
  const axis = [0, 50, 100, 150, 200];
  const vals = [-2, -1, 0, 1, 2];
  const bad = axis.map((x) => [200 - x, 100 - x, 54 + x / 10, -55, -111]);
  const r = reviewGrid(axis, vals, bad, { volume: false });
  assert.ok(r.issues.some((i) => i.code === 'zero-column-not-zero' && i.severity === 'error'), JSON.stringify(r.issues));
  const good = axis.map((x) => [200 - x, 100 - x, 0, -55, -111]);
  const g = reviewGrid(axis, vals, good, { volume: false });
  assert.ok(!g.issues.some((i) => i.code === 'zero-column-not-zero'));
});

check('one lost minus in the trim header is put back, once, and reported', () => {
  const axis = [4100, 4150, 4200, 4250];
  const vals = [1, 0, -0.5, -1, -1.5, -2, 3, -4];
  const grid = axis.map((x) => vals.map((_, c) => 137 + x / 1000 - c * 0.2));
  const r = reviewGrid(axis, vals, grid, { volume: true });
  assert.deepStrictEqual(r.vals, [1, 0, -0.5, -1, -1.5, -2, -3, -4]);
  assert.ok(r.repairs.some((x) => x.code === 'header-sign'));
});

check('a hole with figures on both sides is a lost figure; a dash in the corner is not', () => {
  const axis = [0, 50, 100, 150, 200, 250];
  const vals = [-2, -1, 1, 2];
  const grid = axis.map((x) => [100 - x / 10, 50 - x / 10, -50 - x / 10, -100 - x / 10]);
  grid[3][1] = 0; grid[0][2] = 0; grid[0][3] = 0;
  const r = reviewParsed({ listAxis: axis, listVals: vals, listGrid: grid, blankCells: [[3, 1], [0, 2], [0, 3]], gridKind: 'correction', tableRole: 'heel' }, {});
  const lf = r.review.issues.find((i) => i.code === 'lost-figures');
  assert.ok(lf && lf.count === 1, JSON.stringify(r.review.issues));
  assert.deepStrictEqual(lf.cells, [[3, 1]]);
});

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
