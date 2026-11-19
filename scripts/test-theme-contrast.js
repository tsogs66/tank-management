/**
 * Tank Chief themes — the muted text tokens must stay readable (WCAG AA, 4.5:1) on the panel colours of every theme.
 * The faint token was 4.1:1 on Night, Prism and Astrolabe, and its hint and label text was hard to read.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '../public/css/app.css'), 'utf8');
const lum = (h) => { const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const blocks = { night: /(^|\n):root\s*\{([^}]*)\}/, bright: /html\.bright\s*\{([^}]*)\}/, prism: /html\.prism\s*\{([^}]*)\}/, astrolabe: /html\.astrolabe\s*\{([^}]*)\}/ };
let fails = 0; let checks = 0;
for (const [name, re] of Object.entries(blocks)) {
  const m = css.match(re); const body = m ? m[m.length - 1] : '';
  const get = (k) => { const r = body.match(new RegExp('--' + k + ':\\s*(#[0-9a-fA-F]{6})')); return r && r[1]; };
  const panel = get('bg-panel'); const dim = get('text-dim'); const faint = get('text-faint');
  for (const [label, fg] of [['text-dim', dim], ['text-faint', faint]]) {
    checks++;
    if (!panel || !fg) { fails++; console.log('  FAIL ' + name + ' ' + label + ': token not found'); continue; }
    const r = ratio(fg, panel);
    if (r < 4.5) { fails++; console.log(`  FAIL ${name} ${label} ${fg} on ${panel} = ${r.toFixed(2)}:1`); } else console.log(`  ok   ${name} ${label} ${r.toFixed(2)}:1`);
  }
}
console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);
