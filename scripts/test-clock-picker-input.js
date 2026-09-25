/**
 * Clock picker must not leave a full-screen overlay that blocks Tank inputs,
 * and HH:MM must accept typing.
 *
 * Run: node scripts/test-clock-picker-input.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const candidates = [
  path.join(__dirname, '..', 'public', 'js', 'clock-picker.js'),
  path.join(__dirname, '..', 'modules', 'tanks', 'public', 'js', 'clock-picker.js'),
  path.join(__dirname, 'clock-picker.js'),
  path.join(__dirname, '..', 'clock-picker.js'),
].filter((p) => fs.existsSync(p));

assert.ok(candidates.length, 'clock-picker.js not found');

for (const file of candidates) {
  const src = fs.readFileSync(file, 'utf8');
  assert(/inputmode="numeric"/.test(src) || /inputmode='numeric'/.test(src),
    file + ': HH:MM parts must be typeable inputs');
  assert(/detachActiveListeners|listeners:\s*\{/.test(src),
    file + ': close() must detach window pointer listeners');
  assert(/key === 'Escape'|key !== 'Escape'/.test(src),
    file + ': Escape must dismiss the overlay');
  assert(/querySelectorAll\('\.ccp-overlay'\)/.test(src),
    file + ': close() must remove orphan overlays');
  assert(!/user-select:none/.test(src.match(/\.ccp-readout\{[^}]+\}/)?.[0] || ''),
    file + ': readout must not be user-select:none (blocks typing)');
  console.log('ok —', path.relative(process.cwd(), file));
}
