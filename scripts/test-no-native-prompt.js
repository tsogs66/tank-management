/*
 * window.prompt() is not available everywhere Tank Chief runs.
 *
 * Electron does not implement it: the call THROWS "prompt() is not supported."
 * rather than returning null. Both call sites sit in async click handlers, so
 * the throw became a rejected promise nobody was listening for -- "Create
 * blank vessel" and "Clone active as new" did nothing at all on the Windows
 * desktop build, with nothing on screen to say why. The Android WebView has no
 * prompt of its own either. Voyage Chief had the same fault on its DCS button.
 *
 * Confirmed by running the real page in Electron 33: the old call throws, the
 * replacement dialog paints and resolves with the typed name.
 *
 * Run: node scripts/test-no-native-prompt.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');

let fails = 0, checks = 0;
function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) fails += 1;
}

/* Strip comments so the explanation above a fix is not mistaken for the fix. */
const code = APP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('\nno call reaches the native prompt');
const bare = code.match(/(^|[^.\w])prompt\s*\(/g) || [];
check('no bare prompt( remains in app.js', bare.length, 0);
check('askText is defined', /function\s+askText\s*\(/.test(code), true);

console.log('\nthe dialog is built at body level');
/* An overlay parked inside a page container renders at 0x0 whenever that page
   is hidden, while still reporting itself open -- a classList check passes it.
   Built and appended the way showToast is, it cannot land anywhere else. */
const fn = code.slice(code.indexOf('function askText'), code.indexOf('function askText') + 3000);
check('the overlay is appended to document.body',
  /document\.body\.appendChild\(el\)/.test(fn), true);
check('it is marked up as a modal dialog',
  /setAttribute\('role',\s*'dialog'\)/.test(fn) && /aria-modal/.test(fn), true);
check('Escape cancels', /ev\.key === 'Escape'/.test(fn), true);
check('Enter accepts', /ev\.key === 'Enter'/.test(fn), true);
check('cancel resolves null, so "" can be told apart',
  /function onCancel\(\)\s*\{\s*close\(null\);/.test(fn), true);

console.log('\nthe dialog is styled from the theme, so it follows html.bright');
check('.ask-text is styled', /\.ask-text\s*\{/.test(CSS), true);
check('.ask-text.open shows it', /\.ask-text\.open\s*\{\s*display:\s*flex/.test(CSS), true);
check('the panel takes its colours from the theme variables',
  /\.ask-text-panel\s*\{[^}]*var\(--bg-panel\)[^}]*\}/s.test(CSS), true);
/* A hardcoded dark panel would be unreadable in the bright theme, which is
   what the variables exist to prevent. */
const panel = CSS.slice(CSS.indexOf('.ask-text-panel {'), CSS.indexOf('.ask-text-panel {') + 400);
check('and no hardcoded hex colour in the panel', /#[0-9a-fA-F]{3,6}\b/.test(panel), false);

console.log('\nboth asking call sites await it');
const sites = code.split('\n').filter((l) => /[^.\w]askText\s*\(/.test(l)
  && !/function\s+askText/.test(l));
check('askText is called from the two places that used to prompt', sites.length, 2);
for (const l of sites) {
  check(`awaited: ${l.trim().slice(0, 40)}`, /await\s+askText\(/.test(l), true);
}

console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);
