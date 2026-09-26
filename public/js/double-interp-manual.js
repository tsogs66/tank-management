/**
 * Manual double interpolation — layout and formulas match the Excel DOUBLE INTERPOLATION sheet.
 * Trim / heel centre columns come from Monitoring or After Bunkering header (calculated trim & heel).
 * Only corner table cells and axis end labels are typed; coloured blocks are calculated live.
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

  function fmt(v) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return String(Math.round(Number(v) * 10000) / 10000);
  }

  function axisBracket(center) {
    if (typeof root.excelAxisBracket === 'function') return root.excelAxisBracket(center);
    const v = Number(center);
    if (!Number.isFinite(v)) return [0, 0, 1];
    if (Math.abs(v) < 1e-9) return [0, 0, 1];
    if (v > 0) return [0, v, 1];
    return [0, v, -1];
  }

  function readAxis(prefix) {
    return [
      num(document.getElementById(`${prefix}-0`)?.value, null),
      num(document.getElementById(`${prefix}-1`)?.value, null),
      num(document.getElementById(`${prefix}-2`)?.value, null),
    ];
  }

  function readCornerGrid(tableId) {
    const grid = [[null, null, null], [null, null, null], [null, null, null]];
    const table = document.getElementById(tableId);
    if (!table) return grid;
    table.querySelectorAll('[data-dim-corner]').forEach((inp) => {
      const r = Number(inp.dataset.row);
      const c = Number(inp.dataset.col);
      if (r >= 0 && r < 3 && c >= 0 && c < 3) {
        grid[r][c] = inp.value === '' ? null : num(inp.value, null);
      }
    });
    return grid;
  }

  function paintFormulaCells(tableId, filled) {
    const table = document.getElementById(tableId);
    if (!table || !filled) return;
    table.querySelectorAll('[data-dim-formula]').forEach((out) => {
      const r = Number(out.dataset.row);
      const c = Number(out.dataset.col);
      const v = filled[r] && filled[r][c];
      out.textContent = fmt(v);
      out.classList.toggle('dim-formula-mid', r === 1 && c === 1);
    });
  }

  function heelMode() {
    const el = document.querySelector('input[name="dim-heel-mode"]:checked');
    return el && el.value === 'sounding' ? 'sounding' : 'volume';
  }

  function applyAxisBracket(prefix, center, force) {
    const bracket = axisBracket(center);
    [0, 1, 2].forEach((i) => {
      const el = document.getElementById(`${prefix}-${i}`);
      if (!el) return;
      if (i === 1) {
        el.value = String(center);
        return;
      }
      if (force || el.dataset.dimAuto === '1' || el.value === '') {
        el.value = String(bracket[i]);
        el.dataset.dimAuto = '1';
      }
    });
  }

  function updateHeelSectionLabels(mode) {
    const title = document.getElementById('dim-heel-section-title');
    if (title) {
      title.textContent = mode === 'sounding'
        ? 'HEELING CORRECTION (cm on sounding)'
        : 'HEELING CORRECTION (m³ to add to volume)';
    }
    const hint = document.getElementById('dim-heel-mode-hint');
    if (hint) {
      hint.textContent = mode === 'sounding'
        ? 'Heel table is in cm: interpolated correction is added to target sounding, then trim volume is read at that length.'
        : 'Heel table is in m³: centre heel (D11) is added to trim centre (D4), then volume is interpolated at target sounding.';
    }
  }

  function computeResult() {
    const fn = root.manualDoubleInterpolation;
    if (typeof fn !== 'function') return null;
    const mode = heelMode();
    const soundingAxis = readAxis('dim-sounding');
    const trimAxis = readAxis('dim-trim');
    const heelAxis = readAxis('dim-heel');
    const trimGrid = readCornerGrid('dim-trim-grid');
    const heelGrid = readCornerGrid('dim-heel-grid');
    const sounding = num(document.getElementById('dim-target-sounding')?.value, soundingAxis[1]);
    const trim = num(document.getElementById('dim-target-trim')?.value, trimAxis[1]);
    const heel = num(document.getElementById('dim-target-heel')?.value, heelAxis[1]);

    const build = root.buildExcelQuadrantGrid;
    if (typeof build === 'function') {
      const corners = root.excelQuadrantCornersFromGrid;
      const heelFilled = build(soundingAxis, heelAxis, corners(heelGrid));
      let heelCenter = 0;
      if (mode === 'volume' && heelFilled && heelFilled[1]) heelCenter = heelFilled[1][1];
      const trimFilled = build(soundingAxis, trimAxis, corners(trimGrid), heelCenter);
      paintFormulaCells('dim-trim-grid', trimFilled);
      paintFormulaCells('dim-heel-grid', heelFilled);
    }

    return fn({
      sounding,
      trim,
      heel,
      soundingAxis,
      trimAxis,
      heelAxis,
      heelGrid,
      trimGrid,
      heelMode: mode,
    });
  }

  function resultVolume(raw) {
    if (raw == null) return null;
    if (typeof raw === 'object' && raw.volumeM3 != null) return raw.volumeM3;
    return Number(raw);
  }

  function soundingAxisRow() {
    const sound = (i) =>
      `<input type="text" inputmode="decimal" data-signed="1" class="dim-axis" id="dim-sounding-${i}">`;
    return `<div class="dim-sounding-axis form-row-3">
      <label class="fr-field"><span>Sounding high</span>${sound(0)}</label>
      <label class="fr-field"><span>Sounding (target)</span>${sound(1)}</label>
      <label class="fr-field"><span>Sounding low</span>${sound(2)}</label>
    </div>`;
  }

  function quadrantSection(title, secLabel, tableId, secPrefix, titleId) {
    const secHead = (i, extraClass, readonly) => {
      const cls = `dim-axis ${extraClass || ''}`.trim();
      const ro = readonly ? ' readonly tabindex="-1"' : '';
      const auto = i !== 1 ? ' data-dim-auto="1"' : '';
      return `<input type="text" inputmode="decimal" data-signed="1" class="${cls}" id="${secPrefix}-${i}"${ro}${auto}>`;
    };
    const corner = (r, c) =>
      `<input type="text" inputmode="decimal" data-signed="1" data-dim-corner data-row="${r}" data-col="${c}" class="dim-manual">`;
    const formula = (r, c) =>
      `<output class="dim-formula" data-dim-formula data-row="${r}" data-col="${c}">—</output>`;
    const soundLabel = (i) =>
      `<output class="dim-sound-label" data-dim-sound-label data-idx="${i}">—</output>`;
    const tid = titleId ? ` id="${titleId}"` : '';

    return `<div class="dim-quadrant-block">
      <div class="section-title"${tid}>${esc(title)}</div>
      <table class="dim-grid dim-excel-grid" id="${tableId}">
        <thead>
          <tr><th></th><th colspan="3">${esc(secLabel)}</th></tr>
          <tr>
            <th>Sounding</th>
            <th>${secHead(0)}</th>
            <th>${secHead(1, 'dim-axis-calc', true)}</th>
            <th>${secHead(2)}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>${soundLabel(0)}</th>
            <td>${corner(0, 0)}</td>
            <td>${formula(0, 1)}</td>
            <td>${corner(0, 2)}</td>
          </tr>
          <tr class="dim-mid-row">
            <th>${soundLabel(1)}</th>
            <td>${formula(1, 0)}</td>
            <td>${formula(1, 1)}</td>
            <td>${formula(1, 2)}</td>
          </tr>
          <tr>
            <th>${soundLabel(2)}</th>
            <td>${corner(2, 0)}</td>
            <td>${formula(2, 1)}</td>
            <td>${corner(2, 2)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
  }

  function closeModal() {
    document.getElementById('tankDoubleInterpModal')?.remove();
  }

  /**
   * @param {object} opts
   * @param {string} opts.tankName
   * @param {number|null} opts.initialVolumeM3
   * @param {number} opts.trimByStern — from header (e.g. 0.41 m)
   * @param {number} opts.heelDeg — from header (e.g. −0.4°)
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
      <div class="tsp-head"><h3>Double interpolation — ${esc(o.tankName || 'Tank')}</h3>
        <button type="button" class="btn ghost small" data-dim-close>Close</button></div>
      <p class="hint">Enter <b>four corners</b> per table. Trim/heel <b>start</b> and <b>end</b> columns
        bracket the header values (0 → 1 m or 0 → −1 when negative). Formula cells follow the Excel sheet.</p>
      <div class="dim-targets form-row-3">
        <label class="fr-field"><span>Target sounding</span>
          <input type="text" inputmode="decimal" data-signed="1" id="dim-target-sounding"></label>
        <label class="fr-field"><span>Trim used (m)</span>
          <input type="text" inputmode="decimal" data-signed="1" id="dim-target-trim" value="${esc(trim)}" readonly tabindex="-1"></label>
        <label class="fr-field"><span>Heel used (°)</span>
          <input type="text" inputmode="decimal" data-signed="1" id="dim-target-heel" value="${esc(heel)}" readonly tabindex="-1"></label>
      </div>
      <fieldset class="dim-heel-mode-field">
        <legend>Heel correction type</legend>
        <label class="dim-radio"><input type="radio" name="dim-heel-mode" value="volume" checked>
          Volume correction (m³) — add to corrected volume</label>
        <label class="dim-radio"><input type="radio" name="dim-heel-mode" value="sounding">
          Sounding correction (cm) — add to sounding length</label>
        <p class="hint" id="dim-heel-mode-hint"></p>
      </fieldset>
      ${soundingAxisRow()}
      <div class="dim-axis-actions">
        <button type="button" class="btn ghost small" id="dim-bracket-axis">Reset trim/heel columns from header</button>
      </div>
      ${quadrantSection('TRIM CORRECTION (volume m³)', 'Trim (m)', 'dim-trim-grid', 'dim-trim')}
      ${quadrantSection('HEELING CORRECTION (m³ to add to volume)', 'Heel (°)', 'dim-heel-grid', 'dim-heel', 'dim-heel-section-title')}
      <div class="dim-result-row">
        <strong>Corrected volume (m³):</strong>
        <output id="dim-result-out">${vol != null ? esc(vol) : '—'}</output>
        <span class="dim-corr-sounding hint" id="dim-corr-sounding-wrap" hidden>
          Sounding after heel: <output id="dim-corr-sounding-out">—</output>
        </span>
        <button type="button" class="btn small" id="dim-recalc">Calculate</button>
      </div>
      <div class="tsp-actions">
        <button type="button" class="btn" data-dim-close>Cancel</button>
        <button type="button" class="btn primary" id="dim-apply">Apply to Actual (m³)</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);

    const syncSoundMid = () => {
      const t = document.getElementById('dim-target-sounding')?.value;
      const mid = document.getElementById('dim-sounding-1');
      if (mid && t !== '') mid.value = t;
      [0, 1, 2].forEach((i) => {
        const v = document.getElementById(`dim-sounding-${i}`)?.value;
        overlay.querySelectorAll(`[data-dim-sound-label][data-idx="${i}"]`).forEach((el) => {
          el.textContent = v !== '' && v != null ? v : '—';
        });
      });
    };

    const recalc = () => {
      syncSoundMid();
      const raw = computeResult();
      const r = resultVolume(raw);
      const out = document.getElementById('dim-result-out');
      if (out) out.textContent = r != null ? fmt(r) : '—';
      const wrap = document.getElementById('dim-corr-sounding-wrap');
      const sout = document.getElementById('dim-corr-sounding-out');
      if (wrap && sout) {
        const show = raw && typeof raw === 'object' && raw.correctedSounding != null;
        wrap.hidden = !show;
        if (show) sout.textContent = fmt(raw.correctedSounding);
      }
      return r;
    };

    overlay.querySelectorAll('[data-dim-close]').forEach((b) => { b.onclick = closeModal; });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    overlay.addEventListener('input', (e) => {
      if (e.target.matches('.dim-axis[data-dim-auto]') && e.target.id !== 'dim-sounding-1') {
        e.target.dataset.dimAuto = '0';
      }
      if (e.target.matches('[data-dim-corner], .dim-axis, #dim-target-sounding')) recalc();
    });
    overlay.querySelectorAll('input[name="dim-heel-mode"]').forEach((inp) => {
      inp.addEventListener('change', () => {
        updateHeelSectionLabels(heelMode());
        recalc();
      });
    });
    document.getElementById('dim-bracket-axis').onclick = () => {
      applyAxisBracket('dim-trim', trim, true);
      applyAxisBracket('dim-heel', heel, true);
      recalc();
    };
    document.getElementById('dim-recalc').onclick = recalc;
    document.getElementById('dim-apply').onclick = () => {
      const r = recalc();
      if (r == null || !Number.isFinite(r)) {
        alert('Enter the four corner values in each table, then Calculate.');
        return;
      }
      if (typeof o.onApply === 'function') o.onApply(r);
      closeModal();
    };

    const setIfEmpty = (id, val) => {
      const el = document.getElementById(id);
      if (el && el.value === '') el.value = String(val);
    };
    setIfEmpty('dim-sounding-0', '4071');
    setIfEmpty('dim-sounding-1', '4041');
    setIfEmpty('dim-sounding-2', '4021');
    setIfEmpty('dim-target-sounding', '4041');
    applyAxisBracket('dim-trim', trim, true);
    applyAxisBracket('dim-heel', heel, true);
    updateHeelSectionLabels('volume');

    if (root.TmsSignedNumeric && typeof root.TmsSignedNumeric.scan === 'function') {
      root.TmsSignedNumeric.scan(overlay);
    }
    recalc();
  }

  root.TankDoubleInterpManual = { open: openDoubleInterpManual, close: closeModal };
}(typeof globalThis !== 'undefined' ? globalThis : window));
