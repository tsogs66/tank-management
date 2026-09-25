/**
 * Moving a tank with a finger.
 *
 * The reorder list is dragged by pointer events so that one code path serves
 * finger, pen and mouse. Nothing else in the suite can see whether that works
 * on a touchscreen: the arithmetic is covered by test-tank-order.js, but
 * whether Android fires the events at all, whether the page scrolls instead
 * of dragging, and whether what the chief let go of is what gets saved are
 * questions only a browser answers.
 *
 * So this drives the real page in a touch-emulated phone: drag the first tank
 * down past two others, then check the list on screen, the order on the
 * server, and that nothing threw on the way.
 *
 * Needs the server running on :3080 and Playwright's Chromium, the same as
 * the parity check it runs beside. Skips politely without them.
 */
'use strict';

const assert = require('assert');

const BASE = process.env.PARITY_BASE || 'http://localhost:3080';
/* The licence gate covers the standalone product; in the AIO shell the host
   has already done it. This is the shell's own path, and the page under test
   is the same page either way. */
const PAGE_URL = `${BASE}/?chengaio=1`;

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.log('skip — playwright not installed');
  process.exit(0);
}

async function main() {
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
  if (!health || !health.ok) {
    console.log(`skip — no server on ${BASE}`);
    return;
  }
  const vesselId = health.activeVesselId;
  if (!vesselId) {
    console.log('skip — no active vessel (run npm run seed)');
    return;
  }

  let browser;
  try {
    browser = await chromium.launch(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH } : {});
  } catch (e) {
    console.log('skip — no browser: ' + e.message.split('\n')[0]);
    return;
  }

  /* A phone, with a touchscreen and no mouse. */
  const context = await browser.newContext({
    hasTouch: true, isMobile: true, viewport: { width: 390, height: 780 },
  });
  const page = await context.newPage();
  const thrown = [];
  page.on('pageerror', (e) => thrown.push(e.message));

  try {
    await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
    /* The app's own state is script-scoped rather than on window, so what
       says it is ready is the navigation function being there and a page
       having been drawn. */
    await page.waitForFunction(() => typeof navigate === 'function', null, { timeout: 20000 });
    await page.waitForSelector('main', { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('.nav-btn, .bn-item').length > 0,
      null, { timeout: 20000 });
    await page.evaluate(() => navigate('fuel'));
    await page.waitForSelector('#btn-reorder', { timeout: 20000 });
    await page.click('#btn-reorder');
    await page.waitForSelector('.reorder-row', { timeout: 20000 });

    const before = await page.$$eval('.reorder-row', (rows) => rows.map((r) => r.dataset.tankId));
    assert.ok(before.length >= 3, `need three tanks to drag among, found ${before.length}`);

    const grip = await page.locator('.reorder-row').first().locator('.reorder-grip').boundingBox();
    const third = await page.locator('.reorder-row').nth(2).boundingBox();
    assert.ok(grip && third, 'the handle and the third row are on screen');

    /* A finger on the handle, down past two rows, and off again. */
    await page.evaluate(async ({ x, fromY, toY }) => {
      const handle = document.querySelector('.reorder-row .reorder-grip');
      const touch = (type, clientY) => handle.dispatchEvent(new PointerEvent(type, {
        pointerId: 1, pointerType: 'touch', isPrimary: true,
        bubbles: true, cancelable: true, clientX: x, clientY,
      }));
      touch('pointerdown', fromY);
      for (let step = 1; step <= 10; step++) {
        touch('pointermove', fromY + ((toY - fromY) * step) / 10);
        await new Promise((done) => setTimeout(done, 16));
      }
      touch('pointerup', toY);
    }, {
      x: grip.x + grip.width / 2,
      fromY: grip.y + grip.height / 2,
      toY: third.y + third.height,
    });

    await page.waitForFunction(
      (first) => {
        const rows = document.querySelectorAll('.reorder-row');
        return rows.length && rows[0].dataset.tankId !== first;
      },
      before[0],
      { timeout: 10000 }
    );

    const after = await page.$$eval('.reorder-row', (rows) => rows.map((r) => r.dataset.tankId));
    assert.notStrictEqual(after[0], before[0],
      'the tank that was dragged has left the top of the list');
    assert.strictEqual(after.length, before.length, 'dragging did not lose or duplicate a tank');
    assert.deepStrictEqual([...after].sort(), [...before].sort(),
      'the same tanks are there, in a different order');

    /* What the chief let go of is what is saved. */
    const saved = await fetch(`${BASE}/api/vessels/${vesselId}`)
      .then((r) => r.json())
      .then((bundle) => bundle.tanks.fuel.map((t) => t.id));
    const savedShown = saved.filter((id) => after.includes(id));
    assert.deepStrictEqual(savedShown, after,
      'the order on the server is the order left on the screen');

    assert.deepStrictEqual(thrown, [], 'nothing threw while dragging');
    console.log(`ok — a finger moved ${before[0]} down the list, and it stayed moved`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
