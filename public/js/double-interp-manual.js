/**
 * Manual double interpolation popup (trim volume + heeling correction tables).
 * Uses calc.manualDoubleInterpolation / calc.bilinearGridInterp when available.
 */
(function (root) {
  'use strict';

  function num(v, fb) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function parseGrid(tableEl) {
    const rows = [];
    tableEl.querySelectorAll('tr[data-dim-row]').forEach((tr) => {
      const cells = [];
      tr.querySelectorAll('input[data-dim-cell]').forEach((inp) => {
        cells.push(inp.value === '' ? null : num(inp.value, null));
      });
      rows.push(cells);
    });
    return rows;
  }

  function readAxis(prefix) {
    return [
      num(document.getElementById(`${prefix}-0`)?.value, null),
      num(document.getElementById(`${prefix}-1`)?.value, null),
      num(document.getElementById(`${prefix}-2`)?.value, null),
    ];
  }

  function computeResult() {
    const fn = root.manualDoubleInterpolation;
    if (typeof fn !== 'function') return null;
    const soundingAxis = readAxis('dim-sounding');
    const trimAxis = readAxis('dim-trim');
    const heelAxis = readAxis('dim-heel');
    const trimGrid = parseGrid(document.getElementById('dim-trim-grid'));
    const heelGrid = parseGrid(document.getElementById('dim-heel-grid'));
    return fn({
      sounding: num(document.getElementById('dim-target-sounding')?.value, null),
      trim: num(document.getElementById('dim-target-trim')?.value, null),
      heel: num(document.getElementById('dim-target-heel')?.value, null),
      soundingAxis,
      trimAxis,
      heelGrid,
      trimGrid,
      heelAxis,
    });
  }

  function gridTable(id, xLabel, yLabel, xPrefix, yPrefix) {
    const x = (i) => `<input type="number" step="any" id="${xPrefix}-${i}" class="dim-axis" style="width:72px">`;
    const y = (i) => `<input type="number" step="any" id="${yPrefix}-${i}" class="dim-axis" style="width:72px">`;
    const body = [0, 1, 2].map((ri) => `<tr data-dim-row="${ri}">
      <th>${y(ri)}</th>
      <td><input type="number" step="any" data-dim-cell></td>
      <td><input type="number" step="any" data-dim-cell></td>
      <td><input type="number" step="any" data-dim-cell></td>
    </tr>`).join('');
    return `<table class="dim-grid" id="${id}">
      <thead><tr><th></th><th colspan="3">${esc(xLabel)}</th></tr>
      <tr><th>${esc(yLabel)}</th><th>${x(0)}</th><th>${x(1)}</th><th>${x(2)}</th></tr></thead>
      <tbody>${body}</tbody></table>`;
  }

  function closeModal() {
    document.getElementById('tankDoubleInterpModal')?.remove();
  }

  /**
   * @param {object} opts
   * @param {string} opts.tankName
   * @param {number|null} opts.initialVolumeM3
   * @param {number} opts.trimByStern
   * @param {number} opts.heelDeg
   * @param {function(number):void} opts.onApply
   */
  function openDoubleInterpManual(opts) {
    closeModal();
    const o = opts || {};
    const trim = num(o.trimByStern, 0);
    const heel = num(o.heelDeg, 0);
    const vol = o.initialVolumeM3;

    const overlay = document.createElement('div');
    overlay.id = 'tankDoubleInterpModal';
    overlay.className = 'tsp-overlay dim-interp-overlay';
    overlay.innerHTML = `<div class="tsp-dialog dim-interp-dialog" role="dialog" aria-modal="true">
      <div class="tsp-head"><h3>Double interpolation (manual) — ${esc(o.tankName || 'Tank')}</h3>
        <button type="button" class="btn ghost small" data-dim-close>Close</button></div>
      <p class="hint">Enter book values from the sounding tables (trim volume + heeling correction). Target sounding / trim / heel go in the middle column of each axis. Result m³ is applied to Actual input.</p>
      <div class="dim-targets form-row-3">
        <label class="fr-field"><span>Target sounding</span>
          <input type="number" step="any" id="dim-target-sounding"></label>
        <label class="fr-field"><span>Target trim (m)</span>
          <input type="number" step="any" id="dim-target-trim" value="${esc(trim)}"></label>
        <label class="fr-field"><span>Target heel (°)</span>
          <input type="number" step="any" id="dim-target-heel" value="${esc(heel)}"></label>
      </div>
      <div class="section-title">Trim correction (volume m³)</div>
      ${gridTable('dim-trim-grid', 'Trim (m)', 'Sounding', 'dim-trim', 'dim-sounding')}
      <div class="section-title">Heeling correction (m³ to add)</div>
      ${gridTable('dim-heel-grid', 'Heel (°)', 'Sounding', 'dim-heel', 'dim-sounding')}
      <div class="dim-result-row">
        <strong>Corrected volume (m³):</strong>
        <output id="dim-result-out">${vol != null ? esc(vol) : '—'}</output>
        <button type="button" class="btn small" id="dim-recalc">Calculate</button>
      </div>
      <div class="tsp-actions">
        <button type="button" class="btn" data-dim-close>Cancel</button>
        <button type="button" class="btn primary" id="dim-apply">Apply to Actual (m³)</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);

    const recalc = () => {
      const r = computeResult();
      const out = document.getElementById('dim-result-out');
      if (out) out.textContent = r != null ? String(r) : '—';
      return r;
    };

    overlay.querySelectorAll('[data-dim-close]').forEach((b) => { b.onclick = closeModal; });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.getElementById('dim-recalc').onclick = recalc;
    document.getElementById('dim-apply').onclick = () => {
      const r = recalc();
      if (r == null || !Number.isFinite(r)) {
        alert('Enter the trim and heel tables, then Calculate.');
        return;
      }
      if (typeof o.onApply === 'function') o.onApply(r);
      closeModal();
    };

    /* Default sounding axis placeholders — chief adjusts to match the book. */
    const sMid = document.getElementById('dim-target-sounding');
    if (sMid && sMid.value === '') sMid.value = '';
    const s0 = document.getElementById('dim-sounding-0');
    const s1 = document.getElementById('dim-sounding-1');
    const s2 = document.getElementById('dim-sounding-2');
    if (s0 && !s0.value) { s0.value = '4021'; s1.value = '4041'; s2.value = '4071'; }
    const t0 = document.getElementById('dim-trim-0');
    const t1 = document.getElementById('dim-trim-1');
    const t2 = document.getElementById('dim-trim-2');
    if (t0 && !t0.value) { t0.value = '0'; t1.value = String(trim); t2.value = '1'; }
    const h0 = document.getElementById('dim-heel-0');
    const h1 = document.getElementById('dim-heel-1');
    const h2 = document.getElementById('dim-heel-2');
    if (h0 && !h0.value) { h0.value = '-1'; h1.value = String(heel); h2.value = '0'; }
  }

  root.TankDoubleInterpManual = { open: openDoubleInterpManual, close: closeModal };
}(typeof globalThis !== 'undefined' ? globalThis : window));
