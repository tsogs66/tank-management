/**
 * Uploaded files open in the in-app viewer with zoom, and the sounding card never pre-marks
 * Ullage or Depth.
 *
 * The user picks the method for each actual reading; a ticked box on the card (even on the
 * sample) reads as a recommendation.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass += 1; };

const index = read('public/index.html');
ok(/<script src="js\/file-viewer\.js[^"]*"><\/script>/.test(index), 'the page loads the viewer');
ok(read('public/sw.js').includes("'/js/file-viewer.js'"), 'the service worker caches the viewer');
const viewer = read('public/js/file-viewer.js');
ok(/pinch/.test(viewer) && /wheel/.test(viewer) && /lastTap/.test(viewer), 'pinch, wheel and double-tap zoom');
ok(/min-height:44px/.test(viewer), 'finger-sized controls');
const bunk = read('public/js/bunkering-report.js');
ok(/data-viewer data-viewer-title="BDN photo"/.test(bunk), 'the BDN photo opens full screen');
ok(/ChengFileViewer\.open\(\{ src: photo\.dataUrl/.test(bunk), 'a BDN PDF opens in the viewer');
const app = read('public/js/app.js');
ok(/alt="Chief Engineer signature" data-viewer/.test(app), 'the signature preview opens full screen');
ok(/alt="Vessel logo" data-viewer/.test(app), 'the logo preview opens full screen');
const tsc = read('public/js/tank-sounding-card.js');
ok(!/const (ullage|depth)Chk = [^'\n]*pr-tsc-checked/.test(tsc), 'Ullage / Depth are never ticked');
ok(/const ullageChk = '';/.test(tsc) && /const depthChk = '';/.test(tsc), 'both boxes are always empty, blank card and sample');

console.log(`file viewer / sounding card: ${pass} checks passed`);
