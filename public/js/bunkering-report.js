/**
 * Bunkering screens — plan & live monitoring, after-bunkering tank condition,
 * and the bunkering report summary.
 *
 * The three are one chain and each reads the stage before it:
 *   Fuel Report -> Bunker Plan -> After Bunkering -> Bunker Summary
 *
 * All numbers come from BunkeringCore (public/js/bunkering-core.js), the same
 * module the server computes with. Layout helpers, the tank grid and the print
 * document are borrowed from FuelReport so both sheets look the same.
 */
const BunkerReports = (() => {
  const Core = window.BunkeringCore;
  const FRCore = window.FuelReportCore;
  const UI = window.FuelReport;

  const { esc, n, pct, signed, nowStamp } = UI;

  const view = {
    page: null,
    plan: null,
    after: null,
    summary: null,
    computed: null,
    conversion: null,
  };

  function bundle() {
    return STATE.bundle;
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

  function bunkerHistory() {
    return { plans: [], after: [], summaries: [], ...(bundle().bunkerHistory || {}) };
  }

  /** Save a form part, keeping the offline cache and queue in step. */
  async function saveChainPart(path, part, form, { snapshot = false, extra = {}, deferServer = false } = {}) {
    const b = bundle();
    const body = { form, snapshot, ...extra };
    b[part] = form;
    await OfflineDB.idbSet('vessel:' + STATE.activeVesselId, b);

    const pushServer = async () => {
      try {
        const res = await Api.request(`/api/vessels/${STATE.activeVesselId}/${path}`, { method: 'PUT', body });
        if (res.form) b[part] = res.form;
        if (res.history) {
          const h = bunkerHistory();
          h[path === 'bunker-plan' ? 'plans' : path === 'bunker-after' ? 'after' : 'summaries'] = res.history;
          b.bunkerHistory = h;
        }
        await OfflineDB.idbSet('vessel:' + STATE.activeVesselId, b);
        showToast(snapshot ? 'Saved' : 'Draft saved');
        return res;
      } catch {
        await Api.mutate(`/api/vessels/${STATE.activeVesselId}/${path}`, { method: 'PUT', body });
        showToast('Saved offline — will sync when online');
        return null;
      }
    };

    if (deferServer) {
      Branding.afterPrintHold(() => { pushServer(); });
      return null;
    }
    return pushServer();
  }

  function historyRows(list, kind, draftEntry) {
    const draft = draftEntry && draftEntry.form ? [{
      ...draftEntry,
      id: draftEntry.id || '__draft__',
      isDraft: true,
      savedAt: draftEntry.savedAt || draftEntry.form.updatedAt || '',
    }] : [];
    const merged = [...draft, ...(list || []).filter((s) => s && s.id !== '__draft__' && !s.isDraft)];
    const rows = merged.map((s) => `<tr>
      <td>${s.isDraft ? '<span class="chip on">Draft</span> ' : ''}${esc((s.savedAt || '').replace('T', ' ').slice(0, 16))}</td>
      <td>${esc(s.voyageNo || '')}</td>
      <td>${esc(s.port || '')}</td>
      <td>${esc(kind === 'plans' ? `${n(s.receivedMT, 3, '—')} / ${n(s.bunkerQuantityMT, 2, '—')} MT`
        : kind === 'summaries' ? `${n(s.receivedQuantityMT, 3, '—')} MT · BDN ${n(s.bdnQuantityMT, 2, '—')}`
        : (s.grades || []).filter((g) => g.presentMT != null)
            .map((g) => `${g.label} ${n(g.presentMT, 1)}`).join(' · ') || (s.isDraft ? 'Current draft — Load to edit' : ''))}</td>
      <td class="btn-row">
        <button class="btn small" data-print="${esc(s.id)}">Print</button>
        <button class="btn small" data-load="${esc(s.id)}">Load</button>
        ${s.isDraft ? '' : `<button class="btn small danger" data-del="${esc(s.id)}">Delete</button>`}
      </td></tr>`).join('');
    return `<div class="scroll-x"><table class="data-table">
      <thead><tr><th>Saved</th><th>Voyage</th><th>Port</th><th>Result</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="empty-state">Nothing saved yet — use Save only for a draft, or Print &amp; Save for a filed report</td></tr>'}</tbody>
    </table></div>`;
  }

  /**
   * Rebuild a saved record from its own form and send it to the printer.
   *
   * Each entry keeps the form it was saved from, so it can be turned back into
   * a sheet without loading it over whatever is on screen — reprinting last
   * month's summary should not cost you the plan you are in the middle of.
   */
  const REPRINTERS = {
    plans: (entry) => {
      const c = Core.computeBunkerPlan(bundle(), entry.form, view.conversion);
      return { computed: c, fresh: Core.planSnapshot(c), pages: planPrintPages(c) };
    },
    after: (entry) => {
      const c = Core.computeAfterBunkering(bundle(), entry.form, view.conversion);
      return { computed: c, fresh: Core.afterSnapshot(c), pages: afterPrintPages(c) };
    },
    summaries: (entry) => {
      const c = Core.computeBunkerSummary(bundle(), entry.form, null, view.conversion);
      return { computed: c, fresh: Core.summarySnapshot(c), pages: summaryPrintPages(c) };
    },
  };

  function bindHistory(wrap, kind, onLoad, draftForm) {
    wrap.querySelectorAll('[data-print]').forEach((btn) => {
      btn.onclick = () => {
        let entry = (bunkerHistory()[kind] || []).find((s) => s.id === btn.dataset.print);
        if (!entry && btn.dataset.print === '__draft__' && draftForm) {
          entry = { form: draftForm, id: '__draft__' };
        }
        if (!entry || !entry.form) { showToast('That saved record has no sheet to print'); return; }
        const build = REPRINTERS[kind];
        if (!build) return;
        try {
          const { fresh, pages } = build(entry);
          if (!entry.isDraft && entry.id !== '__draft__') UI.warnIfDrifted(UI.snapshotDrift(entry, fresh));
          UI.printHtml(pages);
        } catch (err) {
          console.warn(err);
          showToast('Could not rebuild that saved record for printing');
        }
      };
    });
    wrap.querySelectorAll('[data-load]').forEach((btn) => {
      btn.onclick = () => {
        let entry = (bunkerHistory()[kind] || []).find((s) => s.id === btn.dataset.load);
        if (!entry && btn.dataset.load === '__draft__' && draftForm) {
          entry = { form: draftForm, id: '__draft__' };
        }
        if (entry) onLoad(entry);
      };
    });
    wrap.querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Delete this saved report?')) return;
        try {
          const res = await Api.request(
            `/api/vessels/${STATE.activeVesselId}/bunker-history/${kind}/${encodeURIComponent(btn.dataset.del)}`,
            { method: 'DELETE' },
          );
          if (res.history) bundle().bunkerHistory = res.history;
          showToast('Deleted');
          navigate(kind === 'plans' ? 'bunker-plan' : kind === 'after' ? 'bunker-after' : 'bunker-summary');
        } catch (err) {
          showToast(err.message || 'Could not delete');
        }
      };
    });
  }

  /* ================================================================ plan ==== */

  const PLAN_COLUMNS = [
    { field: 'capacity100M3', label: 'CAPACITY 100% M3', d: 1 },
    { field: 'capacity85M3', label: 'CAPACITY 85% M3', d: 2 },
    { field: 'startingUllageMM', label: 'STARTING ULL. (MM)', d: 0 },
    { field: 'startingRobM3', label: 'STARTING ROB (M3)', d: 3 },
    { field: 'freeM3At85', label: 'FREE (M3) @85% CAP', d: 3 },
    { field: 'targetVolumePercent', label: 'TARGET VOL. %', d: 'pct' },
    { field: 'targetUllageMM', label: 'TARGET ULLAGE', d: 0 },
    { field: 'planAddMT', label: 'PLAN ADD (MT)', d: 3 },
    { field: 'currentVolumePercent', label: 'CURRENT VOL.(%)', d: 'pct' },
    { field: 'currentVolumeM3', label: 'CURRENT VOL.(M3)', d: 3 },
    { field: 'quantityAddMT', label: 'QUANTITY ADD (MT)', d: 3 },
    { field: 'remainingToTargetMT', label: 'TO GO (MT)', d: 3 },
  ];

  function planCell(field, value) {
    const col = PLAN_COLUMNS.find((c) => c.field === field);
    if (!col) return n(value, 2);
    return col.d === 'pct' ? pct(value) : n(value, col.d);
  }

  let clockTimer = null;
  let tickTimer = null;
  let countdownEndsAt = null;
  function stopClockTicker() {
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  /**
   * Two cadences, because they cost different amounts.
   *
   * The clock itself is retimed every second — while fuel is going aboard the
   * pumping time has to be seen running, and it is only a few text nodes. The
   * quantities, rates and ETAs come from a full recompute over every tank, so
   * those keep the slower beat; they move on the scale of minutes anyway.
   */
  function startClockTicker() {
    stopClockTicker();
    const alive = () => view.page === 'bunker-plan' && document.getElementById('bp-clock-toggle');

    tickTimer = setInterval(() => {
      if (!alive()) { stopClockTicker(); return; }
      if (!tickClockOnly()) stopClockTicker();
    }, 1000);

    clockTimer = setInterval(() => {
      if (!alive()) { stopClockTicker(); return; }
      const c = Core.computeBunkerPlan(bundle(), view.plan, view.conversion);
      if (!c.monitoring.clock.running && !c.monitoring.tanksFilling) return;
      refreshPlan();
    }, 15000);
  }

  /**
   * Retime whatever is running, without recomputing the plan behind it.
   *
   * Only running clocks are touched. A paused or closed tank keeps the figure
   * it stopped on — that is the record of how long it took, and overwriting it
   * with a live count would be a lie about a valve that is shut.
   *
   * Returns whether anything is still running, so the ticker can retire itself
   * rather than burn a timer over a finished operation.
   */
  function tickClockOnly() {
    let anyRunning = false;
    const clock = Core.pumpingClock(view.plan, 0, null);
    if (clock.running) {
      anyRunning = true;
      UI.setCell('[data-bp-mon="elapsedLabel"]', clock.elapsedLabelLive || clock.elapsedLabel);
      // The countdown counts down. It is rebuilt from the quantity still to come
      // on the slower beat; between those it just runs off the wall clock, so it
      // moves every second instead of jumping every fifteen.
      const el = document.querySelector('[data-bp-est-mon="countdown"]');
      if (el && countdownEndsAt) {
        const leftH = (countdownEndsAt - Date.now()) / 3600000;
        el.textContent = leftH > 0 ? Core.hmsLabel(leftH) : '0h 00m 00s';
      }
    }
    const seq = Array.isArray(view.plan.sequence) ? view.plan.sequence : [];
    seq.forEach((slot, i) => {
      const tc = Core.tankClock(slot || {});
      if (!tc.running) return;
      anyRunning = true;
      const el = document.querySelector(`[data-bp-tank-time="${i}"]`);
      if (el) el.textContent = tc.elapsedLabelLive;
    });
    return anyRunning;
  }

  function recomputePlan() {
    view.computed = Core.computeBunkerPlan(bundle(), view.plan, view.conversion);
    return view.computed;
  }

  async function renderPlan(main) {
    view.page = 'bunker-plan';
    await loadConversion();
    const b = bundle();
    view.plan = Core.normalizePlan(b, view.pendingPlan || b.bunkerPlan, view.conversion);
    view.pendingPlan = null;
    const c = recomputePlan();

    main.innerHTML += `<div class="page-head no-print">
      <div><h1>Bunkering Plan &amp; Monitoring</h1>
        <div class="desc">Target ullage per tank from the fuel report ROB, then live intake as the transfer runs</div></div>
      <div class="btn-row">
        <button class="btn primary" id="bp-print-save">PRINT &amp; SAVE</button>
        <button class="btn" id="bp-save">Save only</button>
        <button class="btn" id="bp-print-only">Print only</button>
        <button class="btn" id="bp-new">NEW PLAN</button>
        <button class="btn" id="bp-menu">MAIN MENU</button>
      </div></div>`;

    const wrap = document.createElement('div');
    wrap.className = 'fuel-report-page';
    wrap.innerHTML = `
      ${planHeaderPanel(c)}
      ${planSequencePanel(c)}
      ${planEstimatesPanel()}
      ${planFinishPanel(c)}
      ${planBlendPanel()}
      ${planTankTablesPanel(c)}
      <div class="form-panel no-print">
        <div class="section-title" style="margin-top:0">Saved plans</div>
        <p class="hint" style="margin-top:0">Drafts stay editable. Filed reports can be reprinted or loaded.</p>
        ${historyRows(bunkerHistory().plans, 'plans', view.plan && view.plan.updatedAt ? {
          form: view.plan,
          voyageNo: view.plan.header && view.plan.header.voyageNo,
          port: view.plan.header && view.plan.header.port,
          savedAt: view.plan.updatedAt,
        } : null)}
      </div>`;
    main.appendChild(wrap);

    bindPlanEvents(wrap);
    refreshPlan();
    if (c.monitoring.clock.running || c.monitoring.tanksFilling) startClockTicker();
  }

  function planHeaderPanel(c) {
    const h = view.plan.header;
    const fuelOpts = FRCore.FUEL_TYPES.map((f) =>
      `<option value="${f.id}" ${h.fuelType === f.id ? 'selected' : ''}>${esc(f.label)}</option>`).join('');
    const heels = FRCore.HEEL_OPTIONS.map((v) => {
      const label = v === 0 ? '0' : `${Math.abs(v)} ${v < 0 ? 'Port' : 'Stbd'}`;
      return `<option value="${v}" ${Number(h.heel) === v ? 'selected' : ''}>${label}</option>`;
    }).join('');
    const grades = Core.COMMON_FUEL_GRADES.map((g) => `<option value="${esc(g)}"></option>`).join('');

    return `<div class="form-panel fr-header no-print">
      <div class="fr-header-grid">
        <label class="fr-field"><span>DATE</span>
          <input type="date" data-head="date" value="${esc(h.date)}"></label>
        <label class="fr-field"><span>VOYAGE</span>
          <input data-head="voyageNo" value="${esc(h.voyageNo)}"></label>
        <label class="fr-field"><span>DRAFT FWD</span>
          <input type="number" step="any" data-head="draftFwd" value="${esc(h.draftFwd)}"></label>
        <label class="fr-field"><span>MEAN DRAFT</span>
          <output class="fr-out" data-bp-head="meanDraft"></output></label>
        <label class="fr-field"><span>HEEL</span>
          <select data-head="heel">${heels}</select></label>
        <label class="fr-field"><span>FUEL</span>
          <select data-head="fuelType">${fuelOpts}</select></label>

        <label class="fr-field fr-field-wide"><span>PORT</span>
          <input data-head="port" value="${esc(h.port)}"></label>
        <label class="fr-field"><span>DRAFT AFT</span>
          <input type="number" step="any" data-head="draftAft" value="${esc(h.draftAft)}"></label>
        <label class="fr-field"><span>TRIM</span>
          <output class="fr-out" data-bp-head="trim"></output></label>
        <label class="fr-field"><span>DELIVERY RATE (MT/H)</span>
          <input type="number" step="any" data-head="deliveryRateMTPerHour" value="${esc(h.deliveryRateMTPerHour)}"></label>
        <label class="fr-field"><span>BUNKER QUANTITY (MT)</span>
          <input type="number" step="any" data-head="bunkerQuantityMT" value="${esc(h.bunkerQuantityMT)}"></label>

        <label class="fr-field"><span>GRADE (BDN)</span>
          <input list="bp-grades" data-head="fuelGrade" value="${esc(h.fuelGrade)}">
          <datalist id="bp-grades">${grades}</datalist></label>
        <label class="fr-field"><span>DENSITY @15</span>
          <input type="number" step="any" data-head="density15" value="${esc(h.density15)}"
            placeholder="${esc(c.header.density15 ?? '')}"></label>
        <label class="fr-field"><span>TEMP (°C)</span>
          <input type="number" step="any" data-head="tempC" value="${esc(h.tempC)}" placeholder="15"></label>
        <label class="fr-field"><span>TIME TO BUNKER</span>
          <output class="fr-out" data-bp-head="timeToBunker"></output></label>
      </div>
      <div class="hint" data-bp-head="advice"></div>
    </div>`;
  }

  function planSequencePanel(c) {
    const tanks = (bundle().tanks.fuel || []);
    const rows = c.rows.map((row, i) => {
      const f = view.plan.sequence[i] || {};
      const opts = ['<option value="">— select tank —</option>'].concat(tanks.map((t) =>
        `<option value="${esc(t.id)}" ${row.tankId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`)).join('');
      const cell = (field) => `<td class="fr-calc" data-bp-cell="${i}.${field}"></td>`;
      return `<tr data-slot="${i}">
        <th class="fr-tank-name">${i + 1}. <select data-slot="${i}" data-field="tankId">${opts}</select></th>
        ${cell('capacity100M3')}${cell('capacity85M3')}${cell('startingUllageMM')}
        ${cell('startingRobM3')}${cell('freeM3At85')}
        <td><input type="number" step="any" data-slot="${i}" data-field="targetVolumeM3" value="${esc(f.targetVolumeM3)}"></td>
        ${cell('targetVolumePercent')}${cell('targetUllageMM')}${cell('planAddMT')}
        <td class="bp-valve" data-bp-valve="${i}"></td>
        <td><input type="number" step="any" data-slot="${i}" data-field="currentSoundingMM" value="${esc(f.currentSoundingMM)}">
          <span class="bp-method" data-bp-method="${i}"></span></td>
        ${cell('currentVolumePercent')}${cell('currentVolumeM3')}${cell('quantityAddMT')}
        ${cell('remainingToTargetMT')}
        <td class="fr-calc" data-bp-cell="${i}.etaLabel"></td>
      </tr>`;
    }).join('');

    const modeOpts = Core.DISTRIBUTION_MODES.map((m) =>
      `<option value="${m.id}" ${view.plan.distributionMode === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('');

    return `<div class="form-panel no-print" style="margin-top:16px">
      <div class="section-title" style="margin-top:0">Sequence</div>
      <div class="bp-distribute">
        <label class="fr-field"><span>DISTRIBUTE THE QUANTITY</span>
          <select id="bp-mode">${modeOpts}</select></label>
        <button class="btn" id="bp-distribute">Fill sequence</button>
        <span class="hint" id="bp-distribute-note">Spreads the bunker quantity over the matching tanks,
          weighted by the space each has below the 85% limit. Targets only — nothing is written to a tank
          until it is sounded on <b>After Bunkering</b>.</span>
      </div>
      <div class="bp-layout">
        <div class="scroll-x">
          <table class="fr-sheet bp-sheet">
            <thead><tr>
              <th>SEQUENCE / TANK NAME</th>
              <th>CAPACITY<br>100% M3</th><th>CAPACITY<br>85% M3</th><th>STARTING<br>ULL. (MM)</th>
              <th>STARTING<br>ROB (M3)</th><th>FREE (M3)<br>@85% CAP</th>
              <th>TARGET<br>VOL. (M3)</th><th>TARGET<br>VOL. %</th><th>TARGET<br>ULLAGE</th><th>PLAN ADD<br>(MT)</th>
              <th>VALVE /<br>STATUS</th>
              <th>CURRENT<br>SOUND (MM)</th><th>CURRENT<br>VOL.(%)</th><th>CURRENT<br>VOL.(M3)</th><th>QUANTITY<br>ADD (MT)</th>
              <th>TO GO<br>(MT)</th><th>ETA</th>
            </tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr>
              <th>TOTAL</th>
              <td class="fr-calc" data-bp-total="capacity100M3"></td>
              <td class="fr-calc" data-bp-total="capacity85M3"></td>
              <td></td>
              <td class="fr-calc" data-bp-total="startingRobM3"></td>
              <td class="fr-calc" data-bp-total="freeM3At85"></td>
              <td class="fr-calc" data-bp-total="targetVolumeM3"></td>
              <td></td><td></td>
              <td class="fr-calc" data-bp-total="plannedAddMT"></td>
              <td></td><td></td><td></td>
              <td class="fr-calc" data-bp-total="currentVolumeM3"></td>
              <td class="fr-calc" data-bp-total="receivedMT"></td>
              <td class="fr-calc" data-bp-total="remainingToTargetMT"></td>
              <td></td>
            </tr></tfoot>
          </table>
        </div>
        <div class="bp-monitor">
          <div class="bp-monitor-box">
            <span>QUANTITY REMAINING</span><b data-bp-mon="quantityRemainingMT"></b></div>
          <div class="bp-monitor-box">
            <span>TIME REMAINING</span><b data-bp-mon="timeRemainingLabel"></b></div>
          <div class="bp-monitor-box bp-monitor-received">
            <span data-bp-mon="receivedLabel">RECEIVED</span><b data-bp-mon="receivedMT"></b></div>
          <div class="bp-progress"><div data-bp-mon="progressFill"></div></div>
          <div class="hint" data-bp-mon="progressText"></div>

          <div class="bp-clock">
            <div class="bp-clock-row"><span>PUMP START</span>
              <input type="datetime-local" id="bp-start-at" class="bp-clock-input"></div>
            <div class="bp-clock-row"><span>PUMPING TIME</span><b data-bp-mon="elapsedLabel">—</b></div>
            <div class="bp-clock-row"><span>RATE</span><b data-bp-mon="rateLabel">—</b></div>
            <div class="bp-clock-row"><span>EXPECTED AT RATE</span><b data-bp-mon="expectedMT">—</b></div>
            <div class="bp-clock-row"><span>MEASURED − EXPECTED</span><b data-bp-mon="varianceMT">—</b></div>
            <div class="btn-row">
              <button class="btn small primary" id="bp-clock-toggle">Start pumping</button>
              <button class="btn small" id="bp-clock-reset">Reset</button>
            </div>
            <div class="btn-row">
              <button class="btn small" id="bp-finish">Finish bunkering</button>
            </div>
          </div>

          <div class="btn-row">
            <button class="btn small" id="bp-fill-85">Target all to 85%</button>
            <button class="btn small" id="bp-clear-current">Clear current soundings</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  /**
   * Finishing the transfer: the measured intake against the delivery note.
   *
   * Nothing projected reaches this panel. The received figure is the sum of
   * the soundings, and the difference against the note is withheld until every
   * tank that took fuel has a reading — a shortfall assembled out of tanks
   * nobody has sounded would send a letter of protest to a supplier who
   * delivered exactly what the note says.
   */
  function planFinishPanel(c) {
    const h = view.plan.header;
    return `<div class="form-panel no-print bp-finish" style="margin-top:16px">
      <div class="section-title" style="margin-top:0">Finish bunkering — delivery note</div>
      <div class="hint" data-bp-fin="status">—</div>
      <div class="bp-fin-grid">
        <div class="bp-est-box"><span>RECEIVED (SOUNDED)</span>
          <b data-bp-fin="received">—</b><i data-bp-fin="receivedSub"></i></div>
        <label class="fr-field bp-fin-input"><span>BDN QUANTITY (MT)</span>
          <input type="number" step="any" data-head="bdnQuantityMT" id="bp-bdn"
            value="${esc(h.bdnQuantityMT)}"></label>
        <div class="bp-est-box"><span>DIFFERENCE</span>
          <b data-bp-fin="difference">—</b><i data-bp-fin="differencePercent"></i></div>
        <div class="bp-est-box" data-bp-fin="verdictBox"><span>AGAINST THE NOTE</span>
          <b data-bp-fin="verdict">—</b><i data-bp-fin="verdictSub"></i></div>
      </div>
      <div class="bp-est-alarm" data-bp-fin="protest" hidden></div>
      <div class="btn-row">
        <button class="btn small" id="bp-to-summary">Open bunker summary</button>
      </div>
      <div class="hint">The protest paperwork — barge, supplier, BDN number, samples, times alongside —
        is on <b>Bunker Summary</b>. The quantity entered here is carried across to it.</div>
    </div>`;
  }

  /** Fill the finish panel from a fresh computation. */
  function refreshFinish(c) {
    const set = UI.setCell;
    const r = c.reconciliation;

    const pending = {
      'no-tanks': 'No tank has taken fuel yet.',
      unsounded: `Waiting on a final sounding for ${r.tanksUnsounded.join(', ')}.`
        + ' Until every tank that took fuel is sounded there is no measured intake to hold'
        + ' against the note.',
      'no-bdn': 'Enter the quantity from the delivery note to compare it with the soundings.',
    };
    set('[data-bp-fin="status"]', r.reconcilable
      ? `Reconciled against ${r.tanksUsed} sounded tank(s)${
        r.finished ? ', transfer finished' : ' — the transfer is still open'}.`
      : (pending[r.pendingReason] || '—'));

    set('[data-bp-fin="received"]', `${n(r.receivedMT, 3)} MT`);
    set('[data-bp-fin="receivedSub"]', r.tanksUnsounded.length
      ? `${r.tanksUsed - r.tanksUnsounded.length} of ${r.tanksUsed} tanks sounded`
      : `all ${r.tanksUsed} tank(s) sounded`);
    set('[data-bp-fin="difference"]', r.differenceMT != null ? `${signed(r.differenceMT, 3)} MT` : '—');
    set('[data-bp-fin="differencePercent"]', r.differencePercent != null
      ? `${signed(r.differencePercent, 3)}% of the note` : '');

    const box = document.querySelector('[data-bp-fin="verdictBox"]');
    const bad = r.protestAdvised === true;
    if (box) {
      box.classList.toggle('bp-fin-bad', bad);
      box.classList.toggle('bp-fin-good', r.withinTolerance === true);
    }
    set('[data-bp-fin="verdict"]', r.withinTolerance == null ? '—'
      : (r.withinTolerance ? 'Within tolerance' : (bad ? 'Short delivery' : 'Over delivery')));
    set('[data-bp-fin="verdictSub"]', r.withinTolerance == null ? ''
      : `tolerance ±${r.tolerancePercent}%`);

    const alarm = document.querySelector('[data-bp-fin="protest"]');
    if (alarm) {
      alarm.hidden = !bad;
      alarm.textContent = bad
        ? `Short of the delivery note by ${n(Math.abs(r.differenceMT), 3)} MT `
          + `(${n(Math.abs(r.differencePercent), 3)}%), beyond the ${r.tolerancePercent}% tolerance. `
          + 'Grounds for a letter of protest — raise it on Bunker Summary before the barge casts off.'
        : '';
    }
  }

  /**
   * Operation estimates — everything on this panel is projected, none of it
   * measured.
   *
   * It is kept in its own panel, away from the CURRENT SOUND column, on
   * purpose. What is typed into that column is a measurement, and it feeds the
   * received quantity the delivery note is reconciled against. An estimate
   * sitting in or beside that box invites somebody to copy it across on a busy
   * deck, and a projected figure has no business on a bunker dispute.
   *
   * So: soundings are entered on the sequence sheet, projections are read here,
   * and the two totals are shown side by side so the gap between them is
   * visible rather than blurred.
   */
  function planEstimatesPanel() {
    return `<div class="form-panel no-print bp-estimates" style="margin-top:16px">
      <div class="section-title" style="margin-top:0">Operation estimates</div>
      <div class="hint bp-est-basis" data-bp-est-mon="basis">—</div>
      <div class="bp-est-alarm" data-bp-est-mon="alarm" hidden></div>
      <div class="bp-est-grid">
        <div class="bp-est-box"><span>PROJECTED RATE</span>
          <b data-bp-est-mon="rate">—</b><i data-bp-est-mon="rateShare"></i></div>
        <div class="bp-est-box"><span>ESTIMATED RECEIVED</span>
          <b data-bp-est-mon="received">—</b><i data-bp-est-mon="receivedSub"></i></div>
        <div class="bp-est-box"><span>AHEAD OF SOUNDINGS</span>
          <b data-bp-est-mon="ahead">—</b><i>not yet confirmed by a sounding</i></div>
        <div class="bp-est-box"><span>ESTIMATED REMAINING</span>
          <b data-bp-est-mon="remaining">—</b><i data-bp-est-mon="remainingSub"></i></div>
        <div class="bp-est-box bp-est-countdown"><span>FINISHES IN</span>
          <b data-bp-est-mon="countdown">—</b><i data-bp-est-mon="etcAt"></i></div>
      </div>
      <div class="scroll-x">
        <table class="fr-sheet bp-est-sheet">
          <thead><tr>
            <th>TANK</th><th>SHARE<br>(MT/H)</th>
            <th>EST. SOUND<br>(MM)</th><th>EST. ULLAGE<br>(MM)</th>
            <th>EST. VOL<br>(%)</th><th>EST. VOL<br>(M3)</th><th>EST. ADDED<br>(MT)</th>
            <th>TARGET<br>IN</th><th>TARGET<br>AT</th><th>HITS 85%<br>IN</th><th>PROJECTED FROM</th>
          </tr></thead>
          <tbody data-bp-est-body></tbody>
        </table>
      </div>
      <div class="hint">Projected from the last real measurement at the rate above — never counted as
        received, and never written into a tank. Sound the tank and enter the reading on the sequence
        sheet to turn any of this into a figure that counts.</div>
    </div>`;
  }

  /**
   * Blend the ROB already aboard with the incoming parcel. The result can be
   * dropped straight into the plan's density field, which is what every
   * quantity on the sheet is converted with.
   */
  function planBlendPanel() {
    const row = (label, dens, mt) => `<tr>
      <td><input data-mix="label" value="${esc(label)}"></td>
      <td><input data-mix="density15" type="number" step="any" placeholder="${dens}"></td>
      <td><input data-mix="quantityMT" type="number" step="any" placeholder="${mt}"></td>
      <td><input data-mix="tempC" type="number" step="any" value="15"></td>
    </tr>`;
    return `<div class="form-panel no-print" style="margin-top:16px">
      <div class="section-title" style="margin-top:0">Blend calculator — ROB and bunker of different density</div>
      <div class="btn-row">
        <button class="btn small" id="bp-blend-toggle">Show</button>
      </div>
      <div id="bp-blend" hidden>
        <div class="scroll-x"><table class="data-table" id="bp-mix-table">
          <thead><tr><th>Parcel</th><th>Density @15</th><th>Quantity MT</th><th>Temp °C</th></tr></thead>
          <tbody>${row('ROB on board', '0.960', '200')}${row('Incoming bunker', '0.945', '450')}</tbody>
        </table></div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn small" id="bp-mix-add">Add parcel</button>
          <button class="btn small primary" id="bp-mix-calc">Calculate blend</button>
        </div>
        <div id="bp-mix-result" style="margin-top:10px"></div>
      </div>
    </div>`;
  }

  /** BEFORE / AFTER bunkering tank tables, as on the workbook plan sheet. */
  function planTankTablesPanel(c) {
    // Until the after-report has been saved it is only a copy of the pre-bunker
    // soundings, so show the prompt rather than the same numbers twice.
    const saved = Boolean(bundle().bunkerAfter);
    const after = saved
      ? readOnlyTankTable(Core.computeAfterBunkering(bundle(), bundle().bunkerAfter, view.conversion))
      : `<p class="empty-state">Not sounded yet — record the tanks on
         <b>After Bunkering</b> and this table fills in.</p>`;
    return `<div class="form-panel no-print" style="margin-top:16px">
      <div class="section-title" style="margin-top:0">Before bunkering — from the fuel report</div>
      ${readOnlyTankTable(c.before)}
      <div class="section-title">After bunkering — from the after-bunkering report</div>
      ${after}
    </div>`;
  }

  function readOnlyTankTable(report) {
    const rows = [];
    for (const section of report.sections) {
      for (const row of section.rows) {
        if (row.measuredM3 == null) continue;
        rows.push(`<tr>
          <td class="fr-tank-name">${esc(row.name)}</td>
          <td>${n(row.capacity100M3, 1)}</td>
          <td>${n(row.capacity85M3, 2)}</td>
          <td>${esc(row.methodLabel)}</td>
          <td>${n(row.reading, 0)}</td>
          <td>${n(row.measuredM3, 3)}</td>
          <td>${n(row.tempC, 0)}</td>
          <td>${n(row.density15, 4)}</td>
          <td>${n(row.vcf, 4)}</td>
          <td>${pct(row.volumePercent)}</td>
          <td>${n(row.gsv15M3, 3)}</td>
          <td>${n(row.wcf, 4)}</td>
          <td><b>${n(row.weightAirMT, 3)}</b></td>
        </tr>`);
      }
    }
    const grades = report.grades.filter((g) => g.actualMT != null)
      .map((g) => `${g.label} ${n(g.actualMT, 3)} MT`).join(' · ');
    return `<div class="scroll-x"><table class="fr-sheet">
      <thead><tr>
        <th>TANK NAME</th><th>VOLUME<br>100%</th><th>VOLUME<br>85%</th><th>SOUNDING<br>METHOD</th>
        <th>SOUNDING<br>(MM)</th><th>OBSERVED<br>VOLUME</th><th>TEMP<br>°C</th><th>DENSITY<br>15°C</th>
        <th>VCF<br>54-B</th><th>OBSERVED<br>VOL %</th><th>CORRECTED<br>VOL M3</th><th>WCF<br>56</th><th>WEIGHT BY<br>AIR MT</th>
      </tr></thead>
      <tbody>${rows.join('') || '<tr><td colspan="13" class="empty-state">No soundings</td></tr>'}</tbody>
    </table></div>
    <div class="hint">${grades ? esc('Totals: ' + grades) : 'No totals yet'}</div>`;
  }

  /** An ISO instant as a datetime-local input wants it, in the device's zone. */
  function localInputValue(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad2 = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
      + `T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  /** Fill the estimates panel from a fresh computation. */
  function refreshEstimates(c) {
    const set = UI.setCell;
    const m = c.monitoring;
    const clockTime = (iso) => (iso
      ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '—');

    // The alarm box below names the tanks already over; here, only the warning
    // that has not fired yet.
    const limitNote = m.estimatedLimitSoonestHours != null
      ? ` First tank reaches the 85% limit in ${Core.hmsLabel(m.estimatedLimitSoonestHours)}.`
      : '';
    set('[data-bp-est-mon="basis"]', m.estimating
      ? `Projecting at the rate ${m.estimateBasisLabel}.${limitNote}`
      : (m.tanksFilling
        ? 'Nothing to project from yet — enter a delivery rate and a density.'
        : 'No tank is open. Estimates start once a valve is opened.'));

    const alarm = document.querySelector('[data-bp-est-mon="alarm"]');
    if (alarm) {
      const over = m.estimatedOverLimitTanks || [];
      alarm.hidden = over.length === 0;
      alarm.textContent = over.length
        ? `${over.length} tank(s) projected above the 85% filling limit — ${over.join(', ')}. `
          + 'Sound them now; this is a projection, not a reading.'
        : '';
    }

    set('[data-bp-est-mon="rate"]', m.estimating ? `${n(m.estimateRateMTPerHour, 1)} MT/h` : '—');
    set('[data-bp-est-mon="rateShare"]', m.estimating && m.tanksFilling
      ? `${n(m.estimateShareMTPerHour, 1)} MT/h into each of ${m.tanksFilling} tank(s)` : '');
    set('[data-bp-est-mon="received"]', m.estimatedReceivedMT != null
      ? `${n(m.estimatedReceivedMT, 3)} MT` : '—');
    set('[data-bp-est-mon="receivedSub"]', `sounded so far: ${n(m.receivedMT, 3)} MT`);
    set('[data-bp-est-mon="ahead"]', m.estimatedAheadMT != null
      ? `${signed(m.estimatedAheadMT, 3)} MT` : '—');
    set('[data-bp-est-mon="remaining"]', m.estimatedRemainingMT != null
      ? `${n(m.estimatedRemainingMT, 3)} MT` : '—');
    set('[data-bp-est-mon="remainingSub"]', m.estimatedPercentComplete != null
      ? `${n(m.estimatedPercentComplete, 1)}% of ${n(c.header.bunkerQuantityMT, 1)} MT` : '');
    set('[data-bp-est-mon="countdown"]', m.estimatedEtcLabel || '—');
    set('[data-bp-est-mon="etcAt"]', m.estimatedEtcAtIso
      ? `completing about ${clockTime(m.estimatedEtcAtIso)}` : '');
    // Let the per-second tick run this down between recomputes.
    countdownEndsAt = m.estimatedEtcAtIso ? Date.parse(m.estimatedEtcAtIso) : null;

    const body = document.querySelector('[data-bp-est-body]');
    if (!body) return;
    const rows = c.rows.filter((r) => r.tankId && r.estimateRateMTPerHour > 0);
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="11" class="bp-est-empty">${
        m.tanksFilling ? 'Waiting for the first minute of pumping.'
          : 'Open a tank on the sequence sheet to project it.'}</td></tr>`;
      return;
    }
    body.innerHTML = rows.map((r) => {
      const from = r.estimatedFrom
        ? `${esc(r.estimatedFrom)}, ${esc(r.estimatedAgeLabel)} ago`
        : 'just opened';
      const method = r.startingMethod ? `<i>${esc(r.startingMethod)}</i>` : '';
      return `<tr class="${r.estimatedOverLimit ? 'bp-est-over' : ''}">
        <th class="fr-tank-name">${esc(r.name)}</th>
        <td>${n(r.estimateRateMTPerHour, 1)}</td>
        <td class="bp-est-figure">${n(r.estimatedSoundingMM, 0)}${method}</td>
        <td>${n(r.estimatedUllageMM, 0)}</td>
        <td>${pct(r.estimatedVolumePercent)}</td>
        <td>${n(r.estimatedVolumeM3, 3)}</td>
        <td>${n(r.estimatedAddedMT, 3)}</td>
        <td>${esc(r.estimatedToTargetLabel)}</td>
        <td>${clockTime(r.estimatedTargetAtIso)}</td>
        <td class="bp-est-limit">${esc(r.estimatedToLimitLabel)}</td>
        <td class="bp-est-from">${from}</td>
      </tr>`;
    }).join('');
  }

  /**
   * Which sense the CURRENT SOUND box wants for this tank, and where it
   * started.
   *
   * The column takes the reading in the tank's own gauging method, but every
   * other reading on this sheet is an ullage, and the box used to say nothing
   * at all. Entering the ullage into a dipped tank turns an empty tank into a
   * full one. The tag says which is wanted; the placeholder shows the tank's
   * opening reading in that same sense, so there is something to measure the
   * new one against.
   */
  function paintSoundingMethod(i, row) {
    const tag = document.querySelector(`[data-bp-method="${i}"]`);
    const box = document.querySelector(`input[data-slot="${i}"][data-field="currentSoundingMM"]`);
    if (tag) {
      tag.textContent = row.tankId && row.startingMethod ? String(row.startingMethod).toUpperCase() : '';
      tag.title = row.startingMethod
        ? `This tank is gauged by ${row.startingMethod}. Enter the reading the same way.`
        : '';
      tag.classList.toggle('bp-method-bad', Boolean(row.reversedReading));
    }
    if (box) {
      box.placeholder = row.tankId && row.startingReadingMM != null
        ? `from ${n(row.startingReadingMM, 0)}` : '';
    }
  }

  /**
   * The per-tank valve cell: what the tank is doing, how long it has been doing
   * it, and the buttons to open, hold or close it.
   */
  function paintValveCell(i, row) {
    const cell = document.querySelector(`[data-bp-valve="${i}"]`);
    if (!cell) return;
    if (!row.tankId) { cell.innerHTML = ''; return; }
    const state = Core.TANK_STATES.find((s) => s.id === row.status) || Core.TANK_STATES[0];
    const closeable = row.status === 'filling' || row.status === 'paused';
    cell.innerHTML = `
      <span class="bp-state bp-state-${state.id}">${esc(state.label)}</span>
      <span class="bp-state-time"><span data-bp-tank-time="${i}">${
        esc(row.clock.elapsedLabelLive || row.clock.elapsedLabel)}</span>${
        row.rateShareMTPerHour > 0 ? ` · ${n(row.rateShareMTPerHour, 0)} MT/h` : ''}</span>
      <span class="bp-state-btns">
        <button class="btn small ${state.id === 'filling' ? '' : 'primary'}"
          data-valve="${i}" data-valve-to="${state.next}">${esc(state.action)}</button>
        ${closeable ? `<button class="btn small" data-valve="${i}" data-valve-to="done">Close</button>` : ''}
      </span>`;
  }

  function refreshPlan() {
    const c = recomputePlan();
    const set = UI.setCell;

    set('[data-bp-head="meanDraft"]', n(c.header.meanDraft, 3));
    set('[data-bp-head="trim"]', n(c.header.trim, 2));
    set('[data-bp-head="timeToBunker"]', c.header.timeToBunkerLabel);

    const advice = [];
    if (c.monitoring.freeSpaceShortfallM3 != null && c.monitoring.freeSpaceShortfallM3 > 0) {
      advice.push(`the selected tanks are ${n(c.monitoring.freeSpaceShortfallM3, 1)} m³ short of holding `
        + `${n(c.header.bunkerQuantityMT, 1)} MT at the 85% limit — add another tank`);
    }
    if (c.monitoring.planCoversQuantity != null && Math.abs(c.monitoring.planCoversQuantity) > 0.5) {
      advice.push(`targets add up to ${signed(c.monitoring.planCoversQuantity, 1)} MT against the bunker quantity`);
    }
    if (c.header.density15 == null) advice.push('no density — enter density @15 °C to get quantities in MT');
    set('[data-bp-head="advice"]', advice.length
      ? `Check: ${advice.join('; ')}.`
      : `Trim ${n(c.header.trim, 2)} m (tables read at ${signed(c.header.trimByStern, 2)} by the stern) · `
        + `density ${n(c.header.density15, 4, '—')} @ ${n(c.header.tempC, 0)} °C`);

    for (const row of c.rows) {
      const i = row.slot - 1;
      for (const col of PLAN_COLUMNS) {
        set(`[data-bp-cell="${i}.${col.field}"]`, planCell(col.field, row[col.field]),
          row.warnings.length ? row.warnings.join(' · ') : '');
      }
      set(`[data-bp-cell="${i}.etaLabel"]`, row.tankId ? row.etaLabel : '');
      paintSoundingMethod(i, row);
      paintValveCell(i, row);
      const tr = document.querySelector(`tr[data-slot="${i}"]`);
      if (tr) {
        tr.classList.toggle('fr-warn', row.warnings.length > 0);
        tr.classList.toggle('bp-row-filling', row.status === 'filling');
        tr.classList.toggle('bp-row-done', row.status === 'done');
      }
    }
    for (const [field, d] of Object.entries({
      capacity100M3: 1, capacity85M3: 2, startingRobM3: 3, freeM3At85: 3,
      targetVolumeM3: 3, plannedAddMT: 3, currentVolumeM3: 3, receivedMT: 3,
      remainingToTargetMT: 3,
    })) {
      set(`[data-bp-total="${field}"]`, n(c.totals[field], d));
    }

    const gradeLabel = (FRCore.FUEL_TYPES.find((f) => f.id === c.header.fuelType) || {}).label || '';
    set('[data-bp-mon="receivedLabel"]', `${gradeLabel} RECEIVED`);
    set('[data-bp-mon="receivedMT"]', `${n(c.monitoring.receivedMT, 3)} MT`);
    set('[data-bp-mon="quantityRemainingMT"]', c.monitoring.quantityRemainingMT != null
      ? `${n(c.monitoring.quantityRemainingMT, 3)} MT` : '—');
    set('[data-bp-mon="timeRemainingLabel"]', c.monitoring.timeRemainingLabel);
    const openTanks = c.monitoring.tanksFilling;
    set('[data-bp-mon="progressText"]', (c.monitoring.percentComplete != null
      ? `${n(c.monitoring.percentComplete, 1)}% of ${n(c.header.bunkerQuantityMT, 1)} MT delivered`
      : 'Enter a bunker quantity to track progress')
      + (openTanks
        ? ` · ${openTanks} tank(s) taking fuel at ${n(c.monitoring.rateSharePerTank, 0)} MT/h each`
        : ' · no tank is open'));
    const fill = document.querySelector('[data-bp-mon="progressFill"]');
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, c.monitoring.percentComplete || 0))}%`;

    const clock = c.monitoring.clock;
    set('[data-bp-mon="elapsedLabel"]', clock.elapsedLabelLive || clock.elapsedLabel);
    const mon = c.monitoring;
    // Say which rate the finishing time is built on. A number worked out from
    // what has actually come aboard is worth more than the one agreed ashore,
    // but only once enough has come aboard to mean anything.
    set('[data-bp-mon="rateLabel"]', mon.effectiveRateMTPerHour > 0
      ? `${n(mon.effectiveRateMTPerHour, 1)} MT/h ${mon.rateSourceIsMeasured ? '(measured)' : '(planned)'}`
      : '—');
    refreshEstimates(c);
    refreshFinish(c);
    const startBox = document.getElementById('bp-start-at');
    if (startBox && document.activeElement !== startBox) {
      startBox.value = view.plan.startedAt ? localInputValue(view.plan.startedAt) : '';
    }
    set('[data-bp-mon="expectedMT"]', clock.expectedMT != null ? `${n(clock.expectedMT, 2)} MT` : '—');
    /* Only a variance once there is something to hold against the expected
       intake. Unsounded tanks make received read 0, and the difference then
       looks like the barge short-delivered the whole parcel. */
    set('[data-bp-mon="varianceMT"]',
      clock.varianceMT != null && mon.tanksSounded > 0 ? `${signed(clock.varianceMT, 2)} MT` : '—',
      mon.tanksSounded > 0
        ? `Against ${mon.tanksSounded} of ${mon.tanksFilling} open tank(s) sounded.`
        : 'No tank has been sounded yet — nothing to compare against the expected intake.');
    const toggle = document.getElementById('bp-clock-toggle');
    if (toggle) {
      /* A finished transfer must not still offer to pause itself. Reopening is
         offered instead, so a transfer finished by mistake — or one the barge
         resumes after a stoppage — is not stuck behind a Reset that would
         throw the pumping time away. */
      toggle.textContent = clock.completed ? 'Reopen transfer'
        : !clock.started ? 'Start pumping' : clock.paused ? 'Resume' : 'Pause';
      toggle.classList.toggle('primary', !clock.started || clock.paused);
    }
    const finish = document.getElementById('bp-finish');
    if (finish) {
      finish.disabled = clock.completed || !clock.started;
      finish.title = clock.completed ? 'The transfer is already finished.'
        : (!clock.started ? 'Start pumping first.' : '');
    }
  }

  /**
   * Open, hold or close one tank. Timing is per tank: a pause stops that tank's
   * own clock, closing it stops it for good, and reopening starts it fresh.
   */
  function setTankState(index, next) {
    const slot = view.plan.sequence[index];
    if (!slot || !slot.tankId) return;
    const nowIso = new Date().toISOString();

    if (next === 'filling') {
      if (slot.status === 'paused' && slot.pausedAt) {
        slot.elapsedPausedMs = (slot.elapsedPausedMs || 0)
          + Math.max(0, Date.now() - Date.parse(slot.pausedAt));
      }
      if (!slot.startedAt) slot.startedAt = nowIso;
      slot.pausedAt = null;
      slot.completedAt = null;
      slot.status = 'filling';
      slot.pausedWithOperation = false;
      // Opening a tank starts the overall pumping clock if it is not running.
      if (!view.plan.startedAt) {
        view.plan.startedAt = nowIso;
        view.plan.pausedAt = null;
        view.plan.elapsedPausedMs = 0;
        view.plan.status = 'pumping';
      }
      startClockTicker();
    } else if (next === 'paused') {
      slot.pausedAt = nowIso;
      slot.status = 'paused';
      // Shut by hand: resuming the operation must not reopen it.
      slot.pausedWithOperation = false;
    } else if (next === 'done') {
      if (slot.status === 'paused' && slot.pausedAt) {
        slot.elapsedPausedMs = (slot.elapsedPausedMs || 0)
          + Math.max(0, Date.now() - Date.parse(slot.pausedAt));
      }
      slot.pausedAt = null;
      slot.completedAt = nowIso;
      slot.status = 'done';
    } else {
      // Reopen — clear this tank's timing and put it back in the queue.
      slot.status = 'pending';
      slot.startedAt = null;
      slot.pausedAt = null;
      slot.elapsedPausedMs = 0;
      slot.completedAt = null;
    }
    refreshPlan();
  }

  /**
   * Pausing the transfer shuts the valves.
   *
   * The overall clock stopping while every tank still reads FILLING said the
   * pumps had stopped and the tanks were still taking fuel at the same time.
   * Every tank that was filling is paused with the operation, and each one is
   * marked so that resuming reopens exactly those — a tank the engineer had
   * already shut by hand stays shut.
   */
  function pauseTanksWithOperation(nowIso) {
    for (const slot of view.plan.sequence || []) {
      if (!slot || !slot.tankId || slot.status !== 'filling') continue;
      slot.pausedAt = nowIso;
      slot.status = 'paused';
      slot.pausedWithOperation = true;
    }
  }

  function resumeTanksPausedWithOperation(nowIso) {
    for (const slot of view.plan.sequence || []) {
      if (!slot || !slot.pausedWithOperation) continue;
      if (slot.status === 'paused' && slot.pausedAt) {
        slot.elapsedPausedMs = (slot.elapsedPausedMs || 0)
          + Math.max(0, Date.now() - Date.parse(slot.pausedAt));
      }
      slot.pausedAt = null;
      slot.status = 'filling';
      slot.pausedWithOperation = false;
    }
  }

  function bindPlanEvents(wrap) {
    wrap.addEventListener('input', (e) => {
      const el = e.target;
      if (el.dataset.slot != null && el.dataset.field) {
        const slot = view.plan.sequence[Number(el.dataset.slot)];
        if (slot) {
          slot[el.dataset.field] = el.value;
          if (el.dataset.field === 'currentSoundingMM') {
            // Anchor the estimate on this reading, in the tank's own running
            // hours so time spent shut is not counted as time taking fuel.
            const tc = Core.tankClock(slot);
            slot.currentSoundingAtElapsedH = tc.elapsedHours || 0;
            slot.currentSoundingAt = new Date().toISOString();
          }
        }
      } else if (el.dataset.head) {
        view.plan.header[el.dataset.head] = el.value;
      } else {
        return;
      }
      refreshPlan();
    });

    document.getElementById('bp-print-save').onclick = async () => {
      Branding.beginPrintHold();
      try {
        await saveChainPart('bunker-plan', 'bunkerPlan',
          { ...view.plan, updatedAt: new Date().toISOString() }, { snapshot: true, deferServer: true });
        UI.printHtml(planPrintPages(recomputePlan()));
      } catch (err) {
        Branding.endPrintHold();
        throw err;
      }
    };
    document.getElementById('bp-save').onclick = () => saveChainPart('bunker-plan', 'bunkerPlan',
      { ...view.plan, updatedAt: new Date().toISOString() });
    // Print without saving: no snapshot filed, nothing written to the vessel.
    document.getElementById('bp-print-only').onclick = () =>
      UI.printHtml(planPrintPages(recomputePlan()));
    document.getElementById('bp-menu').onclick = () => navigate('dashboard');
    document.getElementById('bp-new').onclick = () => {
      if (!confirm('Start a new plan? The current sequence and targets are cleared.')) return;
      view.pendingPlan = Core.emptyBunkerPlan(bundle(), view.conversion);
      navigate('bunker-plan');
    };
    // Valve buttons live inside cells that are repainted on every refresh, so
    // they are handled by delegation rather than bound per button.
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-valve]');
      if (!btn) return;
      setTankState(Number(btn.dataset.valve), btn.dataset.valveTo);
    });

    document.getElementById('bp-mode').onchange = (e) => { view.plan.distributionMode = e.target.value; };
    document.getElementById('bp-distribute').onclick = () => {
      const c = recomputePlan();
      const res = Core.distributeToSequence(bundle(), {
        mode: view.plan.distributionMode,
        fuelType: c.header.fuelType,
        quantityMT: c.header.bunkerQuantityMT,
        density15: c.header.density15,
        tempC: c.header.tempC,
      }, view.conversion);
      if (!res.sequence.length) {
        showToast(res.warnings[0] || 'Nothing to distribute');
        return;
      }
      const kept = view.plan.sequence.map((s) => s.currentSoundingMM);
      view.plan.sequence = view.plan.sequence.map((slot, i) => (
        res.sequence[i] ? { ...res.sequence[i], currentSoundingMM: kept[i] || '' }
          : { tankId: '', targetVolumeM3: '', currentSoundingMM: '' }
      ));
      view.pendingPlan = view.plan;
      navigate('bunker-plan');
      showToast(res.warnings.length ? res.warnings[0] : `Sequence filled — ${res.sequence.length} tank(s)`);
    };

    document.getElementById('bp-clock-toggle').onclick = () => {
      const clock = Core.pumpingClock(view.plan, 0, null);
      const nowIso = new Date().toISOString();
      if (clock.completed) {
        /* Reopen. The clock picks up exactly where it stopped: everything
           between finishing and reopening goes to the paused total, or the
           gap would be counted as time spent taking fuel and inflate the
           expected intake. It reopens held, and the tanks stay shut until
           somebody opens the ones that are taking fuel again. */
        view.plan.elapsedPausedMs = (view.plan.elapsedPausedMs || 0)
          + Math.max(0, Date.now() - Date.parse(view.plan.completedAt));
        view.plan.completedAt = null;
        view.plan.pausedAt = nowIso;
        view.plan.status = 'pumping';
      } else if (!clock.started) {
        view.plan.startedAt = nowIso;
        view.plan.pausedAt = null;
        view.plan.elapsedPausedMs = 0;
        view.plan.completedAt = null;
        view.plan.status = 'pumping';
      } else if (clock.paused) {
        view.plan.elapsedPausedMs = (view.plan.elapsedPausedMs || 0)
          + Math.max(0, Date.now() - Date.parse(view.plan.pausedAt));
        view.plan.pausedAt = null;
        resumeTanksPausedWithOperation(nowIso);
      } else {
        view.plan.pausedAt = nowIso;
        pauseTanksWithOperation(nowIso);
      }
      refreshPlan();
      startClockTicker();
    };
    /* Pumping usually starts before anyone reaches the tablet, so the start can
       be entered after the fact — from the barge's own log or the BDN — and the
       elapsed time, the measured rate and the finishing time all follow it. */
    document.getElementById('bp-start-at').onchange = (e) => {
      const v = e.target.value;
      if (!v) { view.plan.startedAt = null; view.plan.status = 'planning'; }
      else {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return;
        if (d.getTime() > Date.now() + 60000) {
          showToast('Pump start is in the future — check the time');
          return;
        }
        view.plan.startedAt = d.toISOString();
        view.plan.pausedAt = null;
        view.plan.status = 'pumping';
      }
      refreshPlan();
      startClockTicker();
    };
    document.getElementById('bp-clock-reset').onclick = () => {
      view.plan.startedAt = null;
      view.plan.pausedAt = null;
      view.plan.elapsedPausedMs = 0;
      view.plan.completedAt = null;
      view.plan.status = 'planning';
      refreshPlan();
      // A tank may still be taking fuel; its own clock keeps running, and the
      // ticker retires itself if nothing is.
      startClockTicker();
    };

    /**
     * Finish the transfer: shut every tank still open, stop the clock, and put
     * the sheet in front of the delivery note.
     *
     * A tank that took fuel and was never sounded is called out before
     * anything is closed. Closing it makes its intake unmeasurable — the level
     * is still in the tank, but the reading that would have caught a short
     * delivery is gone once the barge has cast off.
     */
    document.getElementById('bp-finish').onclick = () => {
      const c = recomputePlan();
      const open = c.rows.filter((r) => r.tankId && (r.status === 'filling' || r.status === 'paused'));
      const short = c.reconciliation.tanksUnsounded;
      const ask = short.length
        ? `Finish bunkering? ${short.join(', ')} took fuel and ${short.length > 1 ? 'have' : 'has'}`
          + ' no final sounding, so the received quantity will be short of the truth'
          + ' and cannot be held against the delivery note.'
        : `Finish bunkering? ${open.length} tank(s) will be closed and the pumping clock stopped.`;
      if (!confirm(ask)) return;

      const nowIso = new Date().toISOString();
      for (const slot of view.plan.sequence) {
        if (!slot.tankId || (slot.status !== 'filling' && slot.status !== 'paused')) continue;
        if (slot.status === 'paused' && slot.pausedAt) {
          slot.elapsedPausedMs = (slot.elapsedPausedMs || 0)
            + Math.max(0, Date.now() - Date.parse(slot.pausedAt));
        }
        slot.pausedAt = null;
        slot.pausedWithOperation = false;
        slot.completedAt = nowIso;
        slot.status = 'done';
      }
      if (view.plan.startedAt && view.plan.pausedAt) {
        view.plan.elapsedPausedMs = (view.plan.elapsedPausedMs || 0)
          + Math.max(0, Date.now() - Date.parse(view.plan.pausedAt));
        view.plan.pausedAt = null;
      }
      view.plan.completedAt = nowIso;
      view.plan.status = 'completed';
      refreshPlan();
      stopClockTicker();

      const panel = document.querySelector('.bp-finish');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const bdn = document.getElementById('bp-bdn');
      if (bdn && !bdn.value) setTimeout(() => bdn.focus(), 400);
    };

    /* Carry the delivery-note quantity across to the paperwork, without
       overwriting a figure already entered there. */
    document.getElementById('bp-to-summary').onclick = () => {
      const qty = view.plan.header.bdnQuantityMT;
      const current = Core.normalizeSummary(bundle(), bundle().bunkerSummary);
      if (qty !== '' && qty != null && (current.bdn.quantityMT === '' || current.bdn.quantityMT == null)) {
        view.pendingSummary = {
          ...current,
          bdn: { ...current.bdn, quantityMT: qty, fuelType: view.plan.header.fuelType || current.bdn.fuelType },
        };
        showToast(`BDN quantity ${qty} MT carried to the summary`);
      } else if (qty !== '' && qty != null && String(current.bdn.quantityMT) !== String(qty)) {
        showToast(`Summary already has ${current.bdn.quantityMT} MT on the BDN — left as it is`);
      }
      navigate('bunker-summary');
    };

    document.getElementById('bp-blend-toggle').onclick = (e) => {
      const box = document.getElementById('bp-blend');
      box.hidden = !box.hidden;
      e.target.textContent = box.hidden ? 'Show' : 'Hide';
    };
    document.getElementById('bp-mix-add').onclick = () => {
      const tb = document.querySelector('#bp-mix-table tbody');
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><input data-mix="label" value="Parcel"></td>
        <td><input data-mix="density15" type="number" step="any"></td>
        <td><input data-mix="quantityMT" type="number" step="any"></td>
        <td><input data-mix="tempC" type="number" step="any" value="15"></td>`;
      tb.appendChild(tr);
    };
    document.getElementById('bp-mix-calc').onclick = () => {
      const parts = [];
      document.querySelectorAll('#bp-mix-table tbody tr').forEach((tr) => {
        const get = (k) => (tr.querySelector(`[data-mix="${k}"]`) || {}).value;
        const dens = parseFloat(get('density15'));
        const mt = parseFloat(get('quantityMT'));
        if (!(dens > 0) || !(mt >= 0)) return;
        parts.push({ label: get('label') || '', density15: dens, quantityMT: mt, tempC: parseFloat(get('tempC')) || 15 });
      });
      const res = Core.blendFuels(parts, 'wcf');
      const box = document.getElementById('bp-mix-result');
      if (!res || !res.blendedDensity15) {
        box.innerHTML = '<div class="hint">Enter at least two parcels with a density and a quantity.</div>';
        return;
      }
      box.innerHTML = `<div class="bs-quantities">
          <div class="bp-monitor-box"><span>BLENDED DENSITY @15</span><b>${n(res.blendedDensity15, 4)}</b></div>
          <div class="bp-monitor-box"><span>TOTAL QUANTITY</span><b>${n(res.totalMT, 3)} MT</b></div>
          <div class="bp-monitor-box"><span>TOTAL VOL @15</span><b>${n(res.totalVol15, 2)} m³</b></div>
        </div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn small" id="bp-mix-use-density">Use as plan density</button>
          <button class="btn small" id="bp-mix-use-qty">Use total as bunker quantity</button>
        </div>`;
      document.getElementById('bp-mix-use-density').onclick = () => {
        view.plan.header.density15 = res.blendedDensity15;
        view.pendingPlan = view.plan;
        navigate('bunker-plan');
        showToast('Blended density applied to the plan');
      };
      document.getElementById('bp-mix-use-qty').onclick = () => {
        view.plan.header.bunkerQuantityMT = res.totalMT;
        view.pendingPlan = view.plan;
        navigate('bunker-plan');
        showToast('Total quantity applied to the plan');
      };
    };

    document.getElementById('bp-fill-85').onclick = () => {
      const c = recomputePlan();
      for (const row of c.rows) {
        if (!row.tankId) continue;
        view.plan.sequence[row.slot - 1].targetVolumeM3 = row.capacity85M3;
      }
      navigate('bunker-plan');
    };
    document.getElementById('bp-clear-current').onclick = () => {
      for (const slot of view.plan.sequence) slot.currentSoundingMM = '';
      navigate('bunker-plan');
    };

    bindHistory(wrap, 'plans', (entry) => {
      view.pendingPlan = entry.form;
      navigate('bunker-plan');
      showToast(entry.isDraft || entry.id === '__draft__' ? 'Draft loaded for editing' : 'Plan loaded');
    }, view.plan);
  }

  /* --------------------------------------------------------- plan print ---- */

  function planPrintPages(c) {
    const rows = c.rows.filter((r) => r.tankId).map((r) => `<tr>
      <td class="fr-print-name">${r.slot}. ${esc(r.name)}</td>
      <td>${n(r.capacity100M3, 1)}</td>
      <td>${n(r.capacity85M3, 2)}</td>
      <td>${n(r.startingUllageMM, 0)}</td>
      <td>${n(r.startingRobM3, 3)}</td>
      <td>${n(r.freeM3At85, 3)}</td>
      <td>${n(r.targetVolumeM3, 3)}</td>
      <td>${pct(r.targetVolumePercent)}</td>
      <td>${n(r.targetUllageMM, 0)}</td>
      <td>${n(r.planAddMT, 3)}</td>
      <td>${n(r.currentSoundingMM, 0)}</td>
      <td>${pct(r.currentVolumePercent)}</td>
      <td>${n(r.currentVolumeM3, 3)}</td>
      <td class="fr-print-weight">${n(r.quantityAddMT, 3)}</td>
      <td>${esc((Core.TANK_STATES.find((s) => s.id === r.status) || {}).label || '')}</td>
      <td>${esc(r.clock.elapsedLabel)}</td>
    </tr>`).join('');

    const t = c.totals;
    const gradeLabel = (FRCore.FUEL_TYPES.find((f) => f.id === c.header.fuelType) || {}).label || '';

    return `<section class="calib-print-page">
      ${UI.masthead('BUNKERING PLAN & MONITORING', `${c.vessel.name} · ${c.header.port || ''}`)}
      ${UI.metaGrid([
        ['Vessel', c.vessel.name],
        ['Voyage No.', c.header.voyageNo],
        ['Date', c.header.date],
        ['Port / place', c.header.port],
        ['Grade', `${gradeLabel}${c.header.fuelGrade ? ` · ${c.header.fuelGrade}` : ''}`],
        ['Bunker quantity', `${n(c.header.bunkerQuantityMT, 2, '—')} MT`],
        ['Delivery rate', `${n(c.header.deliveryRateMTPerHour, 1, '—')} MT/h`],
        ['Time to bunker', c.header.timeToBunkerLabel],
        ['Draft fwd / aft', `${n(c.header.draftFwd, 2)} / ${n(c.header.draftAft, 2)} m`],
        ['Mean draft', `${n(c.header.meanDraft, 2)} m`],
        ['Trim / heel', `${n(c.header.trim, 2)} m · ${c.header.heel}°`],
        ['Density @15 / temp', `${n(c.header.density15, 4, '—')} · ${n(c.header.tempC, 0)} °C`],
      ])}
      <h3 class="fr-print-h3">Loading sequence</h3>
      <table class="fr-print-table">
        <thead><tr>
          <th>Seq / tank</th><th>Cap 100% m³</th><th>Cap 85% m³</th><th>Start ullage mm</th>
          <th>Start ROB m³</th><th>Free m³ @85%</th><th>Target vol m³</th><th>Target %</th>
          <th>Target ullage</th><th>Plan add MT</th><th>Current sound mm</th><th>Current %</th>
          <th>Current m³</th><th>Quantity add MT</th><th>Valve</th><th>Time open</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="16">No tanks in the sequence</td></tr>'}</tbody>
        <tfoot><tr>
          <th>TOTAL</th>
          <td>${n(t.capacity100M3, 1)}</td><td>${n(t.capacity85M3, 2)}</td><td></td>
          <td>${n(t.startingRobM3, 3)}</td><td>${n(t.freeM3At85, 3)}</td>
          <td>${n(t.targetVolumeM3, 3)}</td><td></td><td></td><td>${n(t.plannedAddMT, 3)}</td>
          <td></td><td></td><td>${n(t.currentVolumeM3, 3)}</td>
          <td class="fr-print-weight">${n(t.receivedMT, 3)}</td>
          <td></td><td></td>
        </tr></tfoot>
      </table>
      <div class="fr-print-cols">
        <div>
          <h3 class="fr-print-h3">Monitoring</h3>
          <table class="fr-print-table"><tbody>
            <tr><td class="fr-print-name">Received</td><td>${n(c.monitoring.receivedMT, 3)} MT</td></tr>
            <tr><td class="fr-print-name">Quantity remaining</td><td>${n(c.monitoring.quantityRemainingMT, 3, '—')} MT</td></tr>
            <tr><td class="fr-print-name">Time remaining</td><td>${esc(c.monitoring.timeRemainingLabel)}</td></tr>
            <tr><td class="fr-print-name">Complete</td><td>${n(c.monitoring.percentComplete, 1, '—')}%</td></tr>
            <tr><td class="fr-print-name">Pumping time</td><td>${esc(c.monitoring.clock.elapsedLabel)}</td></tr>
            <tr><td class="fr-print-name">Expected at rate</td>
              <td>${n(c.monitoring.clock.expectedMT, 2, '—')} MT</td></tr>
            <tr><td class="fr-print-name">Measured − expected</td>
              <td>${c.monitoring.clock.varianceMT != null ? signed(c.monitoring.clock.varianceMT, 2) : '—'} MT</td></tr>
          </tbody></table>
        </div>
        <div>
          <h3 class="fr-print-h3">Capacity check</h3>
          <table class="fr-print-table"><tbody>
            <tr><td class="fr-print-name">Free space in sequence @85%</td><td>${n(t.freeM3At85, 3)} m³</td></tr>
            <tr><td class="fr-print-name">Plan add vs bunker quantity</td>
              <td>${signed(c.monitoring.planCoversQuantity, 2) || '—'} MT</td></tr>
            <tr><td class="fr-print-name">Space shortfall for quantity</td>
              <td>${c.monitoring.freeSpaceShortfallM3 != null ? signed(c.monitoring.freeSpaceShortfallM3, 2) : '—'} m³</td></tr>
          </tbody></table>
        </div>
        <div>
          <h3 class="fr-print-h3">Method</h3>
          <table class="fr-print-table"><tbody>
            <tr><td class="fr-print-name">Free @85%</td><td>85% capacity − starting ROB</td></tr>
            <tr><td class="fr-print-name">Target ullage</td><td>calibration table read backwards from the target volume</td></tr>
            <tr><td class="fr-print-name">Quantity add</td><td>(current volume − starting ROB) × VCF × WCF</td></tr>
            <tr><td class="fr-print-name">Time</td><td>quantity ÷ delivery rate</td></tr>
          </tbody></table>
        </div>
      </div>
      ${UI.printSignatureBlock()}
      ${UI.footer(`${c.vessel.name} · bunkering plan · ${c.header.date || ''}`)}
    </section>
    <section class="calib-print-page">
      ${UI.masthead('BEFORE BUNKERING', `${c.vessel.name} · ${c.header.date || ''}`)}
      ${c.before.sections.map((s) => UI.printSectionTable(s, c.before.options)).join('')}
      ${UI.printSignatureBlock()}
      ${UI.footer(`${c.vessel.name} · before bunkering`)}
    </section>`;
  }

  /* ====================================================== after bunkering ==== */

  function recomputeAfter() {
    view.computed = Core.computeAfterBunkering(bundle(), view.after, view.conversion);
    return view.computed;
  }

  async function renderAfter(main) {
    view.page = 'bunker-after';
    await loadConversion();
    const b = bundle();
    view.after = Core.normalizeAfterReport(b, view.pendingAfter || b.bunkerAfter, view.conversion);
    view.pendingAfter = null;
    const c = recomputeAfter();

    main.innerHTML += `<div class="page-head no-print">
      <div><h1>Tank Monitoring After Bunkering</h1>
        <div class="desc">Re-sound every tank; intake per grade is the difference against the ROB prior to bunkering</div></div>
      <div class="btn-row">
        <button class="btn" id="ba-get-data">GET DATA</button>
        <button class="btn primary" id="ba-print-save">PRINT &amp; SAVE</button>
        <button class="btn" id="ba-save">Save only</button>
        <button class="btn" id="ba-print-only">Print only</button>
        <button class="btn" id="ba-menu">MAIN MENU</button>
      </div></div>`;

    const wrap = document.createElement('div');
    wrap.className = 'fuel-report-page';
    wrap.innerHTML = `
      ${afterHeaderPanel()}
      ${c.sections.map((s) => UI.sheetTableHtml(s, view.after.rows)).join('')}
      ${afterGradesPanel(c)}
      <div class="form-panel no-print">
        <div class="section-title" style="margin-top:0">Saved after-bunkering reports</div>
        <p class="hint" style="margin-top:0">Drafts stay here for editing. Filed reports can be reprinted or loaded back into the form.</p>
        ${historyRows(bunkerHistory().after, 'after', view.after && view.after.updatedAt ? {
          form: view.after,
          voyageNo: view.after.header && view.after.header.voyageNo,
          port: view.after.header && view.after.header.port,
          savedAt: view.after.updatedAt,
        } : null)}
      </div>`;
    main.appendChild(wrap);

    bindAfterEvents(wrap);
    refreshAfter();
  }

  function afterHeaderPanel() {
    const h = view.after.header;
    const types = FRCore.REPORT_TYPES.map((t) =>
      `<option value="${esc(t)}" ${h.reportType === t ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const heels = FRCore.HEEL_OPTIONS.map((v) => {
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
        <label class="fr-field"><span>DRAFT AFT</span>
          <input type="number" step="any" data-head="draftAft" value="${esc(h.draftAft)}"></label>
        <label class="fr-field"><span>MEAN DRAFT</span>
          <output class="fr-out" data-ba-head="meanDraft"></output></label>
        <label class="fr-field"><span>TRIM</span>
          <output class="fr-out" data-ba-head="trim"></output></label>
        <label class="fr-field"><span>HEEL</span>
          <select data-head="heel">${heels}</select></label>
        <label class="fr-field"><span>ER TEMP.</span>
          <input type="number" step="any" data-head="engineRoomTemp" value="${esc(h.engineRoomTemp)}"></label>

        <label class="fr-field"><span>DATE</span>
          <input type="date" data-head="date" value="${esc(h.date)}"></label>
        <label class="fr-field"><span>TIME</span>
          <input type="time" data-head="time" value="${esc(h.time)}"></label>
        <label class="fr-field fr-field-wide"><span>PORT</span>
          <input data-head="port" value="${esc(h.port)}"></label>
        <label class="fr-field"><span>SW TEMP.</span>
          <input type="number" step="any" data-head="seaTemp" value="${esc(h.seaTemp)}"></label>
      </div>
      <div class="hint" data-ba-head="attitude"></div>
    </div>`;
  }

  function afterGradesPanel(c) {
    const cells = c.grades.map((g) => `
      <div class="fr-grade" data-grade="${g.id}">
        <div class="fr-grade-label">${esc(g.label)}</div>
        <label class="fr-field"><span>ROB PRIOR BUNKERING (MT)</span>
          <input type="number" step="any" data-prior="${g.id}" value="${esc(view.after.priorRob[g.id])}"></label>
        <div class="fr-grade-row"><span>TOTAL ADDED (MT)</span><b data-ba-grade="${g.id}.addedMT"></b></div>
        <div class="fr-grade-row"><span>TOTAL PRESENT (MT)</span><b data-ba-grade="${g.id}.presentMT"></b></div>
      </div>`).join('');
    return `<div class="form-panel no-print">
      <div class="section-title" style="margin-top:0">ROB prior bunkering → total added → present</div>
      <div class="fr-grades">${cells}</div>
      <p class="hint"><b>GET DATA</b> refills the prior-ROB column and the soundings from the saved fuel report.
        A negative "added" is consumption, not intake.</p>
    </div>`;
  }

  function refreshAfter() {
    const c = recomputeAfter();
    const set = UI.setCell;
    set('[data-ba-head="meanDraft"]', n(c.header.meanDraft, 2));
    set('[data-ba-head="trim"]', n(c.header.trim, 2));
    set('[data-ba-head="attitude"]',
      `Trim ${c.header.trimLabel} · heel ${c.header.heelLabel} — tables read at trim `
      + `${signed(c.header.trimByStern, 2)} m by the stern.`);
    UI.paintSectionCells(c.sections);
    for (const g of c.grades) {
      set(`[data-ba-grade="${g.id}.addedMT"]`, g.addedMT != null ? `${signed(g.addedMT, 3)}` : '—');
      set(`[data-ba-grade="${g.id}.presentMT"]`, n(g.presentMT, 3, '—'));
      const box = document.querySelector(`.fr-grade[data-grade="${g.id}"]`);
      if (box) {
        box.classList.toggle('fr-grade-empty', !g.tanks);
        box.classList.toggle('fr-grade-good', g.addedMT != null && g.addedMT > 0.001);
      }
    }
  }

  function bindAfterEvents(wrap) {
    UI.bindSectionMove(wrap, view.after.rows, () => {
      view.pendingAfter = view.after;
      navigate('bunker-after');
    });
    wrap.addEventListener('input', (e) => {
      const el = e.target;
      if (el.dataset.row && el.dataset.field) {
        const row = view.after.rows[el.dataset.row];
        if (!row) return;
        const moves = el.dataset.field === 'fuelType'
          && UI.sectionWouldChange(view.computed, row, el.dataset.row, el.value);
        row[el.dataset.field] = el.type === 'checkbox' ? el.checked : el.value;
        if (moves) {
          view.pendingAfter = view.after;
          navigate('bunker-after');
          showToast(`Moved to the ${UI.SECTION_SHORT[FRCore.sectionForFuelType(el.value)]} table`);
          return;
        }
      } else if (el.dataset.head) {
        view.after.header[el.dataset.head] = el.value;
      } else if (el.dataset.prior) {
        view.after.priorRob[el.dataset.prior] = el.value;
      } else {
        return;
      }
      refreshAfter();
    });

    document.getElementById('ba-get-data').onclick = async () => {
      const keep = confirm('Keep the soundings already entered here?\n\n'
        + 'OK — refresh only the ROB prior bunkering.\n'
        + 'Cancel — reload soundings from the fuel report as well.');
      try {
        const res = await Api.request(`/api/vessels/${STATE.activeVesselId}/bunker-after/get-data`,
          { method: 'POST', body: { keepSoundings: keep } });
        view.pendingAfter = res.form;
      } catch {
        // Offline: recompute the same thing locally.
        const base = Core.emptyAfterReport(bundle(), view.conversion);
        view.pendingAfter = keep ? { ...view.after, priorRob: base.priorRob } : base;
      }
      navigate('bunker-after');
      showToast('Data pulled from the fuel report');
    };
    document.getElementById('ba-print-save').onclick = async () => {
      Branding.beginPrintHold();
      try {
        await saveChainPart('bunker-after', 'bunkerAfter',
          { ...view.after, updatedAt: new Date().toISOString() }, { snapshot: true, deferServer: true });
        UI.printHtml(afterPrintPages(recomputeAfter()));
      } catch (err) {
        Branding.endPrintHold();
        throw err;
      }
    };
    document.getElementById('ba-save').onclick = () => saveChainPart('bunker-after', 'bunkerAfter',
      { ...view.after, updatedAt: new Date().toISOString() });
    document.getElementById('ba-print-only').onclick = () =>
      UI.printHtml(afterPrintPages(recomputeAfter()));
    document.getElementById('ba-menu').onclick = () => navigate('dashboard');

    bindHistory(wrap, 'after', (entry) => {
      view.pendingAfter = entry.form;
      navigate('bunker-after');
      showToast(entry.isDraft || entry.id === '__draft__' ? 'Draft loaded for editing' : 'After-bunkering report loaded');
    }, view.after);
  }

  function afterPrintPages(c) {
    const gradeRows = c.grades.filter((g) => g.tanks > 0 || g.priorMT != null).map((g) => `<tr>
      <td class="fr-print-name">${esc(g.label)}</td>
      <td>${n(g.priorMT, 3, '—')}</td>
      <td class="fr-print-weight">${signed(g.addedMT, 3) || '—'}</td>
      <td>${n(g.presentMT, 3, '—')}</td>
    </tr>`).join('');
    const gradeGroupRows = (FRCore.SECTIONS || []).map((sec) => {
      const members = (c.grades || []).filter((g) => (sec.grades || []).includes(g.id)
        && (g.tanks > 0 || g.priorMT != null || g.presentMT != null || g.addedMT != null));
      if (!members.length) return '';
      const prior = members.reduce((s, g) => s + (Number(g.priorMT) || 0), 0);
      const added = members.reduce((s, g) => s + (Number(g.addedMT) || 0), 0);
      const present = members.reduce((s, g) => s + (Number(g.presentMT) || 0), 0);
      const anyPrior = members.some((g) => g.priorMT != null);
      const anyAdded = members.some((g) => g.addedMT != null);
      const anyPresent = members.some((g) => g.presentMT != null);
      return `<tr>
        <th class="fr-print-name">${esc(sec.totalLabel || sec.shortLabel || sec.title)}</th>
        <td><b>${anyPrior ? n(prior, 3) : '—'}</b></td>
        <td class="fr-print-weight"><b>${anyAdded ? signed(added, 3) : '—'}</b></td>
        <td><b>${anyPresent ? n(present, 3) : '—'}</b></td>
      </tr>`;
    }).join('');

    /* Same face as Tank Condition: masthead facts put Mean Draft under the
       draft pair, and HFO/VLSFO vs MO/MGO/LSMGO each get their own table. */
    return `<section class="calib-print-page fr-tc-page">
      ${UI.printMasthead(c, { title: 'TANK CONDITION AFTER BUNKERING' })}
      ${c.sections.map((s) => UI.printConditionSection(s, c.options)).join('')}
      <div class="fr-tc-cards">
        <div class="fr-tc-card">
          <h4>ROB prior bunkering → received → present (MT)</h4>
          <table class="fr-tc-mini">
            <thead><tr><th>Grade</th><th>Prior</th><th>Added</th><th>Present</th></tr></thead>
            <tbody>${gradeRows || '<tr><td colspan="4">—</td></tr>'}</tbody>
            <tfoot>${gradeGroupRows}</tfoot>
          </table>
          <p class="calib-print-note">Added = present − ROB prior. HFO/VLSFO and MO/MGO/LSMGO totals stay separate.</p>
        </div>
      </div>
      <div class="fr-tc-signoff">
        ${UI.printSignatureBlock(c.signature && c.signature.preparedBy, c.signature && c.signature.rank)}
      </div>
      ${UI.footer(`${c.vessel.name} · after bunkering · ${c.header.dateTime}`)}
    </section>`;
  }

  /* ============================================================= summary ==== */

  function recomputeSummary() {
    view.computed = Core.computeBunkerSummary(bundle(), view.summary, null, view.conversion);
    return view.computed;
  }

  async function renderSummary(main) {
    view.page = 'bunker-summary';
    await loadConversion();
    const b = bundle();
    view.summary = Core.normalizeSummary(b, view.pendingSummary || b.bunkerSummary);
    view.pendingSummary = null;
    const c = recomputeSummary();

    main.innerHTML += `<div class="page-head no-print">
      <div><h1>Bunkering Report Summary</h1>
        <div class="desc">BDN paperwork, fuel onboard before and after, and the tanks after bunkering</div></div>
      <div class="btn-row">
        <button class="btn primary" id="bs-print-save">PRINT &amp; SAVE</button>
        <button class="btn" id="bs-save">Save only</button>
        <button class="btn" id="bs-print-only">Print only</button>
        <button class="btn" id="bs-new">NEW REPORT</button>
        <button class="btn" id="bs-menu">MAIN MENU</button>
      </div></div>`;

    const wrap = document.createElement('div');
    wrap.className = 'fuel-report-page';
    wrap.innerHTML = `
      ${summaryDetailsPanel(c)}
      ${summaryQuantitiesPanel(c)}
      <div class="form-panel no-print" style="margin-top:16px">
        <div class="section-title" style="margin-top:0">Tanks after bunkering</div>
        ${readOnlyTankTable(c.after)}
      </div>
      <div class="form-panel no-print">
        <div class="section-title" style="margin-top:0">Saved summaries</div>
        <p class="hint" style="margin-top:0">Saved drafts stay editable. Filed reports can be reprinted or loaded.</p>
        ${historyRows(bunkerHistory().summaries, 'summaries', view.summary && view.summary.updatedAt ? {
          form: view.summary,
          voyageNo: view.summary.voyageNo,
          port: view.summary.port,
          savedAt: view.summary.updatedAt,
        } : null)}
      </div>`;
    main.appendChild(wrap);

    bindSummaryEvents(wrap);
    refreshSummary();
  }

  function summaryDetailsPanel(c) {
    const f = view.summary;
    const eventRows = Core.SUMMARY_EVENTS.map((e) => `
      <div class="bs-event">
        <span>${esc(e.label)}</span>
        <input type="date" data-event="${e.id}.date" value="${esc(f.events[e.id].date)}">
        <input type="time" data-event="${e.id}.time" value="${esc(f.events[e.id].time)}">
      </div>`).join('');
    const conditions = Core.SHIP_CONDITIONS.map((s) => `
      <label class="bs-check"><input type="radio" name="bs-condition" value="${s.id}"
        ${f.shipCondition === s.id ? 'checked' : ''}> ${esc(s.label)}</label>`).join('');
    const grades = Core.COMMON_FUEL_GRADES.map((g) => `<option value="${esc(g)}"></option>`).join('');

    return `<div class="form-panel no-print">
      <div class="bs-grid">
        <div>
          <div class="section-title" style="margin-top:0">Vessel &amp; call</div>
          <div class="fr-quant">
            <label class="fr-field"><span>VESSEL</span>
              <output class="fr-out">${esc(c.vessel.name)}</output></label>
            <label class="fr-field"><span>VOYAGE NO.</span>
              <input data-sum="voyageNo" value="${esc(f.voyageNo)}"></label>
            <label class="fr-field"><span>DATE</span>
              <input type="date" data-sum="date" value="${esc(f.date)}"></label>
            <label class="fr-field fr-field-wide"><span>PORT / PLACE</span>
              <input data-sum="port" value="${esc(f.port)}"></label>
          </div>
          <div class="section-title">Times</div>
          <div class="bs-events">${eventRows}</div>
          <div class="hint" data-bs="timing"></div>
        </div>
        <div>
          <div class="section-title" style="margin-top:0">Delivery</div>
          <div class="fr-quant">
            <label class="fr-field"><span>BARGE NAME</span>
              <input data-sum="bargeName" value="${esc(f.bargeName)}"></label>
            <label class="fr-field"><span>SUPPLIER</span>
              <input data-sum="supplier" value="${esc(f.supplier)}"></label>
            <label class="fr-field"><span>FUEL GRADE</span>
              <input list="bs-grades" data-sum="fuelGrade" value="${esc(f.fuelGrade)}">
              <datalist id="bs-grades">${grades}</datalist></label>
            <label class="fr-field"><span>B.D.N. / B.D.R.</span>
              <input data-sum="bdnNumber" value="${esc(f.bdnNumber)}"></label>
          </div>
          <div class="section-title">Condition &amp; samples</div>
          <div class="bs-checks">
            <div class="bs-check-group"><span>SHIP'S CONDITION</span>${conditions}</div>
            <label class="bs-check"><input type="checkbox" data-sum="letterOfProtest"
              ${f.letterOfProtest ? 'checked' : ''}> LETTER OF PROTEST ISSUED</label>
            <label class="bs-check"><input type="checkbox" data-sum="samplesGiven"
              ${f.samplesGiven ? 'checked' : ''}> SAMPLE/S GIVEN FOR ANALYSIS</label>
          </div>
          <label class="fr-field" style="margin-top:10px"><span>REMARKS</span>
            <textarea data-sum="remarks" rows="3">${esc(f.remarks)}</textarea></label>
        </div>
      </div>
    </div>`;
  }

  function summaryQuantitiesPanel(c) {
    const f = view.summary;
    const lubes = FRCore.LUBE_FIELDS.map((l) => `
      <label class="fr-field"><span>${esc(l.label)}</span>
        <input type="number" step="any" data-lube="${l.id}" value="${esc(f.lubes[l.id])}"></label>`).join('');
    const fuelRows = c.fuelOnboard.map((g) => `<tr>
      <td class="fr-tank-name">${esc(g.label)}</td>
      <td data-bs-fuel="${g.id}.previousMT"></td>
      <td data-bs-fuel="${g.id}.receivedMT"></td>
      <td data-bs-fuel="${g.id}.presentMT"></td>
    </tr>`).join('');
    const bdnGrades = FRCore.FUEL_TYPES.map((t) =>
      `<option value="${t.id}" ${f.bdn.fuelType === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('');

    return `<div class="form-panel no-print" style="margin-top:16px">
      <div class="bs-grid">
        <div>
          <div class="section-title" style="margin-top:0">Fuel remaining onboard (MT)</div>
          <div class="scroll-x"><table class="fr-sheet">
            <thead><tr><th>GRADE</th><th>PREVIOUS</th><th>RECEIVED</th><th>PRESENT</th></tr></thead>
            <tbody>${fuelRows}</tbody>
          </table></div>
          <p class="hint">Straight from the after-bunkering report — previous is the ROB prior to bunkering.</p>
          <div class="section-title">Lubes remaining onboard</div>
          <div class="fr-quant">${lubes}</div>
        </div>
        <div>
          <div class="section-title" style="margin-top:0">Bunker details (BDN)</div>
          <div class="fr-quant">
            <label class="fr-field"><span>GRADE</span>
              <select data-bdn="fuelType">${bdnGrades}</select></label>
            <label class="fr-field"><span>QUANTITY (MT)</span>
              <input type="number" step="any" data-bdn="quantityMT" value="${esc(f.bdn.quantityMT)}"></label>
            <label class="fr-field"><span>SULPHUR (%)</span>
              <input type="number" step="any" data-bdn="sulphurPercent" value="${esc(f.bdn.sulphurPercent)}"></label>
            <label class="fr-field"><span>DENSITY @15°</span>
              <input type="number" step="any" data-bdn="density15" value="${esc(f.bdn.density15)}"></label>
          </div>
          <div class="bs-quantities">
            <div class="bp-monitor-box"><span>BDN QUANTITY</span><b data-bs="bdnQuantityMT"></b></div>
            <div class="bp-monitor-box"><span>RECEIVED QUANTITY</span><b data-bs="receivedQuantityMT"></b></div>
            <div class="bp-monitor-box" id="bs-diff-box"><span>DIFFERENCE</span><b data-bs="differenceMT"></b></div>
          </div>
          <div class="hint" data-bs="difference-note"></div>
        </div>
      </div>
    </div>`;
  }

  function refreshSummary() {
    const c = recomputeSummary();
    const set = UI.setCell;

    for (const g of c.fuelOnboard) {
      set(`[data-bs-fuel="${g.id}.previousMT"]`, n(g.previousMT, 3, '—'));
      set(`[data-bs-fuel="${g.id}.receivedMT"]`, g.receivedMT != null ? signed(g.receivedMT, 3) : '—');
      set(`[data-bs-fuel="${g.id}.presentMT"]`, n(g.presentMT, 3, '—'));
    }
    set('[data-bs="bdnQuantityMT"]', n(c.quantities.bdnQuantityMT, 3, '—'));
    set('[data-bs="receivedQuantityMT"]', n(c.quantities.receivedQuantityMT, 3, '—'));
    set('[data-bs="differenceMT"]', c.quantities.differenceMT != null
      ? signed(c.quantities.differenceMT, 3) : '—');

    const diff = c.quantities.differencePercent;
    // Say which half of the comparison is missing. "Enter a BDN quantity" was
    // wrong advice when the BDN was already in and the soundings were not.
    const pending = c.quantities.pendingReason === 'no-bdn'
      ? 'Enter the BDN quantity to compare it with what the tanks show.'
      : 'Waiting on the after-bunkering soundings for this grade — no measured '
        + 'figure to compare the BDN against yet.';
    set('[data-bs="difference-note"]', diff != null
      ? `${signed(diff, 3)}% against the BDN figure — ${Math.abs(diff) > 0.5
        ? 'outside the 0.5% normally accepted; consider a letter of protest'
        : 'within the 0.5% normally accepted'}.`
      : pending);
    const box = document.getElementById('bs-diff-box');
    if (box) box.classList.toggle('bp-monitor-bad', diff != null && Math.abs(diff) > 0.5);

    set('[data-bs="timing"]', `Pumping ${c.timing.pumpingLabel} · alongside ${c.timing.alongsideLabel}`
      + (c.timing.averageRateMTPerHour != null
        ? ` · average rate ${n(c.timing.averageRateMTPerHour, 1)} MT/h` : '')
      + ((c.timing.warnings || []).length ? ` · ${c.timing.warnings.join(' ')}` : ''));
  }

  function bindSummaryEvents(wrap) {
    const apply = (el) => {
      if (el.dataset.sum) {
        view.summary[el.dataset.sum] = el.type === 'checkbox' ? el.checked : el.value;
      } else if (el.dataset.event) {
        const [id, field] = el.dataset.event.split('.');
        view.summary.events[id][field] = el.value;
      } else if (el.dataset.lube) {
        view.summary.lubes[el.dataset.lube] = el.value;
      } else if (el.dataset.bdn) {
        view.summary.bdn[el.dataset.bdn] = el.value;
      } else if (el.name === 'bs-condition') {
        view.summary.shipCondition = el.value;
      } else {
        return false;
      }
      return true;
    };
    wrap.addEventListener('input', (e) => { if (apply(e.target)) refreshSummary(); });
    wrap.addEventListener('change', (e) => { if (apply(e.target)) refreshSummary(); });

    document.getElementById('bs-print-save').onclick = async () => {
      Branding.beginPrintHold();
      try {
        await saveChainPart('bunker-summary', 'bunkerSummary',
          { ...view.summary, updatedAt: new Date().toISOString() }, { snapshot: true, deferServer: true });
        UI.printHtml(summaryPrintPages(recomputeSummary()));
      } catch (err) {
        Branding.endPrintHold();
        throw err;
      }
    };
    document.getElementById('bs-save').onclick = () => saveChainPart('bunker-summary', 'bunkerSummary',
      { ...view.summary, updatedAt: new Date().toISOString() });
    document.getElementById('bs-print-only').onclick = () =>
      UI.printHtml(summaryPrintPages(recomputeSummary()));
    document.getElementById('bs-menu').onclick = () => navigate('dashboard');
    document.getElementById('bs-new').onclick = () => {
      if (!confirm('Start a new summary? The current paperwork is cleared.')) return;
      view.pendingSummary = Core.emptySummary(bundle());
      navigate('bunker-summary');
    };

    bindHistory(wrap, 'summaries', (entry) => {
      view.pendingSummary = entry.form;
      navigate('bunker-summary');
      showToast(entry.isDraft || entry.id === '__draft__' ? 'Draft loaded for editing' : 'Summary loaded');
    }, view.summary);
  }

  /** Fuel onboard split into HFO/VLSFO and MO/MGO/LSMGO tables (Tank Condition style). */
  function fuelOnboardSectionHtml(c) {
    return (FRCore.SECTIONS || []).map((sec) => {
      const members = (c.fuelOnboard || []).filter((g) => (sec.grades || []).includes(g.id));
      const rows = members.map((g) => `<tr>
        <td class="fr-print-name">${esc(g.label)}</td>
        <td>${n(g.previousMT, 3, '—')}</td>
        <td>${g.receivedMT != null ? signed(g.receivedMT, 3) : '—'}</td>
        <td class="fr-print-weight">${n(g.presentMT, 3, '—')}</td>
      </tr>`).join('');
      const prev = members.reduce((s, g) => s + (Number(g.previousMT) || 0), 0);
      const recv = members.reduce((s, g) => s + (Number(g.receivedMT) || 0), 0);
      const present = members.reduce((s, g) => s + (Number(g.presentMT) || 0), 0);
      const anyPrev = members.some((g) => g.previousMT != null);
      const anyRecv = members.some((g) => g.receivedMT != null);
      const anyPresent = members.some((g) => g.presentMT != null);
      return `<section class="fr-tc-block">
        <div class="fr-tc-block-head">
          <h3>${esc(sec.title)}</h3>
          <span>${members.length} grade${members.length === 1 ? '' : 's'}</span>
        </div>
        <table class="fr-tc-table">
          <thead><tr><th class="fr-print-name">Grade</th><th>Previous</th><th>Received</th><th>Present MT</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4">—</td></tr>'}</tbody>
          <tfoot><tr>
            <th class="fr-print-name">${esc(sec.totalLabel || 'TOTAL')}</th>
            <td><b>${anyPrev ? n(prev, 3) : '—'}</b></td>
            <td><b>${anyRecv ? signed(recv, 3) : '—'}</b></td>
            <td class="fr-tc-total-mt"><b>${anyPresent ? n(present, 3) : '—'}</b></td>
          </tr></tfoot>
        </table>
      </section>`;
    }).join('');
  }

  /** Tank Condition face for before/after sheets attached to the summary pack. */
  function summaryConditionPage(computed, title, note) {
    if (!computed || !computed.sections || !computed.sections.length) {
      return `<section class="calib-print-page fr-tc-page">
        ${UI.masthead(title, `${cVessel(computed)} · ${esc((computed && computed.header && computed.header.date) || '')}`)}
        <p class="calib-print-note">${esc(note || 'No tank condition recorded for this stage.')}</p>
        ${UI.printSignatureBlock()}
        ${UI.footer(title)}
      </section>`;
    }
    return `<section class="calib-print-page fr-tc-page">
      ${UI.printMasthead(computed, { title })}
      ${computed.sections.map((s) => UI.printConditionSection(s, computed.options)).join('')}
      <p class="calib-print-note">${esc(note || '')}</p>
      <div class="fr-tc-signoff">
        ${UI.printSignatureBlock(computed.signature && computed.signature.preparedBy, computed.signature && computed.signature.rank)}
      </div>
      ${UI.footer(`${computed.vessel && computed.vessel.name ? computed.vessel.name : ''} · ${title}`)}
    </section>`;
  }

  function cVessel(computed) {
    return (computed && computed.vessel && computed.vessel.name) || '';
  }

  function summaryPrintPages(c) {
    const eventRows = c.eventLabels.map((e) => {
      const v = c.events[e.id] || {};
      return `<tr><td class="fr-print-name">${esc(e.label)}</td>
        <td>${esc(v.date || '—')}</td><td>${esc(v.time || '—')}</td></tr>`;
    }).join('');

    const lubeRows = FRCore.LUBE_FIELDS.map((l) => `<tr>
      <td class="fr-print-name">${esc(l.label)}</td>
      <td>${n(c.lubes[l.id], 2, '—')}</td>
    </tr>`).join('');

    const cover = `<section class="calib-print-page fr-tc-page">
      ${UI.masthead('BUNKERING REPORT SUMMARY', `${c.vessel.name} · ${c.port || ''}`)}
      ${UI.metaGrid([
        ['Vessel', c.vessel.name],
        ['Voyage No.', c.voyageNo],
        ['Date', c.date],
        ['Port / place', c.port],
        ['Barge', c.bargeName],
        ['Supplier', c.supplier],
        ['Fuel grade', c.fuelGrade],
        ['B.D.N. / B.D.R.', c.bdnNumber],
        ["Ship's condition", (Core.SHIP_CONDITIONS.find((s) => s.id === c.shipCondition) || {}).label || '—'],
        ['Letter of protest', c.letterOfProtest ? 'YES' : 'NO'],
        ['Samples for analysis', c.samplesGiven ? 'YES' : 'NO'],
        ['Pumping / alongside', `${c.timing.pumpingLabel} / ${c.timing.alongsideLabel}`],
      ])}
      <div class="fr-print-cols">
        <div>
          <h3 class="fr-print-h3">Times</h3>
          <table class="fr-print-table">
            <thead><tr><th>Event</th><th>Date</th><th>Time</th></tr></thead>
            <tbody>${eventRows}</tbody>
          </table>
          <h3 class="fr-print-h3">Lubes remaining onboard</h3>
          <table class="fr-print-table"><tbody>${lubeRows}</tbody></table>
        </div>
        <div>
          <h3 class="fr-print-h3">Bunker details (BDN)</h3>
          <table class="fr-print-table"><tbody>
            <tr><td class="fr-print-name">Grade</td><td>${esc(c.bdn.label)}</td></tr>
            <tr><td class="fr-print-name">Quantity</td><td>${n(c.bdn.quantityMT, 3, '—')} MT</td></tr>
            <tr><td class="fr-print-name">Sulphur</td><td>${n(c.bdn.sulphurPercent, 3, '—')} %</td></tr>
            <tr><td class="fr-print-name">Density @15°</td><td>${n(c.bdn.density15, 4, '—')}</td></tr>
          </tbody></table>
          <h3 class="fr-print-h3">BDN vs measured</h3>
          <table class="fr-print-table"><tbody>
            <tr><td class="fr-print-name">BDN quantity</td><td>${n(c.quantities.bdnQuantityMT, 3, '—')} MT</td></tr>
            <tr><td class="fr-print-name">Received quantity</td><td>${n(c.quantities.receivedQuantityMT, 3, '—')} MT</td></tr>
            <tr><td class="fr-print-name">Difference</td>
              <td class="fr-print-weight">${c.quantities.differenceMT != null ? signed(c.quantities.differenceMT, 3) : '—'} MT
              ${c.quantities.differencePercent != null ? `(${signed(c.quantities.differencePercent, 3)}%)` : ''}</td></tr>
            <tr><td class="fr-print-name">Average rate</td>
              <td>${n(c.timing.averageRateMTPerHour, 1, '—')} MT/h</td></tr>
          </tbody></table>
        </div>
      </div>
      <h3 class="fr-print-h3">Fuel remaining onboard (MT)</h3>
      <p class="calib-print-note">HFO/VLSFO and MO/MGO/LSMGO are totalled in separate tables — same face as Tank Condition.</p>
      ${fuelOnboardSectionHtml(c)}
      <h3 class="fr-print-h3">Remarks</h3>
      <p class="calib-print-note">${esc(c.remarks || '—')}</p>
      ${UI.printSignatureBlock()}
      ${UI.footer(`${c.vessel.name} · bunkering summary · ${c.date || ''}`)}
    </section>`;

    const beforePage = summaryConditionPage(
      c.before,
      'TANK CONDITION BEFORE BUNKERING',
      'ROB prior to the delivery — from the fuel oil report (or bunker plan before sheet).',
    );
    const afterPage = summaryConditionPage(
      c.after,
      'TANK CONDITION AFTER BUNKERING',
      'Tank condition as measured after the delivery — same figures as the after-bunkering report.',
    );

    return cover + beforePage + afterPage;
  }

  return {
    renderPlan,
    renderAfter,
    renderSummary,
    planPrintPages,
    afterPrintPages,
    summaryPrintPages,
    view,
  };
})();

window.BunkerReports = BunkerReports;
