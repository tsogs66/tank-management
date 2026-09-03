/* Bunker Consumption Calculation — Tank Chief standalone module.
 * Mirrors the Voyage Chief bunker consumption estimator, using Tank Chief ROB. */
const BunkerConsumption = (function () {
  const SIDES = [
    { key: 'residual', title: 'HFO / LSFO', grades: ['HFO', 'LSFO'], defaultGrade: 'HFO', qtyLabel: 'HFO/LSFO' },
    { key: 'distillate', title: 'MGO / LSMGO', grades: ['MDO/MGO', 'LSMGO'], defaultGrade: 'MDO/MGO', qtyLabel: 'MGO/LSMGO' },
  ];
  const MAX_LEGS = 10;

  function emptyLeg() { return { port: false, from: '', to: '', distance: null, speed: null, dailyCons: null, days: null }; }
  function emptySide(grade) {
    return { grade, legs: Array.from({ length: MAX_LEGS }, () => emptyLeg()), currentRob: null, marginPct: 20, qtyReceive: null };
  }
  function defaultPlan() { return { voyageNo: '', date: '', residual: emptySide('HFO'), distillate: emptySide('MDO/MGO') }; }

  function ensurePlan(plan) {
    if (!plan || typeof plan !== 'object') plan = defaultPlan();
    SIDES.forEach(meta => {
      if (!plan[meta.key]) plan[meta.key] = emptySide(meta.defaultGrade);
      const s = plan[meta.key];
      if (!Array.isArray(s.legs)) s.legs = [];
      while (s.legs.length < MAX_LEGS) s.legs.push(emptyLeg());
      s.legs = s.legs.slice(0, MAX_LEGS);
      if (!meta.grades.includes(s.grade)) s.grade = meta.defaultGrade;
      if (s.marginPct == null || s.marginPct === '') s.marginPct = 20;
    });
    return plan;
  }

  function legDays(leg) {
    if (leg.port) return (leg.days != null && !isNaN(leg.days)) ? Number(leg.days) : null;
    if (leg.days != null && leg.days !== '' && !isNaN(leg.days)) return Number(leg.days);
    const d = Number(leg.distance), s = Number(leg.speed);
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
    let daysPort = 0, daysSea = 0, totalDist = 0, totalCons = 0;
    (side.legs || []).forEach(leg => {
      const days = legDays(leg), qty = legQty(leg), dist = Number(leg.distance);
      if (dist > 0) totalDist += dist;
      if (days != null) { if (leg.port) daysPort += days; else daysSea += days; }
      if (qty != null) totalCons += qty;
    });
    const mp = Number(side.marginPct);
    const margin = (!isNaN(mp) ? totalCons * (mp / 100) : 0);
    const required = totalCons + margin;
    const rob = (side.currentRob != null && side.currentRob !== '' && !isNaN(side.currentRob)) ? Number(side.currentRob) : null;
    const receive = (side.qtyReceive != null && !isNaN(side.qtyReceive)) ? Number(side.qtyReceive) : 0;
    const arrivalRob = rob == null ? null : rob - required;
    const nextDepRob = arrivalRob == null ? null : arrivalRob + receive;
    const stem = rob == null ? null : Math.max(0, required - rob - receive);
    return { daysPort, daysSea, totalDist, totalCons, margin, required, arrivalRob, nextDepRob, stem, receive };
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
    } catch (_) {}
    return rob;
  }

  function loadTankRob(plan) {
    const rob = tankRobByGrade();
    SIDES.forEach(meta => {
      const side = plan[meta.key];
      let val = 0;
      if (rob[side.grade] != null) val = Number(rob[side.grade]);
      else meta.grades.forEach(g => { if (rob[g] != null) val += Number(rob[g]); });
      if (val > 0) side.currentRob = Math.round(val * 1000) / 1000;
    });
    if (!plan.date) plan.date = new Date().toISOString().slice(0, 10);
    return plan;
  }

  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fmt(v, d) { return v == null || isNaN(v) ? '—' : Number(v).toFixed(d ?? 2); }
  function fmtFuel(v) { return v == null || isNaN(v) ? '—' : Number(v).toFixed(3); }

  let _plan = null;
  let _saveTimer = null;

  function getPlan() {
    if (!_plan) {
      _plan = ensurePlan(STATE.bundle?.bunkerConsumption?.plan || null);
    }
    return _plan;
  }

  function scheduleSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
      try {
        if (!STATE.bundle) return;
        if (!STATE.bundle.bunkerConsumption) STATE.bundle.bunkerConsumption = {};
        STATE.bundle.bunkerConsumption.plan = JSON.parse(JSON.stringify(_plan));
        await persistPart('bunkerConsumption', STATE.bundle.bunkerConsumption);
      } catch (_) {}
    }, 400);
  }

  function readFromDom(plan) {
    const voyEl = document.getElementById('bc_voyageNo');
    const dateEl = document.getElementById('bc_date');
    if (voyEl) plan.voyageNo = voyEl.value.trim();
    if (dateEl) plan.date = dateEl.value;
    SIDES.forEach(meta => {
      const side = plan[meta.key];
      const gradeSel = document.querySelector(`select[data-bc-grade="${meta.key}"]`);
      if (gradeSel) side.grade = gradeSel.value;
      document.querySelectorAll(`input[data-bc-sf][data-bc-side="${meta.key}"]`).forEach(inp => {
        const f = inp.dataset.bcSf;
        const v = inp.value === '' ? null : parseFloat(inp.value);
        side[f] = (f === 'marginPct') ? (v == null || isNaN(v) ? 20 : v) : (v == null || isNaN(v) ? null : v);
      });
      side.legs.forEach((leg, i) => {
        const tr = document.querySelector(`tr[data-bc-side="${meta.key}"][data-bc-row="${i}"]`);
        if (!tr) return;
        const port = tr.querySelector('[data-f="port"]');
        leg.port = !!(port && port.checked);
        ['from', 'to'].forEach(f => { const el = tr.querySelector(`[data-f="${f}"]`); if (el) leg[f] = el.value; });
        ['distance', 'speed', 'dailyCons', 'days'].forEach(f => {
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
    if (voyEl && document.activeElement !== voyEl) voyEl.value = plan.voyageNo || '';
    if (dateEl && document.activeElement !== dateEl) {
      if (!plan.date) plan.date = new Date().toISOString().slice(0, 10);
      dateEl.value = plan.date || '';
    }
    grid.innerHTML = SIDES.map(meta => {
      const side = plan[meta.key];
      const sum = summarize(side);
      const gradeOpts = meta.grades.map(g => `<option value="${g}" ${side.grade === g ? 'selected' : ''}>${g}</option>`).join('');
      const rows = side.legs.map((leg, i) => {
        const days = legDays(leg), qty = legQty(leg);
        return `<tr data-bc-side="${meta.key}" data-bc-row="${i}">
          <td><input type="checkbox" data-f="port" ${leg.port ? 'checked' : ''}></td>
          <td><input type="text" data-f="from" value="${esc(leg.from)}" placeholder="From"></td>
          <td><input type="text" data-f="to" value="${esc(leg.to)}" placeholder="To"></td>
          <td><input type="number" step="0.1" data-f="distance" value="${leg.distance ?? ''}" ${leg.port ? 'disabled' : ''} inputmode="decimal"></td>
          <td><input type="number" step="0.1" data-f="speed" value="${leg.speed ?? ''}" ${leg.port ? 'disabled' : ''} inputmode="decimal"></td>
          <td><input type="number" step="0.01" data-f="dailyCons" value="${leg.dailyCons ?? ''}" inputmode="decimal"></td>
          <td><input type="number" step="0.001" data-f="days" value="${days ?? ''}" inputmode="decimal"></td>
          <td><input type="number" readonly tabindex="-1" value="${qty == null ? '' : fmtFuel(qty)}"></td>
        </tr>`;
      }).join('');
      return `<div class="bc-side" data-bc-side="${meta.key}">
        <h3>${meta.title}</h3>
        <div class="field bc-grade"><label>Grade</label>
          <select data-bc-grade="${meta.key}">${gradeOpts}</select></div>
        <div class="scroll-x"><table class="bc-table">
          <thead><tr><th style="width:5%">P/A</th><th style="width:16%">From</th><th style="width:16%">To</th><th style="width:10%">Dist</th><th style="width:10%">Speed</th><th style="width:12%">Daily</th><th style="width:10%">Days</th><th style="width:12%">${meta.qtyLabel} MT</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <div class="bc-totals">
          <div class="form-row"><label>Current ROB (MT)</label><input type="number" step="0.001" data-bc-sf="currentRob" data-bc-side="${meta.key}" value="${side.currentRob ?? ''}"></div>
          <div class="form-row"><label>Margin %</label><input type="number" step="0.1" data-bc-sf="marginPct" data-bc-side="${meta.key}" value="${side.marginPct ?? 20}"></div>
          <div class="form-row"><label>Qty to Receive (MT)</label><input type="number" step="0.001" data-bc-sf="qtyReceive" data-bc-side="${meta.key}" value="${side.qtyReceive ?? ''}"></div>
          <div class="bc-calc-row"><span>Days Port</span><strong>${fmt(sum.daysPort, 3)}</strong></div>
          <div class="bc-calc-row"><span>Days Sea</span><strong>${fmt(sum.daysSea, 3)}</strong></div>
          <div class="bc-calc-row"><span>Total Distance</span><strong>${fmt(sum.totalDist, 2)} nm</strong></div>
          <div class="bc-calc-row"><span>Total Consumption</span><strong>${fmtFuel(sum.totalCons)} MT</strong></div>
          <div class="bc-calc-row"><span>Total Margin</span><strong>${fmtFuel(sum.margin)} MT</strong></div>
          <div class="bc-calc-row"><span>Required Quantity</span><strong>${fmtFuel(sum.required)} MT</strong></div>
          <div class="bc-calc-row"><span>Arrival ROB</span><strong>${sum.arrivalRob == null ? '—' : fmtFuel(sum.arrivalRob) + ' MT'}</strong></div>
          <div class="bc-calc-row"><span>Next Dep ROB</span><strong>${sum.nextDepRob == null ? '—' : fmtFuel(sum.nextDepRob) + ' MT'}</strong></div>
          <div class="bc-calc-row"><span>Stem needed</span><strong>${sum.stem == null ? '—' : fmtFuel(sum.stem) + ' MT'}</strong></div>
        </div>
        <div class="bc-formula">Sea days = Dist ÷ (Speed × 24) · Qty = Daily × Days · Required = Cons + Margin · Arrival ROB = Current ROB − Required</div>
      </div>`;
    }).join('');
  }

  function buildPrintHtml(plan) {
    const vessel = vesselName();
    const voyageNo = plan.voyageNo || '—';
    const sidesHtml = SIDES.map(meta => {
      const side = plan[meta.key];
      const sum = summarize(side);
      const body = side.legs.map(leg => {
        const days = legDays(leg), qty = legQty(leg);
        return `<tr>
          <td>${leg.port ? '●' : ''}</td><td>${esc(leg.from)}</td><td>${esc(leg.to)}</td>
          <td>${leg.distance != null ? fmt(leg.distance, 2) : ''}</td>
          <td>${leg.speed != null ? fmt(leg.speed, 2) : ''}</td>
          <td>${leg.dailyCons != null ? fmtFuel(leg.dailyCons) : ''}</td>
          <td>${days != null ? fmt(days, 3) : ''}</td>
          <td>${qty != null ? fmtFuel(qty) : ''}</td></tr>`;
      }).join('');
      return `<div style="margin-top:18px"><h3 style="margin:0 0 6px">${esc(meta.title)} — ${esc(side.grade)}</h3>
        <table class="print-table"><thead><tr><th>P/A</th><th>From</th><th>To</th><th>Dist</th><th>Speed</th><th>Daily</th><th>Days</th><th>Qty MT</th></tr></thead>
        <tbody>${body}</tbody></table>
        <table class="print-table" style="margin-top:8px"><tbody>
          <tr><td>Current ROB</td><td>${side.currentRob == null ? '—' : fmtFuel(side.currentRob) + ' MT'}</td><td>Margin %</td><td>${fmt(side.marginPct, 1)}%</td></tr>
          <tr><td>Qty to Receive</td><td>${side.qtyReceive == null ? '—' : fmtFuel(side.qtyReceive) + ' MT'}</td><td>Days Port</td><td>${fmt(sum.daysPort, 3)}</td></tr>
          <tr><td>Days Sea</td><td>${fmt(sum.daysSea, 3)}</td><td>Total Distance</td><td>${fmt(sum.totalDist, 2)} nm</td></tr>
          <tr><td>Total Consumption</td><td>${fmtFuel(sum.totalCons)} MT</td><td>Total Margin</td><td>${fmtFuel(sum.margin)} MT</td></tr>
          <tr><td>Required Quantity</td><td>${fmtFuel(sum.required)} MT</td><td>Arrival ROB</td><td>${sum.arrivalRob == null ? '—' : fmtFuel(sum.arrivalRob) + ' MT'}</td></tr>
          <tr><td>Next Dep ROB</td><td>${sum.nextDepRob == null ? '—' : fmtFuel(sum.nextDepRob) + ' MT'}</td><td>Stem needed</td><td>${sum.stem == null ? '—' : fmtFuel(sum.stem) + ' MT'}</td></tr>
        </tbody></table></div>`;
    }).join('');

    return `<div class="print-doc">
      <h2 style="margin:0 0 4px">Bunker Consumption Calculation</h2>
      <div style="margin-bottom:12px;font-size:11px;color:#666">Voyage fuel plan — sea / port legs with margin</div>
      <table class="print-table"><tbody>
        <tr><td>Voyage No.</td><td>${esc(voyageNo)}</td><td>Date</td><td>${esc(plan.date || '—')}</td></tr>
        <tr><td>Vessel</td><td colspan="3">${esc(vessel)}</td></tr>
      </tbody></table>
      ${sidesHtml}
      <div style="margin-top:16px;font-size:10px;color:#666">Sea days = Dist ÷ (Speed × 24). Quantity = Daily Cons × Days. Required = Consumption + Margin. Arrival ROB = Current ROB − Required.</div>
      ${typeof Branding !== 'undefined' ? Branding.printCredit() : ''}
    </div>`;
  }

  function saveToHistory(plan) {
    if (!STATE.bundle) return;
    if (!STATE.bundle.bunkerConsumption) STATE.bundle.bunkerConsumption = {};
    if (!Array.isArray(STATE.bundle.bunkerConsumption.history)) STATE.bundle.bunkerConsumption.history = [];
    const snap = JSON.parse(JSON.stringify(plan));
    snap.savedAt = new Date().toISOString();
    STATE.bundle.bunkerConsumption.history.unshift(snap);
    if (STATE.bundle.bunkerConsumption.history.length > 50) STATE.bundle.bunkerConsumption.history.length = 50;
  }

  function renderHistory() {
    const panel = document.getElementById('bcHistory');
    const body = document.getElementById('bcHistoryBody');
    if (!panel || !body) return;
    const history = STATE.bundle?.bunkerConsumption?.history || [];
    if (!history.length) { panel.style.display = 'none'; return; }
    panel.style.display = '';
    body.innerHTML = history.map((h, i) => {
      const resSide = ensurePlan(h).residual;
      const distSide = ensurePlan(h).distillate;
      const resSum = summarize(resSide);
      const distSum = summarize(distSide);
      return `<tr>
        <td>${esc(h.date || h.savedAt?.slice(0, 10) || '—')}</td>
        <td>${esc(h.voyageNo || '—')}</td>
        <td>${fmtFuel(resSum.required)} MT</td>
        <td>${fmtFuel(distSum.required)} MT</td>
        <td><button class="btn small" data-bc-load="${i}">Load</button> <button class="btn small" data-bc-del="${i}">Del</button></td>
      </tr>`;
    }).join('');
  }

  function render(main) {
    _plan = getPlan();

    main.innerHTML += `<div class="page-head no-print">
      <div><h1>Bunker Consumption Calculation</h1>
        <div class="desc">Plan fuel burn by voyage leg for residual and distillate</div></div>
      <div class="btn-row">
        <button class="btn" id="bc-load-rob">Load Tank ROB</button>
        <button class="btn" id="bc-clear">Clear</button>
      </div>
      <div class="btn-row" style="margin-top:4px">
        <button class="btn" id="bc-print-only">Print</button>
        <button class="btn" id="bc-save-only">Save</button>
        <button class="btn primary" id="bc-print-save">Print &amp; Save</button>
      </div>
    </div>
    <div class="form-panel no-print">
      <div class="form-row-3">
        <div class="form-row"><label>Vessel</label><input id="bc_vessel" readonly></div>
        <div class="form-row"><label>Voyage No.</label><input id="bc_voyageNo"></div>
        <div class="form-row"><label>Date</label><input type="date" id="bc_date"></div>
      </div>
      <div id="bcGrid"></div>
      <div class="hint" style="margin-top:12px">Sea days ≈ distance (nm) ÷ (speed kn × 24); port/anchor days entered directly; 10–20% safety margin is common.</div>
    </div>
    <div class="form-panel no-print" id="bcHistory" style="display:none">
      <div class="section-title" style="margin-top:0">Saved Calculations</div>
      <div class="scroll-x"><table><thead><tr><th>Date</th><th>Voyage</th><th>Residual</th><th>Distillate</th><th></th></tr></thead>
        <tbody id="bcHistoryBody"></tbody></table></div>
    </div>`;

    renderGrid(_plan);
    renderHistory();
    bindEvents();
  }

  function bindEvents() {
    document.getElementById('bc-load-rob')?.addEventListener('click', () => {
      loadTankRob(_plan);
      renderGrid(_plan);
      scheduleSave();
      showToast('Tank ROB loaded');
    });
    document.getElementById('bc-clear')?.addEventListener('click', () => {
      if (!confirm('Clear the bunker consumption plan?')) return;
      _plan = ensurePlan(defaultPlan());
      _plan.date = new Date().toISOString().slice(0, 10);
      renderGrid(_plan);
      scheduleSave();
    });
    document.getElementById('bc-print-save')?.addEventListener('click', () => {
      readFromDom(_plan);
      saveToHistory(_plan);
      scheduleSave();
      renderHistory();
      doPrint();
    });
    document.getElementById('bc-print-only')?.addEventListener('click', () => {
      readFromDom(_plan);
      doPrint();
    });
    document.getElementById('bc-save-only')?.addEventListener('click', () => {
      readFromDom(_plan);
      saveToHistory(_plan);
      scheduleSave();
      renderHistory();
      showToast('Saved');
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
        if (t.matches('[data-bc-grade], [data-bc-sf], .bc-table [data-f]')) {
          readFromDom(_plan);
          const tr = t.closest('tr[data-bc-side]');
          if (tr && (t.dataset.f === 'distance' || t.dataset.f === 'speed' || t.dataset.f === 'port')) {
            const sk = tr.dataset.bcSide, ri = Number(tr.dataset.bcRow);
            const leg = _plan[sk].legs[ri];
            if (!leg.port && (t.dataset.f === 'distance' || t.dataset.f === 'speed')) {
              const d = Number(leg.distance), s = Number(leg.speed);
              if (d > 0 && s > 0) leg.days = Math.round((d / (s * 24)) * 1000) / 1000;
            }
          }
          renderGrid(_plan);
          scheduleSave();
        }
      });
      grid.addEventListener('input', (e) => {
        const t = e.target;
        if (!t || !t.matches('.bc-table [data-f="dailyCons"], .bc-table [data-f="days"], [data-bc-sf]')) return;
        readFromDom(_plan);
        const tr = t.closest('tr[data-bc-side]');
        if (tr) {
          const sk = tr.dataset.bcSide, ri = Number(tr.dataset.bcRow);
          const leg = _plan[sk].legs[ri];
          const qtyInp = tr.querySelector('td:last-child input');
          const qty = legQty(leg);
          if (qtyInp) qtyInp.value = qty == null ? '' : fmtFuel(qty);
        }
        scheduleSave();
      });
    }

    const histPanel = document.getElementById('bcHistory');
    if (histPanel) histPanel.addEventListener('click', (e) => {
      const loadBtn = e.target.closest('[data-bc-load]');
      const delBtn = e.target.closest('[data-bc-del]');
      if (loadBtn) {
        const idx = Number(loadBtn.dataset.bcLoad);
        const hist = STATE.bundle?.bunkerConsumption?.history || [];
        if (hist[idx]) {
          _plan = ensurePlan(JSON.parse(JSON.stringify(hist[idx])));
          renderGrid(_plan);
          scheduleSave();
          showToast('Loaded');
        }
      }
      if (delBtn) {
        const idx = Number(delBtn.dataset.bcDel);
        const hist = STATE.bundle?.bunkerConsumption?.history || [];
        if (hist[idx] && confirm('Delete this saved calculation?')) {
          hist.splice(idx, 1);
          scheduleSave();
          renderHistory();
        }
      }
    });
  }

  function doPrint() {
    readFromDom(_plan);
    const html = buildPrintHtml(_plan);
    if (typeof Branding !== 'undefined' && Branding.printLiveDocument) {
      const root = document.createElement('div');
      root.id = 'bc-print-root';
      root.className = 'print-only';
      root.innerHTML = html;
      Branding.printLiveDocument(
        () => { document.body.appendChild(root); document.body.classList.add('bc-printing'); },
        () => { document.body.classList.remove('bc-printing'); try { root.remove(); } catch (_) {} },
        { title: 'Bunker Consumption Calculation' }
      );
    } else {
      window.print();
    }
  }

  return { render };
})();
