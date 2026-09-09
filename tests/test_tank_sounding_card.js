#!/usr/bin/env node
/*
 * Tank Sounding Card handout checks.
 * Run: node tests/test_tank_sounding_card.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/js/tank-sounding-card.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const BRAND = fs.readFileSync(path.join(ROOT, 'public/js/branding.js'), 'utf8');

let checks = 0, failures = 0;
function check(label, cond, detail) {
  checks++;
  const ok = !!cond;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail != null ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

console.log('\nTank Sounding Card');

check('module file present', SRC.includes('Tank Sounding Card'));
check('script included in index', INDEX.includes('tank-sounding-card.js'));
check('nav wired', APP.includes("mk('sounding-card', 'Sounding Card'") && APP.includes("page === 'sounding-card'"));
check('branding printHtmlDocument', BRAND.includes('printHtmlDocument'));

const sandbox = {
  window: {},
  Branding: {
    escPrint(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },
  },
  console,
};
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox);
const TSC = sandbox.window.TankSoundingCard;
check('exports TankSoundingCard', !!TSC);

const bundle = {
  vessel: { name: 'MV TEST', company: 'Ocean Co' },
  tanks: {
    fuel: [
      { id: 'f2', name: 'NO.2 HFO (S)', tankNo: 2 },
      { id: 'f1', name: 'NO.1 HFO (P)', tankNo: 1 },
      { id: 'f3', name: 'SETTLING', tankNo: 3 },
    ],
  },
};

const tanks = TSC.fuelTanks(bundle);
check('reads fuel tanks only', tanks.length === 3);
check('sorts by tankNo', tanks[0].name === 'NO.1 HFO (P)' && tanks[2].name === 'SETTLING');

const half = TSC.buildHalfHtml(bundle);
check('title TANK SOUNDING CARD', half.includes('TANK SOUNDING CARD'));
check('subtitle Tank Chief - vessel', half.includes('Tank Chief - MV TEST'));
check('footer vessel — company — ts0gs', half.includes('MV TEST — Ocean Co — ts0gs'));
check('date and time fields', half.includes('>Date<') && half.includes('>Time<'));
check('draft and trim fields', half.includes('Forward Draft') && half.includes('Aft Draft') && half.includes('>Trim<'));
check('ullage and depth checkboxes', half.includes('Ullage') && half.includes('Depth') && half.includes('pr-tsc-box'));
check('sounding cm column', half.includes('Sounding (cm)'));
check('lists all tank names', half.includes('NO.1 HFO (P)') && half.includes('NO.2 HFO (S)') && half.includes('SETTLING'));
check('sounded by line', /Sounded by/.test(half));

const page = TSC.buildPageHtml(bundle);
check('two mirrored copies', (page.match(/pr-tsc-copy/g) || []).length === 2);
check('equal half width class', page.includes('pr-tsc-page') && page.includes('pr-tsc-copy'));

const doc = TSC.buildPrintDocument(page);
check('A4 landscape page size', doc.includes('size: A4 landscape'));
check('equal cut padding', /padding:4\.5mm 4\.2mm 4\.2mm/.test(doc));
check('centre dashed cut', /border-right:0\.45pt dashed/.test(doc));
check('148.5mm half width', doc.includes('148.5mm'));
check('fit helper embedded', doc.includes('fitTankSoundingRoot'));
check('single page overflow lock', /max-height:210mm[\s\S]{0,80}overflow:hidden/.test(doc));

const emptyHalf = TSC.buildHalfHtml({ vessel: { name: 'X' }, tanks: { fuel: [] } });
check('empty fuel tanks message', /No fuel oil tanks/.test(emptyHalf));

const many = {
  vessel: { name: 'BIG', owner: 'Owner Ltd' },
  tanks: {
    fuel: Array.from({ length: 17 }, (_, i) => ({ id: 't' + i, name: 'TANK ' + (i + 1), tankNo: i + 1 })),
  },
};
const manyHalf = TSC.buildHalfHtml(many);
check('flexible for many tanks', (manyHalf.match(/pr-tsc-tank/g) || []).length === 17);
check('company falls back to owner', manyHalf.includes('BIG — Owner Ltd — ts0gs'));

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks - failures}/${checks} checks`);
process.exit(failures ? 1 : 0);
