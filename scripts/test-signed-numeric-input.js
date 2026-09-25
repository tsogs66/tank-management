/**
 * Signed numeric inputs: minus on Android decimal pad via accessory + coercion.
 *
 * Run: node scripts/test-signed-numeric-input.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const file = path.join(__dirname, '..', 'public', 'js', 'signed-numeric-input.js');
assert.ok(fs.existsSync(file), 'signed-numeric-input.js missing');
const src = fs.readFileSync(file, 'utf8');

assert(src.includes('data-head="heel"'), 'must target heel header fields');
assert(src.includes('[data-survey-corr]'), 'must target voyage bunker survey correction');
assert(src.includes('tms-signed-accessory'), 'must render minus accessory bar');
assert(src.includes('coerceSignedNumericInput'), 'must coerce signed typing');
assert(src.includes("inputmode', touchLike() ? 'decimal' : 'text'"), 'touch keeps decimal pad');
assert(src.includes('lastSignedInput'), 'must keep target field when Insert is tapped');
assert(src.includes('applyAccessoryChar'), 'must insert via accessory buttons');

const fuelReport = path.join(__dirname, '..', 'public', 'js', 'fuel-report.js');
const fr = fs.readFileSync(fuelReport, 'utf8');
assert(fr.includes('data-head="heel"'), 'fuel report must expose heel inputs');

const indexHtml = path.join(__dirname, '..', 'public', 'index.html');
assert(fs.readFileSync(indexHtml, 'utf8').includes('signed-numeric-input.js'),
  'index.html must load signed-numeric-input.js');

const sandbox = {
  document: {
    readyState: 'complete',
    documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
    head: { appendChild() {} },
    body: { appendChild() {} },
    addEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => ({
      setAttribute() {},
      addEventListener() {},
      classList: { add() {}, remove() {} },
      style: {},
    }),
  },
  window: {},
  navigator: { maxTouchPoints: 2 },
  MutationObserver: undefined,
  Event: class Event { constructor(type, o) { this.type = type; this.bubbles = o?.bubbles; } },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const coerce = sandbox.TmsSignedNumeric.coerceSignedNumericInput;
function mockInput(v) {
  return {
    dataset: { signed: '1' },
    value: v,
    selectionStart: v.length,
    setSelectionRange() {},
  };
}
const a = mockInput('−1.5');
coerce(a);
assert.strictEqual(a.value, '-1.5', 'unicode minus normalises');

console.log('ok — signed-numeric-input');
