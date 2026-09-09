/**
 * Tank Sounding Card — blank A4 landscape handout (two equal mirrored halves).
 * Fuel-oil tank rows come from the vessel tanks database.
 */
const TankSoundingCard = (() => {
  const esc = (s) => (typeof Branding !== 'undefined' && Branding.escPrint
    ? Branding.escPrint(s)
    : String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;'));

  function vesselMeta(bundle) {
    const v = (bundle && bundle.vessel) || {};
    const name = v.name || (bundle && bundle.voyage && bundle.voyage.vessel) || 'Vessel';
    const company = v.company || v.owner || 'Company';
    return { name, company };
  }

  function fuelTanks(bundle) {
    const list = ((bundle && bundle.tanks && bundle.tanks.fuel) || []).filter(Boolean);
    return list.slice().sort((a, b) => {
      const an = a.tankNo != null && a.tankNo !== '' ? Number(a.tankNo) : NaN;
      const bn = b.tankNo != null && b.tankNo !== '' ? Number(b.tankNo) : NaN;
      if (!Number.isNaN(an) && !Number.isNaN(bn) && an !== bn) return an - bn;
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  function buildHalfHtml(bundle, opts = {}) {
    const { name, company } = vesselMeta(bundle);
    const tanks = opts.tanks || fuelTanks(bundle);
    const sample = !!opts.sample;
    const tankRows = tanks.length
      ? tanks.map((t, i) => {
        const val = sample ? String(120 + i * 17) : '';
        const temp = sample ? String(38 + (i % 5)) : '';
        let method = String(t.soundingMethod || t.method || '').toLowerCase();
        if (sample && !method) method = (i % 3 === 0) ? 'depth' : 'ullage';
        const ullageChk = sample && (method === 'ullage' || method === 'ull') ? ' pr-tsc-checked' : '';
        const depthChk = sample && (method === 'depth' || method === 'dip' || method === 'sounding') ? ' pr-tsc-checked' : '';
        return `<tr><td class="pr-tsc-tank">${esc(t.name || 'Tank')}</td>`
          + `<td class="pr-tsc-method-cell">`
          + `<label class="pr-tsc-chk${ullageChk}"><span class="pr-tsc-box"></span> Ullage</label>`
          + `<label class="pr-tsc-chk${depthChk}"><span class="pr-tsc-box"></span> Depth</label>`
          + `</td>`
          + `<td class="pr-tsc-cm">${esc(val)}</td>`
          + `<td class="pr-tsc-temp">${esc(temp)}</td></tr>`;
      }).join('')
      : `<tr><td class="pr-tsc-tank pr-tsc-empty" colspan="4">No fuel oil tanks in vessel database</td></tr>`;

    const dateVal = sample ? esc(opts.sampleDate || '') : '';
    const timeVal = sample ? esc(opts.sampleTime || '') : '';
    const fwdVal = sample ? esc(opts.sampleFwd || '') : '';
    const aftVal = sample ? esc(opts.sampleAft || '') : '';
    const trimVal = sample ? esc(opts.sampleTrim || '') : '';
    const seaVal = sample ? esc(opts.sampleSea || '') : '';
    const erVal = sample ? esc(opts.sampleEr || '') : '';
    const byVal = sample ? esc(opts.sampleBy || '') : '';

    return `<div class="pr-tsc-inner" style="--tsc-rows:${Math.max(1, tanks.length || 1)}">
      <div class="pr-tsc-title">TANK SOUNDING CARD</div>
      <div class="pr-tsc-sub">Tank Chief - ${esc(name)}</div>

      <div class="pr-tsc-body">
        <div class="pr-tsc-meta">
          <div class="pr-tsc-grid2">
            <div class="pr-tsc-field"><span class="pr-tsc-lbl">Date</span><span class="pr-tsc-line">${dateVal}</span></div>
            <div class="pr-tsc-field"><span class="pr-tsc-lbl">Time</span><span class="pr-tsc-line">${timeVal}</span></div>
          </div>
          <div class="pr-tsc-grid3">
            <div class="pr-tsc-field"><span class="pr-tsc-lbl">Forward Draft</span><span class="pr-tsc-line">${fwdVal}</span></div>
            <div class="pr-tsc-field"><span class="pr-tsc-lbl">Aft Draft</span><span class="pr-tsc-line">${aftVal}</span></div>
            <div class="pr-tsc-field"><span class="pr-tsc-lbl">Trim</span><span class="pr-tsc-line">${trimVal}</span></div>
          </div>
          <div class="pr-tsc-grid2">
            <div class="pr-tsc-field"><span class="pr-tsc-lbl">Sea Temp (°C)</span><span class="pr-tsc-line">${seaVal}</span></div>
            <div class="pr-tsc-field"><span class="pr-tsc-lbl">E/R Temp (°C)</span><span class="pr-tsc-line">${erVal}</span></div>
          </div>
        </div>

        <div class="pr-tsc-table-wrap">
          <table class="pr-tsc-table">
            <thead><tr><th>Tank</th><th>Method</th><th>Sounding (cm)</th><th>Temp (°C)</th></tr></thead>
            <tbody>${tankRows}</tbody>
          </table>
        </div>
      </div>

      <div class="pr-tsc-by">
        <span class="pr-tsc-lbl">Sounded by</span>
        <span class="pr-tsc-line">${byVal}</span>
      </div>
      <div class="pr-tsc-foot">${esc(name)} — ${esc(company)} — ts0gs</div>
    </div>`;
  }

  function buildPageHtml(bundle, opts = {}) {
    const form = buildHalfHtml(bundle, opts);
    const copy = `<div class="pr-tsc-copy"><div class="pr-tsc-page-inner">${form}</div></div>`;
    return `<div class="pr-tsc-page">${copy}${copy}</div>`;
  }

  function fitScript() {
    /* Escape closing script tag so this stays valid when embedded in HTML. */
    return `function fitTankSoundingRoot(doc){
  try{
    const page = doc.querySelector('.pr-tsc-page');
    if (!page) return 1;
    const copies = Array.from(doc.querySelectorAll('.pr-tsc-copy'));
    const inners = Array.from(doc.querySelectorAll('.pr-tsc-page-inner'));
    if (copies.length !== 2 || inners.length !== 2) return 1;
    const isAndroid = /Android/i.test(navigator.userAgent || '');
    /* Lock the landscape page box even under @media screen preview. */
    try {
      doc.documentElement.style.width = '297mm';
      doc.documentElement.style.height = '210mm';
      doc.documentElement.style.overflow = 'hidden';
      doc.body.style.width = '297mm';
      doc.body.style.height = '210mm';
      doc.body.style.margin = '0';
      doc.body.style.padding = '0';
      doc.body.style.overflow = 'hidden';
      page.style.width = '297mm';
      page.style.height = '210mm';
      page.style.maxHeight = '210mm';
      page.style.overflow = 'hidden';
      copies.forEach((c) => {
        c.style.height = '210mm';
        c.style.maxHeight = '210mm';
        c.style.overflow = 'hidden';
      });
      inners.forEach((el) => {
        el.style.zoom = '1';
        el.style.transform = 'none';
        el.style.height = '201.3mm';
        el.style.maxHeight = '201.3mm';
        el.style.overflow = 'hidden';
      });
    } catch (_e) {}
    void page.offsetHeight;
    const measureOverflow = () => {
      let worst = 1;
      inners.forEach((frame) => {
        const card = frame.querySelector('.pr-tsc-inner');
        if (!card) return;
        const frameH = Math.max(1, frame.clientHeight || frame.getBoundingClientRect().height);
        const frameW = Math.max(1, frame.clientWidth || frame.getBoundingClientRect().width);
        const prevH = card.style.height;
        const prevMax = card.style.maxHeight;
        const by = card.querySelector('.pr-tsc-by');
        const prevBy = by ? by.style.marginTop : '';
        card.style.height = 'auto';
        card.style.maxHeight = 'none';
        if (by) by.style.marginTop = '2.2mm';
        void card.offsetHeight;
        const sw = Math.max(card.scrollWidth, card.offsetWidth, 1);
        const sh = Math.max(card.scrollHeight, card.offsetHeight, 1);
        card.style.height = prevH;
        card.style.maxHeight = prevMax;
        if (by) by.style.marginTop = prevBy;
        worst = Math.min(worst, frameW / sw, frameH / sh);
      });
      return worst;
    };
    /* Height-only ratio so row packing is not capped by exact full-width fit (=1.0). */
    const measureHeightRatio = () => {
      let worst = Infinity;
      inners.forEach((frame) => {
        const card = frame.querySelector('.pr-tsc-inner');
        if (!card) return;
        const frameH = Math.max(1, frame.clientHeight || frame.getBoundingClientRect().height);
        const prevH = card.style.height;
        const prevMax = card.style.maxHeight;
        const by = card.querySelector('.pr-tsc-by');
        const prevBy = by ? by.style.marginTop : '';
        card.style.height = 'auto';
        card.style.maxHeight = 'none';
        if (by) by.style.marginTop = '2.2mm';
        void card.offsetHeight;
        const sh = Math.max(card.scrollHeight, card.offsetHeight, 1);
        card.style.height = prevH;
        card.style.maxHeight = prevMax;
        if (by) by.style.marginTop = prevBy;
        worst = Math.min(worst, frameH / sh);
      });
      return worst;
    };
    const applyScale = (scale) => {
      inners.forEach((el) => {
        el.style.transformOrigin = 'top left';
        if (isAndroid) {
          el.style.zoom = '';
          el.style.transform = scale < 0.995 ? ('scale(' + scale + ')') : 'none';
        } else {
          el.style.transform = 'none';
          el.style.zoom = String(scale);
        }
      });
    };
    const packRows = () => {
      const cards = Array.from(doc.querySelectorAll('.pr-tsc-inner'));
      /* Grow row height to fill leftover card space (table expands with fewer tanks). */
      let lo = 3.4, hi = 8.5, best = 4.6;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        cards.forEach((c) => { c.style.setProperty('--tsc-row', mid.toFixed(2) + 'mm'); });
        void page.offsetHeight;
        /* Keep a little slack so footer/sounded-by never clips. */
        if (measureHeightRatio() >= 1.03) { best = mid; lo = mid; }
        else { hi = mid; }
      }
      cards.forEach((c) => { c.style.setProperty('--tsc-row', best.toFixed(2) + 'mm'); });
      if (measureHeightRatio() < 1.0) {
        cards.forEach((c) => c.classList.add('pr-tsc-dense'));
        lo = 2.2; hi = 4.2; best = 3.0;
        for (let i = 0; i < 10; i++) {
          const mid = (lo + hi) / 2;
          cards.forEach((c) => { c.style.setProperty('--tsc-row', mid.toFixed(2) + 'mm'); });
          void page.offsetHeight;
          if (measureHeightRatio() >= 1.03) { best = mid; lo = mid; }
          else { hi = mid; }
        }
        cards.forEach((c) => { c.style.setProperty('--tsc-row', best.toFixed(2) + 'mm'); });
      }
    };
    packRows();
    let scale = Math.min(1, Math.max(0.62, measureOverflow()));
    if (scale >= 0.995) scale = isAndroid ? 0.98 : 1;
    else scale = Math.max(0.68, scale * (isAndroid ? 0.94 : 0.985));
    applyScale(scale);
    for (let n = 0; n < 8; n++) {
      void page.offsetHeight;
      let clipped = false;
      inners.forEach((frame) => {
        const foot = frame.querySelector('.pr-tsc-foot');
        if (!foot) return;
        const fb = frame.getBoundingClientRect();
        const ft = foot.getBoundingClientRect();
        /* Only true overflow past the frame — flush footer is OK. */
        if (ft.bottom > fb.bottom + 0.75) clipped = true;
      });
      if (!clipped && measureOverflow() >= 0.98) break;
      scale = Math.max(0.62, scale * 0.96);
      applyScale(scale);
    }
    try {
      doc.documentElement.style.height = '210mm';
      doc.body.style.height = '210mm';
      doc.documentElement.style.overflow = 'hidden';
      doc.body.style.overflow = 'hidden';
    } catch (_e) {}
    return scale;
  } catch (err) {
    console.warn('Tank Sounding Card fit failed', err);
    return 1;
  }
}
try { fitTankSoundingRoot(document); } catch (_e) {}
window.addEventListener('load', function(){ try { fitTankSoundingRoot(document); } catch (_e) {} });
`;
  }

  function buildPrintDocument(pageHtml, opts = {}) {
    const title = opts.title || 'Tank Sounding Card';
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(title)}</title>
<style>
@page{ size: A4 landscape; margin: 0; }
html, body{
  margin:0 !important; padding:0 !important; background:#fff !important;
  width:297mm !important; height:210mm !important;
  max-width:297mm !important; max-height:210mm !important;
  overflow:hidden !important;
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
.pr-tsc-page{
  box-sizing:border-box !important;
  display:flex !important;
  flex-direction:row !important;
  flex-wrap:nowrap !important;
  width:297mm !important; height:210mm !important;
  max-width:297mm !important; max-height:210mm !important;
  margin:0 !important; padding:0 !important;
  background:#fff !important;
  overflow:hidden !important;
  page-break-after:avoid !important; page-break-inside:avoid !important;
  break-after:avoid !important; break-inside:avoid !important;
}
.pr-tsc-copy{
  display:block !important;
  vertical-align:top !important;
  box-sizing:border-box !important;
  flex:1 1 50% !important;
  width:148.5mm !important;
  max-width:148.5mm !important;
  min-width:0 !important;
  height:210mm !important;
  max-height:210mm !important;
  /* Equal L/R/T/B so both cut halves match. */
  padding:4.5mm 4.2mm 4.2mm !important;
  overflow:hidden !important;
  background:#fff !important;
  position:relative !important;
}
.pr-tsc-page .pr-tsc-copy:first-child{
  border-right:0.45pt dashed #666 !important;
}
.pr-tsc-page .pr-tsc-copy:last-child{
  border-right:none !important;
}
.pr-tsc-page-inner{
  /* Content box inside equal pad: 210 − 4.5 − 4.2 = 201.3mm */
  box-sizing:border-box;
  width:100%;
  max-width:100%;
  height:201.3mm;
  max-height:201.3mm;
  min-height:0;
  overflow:hidden;
  transform-origin:top left;
}
.pr-tsc-inner{
  width:100%;
  height:100%;
  max-height:100%;
  min-height:0;
  display:flex;
  flex-direction:column;
  font-family: Calibri, 'Segoe UI', Candara, sans-serif;
  color:#111;
  font-size:7.2pt;
  line-height:1.15;
  --tsc-row: 5.2mm;
}
.pr-tsc-title{
  text-align:center; font-size:11pt; font-weight:700; letter-spacing:0.04em;
  margin:0 0 0.4mm; flex:0 0 auto;
}
.pr-tsc-sub{
  text-align:center; font-size:7.2pt; color:#444; letter-spacing:0.02em;
  margin:0 0 1.6mm; flex:0 0 auto;
}
.pr-tsc-body{
  flex:0 0 auto; min-height:0;
  display:flex; flex-direction:column;
}
.pr-tsc-meta{
  flex:0 0 auto;
  margin:0 0 3.2mm;
  padding-bottom:1.6mm;
  border-bottom:0.45pt solid #bbb;
}
.pr-tsc-grid2, .pr-tsc-grid3{
  display:grid; gap:1.2mm 2mm; margin:0 0 1.5mm;
}
.pr-tsc-grid2:last-child, .pr-tsc-grid3:last-child{ margin-bottom:0; }
.pr-tsc-grid2{ grid-template-columns:1fr 1fr; }
.pr-tsc-grid3{ grid-template-columns:1fr 1fr 1fr; }
.pr-tsc-field, .pr-tsc-by{
  display:flex; align-items:flex-end; gap:1mm; min-width:0;
}
.pr-tsc-lbl{
  flex:0 0 auto; font-weight:600; white-space:nowrap; font-size:6.8pt;
}
.pr-tsc-line{
  flex:1 1 auto;
  border-bottom:0.6pt solid #222;
  min-height:3.6mm;
  min-width:8mm;
  padding:0 0.4mm 0.15mm;
  font-size:7.2pt;
}
.pr-tsc-method-cell{
  text-align:center; white-space:nowrap; font-size:5.5pt; padding:0.3mm 0.35mm !important;
  vertical-align:middle;
}
.pr-tsc-method-cell .pr-tsc-chk{
  display:inline-flex; align-items:center; justify-content:center; gap:0.55mm;
  margin:0 0.7mm; font-weight:500;
}
.pr-tsc-box{
  display:inline-block; width:2.8mm; height:2.8mm;
  border:0.55pt solid #222; box-sizing:border-box;
  background:#fff; flex:0 0 auto;
}
.pr-tsc-checked .pr-tsc-box{
  background:linear-gradient(to bottom right, transparent 42%, #111 42%, #111 58%, transparent 58%),
             linear-gradient(to bottom left, transparent 42%, #111 42%, #111 58%, transparent 58%);
}
.pr-tsc-table-wrap{
  flex:0 0 auto;
  min-height:0;
  display:block;
  margin-top:0.6mm;
}
.pr-tsc-table{
  width:100%;
  border-collapse:collapse; table-layout:fixed;
  font-size:7pt; margin:0; flex:0 0 auto;
}
.pr-tsc-table th, .pr-tsc-table td{
  border:0.5pt solid #222; padding:0.7mm 0.7mm;
  height:var(--tsc-row, 5.2mm);
  min-height:var(--tsc-row, 5.2mm);
  vertical-align:middle;
}
.pr-tsc-table th{
  background:#efefef; font-weight:600; font-size:6.4pt; text-align:center;
  height:auto; min-height:4mm;
}
.pr-tsc-tank{ text-align:left; width:42%; font-weight:500; }
.pr-tsc-method-cell{ width:28%; }
.pr-tsc-cm{ text-align:center; width:16%; }
.pr-tsc-temp{ text-align:center; width:14%; }
.pr-tsc-empty{ text-align:center; color:#666; font-style:italic; }
.pr-tsc-by{
  flex:0 0 auto; margin-top:auto; padding-top:2.2mm; width:100%;
}
.pr-tsc-foot{
  flex:0 0 auto; margin-top:1.4mm;
  text-align:center; font-size:6.2pt; color:#555; letter-spacing:0.02em;
}
.pr-tsc-dense .pr-tsc-title{ font-size:9.5pt; }
.pr-tsc-dense .pr-tsc-sub{ font-size:6.4pt; margin-bottom:0.8mm; }
.pr-tsc-dense .pr-tsc-meta{ margin-bottom:2.2mm; padding-bottom:1mm; }
.pr-tsc-dense .pr-tsc-table{ font-size:6.2pt; }
.pr-tsc-dense .pr-tsc-table th{ font-size:5.8pt; padding:0.35mm 0.6mm; }
.pr-tsc-dense .pr-tsc-table td{ padding:0.35mm 0.6mm; }
@media print{
  html, body, .pr-tsc-page{
    width:297mm !important; height:210mm !important;
    max-height:210mm !important; overflow:hidden !important;
  }
}
@media screen{
  body{ background:#e8e8e8 !important; padding:16px !important;
    width:auto !important; height:auto !important; max-height:none !important; overflow:auto !important; }
  .pr-tsc-page{
    margin:0 auto;
    box-shadow:0 2px 12px rgba(0,0,0,.18);
  }
}
</style></head><body>${pageHtml}<script>${fitScript()}<\/script></body></html>`;
  }

  function printBlank(bundle) {
    try {
      const tanks = fuelTanks(bundle);
      if (!tanks.length) {
        if (typeof showToast === 'function') showToast('No fuel oil tanks on this vessel');
        else alert('No fuel oil tanks on this vessel');
        return;
      }
      const page = buildPageHtml(bundle);
      const jobTitle = 'Tank Sounding Card';
      const html = buildPrintDocument(page, { title: jobTitle });
      if (typeof Branding !== 'undefined' && Branding.printHtmlDocument) {
        Branding.printHtmlDocument(html, jobTitle);
      } else {
        const win = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=800');
        if (!win) { alert('Allow pop-ups to print.'); return; }
        win.document.open();
        win.document.write(html);
        win.document.close();
        setTimeout(() => { try { win.print(); } catch (_) {} }, 200);
      }
    } catch (err) {
      console.error('Tank Sounding Card print failed', err);
      alert('Print failed: ' + (err && err.message ? err.message : err));
    }
  }

  function previewSample(bundle) {
    const tanks = fuelTanks(bundle);
    const page = buildPageHtml(bundle, {
      sample: true,
      sampleDate: '09 Sep 2026',
      sampleTime: '10:30',
      sampleFwd: '8.45',
      sampleAft: '9.10',
      sampleTrim: '0.65 A',
      sampleSea: '28.5',
      sampleEr: '36.0',
      sampleBy: 'C/E',
      tanks: tanks.length ? tanks : [{ name: 'NO.1 H.F.O. TANK (P)' }, { name: 'NO.1 H.F.O. TANK (S)' }],
    });
    const html = buildPrintDocument(page, { title: 'Tank Sounding Card — Sample' });
    const win = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=800');
    if (!win) {
      alert('Allow pop-ups to show the sample.');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  function renderPage(main, bundle) {
    const tanks = fuelTanks(bundle);
    const names = tanks.map((t) => esc(t.name || 'Tank')).join(', ') || '—';
    main.innerHTML = `<div class="page-head"><div>
      <h1>Tank Sounding Card</h1>
      <div class="desc">Blank A4 landscape handout — two identical halves, cut on the centre dashed line</div>
    </div>
    <div class="btn-row no-print">
      <button class="btn primary" type="button" id="btn-tsc-print">Print Blank Form (A4 Landscape ÷2)</button>
      <button class="btn" type="button" id="btn-tsc-sample">Preview Sample</button>
    </div></div>
    <div class="form-panel">
      <div class="section-title" style="margin-top:0">Fuel oil tanks (${tanks.length})</div>
      <p class="hint" style="margin-top:0">Rows follow the vessel fuel tanks database. Each half includes Date, Time, Forward / Aft Draft, Trim, Sea Temp, E/R Temp, and per tank: Ullage / Depth method checkboxes, blank sounding (cm), and Temp (°C), plus Sounded by. Subtitle and footer match the Voyage Log Entry Data Card style.</p>
      <p class="hint" id="tsc-tank-list"><strong>Tanks:</strong> ${names}</p>
    </div>`;
    const printBtn = document.getElementById('btn-tsc-print');
    const sampleBtn = document.getElementById('btn-tsc-sample');
    if (printBtn) printBtn.onclick = () => printBlank(bundle);
    if (sampleBtn) sampleBtn.onclick = () => previewSample(bundle);
  }

  return {
    fuelTanks,
    buildHalfHtml,
    buildPageHtml,
    buildPrintDocument,
    printBlank,
    previewSample,
    renderPage,
  };
})();

window.TankSoundingCard = TankSoundingCard;
