/**
 * Fuel Oil Report page — the workbook "TANK CONDITION" sheet.
 *
 * On screen this is the entry grid from the workbook: one row per fuel tank
 * with fuel type / sounding / method / temp / unit / tank-in-use, and the
 * derived columns beside them.
 *
 * The derivation itself (how each sounding became a weight) and the reference
 * tables are collapsed on screen but always rendered into the printed
 * document — see buildPrintPages() below.
 *
 * All numbers come from FuelReportCore (public/js/fuel-report-core.js), the
 * same module the server computes with.
 */
const FuelReport = (() => {
  const Core = window.FuelReportCore;

  /* ---------- local formatting helpers ---------- */

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  function n(v, d = 2, blank = '') {
    if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return blank;
    return Number(v).toFixed(d);
  }

  function pct(v) {
    return v === null || v === undefined ? '' : `${Math.round(Number(v))}%`;
  }

  function signed(v, d = 3) {
    if (v === null || v === undefined || v === '') return '';
    const x = Number(v);
    return (x > 0 ? '+' : '') + x.toFixed(d);
  }

  function nowStamp() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  }

  /** Per-column display precision, shared by the screen grid and the printout. */
  const CELL_FORMAT = {
    capacity100M3: (v) => n(v, 1),
    capacity100MT: (v) => n(v, 2),
    measuredM3: (v) => n(v, 3),
    volumePercent: pct,
    density15: (v) => n(v, 4),
    vcf: (v) => n(v, 4),
    gsv15M3: (v) => n(v, 3),
    wcf: (v) => n(v, 4),
    weightAirMT: (v) => n(v, 3),
  };

  const COMPUTED_COLUMNS = [
    { field: 'capacity100M3', label: 'VOLUME 100% M3' },
    { field: 'capacity100MT', label: 'VOLUME 100% MT' },
    { field: 'measuredM3', label: 'MEASURED VOL. (M3)' },
    { field: 'volumePercent', label: 'VOLUME %' },
    { field: 'density15', label: 'Density @15°C' },
    { field: 'vcf', label: 'VCF TABLE 54-B' },
    { field: 'gsv15M3', label: 'GSV @ 15°C (M3)' },
    { field: 'wcf', label: 'WCF TABLE 56' },
    { field: 'weightAirMT', label: 'WEIGHT BY AIR (MT)' },
  ];

  /* ---------- page state ---------- */

  const view = {
    form: null,
    pendingForm: null,
    computed: null,
    conversion: null,
    showCalcSheet: false,
    dirty: false,
  };

  function currentBundle() {
    return STATE.bundle;
  }

  function recompute() {
    view.computed = Core.computeFuelReport(currentBundle(), view.form, view.conversion);
    return view.computed;
  }

  /** The block a tank's row is currently drawn in, per the last computation. */
  function currentSectionOf(computed, tankId) {
    for (const section of computed.sections) {
      if (section.rows.some((r) => r.tankId === tankId)) return section.id;
    }
    return null;
  }

  /**
   * A fuel type that belongs in the other block moves the row between tables,
   * which the cell repaint cannot do — the page has to be rebuilt.
   */
  function sectionWouldChange(computed, formRow, tankId, nextFuelType) {
    if (formRow.section) return false; // pinned rows stay put
    return Core.sectionForFuelType(nextFuelType) !== currentSectionOf(computed, tankId);
  }

  async function loadConversion() {
    if (view.conversion) return view.conversion;
    if (STATE.conversionTable) {
      view.conversion = STATE.conversionTable;
      return view.conversion;
    }
    try {
      view.conversion = await Api.request('/api/reference/conversion');
      await OfflineDB.idbSet('conversion', view.conversion);
    } catch {
      view.conversion = (await OfflineDB.idbGet('conversion'))
        || { apiToDensity15: [], rdToDensity15: [] };
    }
    STATE.conversionTable = view.conversion;
    return view.conversion;
  }

  /* ---------- page ---------- */

  async function render(main) {
    const bundle = currentBundle();
    // A report loaded from the history panel survives the re-render that follows it.
    view.form = Core.normalizeForm(bundle, view.pendingForm || bundle.fuelReport);
    view.pendingForm = null;
    view.dirty = false;
    await loadConversion();
    recompute();

    main.innerHTML += `<div class="page-head no-print">
      <div>
        <h1>Fuel Oil Report</h1>
        <div class="desc">Tank condition sheet — soundings, VCF/WCF and weight in air per fuel tank</div>
      </div>
      <div class="btn-row">
        <button class="btn primary" id="fr-print-save">PRINT &amp; SAVE</button>
        <button class="btn" id="fr-save">Save only</button>
        <button class="btn" id="fr-main-menu">MAIN MENU</button>
      </div>
    </div>`;

    const wrap = document.createElement('div');
    wrap.className = 'fuel-report-page';
    wrap.innerHTML = `
      ${renderHeaderPanel()}
      ${view.computed.sections.map((s) => renderSectionPanel(s)).join('')}
      ${renderGradesPanel()}
      ${renderQuantitiesPanel()}
      ${renderCalcSheetPanel()}
      ${renderHistoryPanel(bundle.reportHistory || [])}
      <div class="fr-preview-label no-print">Print preview — this is the document PRINT &amp; SAVE sends to the printer</div>
      <div id="fr-live-preview" class="fuel-report-print-doc fr-preview"></div>`;
    main.appendChild(wrap);

    bindEvents(wrap);
    refreshComputed();
  }

  function renderHeaderPanel() {
    const h = view.form.header;
    const types = Core.REPORT_TYPES.map((t) =>
      `<option value="${esc(t)}" ${h.reportType === t ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const heels = Core.HEEL_OPTIONS.map((v) => {
      const label = v === 0 ? '0' : `${Math.abs(v)} ${v < 0 ? 'Port' : 'Stbd'}`;
      return `<option value="${v}" ${Number(h.heel) === v ? 'selected' : ''}>${label}</option>`;
    }).join('');

    return `<div class="form-panel fr-header no-print">
      <div class="fr-header-grid">
        <label class="fr-field"><span>VOYAGE</span>
          <input data-head="voyageNo" value="${esc(h.voyageNo)}"></label>
        <label class="fr-field"><span>REPORT</span>
          <select data-head="reportType">${types}</select></label>
        <label class="fr-field"><span>DRAFT FWD</span>
          <input type="number" step="any" data-head="draftFwd" value="${esc(h.draftFwd)}"></label>
        <label class="fr-field"><span>MEAN DRAFT</span>
          <output class="fr-out" data-fr-head="meanDraft"></output></label>
        <label class="fr-field"><span>HEEL</span>
          <select data-head="heel">${heels}</select></label>
        <label class="fr-field"><span>ER TEMP.</span>
          <input type="number" step="any" data-head="engineRoomTemp" value="${esc(h.engineRoomTemp)}"></label>

        <label class="fr-field"><span>DATE</span>
          <input type="date" data-head="date" value="${esc(h.date)}"></label>
        <label class="fr-field"><span>TIME</span>
          <input type="time" data-head="time" value="${esc(h.time)}"></label>
        <label class="fr-field"><span>DRAFT AFT</span>
          <input type="number" step="any" data-head="draftAft" value="${esc(h.draftAft)}"></label>
        <label class="fr-field"><span>TRIM</span>
          <output class="fr-out" data-fr-head="trim"></output></label>
        <label class="fr-field fr-field-wide"><span>PORT</span>
          <input data-head="port" value="${esc(h.port)}"></label>
        <label class="fr-field"><span>SW TEMP.</span>
          <input type="number" step="any" data-head="seaTemp" value="${esc(h.seaTemp)}"></label>
      </div>
      <div class="hint" data-fr-head="attitude"></div>
    </div>`;
  }

  /**
   * The tank-entry grid for one section. `formRows` lets other pages (the
   * after-bunkering report) render the same sheet against their own form.
   */
  function renderSectionPanel(section, formRows) {
    const fuelTypes = Core.FUEL_TYPES;
    const units = Core.UNIT_STANDARDS;
    const source = formRows || view.form.rows;
    const rows = section.rows.map((row) => {
      const f = source[row.tankId] || {};
      const typeOpts = fuelTypes.map((t) =>
        `<option value="${t.id}" ${row.fuelType === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('');
      const unitOpts = units.map((u) =>
        `<option value="${u.id}" ${row.unit === u.id ? 'selected' : ''}>${esc(u.label)}</option>`).join('');
      const methodOpts = Core.METHODS.map((m) =>
        `<option value="${m.id}" ${row.method === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
      return `<tr data-tank="${esc(row.tankId)}">
        <th class="fr-tank-name">${esc(row.name)}<span class="fr-move" data-fr-move="${esc(row.tankId)}"></span></th>
        <td><select data-row="${esc(row.tankId)}" data-field="fuelType">${typeOpts}</select></td>
        <td><input type="number" step="any" data-row="${esc(row.tankId)}" data-field="reading" value="${esc(f.reading)}"></td>
        <td><select data-row="${esc(row.tankId)}" data-field="method">${methodOpts}</select></td>
        <td><input type="number" step="any" class="fr-narrow" data-row="${esc(row.tankId)}" data-field="tempC" value="${esc(f.tempC)}"></td>
        <td><select data-row="${esc(row.tankId)}" data-field="unit">${unitOpts}</select></td>
        <td><input type="number" step="any" class="fr-wide" data-row="${esc(row.tankId)}" data-field="unitValue" value="${esc(f.unitValue)}"></td>
        <td class="fr-check"><input type="checkbox" data-row="${esc(row.tankId)}" data-field="inUse" ${row.inUse ? 'checked' : ''}></td>
        ${COMPUTED_COLUMNS.map((c) =>
          `<td class="fr-calc" data-fr-cell="${esc(row.tankId)}.${c.field}"></td>`).join('')}
      </tr>`;
    }).join('');

    return `<div class="form-panel fr-section no-print" data-section="${esc(section.id)}">
      <div class="section-title" style="margin-top:0">${esc(section.title)}</div>
      <div class="scroll-x">
        <table class="fr-sheet">
          <thead>
            <tr>
              <th>TANK</th><th>FUEL TYPE</th><th>ACTUAL (MM)</th><th>METHOD</th><th>TEMP. (°C)</th>
              <th>UNIT</th><th>UNIT VALUE</th><th>TANK IN USE</th>
              ${COMPUTED_COLUMNS.map((c) => `<th class="fr-calc-head">${esc(c.label)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <th colspan="8">TOTAL — ${section.rows.length} tanks</th>
              <td class="fr-calc" data-fr-total="${esc(section.id)}.capacity100M3"></td>
              <td class="fr-calc" data-fr-total="${esc(section.id)}.capacity100MT"></td>
              <td class="fr-calc" data-fr-total="${esc(section.id)}.measuredM3"></td>
              <td></td><td></td><td></td>
              <td class="fr-calc" data-fr-total="${esc(section.id)}.gsv15M3"></td>
              <td></td>
              <td class="fr-calc" data-fr-total="${esc(section.id)}.weightAirMT"></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="hint" data-fr-section-note="${esc(section.id)}"></div>
    </div>`;
  }

  function renderGradesPanel() {
    const cells = Core.FUEL_TYPES.map((g) => `
      <div class="fr-grade" data-grade="${g.id}">
        <div class="fr-grade-label">${esc(g.label)}</div>
        <label class="fr-field"><span>LOGBOOK ROB (MT)</span>
          <input type="number" step="any" data-logbook="${g.id}" value="${esc(view.form.logbook[g.id])}"></label>
        <div class="fr-grade-row"><span>TOTAL ACTUAL (MT)</span>
          <b data-fr-grade="${g.id}.actualMT"></b></div>
        <div class="fr-grade-row"><span>LOGBOOK − ACTUAL</span>
          <b data-fr-grade="${g.id}.differenceMT"></b></div>
      </div>`).join('');
    return `<div class="form-panel no-print">
      <div class="section-title" style="margin-top:0">Totals vs log book</div>
      <div class="fr-grades">${cells}</div>
    </div>`;
  }

  function renderQuantitiesPanel() {
    const lube = Core.LUBE_FIELDS.map((f) => `
      <label class="fr-field"><span>${esc(f.label)}</span>
        <input type="number" step="any" data-lube="${f.id}" value="${esc(view.form.lube[f.id])}">
        <em class="fr-unit" data-fr-lube="${f.id}"></em></label>`).join('');
    const received = Core.RECEIVED_FIELDS.map((f) => `
      <label class="fr-field"><span>${esc(f.label)}</span>
        <input type="number" step="any" data-received="${f.id}" value="${esc(view.form.received[f.id])}"></label>`).join('');
    const consumption = Core.CONSUMPTION_FIELDS.map((f) => `
      <label class="fr-field"><span>${esc(f.label)}</span>
        <input type="number" step="any" data-consumption="${f.id}" value="${esc(view.form.consumption[f.id])}"></label>`).join('');
    const sig = view.form.signature;
    return `<div class="form-panel no-print">
      <div class="section-title" style="margin-top:0">Lube oil quantity (litres)</div>
      <div class="fr-quant">${lube}</div>
      <div class="section-title">Received quantity (MT)</div>
      <div class="fr-quant">${received}</div>
      <div class="section-title">Daily fuel consumption (MT)</div>
      <div class="fr-quant">${consumption}</div>
      <div class="section-title">Prepared by</div>
      <div class="fr-quant">
        <label class="fr-field"><span>NAME</span>
          <input data-signature="preparedBy" value="${esc(sig.preparedBy)}"></label>
        <label class="fr-field"><span>RANK</span>
          <input data-signature="rank" value="${esc(sig.rank)}"></label>
      </div>
    </div>`;
  }

  function renderCalcSheetPanel() {
    return `<div class="form-panel no-print">
      <div class="section-title" style="margin-top:0">Calculation sheet &amp; reference tables</div>
      <p class="hint">The white pages below are the printout. Use PRINT &amp; SAVE (or Print / PDF without saving) to send them to the printer.</p>
      <div class="btn-row">
        <button class="btn small" id="fr-toggle-calc">Show on screen</button>
        <button class="btn small" id="fr-print-only">Print / PDF without saving</button>
      </div>
      <div id="fr-calc-sheet" class="fr-calc-sheet" hidden></div>
    </div>`;
  }

  function renderHistoryPanel(history) {
    const rows = (history || []).map((s) => `<tr>
      <td>${esc((s.savedAt || '').replace('T', ' ').slice(0, 16))}</td>
      <td>${esc(s.reportType || '')}</td>
      <td>${esc(s.voyageNo || '')}</td>
      <td>${esc(s.port || '')}</td>
      <td>${n(s.totals && s.totals.weightAirMT, 3)}</td>
      <td class="btn-row"><button class="btn small" data-load-snapshot="${esc(s.id)}">Load</button>
        <button class="btn small danger" data-del-snapshot="${esc(s.id)}">Delete</button></td>
    </tr>`).join('');
    return `<div class="form-panel no-print" id="fr-history-panel">
      <div class="section-title" style="margin-top:0">Saved reports</div>
      <div class="scroll-x"><table class="data-table">
        <thead><tr><th>Saved</th><th>Type</th><th>Voyage</th><th>Port</th><th>Total MT</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="empty-state">No saved reports yet</td></tr>'}</tbody>
      </table></div>
    </div>`;
  }

  /* ---------- live recalculation ---------- */

  function setCell(selector, value, title) {
    document.querySelectorAll(selector).forEach((el) => {
      el.textContent = value;
      if (title) el.title = title;
      else el.removeAttribute('title');
    });
  }

  const SECTION_SHORT = { fuel: 'F.O.', do: 'D.O.' };

  /**
   * A row sits in the block its fuel type belongs to, so nothing has to be
   * clicked for the totals to be right. The control here is the exception: pin
   * a row back to its home table, or release a pinned row to follow the fuel
   * type again.
   */
  function moveControlHtml(row) {
    if (row.pinned) {
      return `<button class="btn small fr-move-btn fr-move-undo" data-move="${esc(row.tankId)}" data-move-to=""
        title="Held in the ${esc(SECTION_SHORT[row.section])} table against its ${esc(row.fuelTypeLabel)} fuel type — release it"
        >pinned ↩</button>`;
    }
    if (row.moved) {
      const home = row.homeSection;
      return `<button class="btn small fr-move-btn" data-move="${esc(row.tankId)}" data-move-to="${esc(home)}"
        title="Counted here because it is carrying ${esc(row.fuelTypeLabel)}. Keep it in the ${esc(SECTION_SHORT[home])} table instead?"
        >${esc(row.fuelTypeLabel)} ↩ ${esc(SECTION_SHORT[home] || home)}</button>`;
    }
    return '';
  }

  /** Write the derived columns and section totals of a computed report into the DOM. */
  function paintSectionCells(sections) {
    for (const section of sections) {
      for (const row of section.rows) {
        const moveSlot = document.querySelector(`[data-fr-move="${row.tankId}"]`);
        if (moveSlot) moveSlot.innerHTML = moveControlHtml(row);
        for (const col of COMPUTED_COLUMNS) {
          const text = CELL_FORMAT[col.field](row[col.field]);
          setCell(`[data-fr-cell="${row.tankId}.${col.field}"]`, text,
            row.warnings.length ? row.warnings.join(' · ') : '');
        }
        const tr = document.querySelector(`tr[data-tank="${row.tankId}"]`);
        if (tr) tr.classList.toggle('fr-warn', row.warnings.length > 0 && row.reading !== '');
      }
      for (const field of ['capacity100M3', 'capacity100MT', 'measuredM3', 'gsv15M3', 'weightAirMT']) {
        setCell(`[data-fr-total="${section.id}.${field}"]`, CELL_FORMAT[field](section.totals[field]));
      }
    }
  }

  function refreshComputed() {
    const c = recompute();

    setCell('[data-fr-head="meanDraft"]', n(c.header.meanDraft, 2));
    setCell('[data-fr-head="trim"]', n(c.header.trim, 2));
    setCell('[data-fr-head="attitude"]',
      `Trim ${c.header.trimLabel} · heel ${c.header.heelLabel} — calibration tables are read at trim `
      + `${signed(c.header.trimByStern, 2)} m by the stern.`);

    paintSectionCells(c.sections);
    for (const section of c.sections) {
      setCell(`[data-fr-section-note="${section.id}"]`,
        `100% capacity ${n(section.totals.capacity100MT, 2)} MT · 85% filling limit `
        + `${n(section.totals.capacity85MT, 2)} MT · ${section.totals.tanksInUse} tank(s) in use`
        + (section.totals.averageDensityInUse != null
          ? ` · mean density in use ${n(section.totals.averageDensityInUse, 4)}` : '')
        + (section.totals.movedIn
          ? ` · ${section.totals.movedIn} tank(s) counted here by fuel type` : '')
        + (section.totals.pinned
          ? ` · ${section.totals.pinned} pinned here` : ''));
    }

    const preview = document.getElementById('fr-live-preview');
    if (preview) preview.innerHTML = buildPrintPages(c);

    for (const grade of c.grades) {
      setCell(`[data-fr-grade="${grade.id}.actualMT"]`, n(grade.actualMT, 3, '—'));
      setCell(`[data-fr-grade="${grade.id}.differenceMT"]`, signed(grade.differenceMT, 3) || '—');
      const box = document.querySelector(`.fr-grade[data-grade="${grade.id}"]`);
      if (box) {
        box.classList.toggle('fr-grade-empty', !grade.tanks);
        box.classList.toggle('fr-grade-off', grade.differenceMT != null && Math.abs(grade.differenceMT) > 0.5);
      }
    }

    for (const row of c.lube.rows) {
      setCell(`[data-fr-lube="${row.id}"]`, row.mt != null ? `${n(row.mt, 3)} MT` : '');
    }

    if (view.showCalcSheet) {
      const host = document.getElementById('fr-calc-sheet');
      if (host) host.innerHTML = buildCalcSheetHtml(c);
    }
  }

  /* ---------- events ---------- */

  /**
   * Wire the move buttons for a sheet. The row physically changes table, so the
   * page has to be re-rendered rather than repainted — `onMoved` is where the
   * page carries its unsaved form across that re-render and navigates.
   */
  function bindSectionMove(wrap, formRows, onMoved) {
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-move]');
      if (!btn) return;
      const row = formRows[btn.dataset.move];
      if (!row) return;
      const to = btn.dataset.moveTo || '';
      row.section = to;
      onMoved(to);
      showToast(to
        ? `Pinned to the ${SECTION_SHORT[to]} table`
        : 'Following the fuel type again');
    });
  }

  function bindEvents(wrap) {
    bindSectionMove(wrap, view.form.rows, () => {
      view.pendingForm = view.form;
      view.dirty = true;
      navigate('fuel-report');
    });
    const mark = () => { view.dirty = true; };

    wrap.addEventListener('input', (e) => {
      const el = e.target;
      if (el.dataset.row && el.dataset.field) {
        const row = view.form.rows[el.dataset.row];
        if (!row) return;
        const moves = el.dataset.field === 'fuelType'
          && sectionWouldChange(view.computed, row, el.dataset.row, el.value);
        row[el.dataset.field] = el.type === 'checkbox' ? el.checked : el.value;
        if (moves) {
          view.pendingForm = view.form;
          view.dirty = true;
          navigate('fuel-report');
          showToast(`Moved to the ${SECTION_SHORT[Core.sectionForFuelType(el.value)]} table`);
          return;
        }
      } else if (el.dataset.head) {
        view.form.header[el.dataset.head] = el.value;
      } else if (el.dataset.logbook) {
        view.form.logbook[el.dataset.logbook] = el.value;
      } else if (el.dataset.lube) {
        view.form.lube[el.dataset.lube] = el.value;
      } else if (el.dataset.received) {
        view.form.received[el.dataset.received] = el.value;
      } else if (el.dataset.consumption) {
        view.form.consumption[el.dataset.consumption] = el.value;
      } else if (el.dataset.signature) {
        view.form.signature[el.dataset.signature] = el.value;
      } else {
        return;
      }
      mark();
      refreshComputed();
    });

    document.getElementById('fr-print-save').onclick = () => saveReport({ snapshot: true, print: true });
    document.getElementById('fr-save').onclick = () => saveReport({ snapshot: false, print: false });
    document.getElementById('fr-main-menu').onclick = () => navigate('dashboard');
    document.getElementById('fr-print-only').onclick = () => printReport(recompute());

    document.getElementById('fr-toggle-calc').onclick = (e) => {
      view.showCalcSheet = !view.showCalcSheet;
      const host = document.getElementById('fr-calc-sheet');
      host.hidden = !view.showCalcSheet;
      e.target.textContent = view.showCalcSheet ? 'Hide' : 'Show on screen';
      if (view.showCalcSheet) host.innerHTML = buildCalcSheetHtml(view.computed);
    };

    wrap.querySelectorAll('[data-load-snapshot]').forEach((btn) => {
      btn.onclick = () => {
        const snap = (currentBundle().reportHistory || []).find((s) => s.id === btn.dataset.loadSnapshot);
        if (!snap) return;
        view.pendingForm = snap.form;
        navigate('fuel-report');
        showToast('Saved report loaded into the sheet');
      };
    });
    wrap.querySelectorAll('[data-del-snapshot]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Delete this saved report?')) return;
        try {
          const res = await Api.deleteFuelReportSnapshot(STATE.activeVesselId, btn.dataset.delSnapshot);
          currentBundle().reportHistory = res.history || [];
          navigate('fuel-report');
        } catch (err) {
          showToast(err.message);
        }
      };
    });
  }

  /* ---------- save ---------- */

  async function saveReport({ snapshot = false, print = false } = {}) {
    const computed = recompute();
    const bundle = currentBundle();
    const form = { ...view.form, updatedAt: new Date().toISOString() };
    const body = { form, snapshot, syncReadings: true };

    bundle.fuelReport = form;
    bundle.readings = Core.readingsFromReport(bundle, computed);
    if (snapshot) {
      bundle.reportHistory = [Core.snapshotFromReport(computed), ...(bundle.reportHistory || [])].slice(0, 50);
    }
    await OfflineDB.idbSet('vessel:' + STATE.activeVesselId, bundle);

    try {
      const res = await Api.saveFuelReport(STATE.activeVesselId, body);
      bundle.fuelReport = res.form;
      if (res.history) bundle.reportHistory = res.history;
      await OfflineDB.idbSet('vessel:' + STATE.activeVesselId, bundle);
      showToast(snapshot ? 'Report saved' : 'Draft saved');
    } catch {
      await Api.mutate(`/api/vessels/${STATE.activeVesselId}/fuel-report`, { method: 'PUT', body });
      showToast('Saved offline — will sync when online');
    }
    view.dirty = false;
    if (print) printReport(computed);
  }

  /* ---------- printed document ---------- */

  function masthead(title, subtitle) {
    return `<header class="calib-print-masthead">
      <div><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div></div>
      <div class="calib-print-badge">OFFICIAL · A4</div>
    </header>`;
  }

  function footer(label) {
    return `<footer class="calib-print-footer">
      <span>${esc(label)}</span><span>Printed ${esc(nowStamp())}</span>
    </footer>`;
  }

  /* ---------- signature & vessel logo on printed sheets ---------- */

  function vesselAssets() {
    return (currentBundle() && currentBundle().assets) || { vesselLogo: null, chEngSignatures: {} };
  }

  /** Signatures are filed under the officer's name, lower-cased. */
  function signatureKey(name) {
    return String(name || '').trim().toLowerCase();
  }

  /**
   * The signature belonging to a given Chief Engineer, or null. Filing them by
   * name means a sheet reprinted after a crew change carries the signature of
   * the officer named on it, not the incoming one's.
   */
  function signatureFor(name) {
    const key = signatureKey(name);
    if (!key) return null;
    return (vesselAssets().chEngSignatures || {})[key] || null;
  }

  function vesselChiefEngineer() {
    return ((currentBundle() && currentBundle().vessel) || {}).chiefEngineer || '';
  }

  /**
   * The signature footer every printed sheet ends with: the signature image sits
   * in the space directly above the line, so it reads as signed over it, and the
   * vessel logo sits just after the block.
   */
  function printSignatureBlock(signerName, role) {
    const signer = String(signerName || vesselChiefEngineer() || '').trim();
    const sig = signatureFor(signer);
    const logo = vesselAssets().vesselLogo;
    return `<div class="fr-print-signrow">
      <div class="fr-print-sign">
        <div class="fr-print-sign-space">${sig ? `<img src="${esc(sig)}" alt="">` : ''}</div>
        <div class="fr-print-sign-line"></div>
        <div class="fr-print-sign-name">${esc(signer || '—')}</div>
        <div class="fr-print-sign-role">${esc(role || 'Chief Engineer')}</div>
      </div>
      ${logo ? `<div class="fr-print-logo"><img src="${esc(logo)}" alt=""></div>` : ''}
    </div>`;
  }

  function metaGrid(entries) {
    return `<div class="calib-print-meta">${entries.map(([k, v]) =>
      `<div><span class="k">${esc(k)}</span><span class="v">${esc(v ?? '—')}</span></div>`).join('')}</div>`;
  }

  function printSectionTable(section, options) {
    const moved = section.rows.filter((r) => r.moved);
    const rows = section.rows.map((r) => `<tr>
      <td class="fr-print-name">${esc(r.name)}${r.moved ? ' *' : ''}</td>
      <td>${esc(r.fuelTypeLabel)}</td>
      <td>${n(r.reading, 0)}</td>
      <td>${esc(r.methodLabel)}</td>
      <td>${n(r.tempC, 1)}</td>
      <td>${n(r.capacity100M3, 1)}</td>
      <td>${n(r.measuredM3, 3)}</td>
      <td>${pct(r.volumePercent)}</td>
      <td>${n(r.density15, 4)}</td>
      <td>${n(r.vcf, 4)}</td>
      <td>${n(r.gsv15M3, 3)}</td>
      <td>${n(r.wcf, 4)}</td>
      <td class="fr-print-weight">${n(r.weightAirMT, 3)}</td>
    </tr>`).join('');
    const t = section.totals;
    return `<h3 class="fr-print-h3">${esc(section.title)}</h3>
      <table class="fr-print-table">
        <thead><tr>
          <th>Tank</th><th>Fuel</th><th>Actual (mm)</th><th>Method</th><th>Temp °C</th>
          <th>100% m³</th><th>Measured m³</th><th>Vol %</th><th>Density @15</th>
          <th>VCF 54B</th><th>GSV @15 m³</th><th>WCF 56</th><th>Weight air MT</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <th colspan="5">TOTAL</th>
          <td>${n(t.capacity100M3, 1)}</td>
          <td>${n(t.measuredM3, 3)}</td>
          <td colspan="3"></td>
          <td>${n(t.gsv15M3, 3)}</td>
          <td></td>
          <td class="fr-print-weight">${n(t.weightAirMT, 3)}</td>
        </tr></tfoot>
      </table>
      <p class="calib-print-note">100% capacity in MT = 100% m³ × ${options.capacityMtFactor}
        · ${(options.safeFillRatio * 100).toFixed(0)}% filling limit = ${n(t.capacity85MT, 2)} MT</p>
      ${moved.length ? `<p class="calib-print-note">* ${moved.map((r) => esc(r.name)).join(', ')} —
        normally ${esc(SECTION_SHORT[moved[0].homeSection] || '')} tank(s), counted here because they are
        carrying ${esc(moved.map((r) => r.fuelTypeLabel).join(' / '))} this voyage.</p>` : ''}
      ${section.rows.some((r) => r.pinned) ? `<p class="calib-print-note">Pinned:
        ${section.rows.filter((r) => r.pinned).map((r) => esc(r.name)).join(', ')} — held in this table
        against the fuel type entered.</p>` : ''}`;
  }

  function prettyDate(iso) {
    if (!iso) return '—';
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return String(iso);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
  }

  function fact(label, value) {
    return `<div class="fr-tc-fact"><span>${esc(label)}</span><b>${value}</b></div>`;
  }

  function printMasthead(c, opts) {
    const title = (opts && opts.title) || 'TANK CONDITION';
    const showFacts = !opts || opts.showFacts !== false;
    const reportType = c.header.reportType || '—';
    const imo = c.vessel.imo ? `IMO ${c.vessel.imo}` : 'IMO —';
    const dateTime = c.header.dateTime || prettyDate(c.header.date);
    const facts = showFacts ? `<div class="fr-tc-facts">
      ${fact('Date', esc(dateTime || '—'))}
      ${fact('Port', esc(c.header.port || '—'))}
      ${fact('Voyage No.', esc(c.header.voyageNo || '—'))}
      ${fact('Heel', esc(c.header.heelLabel || '—'))}
      ${fact('FW Draft', `${n(c.header.draftFwd, 2)} m`)}
      ${fact('Aft Draft', `${n(c.header.draftAft, 2)} m`)}
      ${fact('Mean Draft', `${n(c.header.meanDraft, 2)} m`)}
      ${fact('Trim', `${n(c.header.trim, 2)} (${esc(c.header.trimLabel)})`)}
      ${fact('S/W Temp', `${n(c.header.seaTemp, 0, '—')} °C`)}
      ${fact('E/R Temp', `${n(c.header.engineRoomTemp, 0, '—')} °C`)}
    </div>` : '';
    return `<header class="fr-tc-masthead">
      <div class="fr-tc-brand-row">
        <div class="fr-tc-app">Vessel Fuel Tank Management</div>
      </div>
      <div class="fr-tc-title-row">
        <div class="fr-tc-ident-left">
          <div class="fr-tc-ident-name">${esc(c.vessel.name || '—')}</div>
          <div class="fr-tc-ident-imo">${esc(imo)}</div>
        </div>
        <h1>${esc(title)}</h1>
        <div class="fr-tc-ident-right">
          <span>Report</span>
          <b>${esc(reportType)}</b>
        </div>
      </div>
      ${facts}
    </header>`;
  }

  function printConditionSection(section, options) {
    const moved = section.rows.filter((r) => r.moved);
    const rows = section.rows.map((r) => `<tr>
      <td class="fr-print-name">${esc(r.name)}${r.moved ? ' *' : ''}</td>
      <td>${esc(r.fuelTypeLabel)}</td>
      <td>${n(r.reading, 0)}</td>
      <td>${esc(r.methodLabel)}</td>
      <td>${n(r.tempC, 1)}</td>
      <td>${n(r.capacity100M3, 1)}</td>
      <td>${n(r.measuredM3, 3)}</td>
      <td>${pct(r.volumePercent)}</td>
      <td>${n(r.density15, 4)}</td>
      <td>${n(r.vcf, 4)}</td>
      <td>${n(r.gsv15M3, 3)}</td>
      <td>${n(r.wcf, 4)}</td>
      <td class="fr-print-weight">${n(r.weightAirMT, 3)}</td>
    </tr>`).join('');
    const t = section.totals;
    return `<section class="fr-tc-block">
      <div class="fr-tc-block-head">
        <h3>${esc(section.title)}</h3>
        <span>${t.tanks} tank${t.tanks === 1 ? '' : 's'}</span>
      </div>
      <table class="fr-tc-table">
        <thead>
          <tr>
            <th class="fr-print-name">Tank</th>
            <th>Fuel</th>
            <th>Actual<br>mm</th>
            <th>Method</th>
            <th>Temp<br>°C</th>
            <th>100%<br>m³</th>
            <th>Measured<br>m³</th>
            <th>Vol %</th>
            <th>Density<br>@15°C</th>
            <th>VCF<br>54B</th>
            <th>GSV @15<br>m³</th>
            <th>WCF<br>56</th>
            <th>Weight<br>air MT</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <th class="fr-print-name" colspan="5">TOTAL</th>
            <td>${n(t.capacity100M3, 1)}</td>
            <td>${n(t.measuredM3, 3)}</td>
            <td colspan="3"></td>
            <td>${n(t.gsv15M3, 3)}</td>
            <td></td>
            <td class="fr-tc-total-mt">${n(t.weightAirMT, 3)}</td>
          </tr>
        </tfoot>
      </table>
      <div class="fr-tc-capline">
        <span>TOTAL (MT) <b>${n(t.weightAirMT, 3)}</b></span>
        <span>100% m³ × ${options.capacityMtFactor} · ${(options.safeFillRatio * 100).toFixed(0)}% limit <b>${n(t.capacity85MT, 2)} MT</b></span>
      </div>
      ${moved.length ? `<p class="calib-print-note">* ${moved.map((r) => esc(r.name)).join(', ')} counted in this block from the fuel type entered this voyage.</p>` : ''}
    </section>`;
  }

  function printConditionPage(c) {
    const grades = c.grades.filter((g) => g.tanks > 0 || g.logbookMT != null);
    const surveyRows = grades.map((g) => `<tr>
      <td class="fr-print-name">${esc(g.label)}</td>
      <td>${n(g.actualMT, 3, '—')}</td>
      <td>${n(g.logbookMT, 3, '—')}</td>
      <td class="${g.differenceMT != null && Math.abs(g.differenceMT) > 0.001 ? 'fr-tc-diff' : ''}">${signed(g.differenceMT, 3) || '—'}</td>
    </tr>`).join('');
    const lubeRows = c.lube.rows.map((r) => `<tr>
      <td class="fr-print-name">${esc(r.label)}</td>
      <td>${n(r.litres, 0, '—')}</td>
      <td>${n(r.mt, 3, '—')}</td>
    </tr>`).join('');
    const receivedRows = c.received.map((r) =>
      `<tr><td class="fr-print-name">${esc(r.label)}</td><td>${n(r.value, 3, '—')}</td></tr>`).join('');
    const consVal = (list, id) => n((list.find((x) => x.id === id) || {}).value, 2, '—');
    const me = c.consumption || [];

    return `<section class="calib-print-page fr-tc-page">
      ${printMasthead(c)}
      ${c.sections.map((s) => printConditionSection(s, c.options)).join('')}
      <div class="fr-tc-cards">
        <div class="fr-tc-card">
          <h4>Lube Oil Quantities</h4>
          <table class="fr-tc-mini">
            <thead><tr><th>Category</th><th>LTRS</th><th>MT</th></tr></thead>
            <tbody>${lubeRows}</tbody>
            <tfoot><tr><th>TOTAL</th><td>${n(c.lube.totalLitres, 0)}</td><td>${n(c.lube.totalMT, 3)}</td></tr></tfoot>
          </table>
        </div>
        <div class="fr-tc-card">
          <h4>Received Quantities</h4>
          <table class="fr-tc-mini">
            <thead><tr><th>Category</th><th>MT / LTRS</th></tr></thead>
            <tbody>${receivedRows}</tbody>
          </table>
        </div>
        <div class="fr-tc-card">
          <h4>Daily Fuel Consumption</h4>
          <table class="fr-tc-mini">
            <thead><tr>${Core.CONSUMPTION_FIELDS.map((f) => `<th>${esc(f.label)}</th>`).join('')}</tr></thead>
            <tbody>
              <tr>${Core.CONSUMPTION_FIELDS.map((f) => `<td>${consVal(me, f.id)}</td>`).join('')}</tr>
            </tbody>
          </table>
        </div>
        <div class="fr-tc-card">
          <h4>Survey Summary</h4>
          <table class="fr-tc-mini">
            <thead><tr><th>Grade</th><th>Monitoring</th><th>Log book</th><th>Difference</th></tr></thead>
            <tbody>${surveyRows || '<tr><td colspan="4">—</td></tr>'}</tbody>
          </table>
        </div>
      </div>
      <div class="fr-tc-signoff">
        ${printSignatureBlock(c.signature.preparedBy, c.signature.rank)}
      </div>
      ${footer(`${c.vessel.name} · tank condition · ${c.header.dateTime}`)}
    </section>`;
  }

  function printAnnexPage(c) {
    const extraRows = [];
    for (const section of c.sections) {
      for (const r of section.rows) {
        extraRows.push(`<tr>
          <td class="fr-print-name">${esc(r.name)}</td>
          <td>${esc(r.fuelTypeLabel)}</td>
          <td>${esc(r.methodLabel)}</td>
          <td>${esc(r.unitLabel)}</td>
          <td>${n(r.unitValue, 4)}</td>
          <td>${r.inUse ? 'YES' : ''}</td>
          <td>${pct(r.volumePercent)}</td>
        </tr>`);
      }
    }
    const temps = [15, 25, 30, 40, 50, 60, 70];
    const densities = [];
    for (const section of c.sections) {
      for (const r of section.rows) {
        if (r.density15 != null && !densities.some((d) => d.density === r.density15)) {
          densities.push({ density: r.density15, tempC: r.tempC, name: r.name });
        }
      }
    }
    const vcfHead = temps.map((t) => `<th>${t}</th>`).join('');
    const vcfRows = densities.map((d) => `<tr>
      <td class="fr-print-name">${n(d.density, 4)}</td>
      ${temps.map((t) => {
        const detail = window.vcfDetail54B(d.density, t);
        const hit = d.tempC !== '' && Math.abs(Number(d.tempC) - t) < 0.5;
        return `<td class="${hit ? 'fr-print-used' : ''}">${n(detail.vcf, 4)}</td>`;
      }).join('')}
      <td>${n(window.wcf56(d.density), 4)}</td>
    </tr>`).join('') || '<tr><td colspan="9">No densities entered</td></tr>';

    return `<section class="calib-print-page fr-tc-page fr-tc-page-2">
      ${printMasthead(c, { title: 'TANK CONDITION', showFacts: false })}
      <h3 class="fr-print-h3">Entry fields not shown on page 1</h3>
      <table class="fr-print-table">
        <thead><tr>
          <th class="fr-print-name">Tank</th><th>Fuel</th><th>Method</th>
          <th>Unit</th><th>Unit value</th><th>In use</th><th>Vol %</th>
        </tr></thead>
        <tbody>${extraRows.join('')}</tbody>
      </table>
      <h3 class="fr-print-h3">Calculation sheet</h3>
      <table class="fr-print-table fr-print-calc">
        <thead><tr>
          <th>Tank</th><th>Reading</th><th>To table</th><th>Trim corr.</th><th>Heel corr.</th>
          <th>Observed m³</th><th>VCF</th><th>GSV m³</th><th>WCF</th><th>Weight MT</th>
        </tr></thead>
        <tbody>${calcAnnexRows(c)}</tbody>
      </table>
      <h3 class="fr-print-h3">ASTM 54B / 56 at densities used (°C)</h3>
      <table class="fr-print-table">
        <thead><tr><th>Density @15</th>${vcfHead}<th>WCF</th></tr></thead>
        <tbody>${vcfRows}</tbody>
      </table>
      ${footer(`${c.vessel.name} · annex · ${c.header.dateTime}`)}
    </section>`;
  }

  function calcAnnexRows(c) {
    const rows = [];
    for (const section of c.sections) {
      for (const r of section.rows) {
        if (r.measuredM3 == null) continue;
        const t = r.trace;
        rows.push(`<tr>
          <td class="fr-print-name">${esc(r.name)}</td>
          <td>${esc(r.methodLabel)} ${n(r.reading, 0)}</td>
          <td>${t.flipped ? `${esc(t.nativeMethod)} ${n(t.nativeReading, 0)}` : 'as read'}</td>
          <td>${corrCell(r, t.trimCorrection)}</td>
          <td>${corrCell(r, t.listCorrection)}</td>
          <td>${n(r.measuredM3, 3)}</td>
          <td>${n(r.vcf, 4)}</td>
          <td>${n(r.gsv15M3, 3)}</td>
          <td>${n(r.wcf, 4)}</td>
          <td class="fr-print-weight">${n(r.weightAirMT, 3)}</td>
        </tr>`);
      }
    }
    return rows.join('') || '<tr><td colspan="10">No soundings entered</td></tr>';
  }

  function printSummaryPage(c) {
    return printConditionPage(c);
  }

  /**
   * The derivation the entry grid hides: how each raw sounding became a weight.
   */
  function corrCell(row, correction) {
    if (correction) return n(correction, 3);
    // 'direct' tanks read volume straight off the trim grid — no separate correction step.
    return row.calcType === 'direct' ? 'in grid' : '0.000';
  }

  function calcRowsHtml(c) {
    const rows = [];
    for (const section of c.sections) {
      for (const r of section.rows) {
        if (r.measuredM3 == null) continue;
        const t = r.trace;
        rows.push(`<tr>
          <td class="fr-print-name">${esc(r.name)}</td>
          <td>${esc(r.methodLabel)} ${n(r.reading, 0)}</td>
          <td>${t.flipped ? `${esc(t.nativeMethod)} ${n(t.nativeReading, 0)} (pipe ${n(t.pipeHeight, 0)})` : 'as read'}</td>
          <td>${esc(r.calcType)} · step ${n(t.soundingIncrement, 0)}</td>
          <td>${signed(t.trimUsed, 2)} m</td>
          <td>${corrCell(r, t.trimCorrection)}</td>
          <td>${signed(t.heelUsed, 1)}°</td>
          <td>${corrCell(r, t.listCorrection)}</td>
          <td>${n(t.correctedReading, 1)}</td>
          <td>${n(r.measuredM3, 3)}</td>
          <td>${t.vcf ? n(t.vcf.alpha, 7) : '—'}</td>
          <td>${t.vcf ? n(t.vcf.deltaT, 2) : '—'}</td>
          <td>${n(r.vcf, 4)}</td>
          <td>${n(r.gsv15M3, 3)}</td>
          <td>${n(r.wcf, 4)}</td>
          <td class="fr-print-weight">${n(r.weightAirMT, 3)}</td>
        </tr>`);
      }
    }
    return rows.join('') || '<tr><td colspan="16">No soundings entered</td></tr>';
  }

  function printCalculationPage(c) {
    return `<section class="calib-print-page">
      ${masthead('CALCULATION SHEET', `${c.vessel.name} · ${c.header.dateTime}`)}
      <p class="calib-print-note">Derivation of every sounded tank on the previous page — the columns the
        entry sheet keeps hidden. Trim is applied as trim by the stern; corrections are read from the tank's
        own calibration grid by double interpolation at the table increment.</p>
      <table class="fr-print-table fr-print-calc">
        <thead><tr>
          <th>Tank</th><th>Reading</th><th>To table scale</th><th>Calibration</th>
          <th>Trim</th><th>Trim corr.</th><th>Heel</th><th>Heel corr.</th><th>Corrected</th>
          <th>Observed m³</th><th>α 54B</th><th>ΔT</th><th>VCF</th><th>GSV m³</th><th>WCF</th><th>Weight MT</th>
        </tr></thead>
        <tbody>${calcRowsHtml(c)}</tbody>
      </table>
      ${footer(`${c.vessel.name} · calculation sheet`)}
    </section>`;
  }

  function printFormulaPage(c) {
    const densities = [];
    for (const section of c.sections) {
      for (const r of section.rows) {
        if (r.density15 != null && !densities.some((d) => d.density === r.density15)) {
          densities.push({ density: r.density15, tempC: r.tempC, name: r.name });
        }
      }
    }
    const temps = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90];
    const vcfHead = temps.map((t) => `<th>${t}</th>`).join('');
    const vcfRows = densities.map((d) => `<tr>
      <td class="fr-print-name">${n(d.density, 4)}</td>
      ${temps.map((t) => {
        const detail = window.vcfDetail54B(d.density, t);
        const hit = d.tempC !== '' && Math.abs(Number(d.tempC) - t) < 0.5;
        return `<td class="${hit ? 'fr-print-used' : ''}">${n(detail.vcf, 4)}</td>`;
      }).join('')}
      <td>${n(window.wcf56(d.density), 4)}</td>
    </tr>`).join('') || '<tr><td colspan="16">No densities entered</td></tr>';

    return `<section class="calib-print-page">
      ${masthead('FORMULAS & REFERENCE TABLES', `${c.vessel.name} · ${c.header.dateTime}`)}
      <h3 class="fr-print-h3">Formulas applied</h3>
      <table class="fr-print-table fr-print-formulas">
        <thead><tr><th>Step</th><th>Formula</th><th>Source</th></tr></thead>
        <tbody>
          <tr><td class="fr-print-name">Mean draft</td><td>(draft fwd + draft aft) ÷ 2</td><td>Report header</td></tr>
          <tr><td class="fr-print-name">Trim</td><td>draft fwd − draft aft (tables read at draft aft − draft fwd, trim by stern)</td><td>Report header</td></tr>
          <tr><td class="fr-print-name">Dip ↔ ullage</td><td>reading on table scale = sounding-pipe height − reading</td><td>Setup sheet</td></tr>
          <tr><td class="fr-print-name">Trim correction</td><td>double interpolation on sounding × trim grid ÷ correction divisor</td><td>Tank calibration table</td></tr>
          <tr><td class="fr-print-name">Heel correction</td><td>double interpolation on corrected sounding × heel grid ÷ correction divisor</td><td>Tank calibration table</td></tr>
          <tr><td class="fr-print-name">Observed volume</td><td>volume curve / trim-volume grid at the corrected sounding</td><td>Tank calibration table</td></tr>
          <tr><td class="fr-print-name">Volume %</td><td>observed volume ÷ 100% capacity × 100</td><td>Data sheet</td></tr>
          <tr><td class="fr-print-name">VCF (ASTM 54B)</td><td>exp(−α·ΔT·(1 + 0.8·α·ΔT)), ΔT = temp − 15 °C, α from the density band</td><td>ASTM Tables sheet</td></tr>
          <tr><td class="fr-print-name">GSV @ 15 °C</td><td>observed volume × VCF</td><td>Data sheet</td></tr>
          <tr><td class="fr-print-name">WCF (ASTM 56)</td><td>density @15 °C − 0.0011 (air buoyancy)</td><td>ASTM Tables sheet</td></tr>
          <tr><td class="fr-print-name">Weight in air</td><td>GSV @ 15 °C × WCF</td><td>Data sheet</td></tr>
          <tr><td class="fr-print-name">100% capacity in MT</td><td>100% volume m³ × ${c.options.capacityMtFactor}</td><td>Report sheet</td></tr>
          <tr><td class="fr-print-name">Filling limit</td><td>100% capacity MT × ${c.options.safeFillRatio}</td><td>Report sheet</td></tr>
          <tr><td class="fr-print-name">Lube oil MT</td><td>litres × ${c.lube.density} ÷ 1000</td><td>Report sheet</td></tr>
          <tr><td class="fr-print-name">Log book difference</td><td>actual total MT − log book ROB MT</td><td>Data sheet</td></tr>
        </tbody>
      </table>
      <h3 class="fr-print-h3">ASTM Table 54B (VCF) and Table 56 (WCF) at the densities used</h3>
      <table class="fr-print-table">
        <thead><tr><th>Density @15 °C</th>${vcfHead}<th>WCF</th></tr></thead>
        <tbody>${vcfRows}</tbody>
      </table>
      <p class="calib-print-note">Columns are product temperature in °C; the shaded cell is the temperature
        actually used for that density in this report. WCF is temperature-independent.</p>
      ${footer(`${c.vessel.name} · formulas & reference tables`)}
    </section>`;
  }

  function buildPrintPages(c) {
    return printConditionPage(c);
  }

  /** Same content the printout carries, for the on-screen "show" toggle. */
  function buildCalcSheetHtml(c) {
    return `<div class="fuel-report-print-doc fr-preview">${printAnnexPage(c)}</div>`;
  }

  /** Keep the print document in the DOM until the dialog closes — a 2s timeout
   *  was deleting it while Chrome's preview was still open, so the printer
   *  received the on-screen entry grid instead. */
  function printHtml(html) {
    let root = document.getElementById('fuel-report-print-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'fuel-report-print-root';
      document.body.appendChild(root);
    }
    root.className = 'fuel-report-print-doc';
    root.innerHTML = html;
    document.body.classList.add('printing-fuel-report');
    const previousTitle = document.title;
    document.title = '\u00A0';
    const finish = () => {
      document.title = previousTitle;
      document.body.classList.remove('printing-fuel-report');
      window.removeEventListener('afterprint', finish);
    };
    window.removeEventListener('afterprint', finish);
    window.addEventListener('afterprint', finish);
    window.setTimeout(() => {
      try {
        window.print();
      } catch (err) {
        console.warn(err);
        finish();
        showToast('Print failed');
      }
    }, 100);
  }

  function printReport(computed) {
    const preview = document.getElementById('fr-live-preview');
    if (preview) preview.innerHTML = buildPrintPages(computed);
    printHtml(buildPrintPages(computed));
  }

  return {
    render,
    printReport,
    buildPrintPages,
    recompute,
    view,
    // Reused by the bunkering screens so both sheets look and behave the same.
    printHtml,
    printSignatureBlock,
    signatureFor,
    signatureKey,
    vesselChiefEngineer,
    vesselAssets,
    sheetTableHtml: renderSectionPanel,
    sectionWouldChange,
    SECTION_SHORT,
    bindSectionMove,
    moveControlHtml,
    paintSectionCells,
    setCell,
    COMPUTED_COLUMNS,
    CELL_FORMAT,
    printSectionTable,
    masthead,
    footer,
    metaGrid,
    esc,
    n,
    pct,
    signed,
    nowStamp,
  };
})();

window.FuelReport = FuelReport;
