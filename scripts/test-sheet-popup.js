/**
 * Monitoring / After Bunkering sheet popups: Actual, Temp, and SG each have
 * their own overlay, and popup fields select-all on entry.
 *
 * Run: node scripts/test-sheet-popup.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const candidates = [
  path.join(__dirname, '..', 'public', 'js', 'fuel-report.js'),
  path.join(__dirname, '..', 'modules', 'tanks', 'public', 'js', 'fuel-report.js'),
].filter((p) => fs.existsSync(p));

assert.ok(candidates.length, 'fuel-report.js not found');

for (const file of candidates) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(process.cwd(), file);
  assert(src.includes('data-sheet-popup="actual"'), rel + ': Actual column must open a popup');
  assert(src.includes('data-sheet-popup="sg"'), rel + ': SG column must open a popup');
  assert(src.includes('data-sheet-popup="temp"'), rel + ': Temp column must open a popup');
  assert(/mode === 'temp'|fieldMode === 'temp'/.test(src), rel + ': popup must have a temp mode');
  assert(src.includes('function selectAllPopupField'), rel + ': popup fields must select-all');
  assert(src.includes('function bindPopupSelectAll'), rel + ': popup must bind select-all on click/focus');
  assert(/data-tsp="tempC"/.test(src), rel + ': temp popup rows must edit tempC');
  assert(!/mode === 'sg'[\s\S]{0,200}Temp \(\u00b0C\)/.test(src)
    || src.includes("mode === 'temp'"), rel + ': temp is a dedicated popup mode');
  console.log('ok —', rel);
}
