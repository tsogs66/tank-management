/**
 * Pinch-to-zoom stays available, and the signature stamp stays inside the sheet.
 *
 * `maximum-scale=1` (or `user-scalable=no`) in the viewport tag turns off pinch zoom on
 * Android, which leaves anyone with poor eyesight unable to enlarge a page. Each page also
 * re-writes its own viewport tag every 1.5 s to keep "Desktop site" off, so the string in
 * that script has to be free of it as well as the tag.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass += 1; };

for (const file of ['public/index.html']) {
  const text = read(file);
  const tags = text.match(/content\s*=\s*"[^"]*width=device-width[^"]*"|const WANT = '[^']*'/g) || [];
  ok(tags.length >= 2, `${file}: expected the viewport tag and the viewport lock script`);
  for (const t of tags) {
    ok(!/maximum-scale/i.test(t), `${file}: ${t} blocks pinch zoom`);
    ok(!/user-scalable\s*=\s*(no|0)/i.test(t), `${file}: ${t} blocks pinch zoom`);
  }
}

/* The stamp hangs below the signature line; a stamped row is tall enough that a full sheet
   does not lose it to the page edge, and the print bridge's own copy of the CSS agrees. */
const css = read('public/css/app.css');
const brand = read('public/js/branding.js');
const fr = read('public/js/fuel-report.js');
ok(/\.fr-print-signrow\.has-stamp \{ min-height: 30mm; \}/.test(css), 'app.css: stamped sign-off row reserves room for the stamp');
ok(/\.fr-print-signrow\.has-stamp \{ min-height: 30mm !important; \}/.test(brand), 'branding.js: the printed copy of the CSS reserves it too');
ok(fr.includes("fr-print-signrow${logo ? ' has-stamp' : ''}"), 'fuel-report.js marks a row that carries a stamp');

console.log(`pinch zoom: ${pass} checks passed`);
