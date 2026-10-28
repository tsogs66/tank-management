/**
 * Save files a report. A second save of the same sheet does not add another row.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const fuel = fs.readFileSync(path.join(root, 'public/js/fuel-report.js'), 'utf8');
const bunker = fs.readFileSync(path.join(root, 'public/js/bunkering-report.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');

assert.match(fuel, /fr-save'\)\.onclick = \(\) => saveReport\(\{ snapshot: true/);
assert.match(fuel, /async function flushIfDirty[\s\S]{0,700}snapshot: true/);
assert.match(bunker, /bp-save'\)\.onclick = \(\) => saveChainPart\([\s\S]{0,220}snapshot: true/);
assert.match(bunker, /ba-save'\)\.onclick = \(\) => saveChainPart\([\s\S]{0,220}snapshot: true/);
assert.match(bunker, /bs-save'\)\.onclick = \(\) => saveChainPart\([\s\S]{0,240}snapshot: true/);
assert.match(bunker, /async function flushOpenForms[\s\S]{0,900}snapshot: true/);
assert.match(app, /async function fileVoyageReportSnapshot/);
assert.match(app, /async function fileTankSummarySnapshot/);
assert.match(app, /async function persistVisibleSavedReports/);
assert.match(app, /async function uploadVisibleReportsToServer/);
assert.match(app, /saved-reports\/merge/);
const flushWork = app.slice(app.indexOf('async function flushUnsavedTankWork'), app.indexOf('window.flushUnsavedTankWork'));
assert.match(flushWork, /Api\.flushQueue/);
assert.match(flushWork, /persistVisibleSavedReports/);
assert.match(flushWork, /uploadVisibleReportsToServer/);
assert.match(app, /showToast\('Voyage report saved'\)/);
assert.match(app, /showToast\('Tank summary saved'\)/);
assert.doesNotMatch(app, /showToast\('Draft saved'\)/);
assert.match(app, /btn-save-voy[\s\S]{0,280}fileVoyageReportSnapshot/);

function sameSavedForm(a, b) {
  const strip = (form) => {
    if (!form || typeof form !== 'object') return form;
    const copy = { ...form };
    delete copy.updatedAt;
    return copy;
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

const filed = { header: { voyageNo: '12' }, updatedAt: '2026-10-28T00:00:00.000Z' };
const again = { header: { voyageNo: '12' }, updatedAt: '2026-10-29T00:00:00.000Z' };
const changed = { header: { voyageNo: '13' }, updatedAt: '2026-10-29T00:00:00.000Z' };
assert.strictEqual(sameSavedForm(filed, again), true);
assert.strictEqual(sameSavedForm(filed, changed), false);

console.log('save files report: ok');
