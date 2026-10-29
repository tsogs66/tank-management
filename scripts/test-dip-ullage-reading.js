#!/usr/bin/env node
/*
 * A dip of 0 is an empty tank; an ullage of 0 is a full one. The sounding
 * page used the tank's default method for every reading, so a DIP 0 taken on
 * Monitoring and recalculated there came out full on the overview. The page
 * now keeps the method the reading was taken with.
 * Run: node scripts/test-dip-ullage-reading.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8').replace(/\r\n/g, '\n');
const calc = require(path.join(ROOT, 'server/calc.js'));

let checks = 0, failures = 0;
function check(label, cond, detail) {
  checks++;
  const ok = !!cond;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail != null ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

console.log('\nDip and ullage on an ullage-default tank');
const tanks = require(path.join(ROOT, 'seed/tanks.json'));
const fuel1 = [].concat(...Object.values(tanks)).find((t) => t.id === 'fuel1');
check('seed tank fuel1 defaults to ullage', /ullage/i.test(fuel1.soundingMethod || ''), fuel1.soundingMethod);
const pct = (r) => (r.volumeObserved / fuel1.capacity) * 100;
const dip0 = calc.computeTank(fuel1, { reading: 0, trim: 0, list: 0, tempC: 15, gaugeType: 'meter', entryMethod: 'dip' });
const ull0 = calc.computeTank(fuel1, { reading: 0, trim: 0, list: 0, tempC: 15, gaugeType: 'meter', entryMethod: 'ullage' });
check('dip 0 is empty', pct(dip0) < 1, pct(dip0).toFixed(1) + '%');
check('ullage 0 is full', pct(ull0) > 90, pct(ull0).toFixed(1) + '%');

console.log('\nSounding page keeps the reading\'s method');
const detail = APP.slice(APP.indexOf('function renderTankDetail('), APP.indexOf('function renderTankDetail(') + 20000);
check('starts from the stored reading\'s method, tank default only for a new reading',
  /initialMethod = methodOf\(existing\.entryMethod \|\| tank\.soundingMethod \|\| 'sounding'\)/.test(detail));
check('offers Dip or Ullage', /id="in-method"[\s\S]{0,300}value="dip"[\s\S]{0,200}value="ullage"/.test(detail));
check('label follows the choice', /methodWord\(methodSelect \? methodSelect\.value : initialMethod\) \+ ' \(cm\)'/.test(detail));
check('calculates with the chosen method, not the tank default',
  /entryMethod: gaugeType === 'volume'[\s\S]{0,160}getElementById\('in-method'\)\.value : initialMethod/.test(detail));

const CORE = fs.readFileSync(path.join(ROOT, 'public/js/fuel-report-core.js'), 'utf8').replace(/\r\n/g, '\n');
check('monitoring default row uses the stored sounding method',
  /method:\s*normalizeMethod\(r\.entryMethod \|\| r\.method \|\| tank\.soundingMethod\)/.test(CORE));
const FuelReportCore = require(path.join(ROOT, 'public/js/fuel-report-core.js'));
const form = FuelReportCore.emptyFuelReport({
  tanks: { fuel: [{ id: 'fuel1', name: 'NO.1 HFO TK', soundingMethod: 'ullage', capacity: 100, category: 'fuel' }] },
  readings: { fuel1: { reading: 0, entryMethod: 'dip', result: { volumeObserved: 0, weightMT: 0 } } },
});
check('empty monitoring sheet opens a dip reading as dip, not ullage', form.rows.fuel1.method === 'dip', form.rows.fuel1.method);

console.log(`\n${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
