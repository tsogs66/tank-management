#!/usr/bin/env node
/**
 * Render the PNG icons from the SVG masters.
 *
 * The SVGs in public/icons and assets/ are the originals; everything else is
 * produced from them, so the mark cannot drift between the browser tab, the
 * installer and the phone's home screen.
 *
 *   node scripts/render-icons.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');

const JOBS = [
  { svg: 'public/icons/icon.svg', out: 'public/icons/icon-512.png', size: 512 },
  { svg: 'public/icons/icon.svg', out: 'public/icons/icon-192.png', size: 192 },
  // Capacitor reads these three to build every Android density, including the
  // adaptive layers a launcher masks into a circle or a squircle.
  { svg: 'public/icons/icon.svg', out: 'assets/icon.png', size: 1024 },
  { svg: 'assets/icon-foreground.svg', out: 'assets/icon-foreground.png', size: 1024, alpha: true },
  { svg: 'assets/icon-background.svg', out: 'assets/icon-background.png', size: 1024 },
  // Electron wants a square PNG for the window and the installer.
  { svg: 'public/icons/icon.svg', out: 'desktop/build/icon.png', size: 512 },
];

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const job of JOBS) {
    const svg = fs.readFileSync(path.join(ROOT, job.svg), 'utf8');
    const page = await browser.newPage({
      viewport: { width: job.size, height: job.size },
      deviceScaleFactor: 1,
    });
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:${job.alpha ? 'transparent' : 'none'}}
      svg{display:block;width:${job.size}px;height:${job.size}px}</style>${svg}`);
    await page.waitForTimeout(120);
    const out = path.join(ROOT, job.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, omitBackground: Boolean(job.alpha) });
    await page.close();
    console.log(`  ${job.svg} -> ${job.out} (${job.size}px)`);
  }
  await browser.close();
  console.log(`${JOBS.length} icons rendered.`);
})();
