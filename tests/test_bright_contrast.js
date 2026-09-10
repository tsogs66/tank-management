#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/app.css'), 'utf8');
const failures = [];
let checks = 0;
function check(label, ok) {
  checks += 1;
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}`);
  if (!ok) failures.push(label);
}
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function relLuminance([r, g, b]) {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrastRatio(a, b) {
  const l1 = relLuminance(hexToRgb(a));
  const l2 = relLuminance(hexToRgb(b));
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
const bright = css.slice(css.indexOf('html.bright {'), css.indexOf('html.bright body'));
const faint = (bright.match(/--text-faint:\s*(#[0-9a-fA-F]{6})/) || [])[1];
const dim = (bright.match(/--text-dim:\s*(#[0-9a-fA-F]{6})/) || [])[1];
console.log('\nTank Chief bright-mode muted contrast');
check('bright --text-faint defined', !!faint);
check('bright --text-dim defined', !!dim);
check('faint vs cream >= 4.5', faint && contrastRatio(faint, '#efebe3') >= 4.5);
check('dim vs cream >= 4.5', dim && contrastRatio(dim, '#efebe3') >= 4.5);
check('no leftover #6b7280 faint', !/--text-faint:\s*#6b7280/.test(bright));
check('hint-inline uses token', /\.hint-inline\s*\{[^}]*color:\s*var\(--text-faint\)/.test(css));
check('bright label override present', /html\.bright \.bp-est-box > span/.test(css));
check('bright input color override present', /html\.bright table\.fr-sheet tbody input/.test(css));
console.log();
if (failures.length) {
  console.log(`FAILED — ${failures.length} of ${checks} checks`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks`);
