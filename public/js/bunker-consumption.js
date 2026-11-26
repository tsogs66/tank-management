/* Bunker Consumption Calculation — Tank Chief.
 * The page, the calculation, saved calculations and the printout live in consumption-plan.js, which Voyage Chief and ChEng AIO use
 * too. This file only tells that module about Tank Chief: where the plan is stored, which fuels the vessel has, where the ROB comes
 * from and how a sheet is printed. Separate from bunkering "Bunker Plan" (BunkerReports). */
const BunkerConsumption = (function () {
  function store() {
    if (!STATE.bundle) return null;
    if (!STATE.bundle.bunkerConsumption || typeof STATE.bundle.bunkerConsumption !== 'object') {
      STATE.bundle.bunkerConsumption = { plan: null, history: [] };
    }
    if (!Array.isArray(STATE.bundle.bunkerConsumption.history)) STATE.bundle.bunkerConsumption.history = [];
    return STATE.bundle.bunkerConsumption;
  }

  /** The fuels this vessel has: the grades of its fuel tanks. None found: Residual and Distillate. */
  function vesselFuels() {
    const out = [];
    try {
      const seen = new Set();
      const rob = tankRobByGrade();
      (STATE.bundle?.tanks?.fuel || []).forEach((t) => {
        const label = FuelReportCore.robGradeLabel ? FuelReportCore.robGradeLabel(t) : null;
        if (!label) return;
        /* a grade with nothing sounded in its tanks is left out, unless it is the only one of its kind */
        const active = (Number(rob && rob[label]) || 0) > 0;
        if (seen.has(label)) { if (active) out.find((x) => x.id === label).active = true; return; }
        seen.add(label); out.push({ id: label, active });
      });
    } catch (_) { /* fall back below */ }
    return out;
  }
  function tankRobByGrade() {
    try {
      return FuelReportCore.robByGradeLabel(STATE.bundle?.tanks?.fuel || [], getReading);
    } catch (_) { return {}; }
  }

  function printMetaGrid(items, cols) {
    if (typeof Branding !== 'undefined' && Branding.printMetaGrid) return Branding.printMetaGrid(items, cols || 4);
    const cells = items.map((it) =>
      `<div class="bc-pr-meta-cell"><span class="bc-pr-meta-lbl">${it.label}</span><span class="bc-pr-meta-val">${it.value}</span></div>`).join('');
    return `<div class="bc-pr-meta cols-${cols || 4}">${cells}</div>`;
  }
  function printHeader(info) {
    if (typeof Branding !== 'undefined' && Branding.printDocHeader) {
      return Branding.printDocHeader({
        vessel: info.vessel,
        title: 'Bunker Consumption Calculation',
        subtitle: 'Voyage fuel plan — sea / port legs with margin',
        badge: 'PLAN',
        rightLabel: 'Voyage No.',
        rightValue: info.voyageNo,
      });
    }
    return `<div class="bc-pr-header"><div class="bc-pr-title">Bunker Consumption Calculation</div>
      <div class="bc-pr-sub">Voyage fuel plan — sea / port legs with margin</div><div class="bc-pr-badge">${info.voyageNo}</div></div>`;
  }
  function printSignature() {
    return `${typeof FuelReport !== 'undefined' ? FuelReport.printSignatureBlock() : ''}${typeof Branding !== 'undefined' ? Branding.printCredit() : ''}`;
  }

  function doPrint(sheetHtml) {
    const html = `<div class="bc-pr-sheet pr-sheet">${sheetHtml}</div>`;
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
            document.title = ' ';
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
    showToast('Sent to print — choose a printer or Save as PDF');
    setTimeout(() => {
      document.body.classList.remove('printing-bc');
      root.innerHTML = '';
    }, 1000);
  }

  /* Ask what to call this save, so it can be found again in Saved Calculations.
     Resolves with the text (possibly empty) or null when the engineer cancels. */
  async function askSaveName(plan) {
    if (typeof askText !== 'function') return plan.saveName || '';
    return askText({
      title: 'Save calculation',
      message: 'Give this calculation a name or short description so it is easy to find later in Saved Calculations.',
      label: 'Name / description',
      placeholder: 'e.g. Singapore to Rotterdam via Cape',
      value: plan.saveName || '',
      okLabel: 'Save',
    });
  }

  function render(main) {
    const host = document.createElement('div');
    host.id = 'bcRoot';
    main.appendChild(host);
    ConsumptionPlan.mount(host, {
      ui: { panel: 'form-panel', btn: 'btn small', primary: 'btn primary small', hist: 'form-panel' },
      fuels: vesselFuels,
      sea: ConsumptionPlan.seaLoader('sea-distance/'),
      load() {
        const st = store();
        return st ? { plan: st.plan, history: st.history } : { plan: null, history: [] };
      },
      async persist(data) {
        const st = store();
        if (!st || !STATE.activeVesselId) return;
        st.plan = data.plan;
        st.history = data.history;
        st.updatedAt = new Date().toISOString();
        await persistPart('bunkerConsumption', st);
      },
      vesselName: () => vesselName(),
      voyageNo: () => STATE.bundle?.voyage?.voyageNo || '',
      toast: (m) => showToast(m),
      askName: askSaveName,
      buttons: [
        {
          id: 'load-rob',
          label: 'Load Tank ROB',
          onClick: () => ({
            rob: tankRobByGrade(),
            message: 'Tank ROB loaded',
            empty: 'No sounded fuel weight yet — sound the tanks on Tank Monitoring first',
          }),
        },
        { id: 'go-plan', label: 'Bunkering plan', onClick: () => { if (typeof navigate === 'function') navigate('bunker-plan'); } },
        { id: 'go-after', label: 'After survey', onClick: () => { if (typeof navigate === 'function') navigate('bunker-after'); } },
        { id: 'go-bdn', label: 'BDN summary', onClick: () => { if (typeof navigate === 'function') navigate('bunker-summary'); } },
      ],
      printMetaGrid,
      printHeader,
      printSignature,
      printExtraMeta: () => [{ label: 'Source', value: 'Tank Chief' }],
      printSheet: (html) => doPrint(html),
    });
  }

  return { render };
})();
