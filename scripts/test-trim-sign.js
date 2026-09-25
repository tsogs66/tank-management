#!/usr/bin/env node
/*
 * Which sign of trim computeTank is handed.
 *
 * The source workbook settles it. In TANK MANAGEMENT CAPTAIN VENIAMIS
 * FINAL VERSION.xlsm:
 *
 *   Data!J7  (name "trimTrue") = draftFwd - draftAft   ← what the sheet prints
 *   Data!AG9 (name "trim")     = -1 * J7               ← what indexes the grid
 *   Tank1!AD7 = trim, and AD8 = INDEX(B4:K4, 0, MATCH(AD7, B4:K4, 1))
 *
 * So the book's columns are keyed by trim *by the stern*. computeTank does
 * that flip itself, per tank, in trimAxisSign() — which is why what it must
 * be handed is the bow-positive figure the ship is read by, draftFwd -
 * draftAft. Handing it the by-stern value negates twice and reads the wrong
 * column.
 *
 * The check below is the workbook's own worked example: NO.1 H.F.O. TANK (P),
 * ullage 208, drafts 6.74 fwd / 8.65 aft, upright, which the sheet answers
 * 456.532 m3 (cached in Data!I11).
 *
 * Run: node scripts/test-trim-sign.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const calc = require('../server/calc.js');

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'tanks.json'), 'utf8'));
const fuel = (seed.tanks && seed.tanks.fuel) || seed.fuel;
const tank = fuel.find((t) => /NO\.1 H\.F\.O\. TANK \(P\)/i.test(t.name || ''));

const DRAFT_FWD = 6.74;
const DRAFT_AFT = 8.65;
const WORKBOOK_M3 = 456.532;

let checks = 0, failures = 0;
function check(label, cond, detail) {
  checks++;
  const ok = !!cond;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const volumeAt = (trim) => calc.computeTank(tank, {
  reading: 208,
  trim,
  list: 0,
  tempC: 36,
  density15: 0.9584,
  gaugeType: 'meter',
  entryMethod: tank.soundingMethod,
}).volumeObserved;

console.log('\nTrim sign handed to computeTank');

check('the seeded tank the workbook worked is present', !!tank);

const bowPositive = volumeAt(DRAFT_FWD - DRAFT_AFT);
const sternPositive = volumeAt(DRAFT_AFT - DRAFT_FWD);

check('draftFwd - draftAft reproduces the workbook figure',
  Math.abs(bowPositive - WORKBOOK_M3) < 0.25,
  `${bowPositive.toFixed(3)} vs ${WORKBOOK_M3}`);

check('draftAft - draftFwd does not — it reads the wrong column',
  Math.abs(sternPositive - WORKBOOK_M3) > 2,
  `${sternPositive.toFixed(3)} vs ${WORKBOOK_M3}`);

/* The two are far enough apart that a sign slip is never a rounding question:
   4.3 m3 on one tank, on a ship with fifteen of them. */
check('the two signs differ by more than 2 m3 on this tank',
  Math.abs(bowPositive - sternPositive) > 2,
  `${Math.abs(bowPositive - sternPositive).toFixed(3)} m3`);

/* Every caller must hand it the printed, bow-positive figure. These are the
   two that used to pass aft - fwd and read every tank a column out. */
const sources = [
  ['server/bunker-live.js', /Number\.isFinite\(fwd\) && Number\.isFinite\(aft\)\) return fwd - aft;/],
  ['server/index.js', /Number\.isFinite\(fwd\) && Number\.isFinite\(aft\)\) return fwd - aft;/],
];
for (const [rel, re] of sources) {
  const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  check(`${rel} derives trim as fwd - aft`, re.test(src));
  check(`${rel} no longer derives it as aft - fwd`,
    !/return aft - fwd;/.test(src));
}

if (failures) {
  console.log(`\n${failures}/${checks} failed`);
  process.exit(1);
}
console.log(`\ntrim sign: ${checks} checks passed`);
