/*
 * Does the replacement dialog actually appear on screen?
 *
 * Reading the source cannot answer that. A first attempt at this fix put the
 * dialog inside a page container, which is display:none whenever its page is
 * not the open one: the overlay reported itself open -- classList and hidden
 * both agreed -- and laid out at 0x0 with nothing visible. So this test
 * measures getBoundingClientRect() and insists it is non-zero, then drives the
 * keyboard the way a user would.
 *
 * Run: node tests/browser_ask_text_e2e.js
 * Needs playwright + a Chromium; skips (exit 0) if neither is installed.
 */
'use strict';

const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { console.log('playwright not installed — skipping'); process.exit(0); }

const ROOT = path.join(__dirname, '..', 'public');

let fails = 0, checks = 0;
function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) fails += 1;
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', (e) => console.log(`  (page error: ${e.message})`));

  /* The real stylesheet and the real askText, in a document whose only page
     container is hidden -- the arrangement that broke the first attempt. */
  await page.setContent(`<!doctype html><html><head>
      <style>${fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8')}</style>
    </head><body><div id="page" style="display:none"></div></body></html>`);
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  const start = app.indexOf('function askTextOverlay()');
  const end = app.indexOf('\n}\n', app.indexOf('function askText(opts)')) + 3;
  await page.addScriptTag({ content: app.slice(start, end) });

  console.log('\nthe dialog paints');
  await page.evaluate(() => { window.answer = askText({ title: 'Year', label: 'Year', value: '2025' }); });
  await page.waitForTimeout(50);
  check('the overlay is a direct child of <body>',
    await page.evaluate(() => document.getElementById('askTextOverlay').parentElement.tagName), 'BODY');
  const rect = await page.evaluate(() => {
    const r = document.getElementById('askTextOverlay').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  check('it measures non-zero on screen', rect.w > 0 && rect.h > 0, true);
  const box = await page.evaluate(() => {
    const r = document.querySelector('.ask-text-dialog').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  check(`the dialog box itself is non-zero (${box.w}x${box.h})`, box.w > 100 && box.h > 50, true);
  check('the input holds the supplied value',
    await page.inputValue('#askTextInput'), '2025');
  check('and has focus',
    await page.evaluate(() => document.activeElement && document.activeElement.id), 'askTextInput');

  console.log('\nEnter accepts the typed text');
  await page.fill('#askTextInput', '2024');
  await page.keyboard.press('Enter');
  check('askText resolved with what was typed', await page.evaluate(() => window.answer), '2024');
  check('and the overlay is gone',
    await page.evaluate(() => document.getElementById('askTextOverlay').hidden), true);

  console.log('\nEscape cancels, the way prompt() returned null');
  await page.evaluate(() => { window.answer = askText({ title: 'Name' }); });
  await page.waitForTimeout(20);
  await page.keyboard.press('Escape');
  check('askText resolved null', await page.evaluate(() => window.answer), null);

  console.log('\na click on the backdrop cancels too');
  await page.evaluate(() => { window.answer = askText({ title: 'Name' }); });
  await page.waitForTimeout(20);
  await page.mouse.click(8, 8);
  check('askText resolved null', await page.evaluate(() => window.answer), null);

  console.log('\nOK returns the text');
  await page.evaluate(() => { window.answer = askText({ title: 'Name', value: 'MV Example' }); });
  await page.waitForTimeout(20);
  await page.click('#askTextAccept');
  check('askText resolved with the value', await page.evaluate(() => window.answer), 'MV Example');

  await browser.close();
  console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
