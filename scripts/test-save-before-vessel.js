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
const switchers = app.split('await Api.setActive(id)');
assert.ok(switchers.length >= 3, 'expected the list handlers plus the trailing call');
switchers.slice(0, -1).forEach((chunk, i) => {
  const tail = chunk.slice(-500);
  assert.match(tail, /flushUnsavedTankWork/, 'setActive ' + i + ' is not preceded by a save');
});
assert.match(app, /data-load[\s\S]{0,220}flushUnsavedTankWork/);
assert.match(fuel, /async function flushIfDirty/);
assert.match(bunker, /async function flushOpenForms/);
console.log('save before vessel switch: ok');
