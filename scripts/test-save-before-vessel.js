/**
 * Switching vessel saves the open sheet before the next ship's file is loaded.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const fuel = fs.readFileSync(path.join(__dirname, '../public/js/fuel-report.js'), 'utf8');
const bunker = fs.readFileSync(path.join(__dirname, '../public/js/bunkering-report.js'), 'utf8');

assert.match(app, /async function flushUnsavedTankWork/);
assert.match(app, /window\.flushUnsavedTankWork = flushUnsavedTankWork/);
assert.match(app, /flushOpenTankReading/);

function between(src, start, end) {
  const i = src.indexOf(start);
  assert.ok(i >= 0, 'missing ' + start);
  const j = src.indexOf(end, i + start.length);
  assert.ok(j > i, 'missing ' + end + ' after ' + start);
  return src.slice(i, j);
}

const activate = between(app, 'async function activateTankVessel', 'async function reloadBundle');
assert.match(activate, /flushUnsavedTankWork[\s\S]{0,500}await Api\.setActive\(id\)/);
const loadBtn = between(app, "querySelectorAll('[data-load]')", "querySelectorAll('[data-del]')");
assert.match(loadBtn, /flushUnsavedTankWork[\s\S]{0,400}await Api\.setActive\(btn\.dataset\.load\)/);
for (const id of ['btn-backup', 'btn-pull', 'btn-push', 'btn-export-vessel']) {
  const chunk = between(app, `getElementById('${id}').onclick`, 'setSettingsBusy(false)');
  assert.match(chunk, /flushUnsavedTankWork/, id + ' writes the open sheet before it runs');
}
assert.match(fuel, /async function flushIfDirty/);
assert.match(bunker, /async function flushOpenForms/);
console.log('save before vessel switch: ok');
