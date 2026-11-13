#!/usr/bin/env node
/**
 * Reading a calibration book from a PDF, end to end.
 *
 * Runs the real importer (Python, pdfplumber, OCR) over books that look like
 * the ones that arrive on a ship - long, spread over many pages, titled in
 * different ways, scanned - and checks what comes out the far end:
 *
 *   1. a book with a text layer is read exactly;
 *   2. the same book as a skewed, speckled scan is read by OCR, and after the
 *      checks every figure is within half a percent and nothing is wrong
 *      without having been said so;
 *   3. a table that fails the checks is not stored unless someone says so;
 *   4. the server takes a book far bigger than the old 50 MB limit without
 *      holding it in memory, refuses one over the limit with a plain message,
 *      and creates tanks from a finished reading without the file being sent
 *      a second time.
 *
 * Needs python3 with pdfplumber and reportlab. The scan needs tesseract,
 * ocrmypdf, pdftoppm, Pillow and img2pdf; without them the scan is skipped
 * (set REQUIRE_PDF_TOOLS=1 to make that a failure, as CI does).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-pdf-test-'));
process.env.TMS_DATA_DIR = path.join(TMP, 'data');
process.env.TMS_PDF_MAX_MB = '100';
const REQUIRE = process.env.REQUIRE_PDF_TOOLS === '1';

function have(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return r.status === 0;
}
const py = have('python3', ['-c', 'import pdfplumber, reportlab']);
if (!py) {
  const msg = 'python3 with pdfplumber and reportlab is not installed';
  if (REQUIRE) { console.error('FAIL: ' + msg); process.exit(1); }
  console.log('skipped: ' + msg);
  process.exit(0);
}
const canScan = have('python3', ['-c', 'import ocrmypdf, PIL, img2pdf, pikepdf'])
  && have('tesseract', ['--version']) && have('pdftoppm', ['-v']);
if (!canScan && REQUIRE) { console.error('FAIL: OCR tooling is not installed'); process.exit(1); }

const pdfImport = require('../server/pdf-import');

let failed = 0;
let total = 0;
async function check(name, fn) {
  total++;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').slice(0, 3).join('\n       ')}`);
  }
}

const BOOKS = path.join(TMP, 'books');
const gen = spawnSync('python3', [path.join(ROOT, 'scripts', 'make-test-sounding-books.py'), BOOKS, '--no-scan'],
  { encoding: 'utf8' });
if (gen.status !== 0) { console.error(gen.stderr || gen.stdout); process.exit(1); }
const expected = JSON.parse(fs.readFileSync(path.join(BOOKS, 'expected.json'), 'utf8'));

/** Compare one extracted table with what the book was made from. */
function compareCurve(table, exp, tolerance) {
  const vc = table.parsed.volumeCurve;
  const want = new Map(exp.x.map((x, i) => [x, exp.v[i]]));
  let worst = 0;
  const wrong = [];
  for (let i = 0; i < vc.x.length; i++) {
    const w = want.get(vc.x[i]);
    if (w == null) { wrong.push(`extra row ${vc.x[i]}`); continue; }
    const rel = Math.abs(vc.v[i] - w) / Math.max(w, 1e-9);
    if (rel > tolerance) wrong.push(`${vc.x[i]}: ${vc.v[i]} (book ${w})`);
    worst = Math.max(worst, rel);
  }
  const have = new Set(vc.x);
  const missing = exp.x.filter((x) => !have.has(x));
  return { worst, wrong, missing };
}

function tablesByName(summary) {
  const out = {};
  for (const t of summary.tables) if (!t.skipped) out[t.tankName] = t;
  return out;
}

(async () => {
  console.log('Tank titles');
  await check('tank titles in many spellings are recognised, cleaned and told apart (scripts/test-pdf-names.py)', () => {
    const r = spawnSync('python3', [path.join(ROOT, 'scripts', 'test-pdf-names.py')], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, (r.stdout || '').split('\n').filter((l) => /FAIL/.test(l)).join('\n') || r.stderr);
  });

  await check('headings, units and signs written many ways (scripts/test-pdf-headers.py)', () => {
    const r = spawnSync('python3', [path.join(ROOT, 'scripts', 'test-pdf-headers.py')], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, (r.stdout || '').split('\n').filter((l) => /FAIL/.test(l)).join('\n') || r.stderr);
  });

  console.log('Headings written other ways');
  await (async () => {
    const raw = await pdfImport.extractFromFile(path.join(BOOKS, 'book-labels.pdf'), { ocr: false });
    const sum = pdfImport.summarizeTables(raw);
    const usable = sum.tables.filter((t) => !t.skipped);
    const byPage = (n) => usable.find((t) => (t.pageStart || t.page) === n);
    await check('GAUGE in cm over VOLUME in m3: read as a sounding table, units kept', () => {
      const t = byPage(1);
      assert.strictEqual(t.kind, 'volumeCurve');
      assert.strictEqual(t.parsed.axisUnit, 'cm');
      assert.strictEqual(t.parsed.volumeUnit, 'm3');
      assert.notStrictEqual(t.parsed.soundingMethod, 'ullage');
    });
    await check('"98% FULL 48.0 m3" gives a capacity of 49 m3, not 48', () => {
      assert.ok(Math.abs(byPage(1).capacityHint - 48.98) < 0.1, String(byPage(1).capacityHint));
    });
    await check('ULLAGE with a bare mm / m3 row under it: an ullage table in millimetres', () => {
      const t = byPage(2);
      assert.strictEqual(t.parsed.soundingMethod, 'ullage');
      assert.strictEqual(t.parsed.axisUnit, 'mm');
      assert.strictEqual(t.capacityHint, 30);
    });
    await check('heel written H3P H2P H1P H1S H2S H3S is a heel table, port negative', () => {
      const t = byPage(3);
      assert.strictEqual(t.tableRole, 'heel');
      assert.deepStrictEqual(t.parsed.listVals, [-3, -2, -1, 1, 2, 3]);
    });
    await check('trim written Tr=-2 ... Tr=2 is a trim table with those trims', () => {
      const t = byPage(4);
      assert.strictEqual(t.tableRole, 'trim');
      assert.deepStrictEqual(t.parsed.trimVals, [-2, -1, 0, 1, 2]);
    });
  })();

  console.log('Layouts from real ship books (heeling in mm, trim in m, combined sounding table)');
  await (async () => {
    const raw = await pdfImport.extractFromFile(path.join(BOOKS, 'book-yards.pdf'), { ocr: false });
    const sum = pdfImport.summarizeTables(raw);
    const [heel, trim, comb] = sum.tables.filter((x) => !x.skipped);
    await check('heeling table: tank named cleanly (page number dropped), ullage in mm, heel to port negative', () => {
      assert.strictEqual(heel.tankName, 'NO.1 H.F.O.TK(P)');
      assert.strictEqual(heel.tableRole, 'heel');
      assert.strictEqual(heel.parsed.soundingMethod, 'ullage');
      assert.strictEqual(heel.parsed.axisUnit, 'mm');
      assert.deepStrictEqual(heel.parsed.listVals, [-4, -3, -2, -1, 1, 2, 3, 4]);
    });
    await check('heeling table: figures run together ("341.870-135.900") are two figures, a dash is a hole kept in place', () => {
      const row = heel.parsed.listGrid[heel.parsed.listAxis.indexOf(250)];
      assert.deepStrictEqual(row, [363.17, 356.07, 348.97, 341.87, -135.9, -188.4, -240.9, -293.4]);
      const first = heel.parsed.listGrid[0];
      assert.deepStrictEqual(first.slice(4), [0, 0, 0, 0]);
      assert.strictEqual(heel.parsed.blankCells.length, 20);
    });
    await check('heeling table: the second depth column (sounded depth) is recognised as the same depth, ullage + sounded = 5071', () => {
      assert.strictEqual(heel.parsed.axisPair.constant, 5071);
      assert.strictEqual(heel.parsed.listGrid[0].length, 8, 'the extra column must not become a ninth heel');
    });
    await check('heeling table: negatives are corrections, not volumes - it is not failed for them', () => {
      assert.notStrictEqual(heel.review.status, 'fail', JSON.stringify(heel.review.issues));
    });
    await check('trim table: "TRIM BY STEM 1.0m / EVEN KEEL 0.0m / -0.5m ... -4.0m" are the trims; "SOUNDED DEPTH mm" and "(M^3)" give the units', () => {
      assert.strictEqual(trim.tankName, 'F.W.TK[S]');
      assert.strictEqual(trim.tableRole, 'trim');
      assert.deepStrictEqual(trim.parsed.trimVals, [1, 0, -0.5, -1, -1.5, -2, -3, -4]);
      assert.strictEqual(trim.parsed.axisUnit, 'mm');
      assert.strictEqual(trim.parsed.volumeUnit, 'm3');
      assert.strictEqual(trim.parsed.soundingMethod, 'sounding');
    });
    await check('combined table: trims Tr=-4 ... Tr=1 and heels H1P ... H3S are read as the trim grid and the heel grid, port negative', () => {
      assert.deepStrictEqual(comb.parsed.trimVals, [-4, -3.5, -3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1]);
      assert.deepStrictEqual(comb.parsed.listVals, [-3, -2, -1, 1, 2, 3]);
      // printed H1P H2P H3P H1S H2S H3S = 0.5 1.0 1.5 -0.5 -0.7 -0.8 -> put in order from port 3 to starboard 3
      assert.deepStrictEqual(comb.parsed.listGrid[0], [1.5, 1, 0.5, -0.5, -0.7, -0.8]);
      assert.strictEqual(comb.parsed.listGrid.length, comb.parsed.trimGrid.length);
    });
    await check('combined table: gauge is the sounding, FILL % and ULLAGE are not columns of the grid, L.C.G / T.C.G / V.C.G / IMOM are left out', () => {
      assert.strictEqual(comb.parsed.trimAxis[0], 0);
      assert.strictEqual(comb.parsed.trimAxis[1], 5);
      assert.strictEqual(comb.parsed.trimGrid[0].length, 11);
      assert.deepStrictEqual(comb.removedHydroHeaders, ['L.C.G', 'T.C.G', 'V.C.G', 'IMOM']);
      assert.strictEqual(comb.parsed.axisUnit, 'cm');
      assert.strictEqual(comb.parsed.volumeUnit, 'm3');
      assert.strictEqual(comb.parsed.axisPair.constant, 1080);
    });
    await check('combined table: the tank is named from the "Compartment descr:" line', () => {
      assert.match(comb.tankName, /NO\.3 H\.F\.O\.\s?TK\.S/);
    });
    await check('a tank\'s trim table and heel table become one calibration, with the real heel table in place of the stand-in', () => {
      const r2 = JSON.parse(JSON.stringify(raw));
      const live = r2.tables.filter((x) => !x.skipped);
      live[0].tankName = live[1].tankName = 'F.W.TK[S]';
      r2.tanks = [{ name: 'F.W.TK[S]', tableIds: [live[0].id, live[1].id], tableCount: 2 }];
      const plans = pdfImport.planTankCreates(r2, { tankNames: ['F.W.TK[S]'], allowFailed: () => true });
      assert.strictEqual(plans.length, 1, JSON.stringify(plans));
      const p = plans[0].patch;
      assert.deepStrictEqual(p.trimVals, [1, 0, -0.5, -1, -1.5, -2, -3, -4]);
      assert.deepStrictEqual(p.listVals, [-4, -3, -2, -1, 1, 2, 3, 4]);
      assert.strictEqual(plans[0].mergedFrom.length, 1);
      assert.strictEqual(p.listSeed, undefined);
    });
  })();

  console.log('A book with three tables per tank (trim correction, list correction, capacity)');
  await (async () => {
    const raw = await pdfImport.extractFromFile(path.join(BOOKS, 'book-fot.pdf'), { ocr: false });
    const sum = pdfImport.summarizeTables(raw);
    const [trim, list, cap] = sum.tables.filter((x) => !x.skipped);
    await check('the three tables are one tank, named from "TANK NAME :"', () => {
      assert.deepStrictEqual(sum.tanks.map((t) => [t.name, t.tableCount]), [['NO.1 F.O.T. PORT', 3]]);
    });
    await check('"BY THE HEAD 2.0M 1.0M | BY THE STERN 1.0M ... 7.0M" (letters spaced out, no signs): head is positive, stern negative', () => {
      assert.strictEqual(trim.tableRole, 'trim');
      assert.deepStrictEqual(trim.parsed.trimVals, [2, 1, -1, -2, -3, -4, -5, -6, -7]);
    });
    await check('"LIST TO PORT 3.0 ... 0.5 | LIST TO STARB\'D 0.5 ... 3.0": port negative, starboard positive', () => {
      assert.strictEqual(list.tableRole, 'heel');
      assert.deepStrictEqual(list.parsed.listVals, [-3, -2.5, -2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2, 2.5, 3]);
    });
    await check('corrections in mm over soundings in metres are corrections, not volumes: none is failed for being negative or small', () => {
      for (const t of [trim, list]) {
        assert.strictEqual(t.parsed.gridKind, 'correction');
        assert.strictEqual(t.parsed.correctionUnit, 'mm');
        assert.strictEqual(t.parsed.axisUnit, 'm');
        assert.strictEqual(t.review.status, 'ok', JSON.stringify(t.review.issues));
      }
    });
    await check('capacity table: gauge written metre-centimetre (0-00, 01 ... 09, 0-10 ...) in two blocks is one curve in cm; KG, LCG and IT are left out', () => {
      assert.strictEqual(cap.parsed.volumeCurve.x.length, 100);
      assert.deepStrictEqual(cap.parsed.volumeCurve.x.slice(0, 12), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      assert.strictEqual(cap.parsed.volumeCurve.x[99], 99);
      assert.strictEqual(cap.parsed.axisUnit, 'cm');
      assert.strictEqual(cap.parsed.volumeUnit, 'm3');
      assert.deepStrictEqual(cap.removedHydroHeaders, ['KG', 'LCG', 'IT']);
      assert.deepStrictEqual(cap.parsed.gaugingHeight, { value: 7.771, unit: 'm' });
      assert.strictEqual(cap.review.status, 'ok', JSON.stringify(cap.review.issues));
    });
    await check('trim, list and capacity become ONE calibration: capacity from the curve (not a correction), no single unit forced on tables in m and cm', () => {
      const plans = pdfImport.planTankCreates(raw, {});
      assert.strictEqual(plans.length, 1, JSON.stringify(plans));
      const p = plans[0];
      assert.strictEqual(p.mergedFrom.length, 2);
      assert.deepStrictEqual(p.patch.trimVals, [2, 1, -1, -2, -3, -4, -5, -6, -7]);
      assert.strictEqual(p.patch.listVals.length, 12);
      assert.strictEqual(p.patch.volumeCurve.x.length, 100);
      assert.ok(Math.abs(p.tank.capacity - Math.max(...cap.parsed.volumeCurve.v)) < 1e-9, String(p.tank.capacity));
      assert.strictEqual(p.tank.soundingUnit, undefined);
      assert.strictEqual(p.tank.calcType, 'trimHeel');
    });
  })();

  console.log('Book with a text layer');
  const textSummary = await (async () => {
    const raw = await pdfImport.extractFromFile(path.join(BOOKS, 'book-long.pdf'), { ocr: true });
    return { raw, summary: pdfImport.summarizeTables(raw) };
  })();
  const text = textSummary.summary;
  const textTables = tablesByName(text);

  await check('finds each tank once, named cleanly', () => {
    assert.deepStrictEqual(text.tanks.map((t) => t.name), Object.keys(expected.tanks));
  });
  await check('does not run OCR on a page that already has text', () => {
    assert.strictEqual(text.ocrUsed, false);
    assert.deepStrictEqual(text.ocrPages, []);
  });
  await check('splices a table that runs over five pages, titled on each (with "(CONT\'D)")', () => {
    const t = textTables['NO.1 H.F.O. STORAGE TANK (P)'];
    assert.deepStrictEqual(t.pageSpan, [1, 2, 3, 4, 5]);
    const c = compareCurve(t, expected.tanks['NO.1 H.F.O. STORAGE TANK (P)'], 1e-9);
    assert.deepStrictEqual([c.wrong, c.missing], [[], []]);
  });
  await check('splices pages that have no title and no header', () => {
    const t = textTables['NO.2 M.D.O. SERVICE TANK (S)'];
    assert.deepStrictEqual(t.pageSpan, [6, 7, 8]);
    const c = compareCurve(t, expected.tanks['NO.2 M.D.O. SERVICE TANK (S)'], 1e-9);
    assert.deepStrictEqual([c.wrong, c.missing], [[], []]);
  });
  await check('reads soundings printed in three blocks side by side as one table, and takes the capacity from the title', () => {
    const t = textTables['FWT 3 C'];
    const c = compareCurve(t, expected.tanks['FWT 3 C'], 1e-9);
    assert.deepStrictEqual([c.wrong, c.missing], [[], []]);
    assert.strictEqual(t.capacityHint, 96.2);
  });
  await check('reads a sounding x trim grid and ignores the hydrostatic block beside it', () => {
    const t = textTables['NO.4 W.B.T. (P)'];
    const e = expected.tanks['NO.4 W.B.T. (P)'];
    assert.deepStrictEqual(t.parsed.trimAxis, e.axis);
    assert.deepStrictEqual(t.parsed.trimVals, e.vals);
    assert.deepStrictEqual(t.parsed.trimGrid, e.grid);
    assert.ok(text.tables.some((x) => x.skipped), 'the hydrostatic block was not set aside');
  });
  await check('every clean table passes the checks without a change', () => {
    for (const t of Object.values(textTables)) {
      assert.strictEqual(t.review.status, 'ok', `${t.tankName}: ${JSON.stringify(t.review.issues)}`);
      assert.strictEqual(t.review.repaired, 0);
    }
  });

  if (canScan) {
    /* How far a table is from the book it was made from: the worst figure, and what is missing.
       Error is judged against the tank, not against the row: one wrong digit in 1.612 is 60%
       of that row and 1% of the tank, and it is the tank that is being measured. */
    function accuracy(table, exp) {
      const p = table.parsed;
      if (p.kind === 'volumeCurve' && exp.x) {
        const c = compareCurve(table, exp, 0);
        const want = new Map(exp.x.map((x, i) => [x, exp.v[i]]));
        const cap = Math.max(...exp.v);
        let worst = 0;
        p.volumeCurve.x.forEach((x, i) => {
          if (want.has(x)) worst = Math.max(worst, Math.abs(p.volumeCurve.v[i] - want.get(x)) / cap);
          else worst = Math.max(worst, 1);
        });
        return { worst, missing: c.missing.length };
      }
      if (p.kind === 'grid' && exp.grid) {
        let worst = 0;
        let missing = 0;
        if (JSON.stringify(p.trimVals) !== JSON.stringify(exp.vals)) return { worst: 1, missing: 1 };
        const cap = Math.max(...exp.grid.flat());
        const byAxis = new Map(p.trimAxis.map((x, i) => [x, p.trimGrid[i]]));
        exp.grid.forEach((row, i) => {
          const got = byAxis.get(exp.axis[i]);
          if (!got) { missing++; return; }
          row.forEach((v, j) => { worst = Math.max(worst, Math.abs(got[j] - v) / cap); });
        });
        return { worst, missing };
      }
      return { worst: 1, missing: 1 };
    }

    /**
     * Read a scanned copy of the book and judge it.
     *
     * The safety checks hold for any scan, whatever the speckle did to it: a table is never
     * called fine when it is not, and one with anything wrong in it says why. The quality
     * checks (every tank found by name, three of four usable) are only asked of the fixed
     * scan, because how well a given pattern of speckle reads is not a property of the code.
     */
    async function scanSuite(label, file, { quality }) {
      console.log(label);
      const raw = await pdfImport.extractFromFile(file, { ocr: true });
      const scan = pdfImport.summarizeTables(raw);
      const scanTables = tablesByName(scan);
      await check('OCR is used on every page, and only because there is no text', () => {
        assert.strictEqual(scan.ocrUsed, true);
        assert.strictEqual(scan.ocrPages.length, expected.pages);
      });
      // Which table is which tank is judged by where it sits in the book, so that a title the
      // scan garbled ("FWI 3 C") does not hide whether its figures were right.
      const results = Object.entries(expected.tanks).map(([name, exp]) => {
        const first = exp.pages[0];
        const table = scan.tables.find((t) => !t.skipped && t.review && (t.pageStart || t.page) === first)
          || scan.tables.find((t) => !t.skipped && (t.pageSpan || [t.page]).includes(first));
        return { name, table, acc: table ? accuracy(table, exp) : { worst: 1, missing: 1 } };
      });
      if (quality) {
        await check('finds the same four tanks with the same names', () => {
          assert.deepStrictEqual(scan.tanks.map((t) => t.name), Object.keys(expected.tanks));
        });
      }
      await check('a table the checks pass is right: nothing "ok" has a figure off by more than 0.5% of the tank, or a row missing', () => {
        for (const r of results) {
          if (r.table && r.table.review && r.table.review.status === 'ok') {
            assert.ok(r.acc.worst <= 0.005 && r.acc.missing === 0, `${r.name} is "ok" but is ${(r.acc.worst * 100).toFixed(1)}% out, ${r.acc.missing} missing`);
          }
        }
      });
      await check('a table with anything wrong in it says why (a warning that names it, or a refusal)', () => {
        for (const r of results) {
          if (!r.table || !r.table.review) continue;
          if (r.acc.worst > 0.005 || r.acc.missing) {
            assert.notStrictEqual(r.table.review.status, 'ok', r.name);
            assert.ok(r.table.review.issues.length > 0, `${r.name} is wrong with nothing said about it`);
          }
        }
      });
      await check('what was corrected or filled in is said so', () => {
        for (const r of results) {
          if (r.table && r.table.review && (r.table.review.repaired > 0 || r.table.review.issues.some((i) => i.code === 'row-filled'))) {
            assert.notStrictEqual(r.table.review.status, 'ok', r.name);
          }
        }
      });
      await check('a page that could not be read is shown as failed, not left out', () => {
        for (const t of scan.tables) {
          if (!t.skipped && t.parsed && t.parsed.kind === 'unknown') assert.strictEqual(t.review && t.review.status, 'fail');
        }
      });
      if (quality) {
        await check('the scan is read well enough to use: at least three tanks pass, and none that passes is off by more than 5% of the tank', () => {
          const usable = results.filter((r) => r.table && r.table.review && r.table.review.status !== 'fail');
          assert.ok(usable.length >= 3, `only ${usable.length} of ${results.length} tanks passed: ${results.map((r) => `${r.name}=${r.table && r.table.review && r.table.review.status}`).join(', ')}`);
          for (const r of usable) assert.ok(r.acc.worst <= 0.05, `${r.name} passed with a figure ${(r.acc.worst * 100).toFixed(0)}% of the tank out`);
        });
      }
    }

    // A fixed scan, so the quality bar is the same on every machine.
    await scanSuite('Scanned copy of the same book (OCR) - fixed scan', path.join(ROOT, 'scripts', 'fixtures', 'book-scanned-seed7.pdf'), { quality: true });
    // Fresh scans with other speckle, for the safety checks only.
    for (const seed of (process.env.PDF_SCAN_SEEDS || '1,2').split(',').filter(Boolean)) {
      const dir = path.join(TMP, `scan-${seed}`);
      const g = spawnSync('python3', [path.join(ROOT, 'scripts', 'make-test-sounding-books.py'), dir, '--seed', seed], { encoding: 'utf8' });
      if (g.status !== 0) throw new Error(g.stderr);
      await scanSuite(`Scanned copy with other speckle (seed ${seed}) - safety only`, path.join(dir, 'book-scanned.pdf'), { quality: false });
    }
  } else {
    console.log('Scanned copy: skipped (OCR tooling not installed)');
  }

  console.log('Fail-safe');
  await check('a table that fails the checks is not planned for storage unless allowed', () => {
    const raw = JSON.parse(JSON.stringify(textSummary.raw));
    const t = raw.tables.find((x) => x.tankName === 'NO.1 H.F.O. STORAGE TANK (P)');
    for (let i = 100; i < 112; i++) t.parsed.volumeCurve.v[i] *= 9; // a block of rows misread
    const blocked = pdfImport.planTankCreates(raw, { tankNames: [t.tankName] });
    assert.strictEqual(blocked.length, 1);
    assert.strictEqual(blocked[0].blocked, true);
    assert.ok(!blocked[0].tank, 'a refused table must not produce a tank');
    assert.match(blocked[0].error, /Failed the checks/);
    const forced = pdfImport.planTankCreates(raw, { tankNames: [t.tankName], allowFailed: () => true });
    assert.ok(forced[0].tank, 'allowing it must');
  });
  await check('a table that was found but could not be read is shown as failed, with the reason', () => {
    const raw = JSON.parse(JSON.stringify(textSummary.raw));
    const t = raw.tables.find((x) => x.tankName === 'FWT 3 C');
    t.parsed = { kind: 'unknown', trimAxis: [], trimVals: [], trimGrid: [], volumeCurve: { x: [], v: [] } };
    const sum = pdfImport.summarizeTables(raw);
    const r = sum.tables.find((x) => x.tankName === 'FWT 3 C').review;
    assert.strictEqual(r.status, 'fail');
    assert.strictEqual(r.issues[0].code, 'unreadable');
    assert.strictEqual(sum.tanks.find((x) => x.name === 'FWT 3 C').review.status, 'fail');
  });
  await check('capacity written on the page is used to catch a decimal point in the wrong place', () => {
    const raw = JSON.parse(JSON.stringify(textSummary.raw));
    const t = raw.tables.find((x) => x.tankName === 'FWT 3 C');
    t.parsed.volumeCurve.v = t.parsed.volumeCurve.v.map((v) => v * 10);
    const sum = pdfImport.summarizeTables(raw);
    const r = sum.tables.find((x) => x.tankName === 'FWT 3 C').review;
    assert.strictEqual(r.status, 'fail');
  });
  await check('a table is compared with the tank it would replace', () => {
    const t = textSummary.raw.tables.find((x) => x.tankName === 'NO.2 M.D.O. SERVICE TANK (S)');
    const stored = {
      name: 'NO.2 MDO SERVICE', capacity: 48.75,
      volumeCurve: { x: t.parsed.volumeCurve.x.slice(), v: t.parsed.volumeCurve.v.map((v) => v * 0.94) },
    };
    const sum = pdfImport.summarizeTables(textSummary.raw, false, { findExisting: (n) => (/M\.?D\.?O/.test(n) ? stored : null) });
    const r = sum.tables.find((x) => x.tankName === 'NO.2 M.D.O. SERVICE TANK (S)').review;
    assert.ok(r.issues.some((i) => i.code === 'differs-from-stored'), JSON.stringify(r.issues));
  });

  console.log('Server');
  // The server runs as its own process so its memory can be measured on its own.
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, ['-e',
    "require('./server/index').start({ port: 0, host: '127.0.0.1' }).then((r) => console.log('PORT ' + r.port))"],
  { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; const m = buf.match(/PORT (\d+)/); if (m) resolve(Number(m[1])); });
    child.on('exit', (c) => reject(new Error('server exited ' + c)));
    setTimeout(() => reject(new Error('server did not start')), 20000);
  });
  const rssMB = () => {
    const r = spawnSync('ps', ['-o', 'rss=', '-p', String(child.pid)], { encoding: 'utf8' });
    return r.status === 0 ? Number(r.stdout.trim()) / 1024 : null;
  };
  const base = `http://127.0.0.1:${port}`;
  const json = async (url, opts) => {
    const res = await fetch(base + url, opts);
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };
  const vessel = (await json('/api/vessels', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Test Carrier' }),
  })).body;

  async function upload(file, extra = {}) {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    return json(`/api/vessels/${vessel.id}/import-pdf/jobs`, { method: 'POST', body: fd });
  }
  async function finish(jobId) {
    for (let i = 0; i < 600; i++) {
      const r = await json(`/api/vessels/${vessel.id}/import-pdf/jobs/${jobId}`);
      if (r.body.status === 'done' || r.body.status === 'error') return r.body;
      await new Promise((r2) => setTimeout(r2, 250));
    }
    throw new Error('job did not finish');
  }

  let jobId;
  await check('reads a book through the job route and returns the review with it', async () => {
    const r = await upload(path.join(BOOKS, 'book-long.pdf'));
    assert.strictEqual(r.status, 202);
    jobId = r.body.jobId;
    const done = await finish(jobId);
    assert.strictEqual(done.status, 'done', done.error);
    assert.strictEqual(done.result.tanks.length, 4);
    assert.ok(done.result.tanks.every((t) => t.review && t.review.status === 'ok'));
  });
  await check('creates the tanks from the finished reading, without sending the file again', async () => {
    const r = await json(`/api/vessels/${vessel.id}/import-pdf`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId, createTanks: true }),
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.created, 4, JSON.stringify(r.body.applied));
    assert.strictEqual(r.body.failed, 0);
    const bundle = (await json(`/api/vessels/${vessel.id}`)).body;
    const names = Object.values(bundle.tanks).flat().map((t) => t.name).sort();
    assert.deepStrictEqual(names, Object.keys(expected.tanks).sort());
  });
  await check('a reading that has expired says so plainly', async () => {
    const r = await json(`/api/vessels/${vessel.id}/import-pdf`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: 'nosuchjob', createTanks: true }),
    });
    assert.strictEqual(r.status, 410);
    assert.match(r.body.error, /expired/);
  });
  await check('does not overwrite a stored table that disagrees with the book unless confirmed', async () => {
    const bundle = (await json(`/api/vessels/${vessel.id}`)).body;
    const tank = Object.values(bundle.tanks).flat().find((t) => /MDO|M\.D\.O/.test(t.name));
    // The stored table is changed by hand to 8% less than the book's.
    const vc = tank.volumeCurve;
    await json(`/api/vessels/${vessel.id}/tanks/${tank.id}/calibration`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ volumeCurve: { x: vc.x, v: vc.v.map((v) => v * 0.92) } }),
    });
    const body = { jobId, createTanks: true, tankNames: ['NO.2 M.D.O. SERVICE TANK (S)'] };
    const refused = await json(`/api/vessels/${vessel.id}/import-pdf`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.strictEqual(refused.body.updated, 0, JSON.stringify(refused.body.applied));
    assert.strictEqual(refused.body.applied[0].needsConfirm, true);
    const confirmed = await json(`/api/vessels/${vessel.id}/import-pdf`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, confirmOverwrite: ['NO.2 M.D.O. SERVICE TANK (S)'] }),
    });
    assert.strictEqual(confirmed.body.updated, 1, JSON.stringify(confirmed.body.applied));
  });

  // A PDF with a big payload hidden in it: the book itself is ten pages, the file is not.
  function bigPdf(mb) {
    const out = path.join(TMP, `big-${mb}.pdf`);
    const script = [
      'import sys, os, pikepdf',
      'src, dst, mb = sys.argv[1], sys.argv[2], int(sys.argv[3])',
      'pdf = pikepdf.open(src)',
      'pdf.pages[0].Junk = pdf.make_stream(os.urandom(1024 * 1024) * mb)',
      'pdf.save(dst)',
    ].join('\n');
    const r = spawnSync('python3', ['-c', script, path.join(BOOKS, 'book-long.pdf'), out, String(mb)], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return out;
  }
  if (have('python3', ['-c', 'import pikepdf'])) {
    await check('takes a 90 MB book (the old limit was 50) without holding it in memory', async () => {
      const file = bigPdf(90);
      const before = rssMB();
      // Stream the body so the test itself does not hold the file either.
      const fd = new FormData();
      fd.append('file', await fs.openAsBlob(file), 'big.pdf');
      const res = await fetch(`${base}/api/vessels/${vessel.id}/import-pdf/jobs`, { method: 'POST', body: fd });
      const accepted = await res.json();
      assert.strictEqual(res.status, 202, JSON.stringify(accepted));
      const done = await finish(accepted.jobId);
      assert.strictEqual(done.status, 'done', done.error);
      assert.strictEqual(done.result.tanks.length, 4);
      const after = rssMB();
      if (before != null && after != null) {
        assert.ok(after - before < 60, `the server grew by ${(after - before).toFixed(0)} MB for a 90 MB upload`);
      }
      fs.unlinkSync(file);
    });
    await check('refuses a book over the limit with a plain message', async () => {
      const file = bigPdf(110);
      const fd = new FormData();
      fd.append('file', await fs.openAsBlob(file), 'huge.pdf');
      const res = await fetch(`${base}/api/vessels/${vessel.id}/import-pdf/jobs`, { method: 'POST', body: fd });
      const body = await res.json();
      assert.strictEqual(res.status, 413, JSON.stringify(body));
      assert.match(body.error, /larger than 100 MB/);
      fs.unlinkSync(file);
    });
    await check('leaves nothing behind in the upload folder', async () => {
      await new Promise((r) => setTimeout(r, 500));
      const dir = path.join(os.tmpdir(), 'tms-pdf-uploads');
      const left = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.pdf')) : [];
      assert.deepStrictEqual(left, []);
    });
  }

  child.removeAllListeners('exit');
  child.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${total - failed}/${total} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
