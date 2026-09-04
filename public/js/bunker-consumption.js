/* Bunker Consumption Calculation — Tank Chief
 * Same layout, controls, printout and saved-history behaviour as Voyage Chief / ChEng AIO.
 * Separate from bunkering "Bunker Plan" (BunkerReports). */
const BunkerConsumption = (function () {
  const SIDES = [
    {
      key: 'residual',
      title: 'HFO / VLSFO',
      grades: ['HFO', 'VLSFO'],
      aliases: ['LSFO'],
      defaultGrade: 'HFO',
      qtyLabel: 'HFO/VLSFO',
    },
    {
      key: 'distillate',
      title: 'MO / MGO / LSMGO',
      grades: ['MO/MGO', 'LSMGO'],
      aliases: ['MDO/MGO', 'MDO', 'MGO'],
      defaultGrade: 'MO/MGO',
      qtyLabel: 'MO/MGO/LSMGO',
    },
  ];
  const MAX_LEGS = 10;

  function emptyLeg() {
    return { port: false, from: '', to: '', distance: null, speed: null, dailyCons: null, days: null };
  }
  function emptySide(grade) {
    return {
      grade,
      legs: Array.from({ length: MAX_LEGS }, () => emptyLeg()),
      currentRob: null,
      marginPct: 20,
      qtyReceive: null,
    };
  }
  function defaultPlan() {
    return { voyageNo: '', date: '', residual: emptySide('HFO'), distillate: emptySide('MO/MGO') };
  }

  /** Keep saved plans readable after LSFO / MDO/MGO label renames. */
  function normalizeGradeLabel(grade, meta) {
    const g = String(grade || '').trim();
    if (meta.grades.includes(g)) return g;
    if (meta.key === 'residual') {
      if (/^lsfo$/i.test(g) || /^vlsfo$/i.test(g)) return 'VLSFO';
    }
    if (meta.key === 'distillate') {
      if (/^(mdo\/?mgo|mdo|mgo|mo\/?mgo)$/i.test(g)) return 'MO/MGO';
    }
    if ((meta.aliases || []).includes(g)) {
      return normalizeGradeLabel(meta.key === 'residual' ? 'VLSFO' : 'MO/MGO', meta);
    }
    return meta.defaultGrade;
  }

  function ensurePlan(plan) {
    if (!plan || typeof plan !== 'object') plan = defaultPlan();
    SIDES.forEach((meta) => {
      if (!plan[meta.key]) plan[meta.key] = emptySide(meta.defaultGrade);
      const s = plan[meta.key];
      if (!Array.isArray(s.legs)) s.legs = [];
      while (s.legs.length < MAX_LEGS) s.legs.push(emptyLeg());
      s.legs = s.legs.slice(0, MAX_LEGS).map((leg) => ({
        port: !!leg.port,
        from: leg.from || '',
        to: leg.to || '',
        distance: leg.distance ?? null,
        speed: leg.speed ?? null,
        dailyCons: leg.dailyCons ?? null,
        days: leg.days ?? null,
      }));
      s.grade = normalizeGradeLabel(s.grade, meta);
      if (s.marginPct == null || s.marginPct === '') s.marginPct = 20;
    });
    return plan;
  }

  function legDays(leg) {
    if (leg.port) return (leg.days != null && !isNaN(leg.days)) ? Number(leg.days) : null;
    if (leg.days != null && leg.days !== '' && !isNaN(leg.days)) return Number(leg.days);
    const d = Number(leg.distance);
    const s = Number(leg.speed);
    if (d > 0 && s > 0) return d / (s * 24);
    return null;
  }
  function legQty(leg) {
    const days = legDays(leg);
    const daily = Number(leg.dailyCons);
    if (days == null || !(daily >= 0) || isNaN(daily)) return null;
    return daily * days;
  }
  function summarize(side) {
    let daysPort = 0;
    let daysSea = 0;
    let totalDist = 0;
    let totalCons = 0;
    (side.legs || []).forEach((leg) => {
      const days = legDays(leg);
      const qty = legQty(leg);
      const dist = Number(leg.distance);
      if (dist > 0) totalDist += dist;
      if (days != null) {
        if (leg.port) daysPort += days;
        else daysSea += days;
      }
      if (qty != null) totalCons += qty;
    });
    const mp = Number(side.marginPct);
    const margin = !isNaN(mp) ? totalCons * (mp / 100) : 0;
    const required = totalCons + margin;
    const rob = (side.currentRob != null && side.currentRob !== '' && !isNaN(side.currentRob))
      ? Number(side.currentRob) : null;
    const receive = (side.qtyReceive != null && side.qtyReceive !== '' && !isNaN(side.qtyReceive))
      ? Number(side.qtyReceive) : 0;
    const arrivalRob = rob == null ? null : rob - required;
    const nextDepRob = arrivalRob == null ? null : arrivalRob + receive;
    const stem = rob == null ? null : Math.max(0, required - rob - receive);
    return { daysPort, daysSea, totalDist, totalCons, margin, required, arrivalRob, nextDepRob, stem, receive };
  }

  function autoFillSeaDays(leg) {
    if (leg.port) return;
    const dist = Number(leg.distance);
    const spd = Number(leg.speed);
    if (dist > 0 && spd > 0) leg.days = Math.round((dist / (spd * 24)) * 1000) / 1000;
  }

  function tankRobByGrade() {
    const rob = {};
    try {
      const fuelTanks = STATE.bundle?.tanks?.fuel || [];
      for (const t of fuelTanks) {
        const r = getReading(t.id);
        const wt = r?.result?.weightMT;
        if (wt != null && wt > 0) {
          const grade = t.fuelGrade || 'Unknown';
          rob[grade] = (rob[grade] || 0) + wt;
        }
      }
    } catch (_) { /* ignore */ }
    return rob;
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function fmtN(v, d) {
    return v == null || v === '' || isNaN(v) ? '—' : Number(v).toFixed(d ?? 2);
  }
  function fmtFuel(v) {
    return v == null || v === '' || isNaN(v) ? '—' : Number(v).toFixed(3);
  }

  let _plan = null;
  let _saveTimer = null;
  let _host = null;

  function store() {
    if (!STATE.bundle) return null;
    if (!STATE.bundle.bunkerConsumption || typeof STATE.bundle.bunkerConsumption !== 'object') {
      STATE.bundle.bunkerConsumption = { plan: defaultPlan(), history: [] };
    }
    if (!Array.isArray(STATE.bundle.bunkerConsumption.history)) {
      STATE.bundle.bunkerConsumption.history = [];
    }
    return STATE.bundle.bunkerConsumption;
  }

  function getPlan() {
    const st = store();
    _plan = ensurePlan(st ? st.plan : null);
    if (st) st.plan = _plan;
    return _plan;
  }

  async function persistNow() {
    const st = store();
    if (!st || !STATE.activeVesselId) return;
    st.plan = JSON.parse(JSON.stringify(_plan));
    try {
      await persistPart('bunkerConsumption', st);
    } catch (err) {
      console.warn('bunkerConsumption persist', err);
    }
  }

  function scheduleSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => { persistNow().catch(() => {}); }, 400);
  }

  function readFromDom(plan) {
    const voyEl = document.getElementById('bc_voyageNo');
    const dateEl = document.getElementById('bc_date');
    if (voyEl) plan.voyageNo = voyEl.value.trim();
    if (dateEl) plan.date = dateEl.value;
    SIDES.forEach((meta) => {
      const side = plan[meta.key];
      const gradeSel = document.querySelector(`select[data-bc-grade="${meta.key}"]`);
      if (gradeSel) side.grade = gradeSel.value;
      document.querySelectorAll(`input[data-bc-sf][data-bc-side="${meta.key}"]`).forEach((inp) => {
        const f = inp.dataset.bcSf;
        const v = inp.value === '' ? null : parseFloat(inp.value);
        side[f] = (f === 'marginPct')
          ? (v == null || isNaN(v) ? 20 : v)
          : (v == null || isNaN(v) ? null : v);
      });
      side.legs.forEach((leg, i) => {
        const tr = document.querySelector(`tr[data-bc-side="${meta.key}"][data-bc-row="${i}"]`);
        if (!tr) return;
        const port = tr.querySelector('[data-f="port"]');
        leg.port = !!(port && port.checked);
        ['from', 'to'].forEach((f) => {
          const el = tr.querySelector(`[data-f="${f}"]`);
          if (el) leg[f] = el.value;
        });
        ['distance', 'speed', 'dailyCons', 'days'].forEach((f) => {
          const el = tr.querySelector(`[data-f="${f}"]`);
          if (!el) return;
          const v = el.value === '' ? null : parseFloat(el.value);
          leg[f] = (v == null || isNaN(v)) ? null : v;
        });
      });
    });
    return plan;
  }

  function renderGrid(plan) {
    const grid = document.getElementById('bcGrid');
    if (!grid) return;
    const v = document.getElementById('bc_vessel');
    const voyEl = document.getElementById('bc_voyageNo');
    const dateEl = document.getElementById('bc_date');
    if (v) v.value = vesselName();
    if (voyEl && document.activeElement !== voyEl) {
      if (!plan.voyageNo) plan.voyageNo = STATE.bundle?.voyage?.voyageNo || '';
      voyEl.value = plan.voyageNo || '';
    }
    if (dateEl && document.activeElement !== dateEl) {
      if (!plan.date) plan.date = new Date().toISOString().slice(0, 10);
      dateEl.value = plan.date || '';
    }

    grid.innerHTML = SIDES.map((meta) => {
      const side = plan[meta.key];
      const sum = summarize(side);
      const gradeOpts = meta.grades
        .map((g) => `<option value="${g}" ${side.grade === g ? 'selected' : ''}>${g}</option>`)
        .join('');
      const rows = side.legs.map((leg, i) => {
        const days = legDays(leg);
        const qty = legQty(leg);
        return `<tr data-bc-side="${meta.key}" data-bc-row="${i}">
          <td class="col-port"><input type="checkbox" data-f="port" ${leg.port ? 'checked' : ''} title="Port or anchorage stay"></td>
          <td class="col-from"><input type="text" data-f="from" value="${esc(leg.from)}" placeholder="From" autocomplete="off"></td>
          <td class="col-to"><input type="text" data-f="to" value="${esc(leg.to)}" placeholder="To" autocomplete="off"></td>
          <td class="col-num"><input type="number" step="0.1" data-f="distance" value="${leg.distance ?? ''}" ${leg.port ? 'disabled' : ''} inputmode="decimal"></td>
          <td class="col-num"><input type="number" step="0.1" data-f="speed" value="${leg.speed ?? ''}" ${leg.port ? 'disabled' : ''} inputmode="decimal"></td>
          <td class="col-num"><input type="number" step="0.01" data-f="dailyCons" value="${leg.dailyCons ?? ''}" inputmode="decimal"></td>
          <td class="col-num"><input type="number" step="0.001" data-f="days" value="${days ?? ''}" inputmode="decimal"></td>
          <td class="col-qty"><input type="number" readonly tabindex="-1" value="${qty == null ? '' : fmtFuel(qty)}"></td>
        </tr>`;
      }).join('');
      return `<div class="bunker-side" data-bc-side="${meta.key}">
        <h3>${meta.title}</h3>
        <div class="field bunker-grade"><label>Grade for ROB / stem</label>
          <select data-bc-grade="${meta.key}">${gradeOpts}</select>
        </div>
        <div class="table-scroll" role="region" aria-label="${meta.title} legs">
          <table class="bunker-table">
            <thead><tr>
              <th class="col-port" title="Check if port or anchorage">P/A</th>
              <th class="col-from">From</th>
              <th class="col-to">To</th>
              <th class="col-num">Dist nm</th>
              <th class="col-num">Speed kn</th>
              <th class="col-num">Daily Cons</th>
              <th class="col-num">Days</th>
              <th class="col-qty">${meta.qtyLabel} MT</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="bunker-totals">
          <div class="field"><label>Current ROB (MT)</label><input type="number" step="0.001" data-bc-sf="currentRob" data-bc-side="${meta.key}" value="${side.currentRob ?? ''}"></div>
          <div class="field"><label>Margin %</label><input type="number" step="0.1" data-bc-sf="marginPct" data-bc-side="${meta.key}" value="${side.marginPct ?? 20}"></div>
          <div class="field"><label>Quantity to Receive (MT)</label><input type="number" step="0.001" data-bc-sf="qtyReceive" data-bc-side="${meta.key}" value="${side.qtyReceive ?? ''}"></div>
          <div class="field calc"><label>Days at Port / Anchor</label><input readonly tabindex="-1" value="${fmtN(sum.daysPort, 3)}"></div>
          <div class="field calc"><label>Days at Sea</label><input readonly tabindex="-1" value="${fmtN(sum.daysSea, 3)}"></div>
          <div class="field calc"><label>Total Distance (nm)</label><input readonly tabindex="-1" value="${fmtN(sum.totalDist, 2)}"></div>
          <div class="field calc"><label>Total Consumption (MT)</label><input readonly tabindex="-1" value="${fmtFuel(sum.totalCons)}"></div>
          <div class="field calc"><label>Total Margin (MT)</label><input readonly tabindex="-1" value="${fmtFuel(sum.margin)}"></div>
          <div class="field calc"><label>Required Quantity (MT)</label><input readonly tabindex="-1" value="${fmtFuel(sum.required)}"></div>
          <div class="field calc"><label>Arrival ROB (MT)</label><input readonly tabindex="-1" value="${sum.arrivalRob == null ? '—' : fmtFuel(sum.arrivalRob)}"></div>
          <div class="field calc"><label>Next Departure ROB (MT)</label><input readonly tabindex="-1" value="${sum.nextDepRob == null ? '—' : fmtFuel(sum.nextDepRob)}"></div>
          <div class="field calc full"><label>Stem still needed (MT)</label><input readonly tabindex="-1" value="${sum.stem == null ? '—' : fmtFuel(sum.stem)}"></div>
        </div>
        <div class="bunker-formula">Sea days = Dist ÷ (Speed × 24) · Qty = Daily × Days · Margin = Cons × Margin% · Required = Cons + Margin · Arrival ROB = Current ROB − Required · Next Dep ROB = Arrival ROB + Qty to Receive</div>
      </div>`;
    }).join('');
  }

  function printMetaGrid(items, cols) {
    if (typeof Branding !== 'undefined' && Branding.printMetaGrid) {
      return Branding.printMetaGrid(items, cols || 4);
    }
    const cells = items.map((it) =>
      `<div class="bc-pr-meta-cell"><span class="bc-pr-meta-lbl">${esc(it.label)}</span><span class="bc-pr-meta-val">${it.value}</span></div>`
    ).join('');
    return `<div class="bc-pr-meta cols-${cols || 4}">${cells}</div>`;
  }

  function buildPrintHtml(plan) {
    const vessel = vesselName();
    const voyageNo = plan.voyageNo || '—';
    const sidesHtml = SIDES.map((meta) => {
      const side = plan[meta.key];
      const sum = summarize(side);
      const body = side.legs.map((leg) => {
        const days = legDays(leg);
        const qty = legQty(leg);
        return `<tr>
          <td>${leg.port ? '●' : ''}</td>
          <td class="row-lbl">${esc(leg.from || '')}</td>
          <td class="row-lbl">${esc(leg.to || '')}</td>
          <td>${leg.distance != null ? fmtN(leg.distance, 2) : ''}</td>
          <td>${leg.speed != null ? fmtN(leg.speed, 2) : ''}</td>
          <td>${leg.dailyCons != null ? fmtFuel(leg.dailyCons) : ''}</td>
          <td>${days != null ? fmtN(days, 3) : ''}</td>
          <td>${qty != null ? fmtFuel(qty) : ''}</td>
        </tr>`;
      }).join('');
      return `<section class="pr-section bc-pr-section">
        <h3 class="pr-section-title bc-pr-section-title">${esc(meta.title)} — ${esc(side.grade)}</h3>
        <div class="pr-section-body bc-pr-section-body">
          <table class="pr-table bc-pr-table">
            <thead><tr>
              <th style="width:7%">P/A</th>
              <th style="width:18%">From</th>
              <th style="width:18%">To</th>
              <th style="width:10%">Dist</th>
              <th style="width:10%">Speed</th>
              <th style="width:12%">Daily</th>
              <th style="width:10%">Days</th>
              <th style="width:15%">Qty MT</th>
            </tr></thead>
            <tbody>${body}</tbody>
          </table>
          ${printMetaGrid([
            { label: 'Current ROB', value: side.currentRob == null ? '—' : fmtFuel(side.currentRob) + ' MT' },
            { label: 'Margin %', value: fmtN(side.marginPct, 1) + '%' },
            { label: 'Qty to Receive', value: side.qtyReceive == null ? '—' : fmtFuel(side.qtyReceive) + ' MT' },
            { label: 'Days Port', value: fmtN(sum.daysPort, 3) },
            { label: 'Days Sea', value: fmtN(sum.daysSea, 3) },
            { label: 'Total Distance', value: fmtN(sum.totalDist, 2) + ' nm' },
            { label: 'Total Consumption', value: fmtFuel(sum.totalCons) + ' MT' },
            { label: 'Total Margin', value: fmtFuel(sum.margin) + ' MT' },
            { label: 'Required Quantity', value: fmtFuel(sum.required) + ' MT' },
            { label: 'Arrival ROB', value: sum.arrivalRob == null ? '—' : fmtFuel(sum.arrivalRob) + ' MT' },
            { label: 'Next Departure ROB', value: sum.nextDepRob == null ? '—' : fmtFuel(sum.nextDepRob) + ' MT' },
            { label: 'Stem still needed', value: sum.stem == null ? '—' : fmtFuel(sum.stem) + ' MT' },
          ], 4)}
        </div>
      </section>`;
    }).join('');

    const header = (typeof Branding !== 'undefined' && Branding.printDocHeader)
      ? Branding.printDocHeader({
        vessel,
        title: 'Bunker Consumption Calculation',
        subtitle: 'Voyage fuel plan — sea / port legs with margin',
        badge: 'PLAN',
        rightLabel: 'Voyage No.',
        rightValue: voyageNo,
      })
      : `<div class="bc-pr-header">
        <div class="bc-pr-title">Bunker Consumption Calculation</div>
        <div class="bc-pr-sub">Voyage fuel plan — sea / port legs with margin</div>
        <div class="bc-pr-badge">${esc(voyageNo)}</div>
      </div>`;

    return `<div class="bc-pr-sheet pr-sheet">
      ${header}
      ${printMetaGrid([
        { label: 'Voyage No.', value: esc(voyageNo) },
        { label: 'Date', value: esc(plan.date || '—') },
        { label: 'Vessel', value: esc(vessel) },
        { label: 'Source', value: 'Tank Chief' },
      ], 4)}
      ${sidesHtml}
      <div class="pr-remarks bc-pr-remarks">
        <div class="pr-remarks-title bc-pr-remarks-title">Calculation basis</div>
        <div class="pr-remarks-body bc-pr-remarks-body">Sea days = Dist ÷ (Speed × 24). Quantity = Daily Cons × Days. Margin = Consumption × Margin%. Required = Consumption + Margin. Arrival ROB = Current ROB − Required. Next Departure ROB = Arrival ROB + Quantity to Receive.</div>
      </div>
      ${typeof FuelReport !== 'undefined' ? FuelReport.printSignatureBlock() : ''}
      ${typeof Branding !== 'undefined' ? Branding.printCredit() : ''}
    </div>`;
  }

  function doPrint(plan) {
    const html = buildPrintHtml(plan || _plan);
    const previousTitle = document.title;
    let root = document.getElementById('bc-print-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'bc-print-root';
      document.body.appendChild(root);
    }
    if (typeof Branding !== 'undefined' && Branding.printLiveDocument) {
      Branding.beginPrintHold?.();
      try {
        Branding.printLiveDocument(
          () => {
            root.innerHTML = html;
            document.body.classList.add('printing-bc');
            document.title = '\u00A0';
          },
          () => {
            document.title = previousTitle;
            document.body.classList.remove('printing-bc');
            root.innerHTML = '';
          },
          {
            title: 'Bunker Consumption Calculation',
            rootId: 'bc-print-root',
            bodyHtml: html,
            bodyClass: 'printing-bc',
          },
        );
      } catch (err) {
        Branding.endPrintHold?.();
        console.warn(err);
        showToast('Print failed');
      }
      return;
    }
    root.innerHTML = html;
    document.body.classList.add('printing-bc');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-bc');
      root.innerHTML = '';
    }, 1000);
  }

  async function saveToHistory(plan) {
    const st = store();
    if (!st) return;
    const snap = JSON.parse(JSON.stringify(plan));
    snap.savedAt = new Date().toISOString();
    st.history.unshift(snap);
    if (st.history.length > 50) st.history.length = 50;
    st.plan = JSON.parse(JSON.stringify(plan));
    await persistNow();
    renderHistory();
  }

  function renderHistory() {
    const panel = document.getElementById('bcHistory');
    const body = document.getElementById('bcHistoryBody');
    if (!panel || !body) return;
    const history = store()?.history || [];
    if (!history.length) {
      panel.style.display = 'none';
      body.innerHTML = '<tr class="empty-row"><td colspan="5">No saved calculations yet.</td></tr>';
      return;
    }
    panel.style.display = '';
    body.innerHTML = history.map((h, i) => {
      const plan = ensurePlan(JSON.parse(JSON.stringify(h)));
      const resSum = summarize(plan.residual);
      const distSum = summarize(plan.distillate);
      const date = h.date || (h.savedAt ? String(h.savedAt).slice(0, 10) : '—');
      return `<tr>
        <td>${esc(date)}</td>
        <td>${esc(h.voyageNo || '—')}</td>
        <td>${fmtFuel(resSum.required)} MT req</td>
        <td>${fmtFuel(distSum.required)} MT req</td>
        <td class="bc-hist-actions">
          <button type="button" class="btn small" data-bc-load="${i}">Load</button>
          <button type="button" class="btn small" data-bc-print="${i}">Print</button>
          <button type="button" class="btn small" data-bc-del="${i}">Del</button>
        </td>
      </tr>`;
    }).join('');
  }

  function loadTankRob() {
    const rob = tankRobByGrade();
    SIDES.forEach((meta) => {
      const side = _plan[meta.key];
      let val = 0;
      if (rob[side.grade] != null) val = Number(rob[side.grade]);
      else meta.grades.forEach((g) => { if (rob[g] != null) val += Number(rob[g]); });
      side.currentRob = Math.round(val * 1000) / 1000;
    });
    if (!_plan.voyageNo) _plan.voyageNo = STATE.bundle?.voyage?.voyageNo || '';
    if (!_plan.date) _plan.date = new Date().toISOString().slice(0, 10);
    renderGrid(_plan);
    scheduleSave();
    showToast('Tank ROB loaded');
  }

  function clearPlan() {
    if (!confirm('Clear the bunker consumption plan for both fuel sides?')) return;
    const voyageNo = STATE.bundle?.voyage?.voyageNo || _plan.voyageNo || '';
    _plan = ensurePlan(defaultPlan());
    _plan.voyageNo = voyageNo;
    _plan.date = new Date().toISOString().slice(0, 10);
    const st = store();
    if (st) st.plan = _plan;
    renderGrid(_plan);
    scheduleSave();
  }

  function bindEvents() {
    document.getElementById('bc-load-rob')?.addEventListener('click', () => {
      readFromDom(_plan);
      loadTankRob();
    });
    document.getElementById('bc-clear')?.addEventListener('click', () => {
      clearPlan();
    });
    document.getElementById('bc-print-only')?.addEventListener('click', () => {
      readFromDom(_plan);
      doPrint(_plan);
    });
    document.getElementById('bc-save-only')?.addEventListener('click', async () => {
      readFromDom(_plan);
      await saveToHistory(_plan);
      showToast('Bunker plan saved');
    });
    document.getElementById('bc-print-save')?.addEventListener('click', async () => {
      readFromDom(_plan);
      await saveToHistory(_plan);
      doPrint(_plan);
    });
    document.getElementById('bc_voyageNo')?.addEventListener('change', () => {
      _plan.voyageNo = document.getElementById('bc_voyageNo').value.trim();
      scheduleSave();
    });
    document.getElementById('bc_date')?.addEventListener('change', () => {
      _plan.date = document.getElementById('bc_date').value;
      scheduleSave();
    });

    const grid = document.getElementById('bcGrid');
    if (grid) {
      grid.addEventListener('change', (e) => {
        const t = e.target;
        if (!t) return;
        if (t.matches('[data-bc-grade], [data-bc-sf], .bunker-table [data-f]')) {
          const tr = t.closest('tr[data-bc-side]');
          if (tr && (t.dataset.f === 'distance' || t.dataset.f === 'speed' || t.dataset.f === 'port')) {
            readFromDom(_plan);
            const sk = tr.dataset.bcSide;
            const ri = Number(tr.dataset.bcRow);
            const leg = _plan[sk].legs[ri];
            if (t.dataset.f === 'port' && leg.port) {
              /* keep days */
            } else if (t.dataset.f === 'distance' || t.dataset.f === 'speed' || (t.dataset.f === 'port' && !leg.port)) {
              autoFillSeaDays(leg);
            }
          } else {
            readFromDom(_plan);
          }
          renderGrid(_plan);
          scheduleSave();
        }
      });
      grid.addEventListener('input', (e) => {
        const t = e.target;
        if (!t || !t.matches('.bunker-table [data-f="dailyCons"], .bunker-table [data-f="days"], [data-bc-sf]')) return;
        readFromDom(_plan);
        const tr = t.closest('tr[data-bc-side]');
        if (tr) {
          const sk = tr.dataset.bcSide;
          const ri = Number(tr.dataset.bcRow);
          const leg = _plan[sk].legs[ri];
          const qtyInp = tr.querySelector('.col-qty input');
          const qty = legQty(leg);
          if (qtyInp) qtyInp.value = qty == null ? '' : fmtFuel(qty);
        }
        scheduleSave();
      });
    }

    const histPanel = document.getElementById('bcHistory');
    if (histPanel) {
      histPanel.addEventListener('click', async (e) => {
        const loadBtn = e.target.closest('[data-bc-load]');
        const printBtn = e.target.closest('[data-bc-print]');
        const delBtn = e.target.closest('[data-bc-del]');
        const hist = store()?.history || [];
        if (loadBtn) {
          const idx = Number(loadBtn.dataset.bcLoad);
          if (hist[idx]) {
            const snap = JSON.parse(JSON.stringify(hist[idx]));
            delete snap.savedAt;
            _plan = ensurePlan(snap);
            const st = store();
            if (st) st.plan = _plan;
            renderGrid(_plan);
            scheduleSave();
            showToast('Loaded saved calculation');
          }
        }
        if (printBtn) {
          const idx = Number(printBtn.dataset.bcPrint);
          if (hist[idx]) {
            doPrint(ensurePlan(JSON.parse(JSON.stringify(hist[idx]))));
          }
        }
        if (delBtn) {
          const idx = Number(delBtn.dataset.bcDel);
          if (hist[idx] && confirm('Delete this saved calculation?')) {
            hist.splice(idx, 1);
            await persistNow();
            renderHistory();
          }
        }
      });
    }
  }

  function render(main) {
    _host = main;
    _plan = getPlan();

    main.innerHTML += `
    <div class="form-panel bc-page no-print">
      <h2 class="bc-page-title">Bunker Consumption Calculation</h2>
      <div class="hint">Plan fuel burn by voyage leg for residual (HFO/LSFO) and distillate (MDO/MGO/LSMGO). Sea days auto-fill from Distance ÷ (Speed × 24) when Port/Anchor is unchecked (1 kn = 1 nm/h). Quantity = Daily Cons × Days. Required Quantity = Total Consumption + Margin %. Arrival ROB = Current ROB − Required (conservative). Next Departure ROB adds bunkers to be received.</div>
      <div class="bunker-plan-head">
        <div class="field"><label>Vessel</label><input id="bc_vessel" readonly></div>
        <div class="field"><label>Voyage No.</label><input id="bc_voyageNo"></div>
        <div class="field"><label>Date</label><input type="date" id="bc_date"></div>
        <div class="btn-row" style="margin:0;">
          <button type="button" class="btn small" id="bc-load-rob">Load Tank ROB</button>
          <button type="button" class="btn small" id="bc-clear">Clear</button>
        </div>
        <div class="btn-row" style="margin:4px 0 0;">
          <button type="button" class="btn small" id="bc-print-only">Print</button>
          <button type="button" class="btn small" id="bc-save-only">Save</button>
          <button type="button" class="btn primary small" id="bc-print-save">Print &amp; Save</button>
        </div>
      </div>
      <div class="bunker-plan-grid" id="bcGrid"></div>
      <div class="hint" style="margin-top:12px;">Industry practice: sea days ≈ distance (nm) ÷ (speed kn × 24); port/anchor days are entered directly; a percentage safety margin (often 10–20%) is added to voyage consumption when sizing stems (many operators also keep a 48–72 h steaming reserve).</div>
    </div>
    <div class="form-panel no-print" id="bcHistory" style="display:none;">
      <h2 class="bc-page-title">Saved Calculations</h2>
      <div class="scroll-x table-scroll">
        <table>
          <thead><tr><th>Date</th><th>Voyage</th><th>Residual</th><th>Distillate</th><th></th></tr></thead>
          <tbody id="bcHistoryBody"><tr class="empty-row"><td colspan="5">No saved calculations yet.</td></tr></tbody>
        </table>
      </div>
    </div>`;

    renderGrid(_plan);
    renderHistory();
    bindEvents();
  }

  return { render };
})();
