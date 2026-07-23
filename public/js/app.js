/* Vessel Fuel Tank Management — SPA */
const CATS = [
  { id: 'fuel', label: 'Fuel Oil', icon: '⛽', color: 'var(--fuel)' },
  { id: 'lube', label: 'Lube Oil', icon: '🛢', color: 'var(--lube)' },
  { id: 'misc', label: 'Misc / Bilge', icon: '🔧', color: 'var(--misc)' },
  { id: 'water', label: 'Fresh Water', icon: '💧', color: 'var(--water)' },
];

const STATE = {
  vessels: [],
  activeVesselId: null,
  bundle: null,
  settings: {},
  conversionTable: null,
  online: navigator.onLine,
  route: { page: 'dashboard', tankId: null },
};

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

function showToast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2400);
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function allTanks() {
  const t = STATE.bundle?.tanks || {};
  return CATS.flatMap((c) => t[c.id] || []);
}

function findTank(id) {
  return allTanks().find((t) => t.id === id) || null;
}

function getReading(id) {
  return STATE.bundle?.readings?.[id] || null;
}

function fillStatusClass(pct) {
  if (pct == null) return 'neutral';
  if (pct >= 95) return 'bad';
  if (pct >= 85) return 'warn'; // workbook uses 85% capacity as working limit
  return 'good';
}

function vesselName() {
  return STATE.bundle?.vessel?.name || STATE.bundle?.voyage?.vessel || 'No vessel';
}

function closeMobileNav() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-backdrop')?.classList.remove('show');
}

function navigate(page, tankId = null) {
  if (page !== 'bunkering' && typeof stopBunkerLiveTimer === 'function') stopBunkerLiveTimer();
  STATE.route = { page, tankId };
  closeMobileNav();
  render();
  window.scrollTo(0, 0);
}

async function persistPart(part, data) {
  STATE.bundle[part] = data;
  await OfflineDB.idbSet('vessel:' + STATE.activeVesselId, STATE.bundle);
  try {
    await Api.savePart(STATE.activeVesselId, part, data);
  } catch {
    await Api.mutate(`/api/vessels/${STATE.activeVesselId}/${part}`, { method: 'PUT', body: data });
    showToast('Saved offline — will sync when online');
  }
}

async function reloadBundle() {
  if (!STATE.activeVesselId) { STATE.bundle = null; return; }
  STATE.bundle = await Api.getVessel(STATE.activeVesselId);
}

/* ---------- Nav / shell ---------- */
function renderNav() {
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = '';

  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.innerHTML = `
    <div class="ship">${vesselName()}</div>
    <div class="sub"><span class="status-dot ${STATE.online ? 'online' : 'offline'}"></span>
      ${STATE.online ? 'Online' : 'Offline'} · Fuel Tank TMS</div>
    <select class="vessel-select" id="vessel-switcher">
      <option value="">— Select vessel —</option>
      ${STATE.vessels.map((v) => `<option value="${v.id}" ${v.id === STATE.activeVesselId ? 'selected' : ''}>${v.name}</option>`).join('')}
    </select>`;
  nav.appendChild(brand);

  const mk = (page, label, icon) => {
    const b = document.createElement('button');
    b.className = 'nav-btn' + (STATE.route.page === page ? ' active' : '');
    b.innerHTML = `<span class="ic">${icon}</span><span>${label}</span>`;
    b.onclick = () => navigate(page);
    return b;
  };

  nav.appendChild(mk('dashboard', 'Dashboard', '▦'));

  let g = document.createElement('div');
  g.className = 'nav-group-label'; g.textContent = 'Tanks';
  nav.appendChild(g);
  for (const c of CATS) nav.appendChild(mk(c.id, c.label, c.icon));
  nav.appendChild(mk('add-tank', 'Add Tank', '+'));
  nav.appendChild(mk('calibration', 'Calibration DB', '☰'));

  g = document.createElement('div');
  g.className = 'nav-group-label'; g.textContent = 'Fuel Management';
  nav.appendChild(g);
  nav.appendChild(mk('voyage', 'Voyage Fuel Calc', '🧭'));
  nav.appendChild(mk('bunkering', 'Bunkering', '⛽'));
  nav.appendChild(mk('report', 'Voyage Report', '📋'));

  g = document.createElement('div');
  g.className = 'nav-group-label'; g.textContent = 'Reference';
  nav.appendChild(g);
  nav.appendChild(mk('vcf-wcf', 'VCF / WCF Calc', 'Σ'));
  nav.appendChild(mk('iso8217', 'ISO 8217 Specs', '▤'));

  g = document.createElement('div');
  g.className = 'nav-group-label'; g.textContent = 'System';
  nav.appendChild(g);
  nav.appendChild(mk('setup', 'Vessel Setup', '⚙'));
  nav.appendChild(mk('settings', 'Backup / Sync', '⇅'));
  nav.appendChild(mk('about', 'About', 'ℹ'));

  document.getElementById('vessel-switcher').onchange = async (e) => {
    const id = e.target.value;
    if (!id) return;
    await Api.setActive(id);
    STATE.activeVesselId = id;
    await reloadBundle();
    navigate('dashboard');
    showToast('Loaded vessel');
  };
}

function render() {
  renderNav();
  const main = document.getElementById('main');
  main.innerHTML = '';

  if (!STATE.online) {
    const banner = document.createElement('div');
    banner.className = 'offline-banner';
    banner.textContent = 'Working offline — changes are saved locally and will sync when the server is available.';
    main.appendChild(banner);
  }

  const noVesselOk = ['setup', 'settings', 'about', 'vcf-wcf', 'iso8217'];
  if (!STATE.bundle && !noVesselOk.includes(STATE.route.page)) {
    main.innerHTML += `<div class="form-panel"><h2>No vessel selected</h2>
      <p style="color:var(--text-dim)">Create or select a vessel in Vessel Setup to begin.</p>
      <button class="btn primary" id="go-setup">Open Vessel Setup</button></div>`;
    document.getElementById('go-setup').onclick = () => navigate('setup');
    return;
  }

  const page = STATE.route.page;
  if (page === 'dashboard') renderDashboard(main);
  else if (page === 'calibration') renderCalibrationList(main);
  else if (page === 'add-tank') renderAddTank(main);
  else if (page === 'voyage') renderVoyage(main);
  else if (page === 'bunkering') renderBunkering(main);
  else if (page === 'report') renderReport(main);
  else if (page === 'vcf-wcf') renderVcfWcf(main);
  else if (page === 'iso8217') renderIso8217(main);
  else if (page === 'setup') renderSetup(main);
  else if (page === 'settings') renderSettings(main);
  else if (page === 'about') renderAbout(main);
  else if (CATS.some((c) => c.id === page) && !STATE.route.tankId) renderCategory(main, page);
  else if (STATE.route.tankId) renderTankDetail(main, STATE.route.tankId);
}

/* ---------- Dashboard ---------- */
function categoryTotals(catId) {
  const tanks = STATE.bundle.tanks[catId] || [];
  let capacity = 0, volume = 0, weight = 0, withReading = 0;
  for (const t of tanks) {
    capacity += t.capacity || 0;
    const r = getReading(t.id);
    if (r?.result) {
      volume += r.result.volumeObserved || 0;
      weight += r.result.weightMT || 0;
      withReading++;
    }
  }
  return { capacity, volume, weight, withReading, count: tanks.length };
}

function renderDashboard(main) {
  const v = STATE.bundle.voyage || {};
  main.innerHTML += `<div class="page-head"><div>
    <h1>Vessel Tank Overview</h1>
    <div class="desc">${vesselName()} · ${v.port || ''} · ${v.date || ''}</div>
  </div></div>`;

  let grandVol = 0, grandCap = 0, grandWeight = 0, totalTanks = 0, readTanks = 0;
  const cards = document.createElement('div');
  cards.className = 'cards-row';
  for (const c of CATS) {
    const t = categoryTotals(c.id);
    grandVol += t.volume; grandCap += t.capacity; grandWeight += t.weight;
    totalTanks += t.count; readTanks += t.withReading;
    const pct = t.capacity ? (t.volume / t.capacity) * 100 : 0;
    cards.innerHTML += `<div class="card">
      <div class="label"><span class="cat-dot cat-${c.id}"></span>${c.label}</div>
      <div class="value">${fmt(t.volume,1)}<span class="unit">m³ / ${fmt(t.capacity,0)}</span></div>
      <div class="sub">${t.withReading}/${t.count} logged · ${fmt(pct,1)}% full</div>
    </div>`;
  }
  const summary = document.createElement('div');
  summary.className = 'cards-row';
  summary.innerHTML = `
    <div class="card"><div class="label">Total Volume</div><div class="value">${fmt(grandVol,1)}<span class="unit">m³</span></div></div>
    <div class="card"><div class="label">Total Weight</div><div class="value">${fmt(grandWeight,1)}<span class="unit">MT</span></div></div>
    <div class="card"><div class="label">Readings</div><div class="value">${readTanks}<span class="unit">/ ${totalTanks}</span></div></div>`;
  main.appendChild(summary);
  main.appendChild(cards);

  for (const c of CATS) {
    const title = document.createElement('div');
    title.className = 'section-title';
    title.innerHTML = `<span class="cat-dot cat-${c.id}"></span>${c.label}`;
    main.appendChild(title);
    main.appendChild(buildTankTable(STATE.bundle.tanks[c.id] || []));
  }
}

function buildTankTable(tanks) {
  const wrap = document.createElement('div');
  wrap.className = 'scroll-x';
  const table = document.createElement('table');
  table.className = 'tank-table';
  table.innerHTML = `<thead><tr>
    <th>Tank</th><th>Role</th><th>Side</th><th>100% m³</th><th>85% m³</th><th>Reading</th><th>Vol m³</th><th>Fill</th><th>MT</th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');
  for (const t of tanks) {
    const r = getReading(t.id);
    const pct = r?.result?.fillPercent ?? null;
    const cls = fillStatusClass(pct);
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.onclick = () => navigate(t.category, t.id);
    tr.innerHTML = `
      <td class="tname">${t.name}</td>
      <td><span class="tag">${t.fuelRole || '—'}</span></td>
      <td>${t.side || '—'}</td>
      <td>${fmt(t.capacity,1)}</td>
      <td>${fmt((t.capacity||0)*0.85,1)}</td>
      <td>${r ? fmt(r.reading, r.gaugeType === 'volume' ? 2 : 1) : '–'}</td>
      <td>${r ? fmt(r.result.volumeObserved,2) : '–'}</td>
      <td>${pct != null ? `<div class="fillbar-wrap"><div class="fillbar-track"><div class="fillbar-fill" style="width:${Math.min(100,pct)}%;background:${cls==='bad'?'var(--bad)':cls==='warn'?'var(--warn)':'var(--good)'}"></div></div><span class="fillbar-pct">${fmt(pct,0)}%</span></div>` : '<span class="pill neutral">none</span>'}</td>
      <td>${r?.result?.weightMT != null ? fmt(r.result.weightMT,2) : '–'}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderCategory(main, catId) {
  const c = CATS.find((x) => x.id === catId);
  const t = categoryTotals(catId);
  main.innerHTML += `<div class="page-head"><div><h1><span class="cat-dot cat-${c.id}"></span>${c.label}</h1>
    <div class="desc">${t.count} tanks · ${fmt(t.capacity,0)} m³</div></div></div>`;
  main.appendChild(buildTankTable(STATE.bundle.tanks[catId] || []));
}

/* ---------- Tank detail ---------- */
function renderTankDetail(main, tankId) {
  const tank = findTank(tankId);
  if (!tank) { main.innerHTML += '<div class="empty-state">Tank not found</div>'; return; }
  const existing = getReading(tankId) || {};
  const c = CATS.find((x) => x.id === tank.category);

  const back = document.createElement('div');
  back.className = 'back-link';
  back.textContent = '← Back to ' + c.label;
  back.onclick = () => navigate(tank.category);
  main.appendChild(back);

  main.innerHTML += `<div class="page-head"><div><h1>${tank.name}</h1>
    <div class="desc">${c.label} · ${tank.fuelRole || ''} · ${tank.side || ''} · cap ${fmt(tank.capacity,2)} m³ · ${tank.calcType}</div></div>
    <div class="btn-row">
      <button class="btn small" id="btn-edit-calib">Edit calibration</button>
      <button class="btn small danger" id="btn-del-tank">Delete tank</button>
    </div></div>`;

  const grid = document.createElement('div');
  grid.className = 'detail-grid';
  const gaugeChoice = tank.calcType === 'direct' && /SETT|SERVICE/i.test(tank.name || '');
  const initialGT = existing.gaugeType || 'meter';

  grid.innerHTML = `
    <div class="form-panel">
      ${gaugeChoice ? `<div class="form-row"><label>Gauge type</label>
        <select id="in-gaugetype">
          <option value="meter" ${initialGT==='meter'?'selected':''}>Meter / ullage (calibration)</option>
          <option value="volume" ${initialGT==='volume'?'selected':''}>Volume gauge (m³ direct)</option>
        </select></div>` : ''}
      <div class="form-row"><label id="reading-label">${initialGT==='volume'?'Volume m³':(tank.soundingMethod||'Reading')}</label>
        <input type="number" step="any" id="in-reading" value="${existing.reading ?? ''}"></div>
      <div class="form-row-2" id="trimlist-row" style="${initialGT==='volume'?'display:none':''}">
        <div class="form-row"><label>Trim (m)</label><input type="number" step="any" id="in-trim" value="${existing.trim ?? STATE.bundle.voyage?.trim ?? 0}"></div>
        <div class="form-row"><label>List / Heel (°)</label><input type="number" step="any" id="in-list" value="${existing.list ?? STATE.bundle.voyage?.heel ?? 0}"></div>
      </div>
    <div class="form-row-2">
      <div class="form-row"><label>Temp (°C)</label><input type="number" step="any" id="in-temp" value="${existing.tempC ?? 15}"></div>
      <div class="form-row"><label>Density @15°C (kg/L)</label><input type="number" step="any" id="in-density" value="${existing.density15 ?? ''}" placeholder="0.9584"></div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label>SG / relative density → density</label>
        <div style="display:flex;gap:6px"><input type="number" step="any" id="in-sg" placeholder="e.g. 0.959"><button type="button" class="btn small" id="btn-sg-den">SG→ρ</button></div>
        <div class="hint">Workbook Conversion sheet (RD/SG)</div></div>
      <div class="form-row"><label>Density → SG</label>
        <div style="display:flex;gap:6px"><input type="number" step="any" id="in-den-to-sg" placeholder="kg/L"><button type="button" class="btn small" id="btn-den-sg">ρ→SG</button></div>
        <div class="hint" id="sg-equiv-hint">Equivalent SG shown after convert</div></div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label>API → density (Conversion sheet)</label>
        <div style="display:flex;gap:6px"><input type="number" step="any" id="in-api" placeholder="API"><button type="button" class="btn small" id="btn-api-den">Use</button></div>
        <div class="hint">From workbook Conversion sheet</div></div>
      <div class="form-row"><label>Capacity ref</label>
        <div class="hint">100% ${fmt(tank.capacity,2)} m³ · 85% ${fmt((tank.capacity||0)*0.85,2)} m³</div></div>
    </div>
    <button class="btn primary" id="btn-calc" style="width:100%">Calculate & Save</button>
    </div>
    <div class="result-panel" id="result-panel"></div>`;
  main.appendChild(grid);

  document.getElementById('btn-edit-calib').onclick = () => navigate('calibration', tankId);
  document.getElementById('btn-del-tank').onclick = async () => {
    if (!confirm('Delete this tank and its readings?')) return;
    await Api.deleteTank(STATE.activeVesselId, tankId);
    await reloadBundle();
    navigate(tank.category);
    showToast('Tank deleted');
  };

  if (gaugeChoice) {
    document.getElementById('in-gaugetype').onchange = (e) => {
      document.getElementById('trimlist-row').style.display = e.target.value === 'volume' ? 'none' : '';
    };
  }

  async function doCalc() {
    const reading = parseFloat(document.getElementById('in-reading').value);
    if (Number.isNaN(reading)) { showToast('Enter a reading'); return; }
    const gaugeType = gaugeChoice ? document.getElementById('in-gaugetype').value : 'meter';
    const inputs = {
      reading,
      trim: gaugeType === 'volume' ? 0 : (parseFloat(document.getElementById('in-trim').value) || 0),
      list: gaugeType === 'volume' ? 0 : (parseFloat(document.getElementById('in-list').value) || 0),
      tempC: parseFloat(document.getElementById('in-temp').value) || 15,
      density15: document.getElementById('in-density').value === '' ? null : parseFloat(document.getElementById('in-density').value),
      gaugeType,
    };
    let result;
    try {
      const resp = await Api.calculate(STATE.activeVesselId, { tankId, inputs, save: true });
      result = resp.result;
      STATE.bundle.readings[tankId] = resp.reading;
      await OfflineDB.idbSet('vessel:' + STATE.activeVesselId, STATE.bundle);
    } catch {
      result = computeTank(tank, inputs);
      STATE.bundle.readings[tankId] = { ...inputs, result, savedAt: new Date().toISOString() };
      await persistPart('readings', STATE.bundle.readings);
    }
    renderResultSteps(document.getElementById('result-panel'), tank, result, inputs);
    showToast('Reading saved');
  }
  document.getElementById('btn-calc').onclick = doCalc;

  async function loadConversionTable() {
    if (STATE.conversionTable) return STATE.conversionTable;
    const table = await Api.request('/api/reference/conversion');
    STATE.conversionTable = table;
    return table;
  }

  async function syncSgHintFromDensity() {
    const dens = parseFloat(document.getElementById('in-density').value);
    const hint = document.getElementById('sg-equiv-hint');
    if (!hint || Number.isNaN(dens)) return;
    try {
      const table = await loadConversionTable();
      const sg = typeof density15ToSg === 'function'
        ? density15ToSg(dens, table.rdToDensity15)
        : null;
      if (sg != null) {
        hint.textContent = `≈ SG ${fmt(sg, 4)} (from density ${fmt(dens, 4)})`;
        document.getElementById('in-den-to-sg').value = dens;
        document.getElementById('in-sg').value = fmt(sg, 4);
      }
    } catch (_) { /* ignore */ }
  }

  document.getElementById('btn-api-den').onclick = async () => {
    const api = parseFloat(document.getElementById('in-api').value);
    if (Number.isNaN(api)) { showToast('Enter API'); return; }
    try {
      const table = await loadConversionTable();
      const dens = typeof apiToDensity15Lookup === 'function'
        ? apiToDensity15Lookup(api, table.apiToDensity15)
        : null;
      if (dens == null) { showToast('No conversion data'); return; }
      document.getElementById('in-density').value = dens;
      await syncSgHintFromDensity();
      showToast(`Density @15°C ≈ ${dens}`);
    } catch (e) { showToast(e.message); }
  };

  document.getElementById('btn-sg-den').onclick = async () => {
    const sg = parseFloat(document.getElementById('in-sg').value);
    if (Number.isNaN(sg)) { showToast('Enter SG / relative density'); return; }
    try {
      const table = await loadConversionTable();
      const dens = typeof sgToDensity15 === 'function'
        ? sgToDensity15(sg, table.rdToDensity15)
        : null;
      if (dens == null) { showToast('SG out of conversion table range'); return; }
      document.getElementById('in-density').value = dens;
      document.getElementById('in-den-to-sg').value = dens;
      document.getElementById('sg-equiv-hint').textContent = `SG ${fmt(sg, 4)} → density ${fmt(dens, 4)} kg/L`;
      showToast(`Density @15°C ≈ ${dens}`);
    } catch (e) { showToast(e.message); }
  };

  document.getElementById('btn-den-sg').onclick = async () => {
    const dens = parseFloat(document.getElementById('in-den-to-sg').value
      || document.getElementById('in-density').value);
    if (Number.isNaN(dens)) { showToast('Enter density @15°C'); return; }
    try {
      const table = await loadConversionTable();
      const sg = typeof density15ToSg === 'function'
        ? density15ToSg(dens, table.rdToDensity15)
        : null;
      if (sg == null) { showToast('Density out of conversion table range'); return; }
      document.getElementById('in-sg').value = sg;
      document.getElementById('in-density').value = dens;
      document.getElementById('sg-equiv-hint').textContent = `Density ${fmt(dens, 4)} → SG ${fmt(sg, 4)}`;
      showToast(`SG / RD ≈ ${sg}`);
    } catch (e) { showToast(e.message); }
  };

  document.getElementById('in-density').addEventListener('change', syncSgHintFromDensity);
  if (existing.density15 != null) syncSgHintFromDensity();

  if (existing.result) renderResultSteps(document.getElementById('result-panel'), tank, existing.result, existing);
  else document.getElementById('result-panel').innerHTML = '<div class="empty-state">Enter sounding and calculate</div>';
}

function renderResultSteps(panel, tank, r, inputs) {
  const pct = r.fillPercent;
  const cls = fillStatusClass(pct);
  const color = cls === 'bad' ? 'var(--bad)' : cls === 'warn' ? 'var(--warn)' : 'var(--good)';
  const circ = 2 * Math.PI * 34;
  const dash = Math.max(0, Math.min(100, pct || 0)) / 100 * circ;
  panel.innerHTML = `
    <div class="gauge-wrap">
      <div class="gauge-ring">
        <svg width="84" height="84"><circle cx="42" cy="42" r="34" stroke="var(--border)" stroke-width="8" fill="none"/>
        <circle cx="42" cy="42" r="34" stroke="${color}" stroke-width="8" fill="none"
          stroke-dasharray="${dash} ${circ}" stroke-linecap="round"/></svg>
        <div class="gauge-pct">${pct != null ? fmt(pct,0)+'%' : '–'}</div>
      </div>
      <div>
        <div style="font-size:22px;font-weight:800">${fmt(r.volumeObserved,2)} m³</div>
        <div style="color:var(--text-dim);font-size:12px">observed · cap ${fmt(tank.capacity,1)} m³</div>
        ${r.weightMT != null ? `<div style="margin-top:4px;font-weight:700;color:var(--accent-2)">${fmt(r.weightMT,3)} MT</div>` : ''}
      </div>
    </div>`;
  const steps = document.createElement('div');
  steps.className = 'steps';
  const defs = [];
  if (r.gaugeType === 'volume') {
    defs.push({ label: 'Volume gauge', formula: 'direct reading', value: fmt(inputs.reading,3)+' m³' });
    defs.push({ label: 'Observed volume', formula: 'clamped to capacity', value: fmt(r.volumeObserved,3)+' m³', highlight: true });
  } else if (tank.calcType === 'correction') {
    defs.push({
      label: 'Trim correction',
      formula: `Interp2 FLOOR/CEILING inc=${r.soundingIncrement ?? '?'} ÷ ${tank.correctionDivisor}`,
      value: fmt((r.trimCorrection||0)/(tank.correctionDivisor||1),3),
    });
    defs.push({
      label: 'List correction',
      formula: `Interp2 FLOOR/CEILING inc=${r.heelIncrement ?? '?'} ÷ ${tank.correctionDivisor}`,
      value: fmt((r.listCorrection||0)/(tank.correctionDivisor||1),3),
    });
    defs.push({ label: 'Corrected reading', formula: 'reading + corrections', value: fmt(r.correctedReading,2) });
    defs.push({ label: 'Observed volume', formula: 'volume curve interp', value: fmt(r.volumeObserved,3)+' m³', highlight: true });
  } else {
    defs.push({
      label: 'Observed volume',
      formula: `trim×heel grid · sounding inc=${r.soundingIncrement ?? '?'} · heel inc=${r.heelIncrement ?? '?'}`,
      value: fmt(r.volumeObserved,3)+' m³',
      highlight: true,
    });
  }
  if (r.vcf != null) {
    let sgNote = '';
    if (STATE.conversionTable?.rdToDensity15 && typeof density15ToSg === 'function') {
      const sgEq = density15ToSg(inputs.density15, STATE.conversionTable.rdToDensity15);
      if (sgEq != null) sgNote = ` · SG≈${fmt(sgEq, 4)}`;
    }
    defs.push({ label: 'VCF (ASTM 54B)', formula: `ρ15=${inputs.density15}${sgNote}, T=${inputs.tempC}°C`, value: fmt(r.vcf,4) });
    defs.push({ label: 'Vol @15°C', formula: 'obs × VCF', value: fmt(r.correctedVolume15,3)+' m³' });
    defs.push({ label: 'WCF', formula: 'ρ15 − 0.0011', value: fmt(r.wcf,4) });
    defs.push({ label: 'Weight in air', formula: 'vol15 × WCF', value: fmt(r.weightMT,3)+' MT', highlight: true });
  }
  for (const s of defs) {
    steps.innerHTML += `<div class="step${s.highlight?' highlight':''}">
      <div class="step-label">${s.label}<span class="formula">${s.formula}</span></div>
      <div class="step-value">${s.value}</div></div>`;
  }
  panel.appendChild(steps);
}

/* ---------- Add tank ---------- */
function renderAddTank(main) {
  main.innerHTML += `<div class="page-head"><div><h1>Add Tank</h1>
    <div class="desc">Manually add storage, settling, or service tanks. Calibration can be edited afterwards or imported via CSV.</div></div></div>
    <div class="help-box">Use role <b>storage</b>, <b>settling</b>, or <b>service</b> so bunkering distribution can target the right tanks. Side and tank number enable Port/Starboard and No.1/No.2 splits.</div>`;

  const form = document.createElement('div');
  form.className = 'form-panel';
  form.style.maxWidth = '720px';
  form.innerHTML = `
    <div class="form-row"><label>Tank name</label><input id="t-name" placeholder="NO.3 H.F.O. TANK (P)"></div>
    <div class="form-row-3">
      <div class="form-row"><label>Category</label>
        <select id="t-cat">${CATS.map(c=>`<option value="${c.id}">${c.label}</option>`).join('')}</select></div>
      <div class="form-row"><label>Role</label>
        <select id="t-role">
          <option value="storage">Storage</option>
          <option value="settling">Settling</option>
          <option value="service">Service</option>
          <option value="overflow">Overflow</option>
          <option value="other">Other</option>
        </select></div>
      <div class="form-row"><label>Fuel grade</label>
        <select id="t-grade">
          <option value="hfo">HFO</option><option value="lsfo">LSFO/VLSFO</option>
          <option value="mdo">MDO</option><option value="mgo">MGO</option><option value="other">Other</option>
        </select></div>
    </div>
    <div class="form-row-3">
      <div class="form-row"><label>Side</label>
        <select id="t-side"><option value="port">Port</option><option value="starboard">Starboard</option><option value="center" selected>Center</option></select></div>
      <div class="form-row"><label>Tank No.</label><input id="t-no" type="number" placeholder="1"></div>
      <div class="form-row"><label>Capacity (m³)</label><input id="t-cap" type="number" step="any"></div>
    </div>
    <div class="form-row-3">
      <div class="form-row"><label>Calc type</label>
        <select id="t-calc"><option value="correction">Correction (trim+list + curve)</option><option value="direct">Direct volume grid</option></select></div>
      <div class="form-row"><label>Sounding method</label>
        <select id="t-method"><option value="ullage">Ullage</option><option value="sounding">Sounding</option></select></div>
      <div class="form-row"><label>Pipe height</label><input id="t-pipe" type="number" step="any" value="0"></div>
    </div>
    <div class="btn-row">
      <button class="btn primary" id="btn-add-tank">Add tank</button>
      <a class="btn" href="/api/templates/tanks.csv">Download CSV template</a>
      <a class="btn" id="btn-export-tanks-csv" href="#">Export tanks CSV</a>
    </div>
    <div class="section-title">Import / edit tanks from CSV</div>
    <p class="hint">Upload the template or an exported tanks CSV. Matching <code>id</code> updates the tank (calibration tables are kept). New rows are created.</p>
    <input type="file" id="csv-file" accept=".csv,text/csv">
    <button class="btn" id="btn-import-csv" style="margin-top:8px">Import CSV</button>`;
  main.appendChild(form);

  const exportTanks = document.getElementById('btn-export-tanks-csv');
  if (exportTanks && STATE.activeVesselId) {
    exportTanks.href = `/api/vessels/${STATE.activeVesselId}/tanks.csv`;
  }

  document.getElementById('btn-add-tank').onclick = async () => {
    const name = document.getElementById('t-name').value.trim();
    if (!name) { showToast('Enter tank name'); return; }
    const tank = {
      name,
      category: document.getElementById('t-cat').value,
      fuelRole: document.getElementById('t-role').value,
      fuelGrade: document.getElementById('t-grade').value,
      side: document.getElementById('t-side').value,
      tankNo: document.getElementById('t-no').value ? Number(document.getElementById('t-no').value) : null,
      capacity: parseFloat(document.getElementById('t-cap').value) || 0,
      calcType: document.getElementById('t-calc').value,
      soundingMethod: document.getElementById('t-method').value,
      pipeHeight: parseFloat(document.getElementById('t-pipe').value) || 0,
      correctionDivisor: 10,
      volumeCurve: { x: [0], v: [0] },
      trimAxis: [], trimVals: [], trimGrid: [],
      listAxis: [], listVals: [], listGrid: [],
    };
    await Api.upsertTank(STATE.activeVesselId, tank);
    await reloadBundle();
    showToast('Tank added — open Calibration DB to enter tables');
    navigate('calibration');
  };

  document.getElementById('btn-import-csv').onclick = async () => {
    const file = document.getElementById('csv-file').files[0];
    if (!file) { showToast('Choose a CSV file'); return; }
    const res = await Api.importCsv(STATE.activeVesselId, file);
    await reloadBundle();
    const c = res.created ?? res.imported ?? 0;
    const u = res.updated ?? 0;
    showToast(u || c ? `Tanks CSV: ${u} updated, ${c} created` : `Imported ${res.imported || 0} tanks`);
  };
}

/* ---------- Calibration editor ---------- */
function renderCalibrationList(main) {
  if (STATE.route.tankId) return renderCalibrationEditor(main, STATE.route.tankId);

  const head = document.createElement('div');
  head.className = 'page-head';
  head.innerHTML = `<div><h1>Calibration Database</h1>
    <div class="desc">Excel-style sounding tables: edit in-app, or export/import CSV &amp; Excel per tank. Workbook import refreshes Tank1–Tank4 style sheets.</div></div>
    <div class="btn-row">
      <label class="btn">Import workbook<input type="file" id="excel-import" accept=".xlsm,.xlsx" hidden></label>
      <button class="btn" id="btn-import-repo-excel">Import repo workbook</button>
      <a class="btn" href="/api/templates/calibration.csv">Calibration CSV template</a>
    </div>`;
  main.appendChild(head);

  const help = document.createElement('div');
  help.className = 'help-box';
  help.innerHTML = `Reference format from <b>TANK MANAGEMENT CAPTAIN VENIAMIS FINAL VERSION.xlsm</b> sheets <b>Tank1–Tank4</b>:
    row headers = sounding/ullage (or Depth), column headers = trim (m), then SOUNDING CM / VOLUME, then list/heel table.
    <br>Per tank: <b>Export CSV / Excel</b> → edit in spreadsheet → <b>Import CSV/Excel</b>. Plain sounding×trim grids are accepted.
    <br>PDF capacity books: open a tank → <b>Import PDF</b> (text PDFs; scanned pages need OCR first).`;
  main.appendChild(help);

  const wrap = document.createElement('div');
  wrap.className = 'scroll-x form-panel';
  let rows = '';
  for (const t of allTanks()) {
    const hasCurve = (t.volumeCurve?.x?.length || 0) > 1 || (t.trimGrid?.length || 0) > 0;
    rows += `<tr class="clickable" data-id="${t.id}">
      <td class="tname">${escapeHtml(t.name)}</td>
      <td>${t.category}</td>
      <td>${t.fuelRole || ''}</td>
      <td>${t.calcType}</td>
      <td>${fmt(t.capacity,1)}</td>
      <td>${fmt((t.capacity||0)*0.85,1)}</td>
      <td><span class="pill ${hasCurve?'good':'warn'}">${hasCurve?'tables present':'needs data'}</span></td>
    </tr>`;
  }
  wrap.innerHTML = `<table class="data-table"><thead><tr>
    <th>Tank</th><th>Cat</th><th>Role</th><th>Type</th><th>100% m³</th><th>85% m³</th><th>Calibration</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
  main.appendChild(wrap);
  wrap.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.onclick = () => navigate('calibration', tr.dataset.id);
  });

  document.getElementById('excel-import').onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await Api.request(`/api/vessels/${STATE.activeVesselId}/import-excel`, { method: 'POST', body: fd });
      await reloadBundle();
      showToast(`Imported ${res.found?.length || 0} tank tables from workbook`);
      navigate('calibration');
    } catch (err) { showToast(err.message); }
  };
  document.getElementById('btn-import-repo-excel').onclick = async () => {
    try {
      const res = await Api.request(`/api/vessels/${STATE.activeVesselId}/import-excel`, { method: 'POST', body: { useRepoFile: true } });
      await reloadBundle();
      showToast(`Imported ${res.found?.length || 0} tank tables from repo workbook`);
      navigate('calibration');
    } catch (err) { showToast(err.message); }
  };
}

function renderCalibrationEditor(main, tankId) {
  const tank = findTank(tankId);
  if (!tank) { main.innerHTML += '<div class="empty-state">Tank not found</div>'; return; }

  const back = document.createElement('div');
  back.className = 'back-link';
  back.textContent = '← All tanks';
  back.onclick = () => navigate('calibration');
  main.appendChild(back);

  const isDirect = tank.calcType === 'direct';
  const head = document.createElement('div');
  head.className = 'page-head';
  head.innerHTML = `<div><h1>${escapeHtml(tank.name)}</h1>
    <div class="desc">Excel Tank-sheet layout · ${isDirect ? 'Depth × trim volume grid + heel table' : 'SOUNDING ullage × trim correction + volume curve + list/heel'} · 100% ${fmt(tank.capacity,2)} m³ · 85% ${fmt((tank.capacity||0)*0.85,2)} m³</div></div>
    <div class="btn-row">
      <button class="btn small" id="btn-back-tank">Back to tank</button>
      <a class="btn small" id="btn-export-csv" href="/api/vessels/${STATE.activeVesselId}/tanks/${tankId}/calibration.csv">Export CSV</a>
      <a class="btn small" id="btn-export-xlsx" href="/api/vessels/${STATE.activeVesselId}/tanks/${tankId}/calibration.xlsx">Export Excel</a>
      <label class="btn small">Import CSV/Excel<input type="file" id="table-import" accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label>
      <label class="btn small">Import PDF<input type="file" id="pdf-import" accept=".pdf,application/pdf" hidden></label>
      <button class="btn small" id="btn-export-tank">Export JSON</button>
      <button class="btn primary" id="btn-save-calib">Save calibration</button>
    </div>`;
  main.appendChild(head);
  document.getElementById('btn-back-tank').onclick = () => navigate(tank.category || 'fuel', tankId);

  document.getElementById('table-import').onchange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      showToast('Importing table…');
      const fd = new FormData();
      fd.append('file', file);
      fd.append('apply', 'true');
      const res = await Api.request(
        `/api/vessels/${STATE.activeVesselId}/tanks/${tankId}/import-table`,
        { method: 'POST', body: fd }
      );
      await reloadBundle();
      const parts = [];
      if (res.patch?.trimAxis) parts.push(`trim ${res.patch.trimAxis.length}×${(res.patch.trimVals || []).length}`);
      if (res.patch?.listAxis) parts.push(`list ${res.patch.listAxis.length}×${(res.patch.listVals || []).length}`);
      if (res.patch?.volumeCurve?.x) parts.push(`volume ${res.patch.volumeCurve.x.length}`);
      showToast(`Imported ${parts.join(', ') || 'calibration'}`);
      navigate('calibration', tankId);
    } catch (err) {
      showToast(err.message);
    }
  };

  const pdfPanel = document.createElement('div');
  pdfPanel.className = 'form-panel pdf-import-panel';
  pdfPanel.style.display = 'none';
  pdfPanel.innerHTML = `<div class="section-title" style="margin-top:0">PDF table import</div>
    <p class="hint" style="margin:0 0 10px">Extracted tables from the PDF. Choose which grid to apply (trim correction, list/heel, volume curve, or full).</p>
    <div id="pdf-tables"></div>`;
  main.appendChild(pdfPanel);

  document.getElementById('pdf-import').onchange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      showToast('Reading PDF tables…');
      const fd = new FormData();
      fd.append('file', file);
      fd.append('includeRaw', 'false');
      const res = await Api.request(`/api/vessels/${STATE.activeVesselId}/import-pdf`, { method: 'POST', body: fd });
      const tables = res.tables || [];
      if (!tables.length) {
        showToast('No tables found in this PDF');
        return;
      }
      pdfPanel.style.display = '';
      const box = document.getElementById('pdf-tables');
      box.innerHTML = tables.map((t) => {
        const preview = (t.preview || []).slice(0, 6).map((row) =>
          `<tr>${row.slice(0, 8).map((c) => `<td>${escapeHtml(String(c ?? ''))}</td>`).join('')}</tr>`
        ).join('');
        return `<div class="pdf-table-card" data-tid="${escapeHtml(t.id)}">
          <div class="pdf-table-head">
            <div><b>${escapeHtml(t.id)}</b> · page ${t.page} · ${t.rows}×${t.cols} · <span class="pill">${escapeHtml(t.kind || 'unknown')}</span>
              ${t.titleHint ? `<div class="hint">${escapeHtml(t.titleHint)}</div>` : ''}
            </div>
            <div class="btn-row">
              <select data-target>
                <option value="auto">Auto (${escapeHtml(t.kind || 'detect')})</option>
                <option value="full">Full (trim + list seed)</option>
                <option value="trim">Trim grid only</option>
                <option value="list">List / heel grid</option>
                <option value="volume">Volume curve</option>
              </select>
              <button class="btn primary small" data-apply>Apply to tank</button>
            </div>
          </div>
          <div class="scroll-x"><table class="data-table compact">${preview}</table></div>
        </div>`;
      }).join('');

      box.querySelectorAll('[data-apply]').forEach((btn) => {
        btn.onclick = async () => {
          const card = btn.closest('.pdf-table-card');
          const tableId = card.dataset.tid;
          const target = card.querySelector('[data-target]').value;
          const table = tables.find((x) => x.id === tableId);
          try {
            const res2 = await Api.request(
              `/api/vessels/${STATE.activeVesselId}/tanks/${tankId}/import-pdf`,
              {
                method: 'POST',
                body: { table, tableId, target, apply: true },
              }
            );
            await reloadBundle();
            showToast(`Applied ${res2.tableId || tableId} (${res2.kind || target})`);
            navigate('calibration', tankId);
          } catch (err) {
            showToast(err.message);
          }
        };
      });
      showToast(`Found ${tables.length} table(s) in ${res.pages || '?'} page(s)`);
    } catch (err) {
      showToast(err.message);
    }
  };

  const meta = document.createElement('div');
  meta.className = 'form-panel';
  const detectedInc = (typeof detectIncrement === 'function')
    ? detectIncrement(tank.trimAxis || [])
    : 1;
  const soundingInc = tank.soundingIncrement || detectedInc || 1;
  const heelInc = tank.heelIncrement || ((typeof detectIncrement === 'function')
    ? detectIncrement(tank.listAxis || tank.trimAxis || [])
    : soundingInc);
  const incOpts = [1, 2, 5, 10, 20, 25, 50];
  const optHtml = (selected) => incOpts.map((n) =>
    `<option value="${n}" ${Number(selected) === n ? 'selected' : ''}>${n}</option>`
  ).join('');

  meta.innerHTML = `
    <div class="form-row-3">
      <div class="form-row"><label>Calc type</label>
        <select id="c-type">
          <option value="correction" ${!isDirect?'selected':''}>correction (Tank1 style)</option>
          <option value="direct" ${isDirect?'selected':''}>direct (Tank2–4 style)</option>
        </select></div>
      <div class="form-row"><label>Capacity 100% m³</label><input id="c-cap" type="number" step="any" value="${tank.capacity||0}"></div>
      <div class="form-row"><label>Correction divisor</label><input id="c-div" type="number" step="any" value="${tank.correctionDivisor|| (isDirect?1:10)}"></div>
    </div>
    <div class="form-row-3">
      <div class="form-row"><label>Pipe height</label><input id="c-pipe" type="number" step="any" value="${tank.pipeHeight||0}"></div>
      <div class="form-row"><label>Sounding method</label>
        <select id="c-method">
          <option value="ullage" ${tank.soundingMethod==='ullage'?'selected':''}>ullage</option>
          <option value="sounding" ${tank.soundingMethod==='sounding'?'selected':''}>sounding</option>
        </select></div>
      <div class="form-row"><label>85% volume (ref)</label><input value="${fmt((tank.capacity||0)*0.85,2)}" disabled></div>
    </div>
    <div class="form-row-3">
      <div class="form-row"><label>Sounding table increment</label>
        <select id="c-sound-inc">${optHtml(soundingInc)}</select>
        <div class="hint">Excel-style FLOOR/CEILING double interp · detected ${detectedInc}</div></div>
      <div class="form-row"><label>List / heel increment</label>
        <select id="c-heel-inc">${optHtml(heelInc)}</select>
        <div class="hint">Usually same as sounding step (1, 2, 5, 10…)</div></div>
      <div class="form-row"><label>Table order</label>
        <input value="${(tank.trimVals||[])[0] > (tank.trimVals||[]).slice(-1)[0] ? 'Descending trim cols' : 'Ascending trim cols'}" disabled>
        <div class="hint">Both −2…+2 and +2…−2 are supported</div></div>
    </div>`;
  main.appendChild(meta);

  main.appendChild(buildExcelCalibrationTable(tank));

  document.getElementById('btn-save-calib').onclick = async () => {
    const parsed = readExcelCalibrationTable(tank);
    const calibration = {
      calcType: document.getElementById('c-type').value,
      capacity: parseFloat(document.getElementById('c-cap').value) || 0,
      correctionDivisor: parseFloat(document.getElementById('c-div').value) || 10,
      pipeHeight: parseFloat(document.getElementById('c-pipe').value) || 0,
      soundingMethod: document.getElementById('c-method').value,
      soundingIncrement: parseFloat(document.getElementById('c-sound-inc').value) || 1,
      heelIncrement: parseFloat(document.getElementById('c-heel-inc').value) || 1,
      ...parsed,
    };
    await Api.saveCalibration(STATE.activeVesselId, tankId, calibration);
    await reloadBundle();
    showToast('Calibration saved');
    navigate('calibration', tankId);
  };
  document.getElementById('btn-export-tank').onclick = () => {
    downloadJson(tank.id + '-calibration.json', findTank(tankId));
  };
}

/** Excel Tank1/Tank2-style combined calibration grid */
function buildExcelCalibrationTable(tank) {
  const panel = document.createElement('div');
  panel.className = 'form-panel excel-calib';
  panel.style.marginTop = '14px';

  const isDirect = tank.calcType === 'direct';
  const rowAxis = tank.trimAxis || [];
  const trimVals = tank.trimVals || [];
  const trimGrid = tank.trimGrid || [];
  const listAxis = tank.listAxis || [];
  const listVals = tank.listVals || [];
  const listGrid = tank.listGrid || [];
  const volX = tank.volumeCurve?.x || [];
  const volV = tank.volumeCurve?.v || [];
  const volMap = new Map(volX.map((x, i) => [Number(x), volV[i]]));

  const rowLabel = isDirect ? 'Depth' : 'SOUNDING ullage';
  const trimLabel = isDirect ? 'Trim → volume m³' : 'Trim (m) → correction';
  const listLabel = isDirect ? 'Heel (deg) → correction' : 'List / heel (deg) → correction';

  // Header row 1: section labels
  let head1 = `<th class="excel-corner">${escapeHtml(rowLabel)}</th>`;
  trimVals.forEach(() => { head1 += '<th class="excel-sec-trim"></th>'; });
  if (!isDirect) {
    head1 += '<th class="excel-sec-vol">SOUNDING CM</th><th class="excel-sec-vol">sounding VOLUME</th>';
  } else {
    head1 += '<th class="excel-gap"></th>';
  }
  if (listVals.length) {
    head1 += `<th class="excel-sec-list">${isDirect ? 'Depth' : 'sounding ullage'}</th>`;
    listVals.forEach(() => { head1 += '<th class="excel-sec-list"></th>'; });
  }

  // Header row 2: numeric trim / list values (editable)
  let head2 = '<th class="excel-corner-sub"></th>';
  trimVals.forEach((v, j) => {
    head2 += `<th class="excel-trim-h"><input type="number" step="any" data-excel="trimVal" data-j="${j}" value="${v}" title="${trimLabel}"></th>`;
  });
  if (!isDirect) {
    head2 += '<th></th><th></th>';
  } else {
    head2 += '<th></th>';
  }
  if (listVals.length) {
    head2 += '<th></th>';
    listVals.forEach((v, j) => {
      head2 += `<th class="excel-list-h"><input type="number" step="any" data-excel="listVal" data-j="${j}" value="${v}" title="${listLabel}"></th>`;
    });
  }

  const nRows = Math.max(rowAxis.length, listAxis.length, isDirect ? 0 : volX.length, 1);
  let body = '';
  for (let i = 0; i < nRows; i++) {
    const ra = rowAxis[i];
    body += '<tr>';
    body += `<td class="excel-rowh"><input type="number" step="any" data-excel="rowAxis" data-i="${i}" value="${ra ?? ''}"></td>`;
    for (let j = 0; j < trimVals.length; j++) {
      const val = trimGrid[i] && trimGrid[i][j] != null ? trimGrid[i][j] : '';
      body += `<td class="excel-trim"><input type="number" step="any" data-excel="trimGrid" data-r="${i}" data-c="${j}" value="${val}"></td>`;
    }
    if (!isDirect) {
      // Prefer matching volume curve by sounding axis when available
      const volAtRow = (ra != null && volMap.has(Number(ra)))
        ? volMap.get(Number(ra))
        : (volV[i] ?? '');
      const xAtRow = (ra != null) ? ra : (volX[i] ?? '');
      body += `<td class="excel-vol"><input type="number" step="any" data-excel="volX" data-i="${i}" value="${xAtRow ?? ''}"></td>`;
      body += `<td class="excel-vol"><input type="number" step="any" data-excel="volV" data-i="${i}" value="${volAtRow ?? ''}"></td>`;
    } else {
      body += '<td class="excel-gap"></td>';
    }
    if (listVals.length) {
      const la = listAxis[i] ?? '';
      body += `<td class="excel-rowh"><input type="number" step="any" data-excel="listAxis" data-i="${i}" value="${la}"></td>`;
      for (let j = 0; j < listVals.length; j++) {
        const val = listGrid[i] && listGrid[i][j] != null ? listGrid[i][j] : '';
        body += `<td class="excel-list"><input type="number" step="any" data-excel="listGrid" data-r="${i}" data-c="${j}" value="${val}"></td>`;
      }
    }
    body += '</tr>';
  }

  panel.innerHTML = `
    <div class="section-title" style="margin-top:0">Calibration table
      <span class="tag">${nRows} rows · trim ${trimVals.length} cols${listVals.length ? ` · list ${listVals.length} cols` : ''}</span>
      <button type="button" class="btn small" id="btn-add-calib-row" style="margin-left:auto">+ row</button>
    </div>
    <div class="hint" style="color:var(--text-faint);font-size:12px;margin-bottom:8px">
      Matches workbook sheets Tank1–Tank4: left = ${escapeHtml(rowLabel)} × trim${isDirect ? ' volume' : ' correction'}; 
      ${isDirect ? '' : 'center = SOUNDING CM / VOLUME; '}right = list/heel table. Edit any cell, then Save.
    </div>
    <div class="scroll-x excel-scroll">
      <table class="calib-table excel-table" id="excel-calib-table">
        <thead>
          <tr class="excel-head-1">${head1}</tr>
          <tr class="excel-head-2">${head2}</tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;

  panel.querySelector('#btn-add-calib-row').onclick = () => {
    const table = panel.querySelector('#excel-calib-table tbody');
    const i = table.children.length;
    const trimN = panel.querySelectorAll('thead input[data-excel="trimVal"]').length;
    const listN = panel.querySelectorAll('thead input[data-excel="listVal"]').length;
    const tr = document.createElement('tr');
    let html = `<td class="excel-rowh"><input type="number" step="any" data-excel="rowAxis" data-i="${i}" value=""></td>`;
    for (let j = 0; j < trimN; j++) html += `<td class="excel-trim"><input type="number" step="any" data-excel="trimGrid" data-r="${i}" data-c="${j}" value=""></td>`;
    if (!isDirect) {
      html += `<td class="excel-vol"><input type="number" step="any" data-excel="volX" data-i="${i}" value=""></td>`;
      html += `<td class="excel-vol"><input type="number" step="any" data-excel="volV" data-i="${i}" value=""></td>`;
    } else html += '<td class="excel-gap"></td>';
    if (listN) {
      html += `<td class="excel-rowh"><input type="number" step="any" data-excel="listAxis" data-i="${i}" value=""></td>`;
      for (let j = 0; j < listN; j++) html += `<td class="excel-list"><input type="number" step="any" data-excel="listGrid" data-r="${i}" data-c="${j}" value=""></td>`;
    }
    tr.innerHTML = html;
    table.appendChild(tr);
  };
  return panel;
}

function readExcelCalibrationTable(tank) {
  const isDirect = document.getElementById('c-type')?.value === 'direct' || tank.calcType === 'direct';
  const trimVals = Array.from(document.querySelectorAll('input[data-excel="trimVal"]'))
    .map((el) => parseFloat(el.value)).filter((n) => !Number.isNaN(n));
  const listVals = Array.from(document.querySelectorAll('input[data-excel="listVal"]'))
    .map((el) => parseFloat(el.value)).filter((n) => !Number.isNaN(n));

  const rowInputs = Array.from(document.querySelectorAll('input[data-excel="rowAxis"]'));
  const trimAxis = [];
  const trimGrid = [];
  const listAxis = [];
  const listGrid = [];
  const volX = [];
  const volV = [];

  rowInputs.forEach((el, i) => {
    const ra = parseFloat(el.value);
    const hasTrim = trimVals.some((_, j) => {
      const cell = document.querySelector(`input[data-excel="trimGrid"][data-r="${i}"][data-c="${j}"]`);
      return cell && cell.value !== '';
    });
    const volXEl = document.querySelector(`input[data-excel="volX"][data-i="${i}"]`);
    const volVEl = document.querySelector(`input[data-excel="volV"][data-i="${i}"]`);
    const listAEl = document.querySelector(`input[data-excel="listAxis"][data-i="${i}"]`);
    if (Number.isNaN(ra) && !hasTrim && !(volXEl && volXEl.value !== '')) return;

    if (!Number.isNaN(ra)) {
      trimAxis.push(ra);
      const row = trimVals.map((_, j) => {
        const cell = document.querySelector(`input[data-excel="trimGrid"][data-r="${i}"][data-c="${j}"]`);
        const n = cell ? parseFloat(cell.value) : 0;
        return Number.isNaN(n) ? 0 : n;
      });
      trimGrid.push(row);
    }

    if (!isDirect && volXEl && volVEl && volXEl.value !== '' && volVEl.value !== '') {
      const x = parseFloat(volXEl.value);
      const v = parseFloat(volVEl.value);
      if (!Number.isNaN(x) && !Number.isNaN(v)) { volX.push(x); volV.push(v); }
    } else if (!isDirect && !Number.isNaN(ra) && volVEl && volVEl.value !== '') {
      const v = parseFloat(volVEl.value);
      if (!Number.isNaN(v)) { volX.push(ra); volV.push(v); }
    }

    if (listAEl && listAEl.value !== '') {
      const la = parseFloat(listAEl.value);
      if (!Number.isNaN(la)) {
        listAxis.push(la);
        listGrid.push(listVals.map((_, j) => {
          const cell = document.querySelector(`input[data-excel="listGrid"][data-r="${i}"][data-c="${j}"]`);
          const n = cell ? parseFloat(cell.value) : 0;
          return Number.isNaN(n) ? 0 : n;
        }));
      }
    }
  });

  return {
    trimAxis,
    trimVals,
    trimGrid,
    listAxis,
    listVals,
    listGrid,
    volumeCurve: { x: volX, v: volV },
  };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function parseNumList(text) {
  return String(text || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

function parseGrid(text) {
  return String(text || '')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseNumList(line));
}

function gridToText(grid) {
  if (!Array.isArray(grid)) return '';
  return grid.map((row) => (Array.isArray(row) ? row.join(', ') : '')).join('\n');
}

/* ---------- Voyage fuel calculation ---------- */
function legMetrics(leg) {
  const distance = parseFloat(leg.distance) || 0;
  const speed = parseFloat(leg.speed) || 0;
  const daily = parseFloat(leg.daily) || 0;
  const days = speed > 0 ? distance / speed / 24 : 0;
  return { days, consumption: daily * days };
}

function renderVoyage(main) {
  main.innerHTML += `<div class="page-head"><div><h1>Voyage Fuel Calculation</h1>
    <div class="desc">Plan consumption by leg. Arrival ROB = Departure ROB + Received − Consumed − Safety margin.</div></div>
    <button class="btn primary" id="btn-save-voyage-plan">Save plan</button></div>`;

  const fuels = [
    ['hfo', 'HFO'],
    ['lsfo', 'LSFO / VLSFO'],
    ['mdo', 'MDO'],
    ['mgo', 'MGO'],
  ];
  if (!STATE.bundle.bunkering) STATE.bundle.bunkering = {};
  const panels = document.createElement('div');
  panels.className = 'fuel-panels';

  for (const [key, label] of fuels) {
    if (!STATE.bundle.bunkering[key]) {
      STATE.bundle.bunkering[key] = {
        departureRob: 0, received: 0, margin: 0,
        legs: Array.from({ length: 8 }, () => ({ from:'', to:'', distance:'', speed:'', daily:'', port:false })),
      };
    }
    const b = STATE.bundle.bunkering[key];
    let totalC = 0, totalD = 0;
    let legRows = '';
    b.legs.forEach((leg, i) => {
      const { days, consumption } = legMetrics(leg);
      totalC += consumption; totalD += days;
      legRows += `<tr>
        <td><input data-k="${key}" data-i="${i}" data-f="from" value="${leg.from||''}"></td>
        <td><input data-k="${key}" data-i="${i}" data-f="to" value="${leg.to||''}"></td>
        <td><input data-k="${key}" data-i="${i}" data-f="distance" type="number" value="${leg.distance||''}"></td>
        <td><input data-k="${key}" data-i="${i}" data-f="speed" type="number" value="${leg.speed||''}"></td>
        <td><input data-k="${key}" data-i="${i}" data-f="daily" type="number" value="${leg.daily||''}"></td>
        <td>${fmt(days,2)}</td><td>${fmt(consumption,2)}</td></tr>`;
    });
    const arrival = (Number(b.departureRob)||0) + (Number(b.received)||0) - totalC - (Number(b.margin)||0);
    const panel = document.createElement('div');
    panel.className = 'form-panel';
    panel.innerHTML = `<div class="section-title" style="margin-top:0">${label}</div>
      <div class="kv-row"><span class="k">Departure ROB (MT)</span><input type="number" data-bk="${key}" data-bf="departureRob" value="${b.departureRob||0}"></div>
      <div class="kv-row"><span class="k">Received (MT)</span><input type="number" data-bk="${key}" data-bf="received" value="${b.received||0}"></div>
      <div class="kv-row"><span class="k">Safety margin (MT)</span><input type="number" data-bk="${key}" data-bf="margin" value="${b.margin||0}"></div>
      <div class="scroll-x" style="margin-top:10px"><table class="leg-table">
        <thead><tr><th>From</th><th>To</th><th>Dist</th><th>Spd</th><th>Daily</th><th>Days</th><th>Used</th></tr></thead>
        <tbody>${legRows}</tbody></table></div>
      <div class="kv-row"><span class="k">Voyage days</span><span class="v">${fmt(totalD,2)}</span></div>
      <div class="kv-row"><span class="k">Total consumption</span><span class="v">${fmt(totalC,2)} MT</span></div>
      <div class="kv-row total"><span class="k">Projected arrival ROB</span>
        <span class="v" style="color:${arrival<0?'var(--bad)':'var(--accent-2)'}">${fmt(arrival,2)} MT</span></div>`;
    panels.appendChild(panel);
  }
  main.appendChild(panels);

  const bind = () => {
    main.querySelectorAll('input[data-k]').forEach((inp) => {
      inp.onchange = () => {
        const { k, i, f } = inp.dataset;
        STATE.bundle.bunkering[k].legs[Number(i)][f] = inp.value;
        renderVoyage(main); // refresh computed
        // re-bind after re-render happens inside navigate-like clear — handled by full re-render:
      };
    });
  };

  // Use event delegation on panels to avoid full re-render loops
  panels.querySelectorAll('input[data-k]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const { k, i, f } = inp.dataset;
      STATE.bundle.bunkering[k].legs[Number(i)][f] = inp.value;
      navigate('voyage');
    });
  });
  panels.querySelectorAll('input[data-bk]').forEach((inp) => {
    inp.addEventListener('change', () => {
      STATE.bundle.bunkering[inp.dataset.bk][inp.dataset.bf] = parseFloat(inp.value) || 0;
      navigate('voyage');
    });
  });

  document.getElementById('btn-save-voyage-plan').onclick = async () => {
    await persistPart('bunkering', STATE.bundle.bunkering);
    showToast('Voyage fuel plan saved');
  };
}

/* ---------- Bunkering with live operation + blend ---------- */
let _bunkerLiveTimer = null;

function stopBunkerLiveTimer() {
  if (_bunkerLiveTimer) {
    clearInterval(_bunkerLiveTimer);
    _bunkerLiveTimer = null;
  }
}

function collectBunkerPlanBody() {
  const mode = document.querySelector('input[name="b-mode"]:checked')?.value || 'equal-storage';
  const manual = {};
  if (mode === 'manual') {
    document.querySelectorAll('[data-manual]').forEach((el) => {
      manual[el.dataset.manual] = parseFloat(el.value) || 0;
    });
  }
  return {
    quantityMT: parseFloat(document.getElementById('b-qty').value) || 0,
    fuelGrade: document.getElementById('b-grade').value,
    density15: document.getElementById('b-dens').value === '' ? null : parseFloat(document.getElementById('b-dens').value),
    tempC: parseFloat(document.getElementById('b-temp').value) || 15,
    rateMTPerHour: parseFloat(document.getElementById('b-rate').value) || 0,
    mode,
    manual,
    bdn: {
      bdnNo: document.getElementById('b-bdn').value,
      supplier: document.getElementById('b-sup').value,
    },
  };
}

function renderBunkering(main) {
  stopBunkerLiveTimer();
  main.innerHTML += `<div class="page-head"><div><h1>Bunkering Operation</h1>
    <div class="desc">Plan MT to receive, start a live op with pumping rate (time used / remaining), watch tank intake, and blend fuels of different density.</div></div></div>
    <div class="help-box">Enter <b>MT to receive</b> and <b>pumping rate (MT/h)</b>, choose distribution, then <b>Start live operation</b>.
    Live view shows total intake, time used, time remaining, and projected tank levels. Use the mix calculator when ROB and bunker density differ.</div>`;

  const activeWrap = document.createElement('div');
  activeWrap.id = 'bunker-live-wrap';
  main.appendChild(activeWrap);

  const panel = document.createElement('div');
  panel.className = 'form-panel';
  panel.id = 'bunker-plan-panel';
  panel.innerHTML = `
    <div class="section-title" style="margin-top:0">Bunker plan — quantity to receive</div>
    <div class="form-row-3">
      <div class="form-row"><label>Fuel grade</label>
        <select id="b-grade"><option value="hfo">HFO</option><option value="lsfo">LSFO</option>
        <option value="mdo">MDO</option><option value="mgo">MGO</option></select></div>
      <div class="form-row"><label>Quantity to receive (MT)</label><input id="b-qty" type="number" step="any" placeholder="e.g. 450"></div>
      <div class="form-row"><label>Pumping rate (MT/h)</label><input id="b-rate" type="number" step="any" placeholder="e.g. 120"></div>
    </div>
    <div class="form-row-3">
      <div class="form-row"><label>Density @15°C (BDN)</label><input id="b-dens" type="number" step="any" placeholder="0.958"></div>
      <div class="form-row"><label>SG / RD (optional)</label>
        <div style="display:flex;gap:6px">
          <input id="b-sg" type="number" step="any" placeholder="0.959">
          <button type="button" class="btn small" id="btn-b-sg-den" title="SG to density">SG→ρ</button>
          <button type="button" class="btn small" id="btn-b-den-sg" title="Density to SG">ρ→SG</button>
        </div>
        <div class="hint" id="b-sg-hint">Convert using workbook Conversion sheet</div>
      </div>
      <div class="form-row"><label>Temp (°C)</label><input id="b-temp" type="number" step="any" value="15"></div>
    </div>
    <div class="form-row-3">
      <div class="form-row"><label>BDN No.</label><input id="b-bdn" placeholder="BDN-..."></div>
      <div class="form-row"><label>Supplier / Barge</label><input id="b-sup" placeholder="Supplier"></div>
      <div class="form-row"><label>Est. duration</label><input id="b-eta-preview" disabled placeholder="enter qty + rate"></div>
    </div>
    <div class="form-row"><label>Distribution mode</label></div>
    <div class="distrib-grid" id="distrib-modes">
      ${[
        ['equal-storage','Equal — all storage'],
        ['port-storage','Port storage only'],
        ['starboard-storage','Starboard storage only'],
        ['no1-storage','No.1 tanks only'],
        ['no2-storage','No.2 tanks only'],
        ['settling','Settling tanks'],
        ['service','Service tanks'],
        ['manual','Manual per tank'],
      ].map(([v,l],i)=>`<label class="distrib-opt${i===0?' active':''}"><input type="radio" name="b-mode" value="${v}" ${i===0?'checked':''}>${l}</label>`).join('')}
    </div>
    <div id="manual-alloc" style="display:none"></div>
    <div class="btn-row">
      <button class="btn primary" id="btn-start-live">Start live operation</button>
      <button class="btn" id="btn-preview-bunker">Preview distribution</button>
      <button class="btn" id="btn-apply-bunker">Apply instantly (no live)</button>
    </div>
    <div id="bunker-result" style="margin-top:14px"></div>`;
  main.appendChild(panel);

  // Mix calculator
  const mix = document.createElement('div');
  mix.className = 'form-panel';
  mix.style.marginTop = '18px';
  mix.innerHTML = `
    <div class="section-title" style="margin-top:0">Mix calculator — different densities</div>
    <p class="hint" style="margin-top:0">Blend ROB already on board with incoming bunker (or any parcels). Uses ASTM WCF volume @15°C by default.</p>
    <div class="scroll-x">
      <table class="data-table" id="mix-table">
        <thead><tr><th>Parcel</th><th>Density @15</th><th>Quantity MT</th><th>Volume m³ (opt.)</th><th>Temp °C</th></tr></thead>
        <tbody>
          <tr>
            <td><input data-mix="label" value="ROB on board"></td>
            <td><input data-mix="density15" type="number" step="any" placeholder="0.960"></td>
            <td><input data-mix="quantityMT" type="number" step="any" placeholder="200"></td>
            <td><input data-mix="volumeM3" type="number" step="any" placeholder=""></td>
            <td><input data-mix="tempC" type="number" step="any" value="15"></td>
          </tr>
          <tr>
            <td><input data-mix="label" value="Incoming bunker"></td>
            <td><input data-mix="density15" type="number" step="any" placeholder="0.945"></td>
            <td><input data-mix="quantityMT" type="number" step="any" placeholder="450"></td>
            <td><input data-mix="volumeM3" type="number" step="any" placeholder=""></td>
            <td><input data-mix="tempC" type="number" step="any" value="15"></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="form-row-3" style="margin-top:10px">
      <div class="form-row"><label>Method</label>
        <select id="mix-method">
          <option value="wcf">WCF volume @15°C (recommended)</option>
          <option value="mass">Mass-weighted density</option>
        </select></div>
      <div class="form-row" style="display:flex;align-items:flex-end;gap:8px">
        <button class="btn" id="btn-mix-add">Add parcel</button>
        <button class="btn primary" id="btn-mix-calc">Calculate blend</button>
      </div>
    </div>
    <div id="mix-result" style="margin-top:12px"></div>`;
  main.appendChild(mix);

  const modes = document.getElementById('distrib-modes');
  modes.querySelectorAll('input').forEach((inp) => {
    inp.onchange = () => {
      modes.querySelectorAll('.distrib-opt').forEach((el) => el.classList.remove('active'));
      inp.closest('.distrib-opt').classList.add('active');
      document.getElementById('manual-alloc').style.display = inp.value === 'manual' ? '' : 'none';
      if (inp.value === 'manual') renderManualAlloc();
    };
  });

  function updateEtaPreview() {
    const qty = parseFloat(document.getElementById('b-qty').value) || 0;
    const rate = parseFloat(document.getElementById('b-rate').value) || 0;
    const el = document.getElementById('b-eta-preview');
    if (!el) return;
    if (qty > 0 && rate > 0) el.value = formatDuration((qty / rate) * 3600000);
    else el.value = '';
  }
  document.getElementById('b-qty').oninput = updateEtaPreview;
  document.getElementById('b-rate').oninput = updateEtaPreview;

  async function bunkerLoadConversion() {
    if (STATE.conversionTable) return STATE.conversionTable;
    const table = await Api.request('/api/reference/conversion');
    STATE.conversionTable = table;
    return table;
  }
  document.getElementById('btn-b-sg-den').onclick = async () => {
    const sg = parseFloat(document.getElementById('b-sg').value);
    if (Number.isNaN(sg)) { showToast('Enter SG / relative density'); return; }
    try {
      const table = await bunkerLoadConversion();
      const dens = sgToDensity15(sg, table.rdToDensity15);
      if (dens == null) { showToast('SG out of table range'); return; }
      document.getElementById('b-dens').value = dens;
      document.getElementById('b-sg-hint').textContent = `SG ${fmt(sg, 4)} → density ${fmt(dens, 4)} kg/L`;
      showToast(`BDN density ≈ ${dens}`);
    } catch (e) { showToast(e.message); }
  };
  document.getElementById('btn-b-den-sg').onclick = async () => {
    const dens = parseFloat(document.getElementById('b-dens').value);
    if (Number.isNaN(dens)) { showToast('Enter density @15°C first'); return; }
    try {
      const table = await bunkerLoadConversion();
      const sg = density15ToSg(dens, table.rdToDensity15);
      if (sg == null) { showToast('Density out of table range'); return; }
      document.getElementById('b-sg').value = sg;
      document.getElementById('b-sg-hint').textContent = `Density ${fmt(dens, 4)} → SG ${fmt(sg, 4)}`;
      showToast(`SG / RD ≈ ${sg}`);
    } catch (e) { showToast(e.message); }
  };

  function renderManualAlloc() {
    const grade = document.getElementById('b-grade').value;
    const tanks = (STATE.bundle.tanks.fuel || []).filter((t) => !t.fuelGrade || t.fuelGrade === grade || t.fuelGrade === 'other' || (grade==='hfo'&&t.fuelGrade==='lsfo'));
    document.getElementById('manual-alloc').innerHTML = `<table class="data-table"><thead><tr><th>Tank</th><th>Role</th><th>Free (approx m³)</th><th>Allocate MT</th></tr></thead><tbody>
      ${tanks.map((t) => {
        const r = getReading(t.id);
        const free = Math.max(0, (t.capacity||0) - (r?.result?.volumeObserved||0));
        return `<tr><td>${escapeHtml(t.name)}</td><td>${t.fuelRole}</td><td>${fmt(free,1)}</td>
          <td><input type="number" step="any" data-manual="${t.id}" value="0" style="width:100px;background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:6px"></td></tr>`;
      }).join('')}
    </tbody></table>`;
  }

  async function runInstant(apply) {
    const body = { ...collectBunkerPlanBody(), apply };
    try {
      const res = await Api.bunkerDistribute(STATE.activeVesselId, body);
      if (apply) await reloadBundle();
      const el = document.getElementById('bunker-result');
      el.innerHTML = `<div class="section-title">Distribution ${apply ? 'applied' : 'preview'}</div>
        <table class="data-table"><thead><tr><th>Tank</th><th>Side</th><th>Before MT</th><th>Add MT</th><th>After vol</th></tr></thead><tbody>
        ${(res.allocations||[]).map((a)=>`<tr>
          <td>${escapeHtml(a.name)}</td><td>${a.side||''}</td><td>${fmt(a.beforeWeight,2)}</td>
          <td><b>${fmt(a.mt,3)}</b></td><td>${a.afterVolume!=null?fmt(a.afterVolume,2):'–'}</td>
        </tr>`).join('')}
        </tbody></table>`;
      showToast(apply ? 'Bunker applied to tanks' : 'Preview ready');
    } catch (e) {
      showToast(e.message);
    }
  }

  document.getElementById('btn-preview-bunker').onclick = () => runInstant(false);
  document.getElementById('btn-apply-bunker').onclick = () => {
    if (!confirm('Apply full bunker quantity to tank ROB readings immediately?')) return;
    runInstant(true);
  };
  document.getElementById('btn-start-live').onclick = async () => {
    const body = collectBunkerPlanBody();
    if (!(body.quantityMT > 0)) { showToast('Enter quantity to receive (MT)'); return; }
    if (!(body.rateMTPerHour > 0)) { showToast('Enter pumping rate (MT/h) for live timing'); return; }
    try {
      const res = await Api.bunkerStart(STATE.activeVesselId, body);
      await reloadBundle();
      showToast('Live bunkering started');
      renderLiveBunkerPanel(res.operation);
    } catch (e) {
      showToast(e.message);
      if (e.message?.includes('already in progress')) loadActiveBunker();
    }
  };

  // Mix calculator handlers
  document.getElementById('btn-mix-add').onclick = () => {
    const tb = document.querySelector('#mix-table tbody');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input data-mix="label" value="Parcel"></td>
      <td><input data-mix="density15" type="number" step="any"></td>
      <td><input data-mix="quantityMT" type="number" step="any"></td>
      <td><input data-mix="volumeM3" type="number" step="any"></td>
      <td><input data-mix="tempC" type="number" step="any" value="15"></td>`;
    tb.appendChild(tr);
  };
  document.getElementById('btn-mix-calc').onclick = () => {
    const parts = [];
    document.querySelectorAll('#mix-table tbody tr').forEach((tr) => {
      const get = (k) => tr.querySelector(`[data-mix="${k}"]`)?.value;
      const dens = parseFloat(get('density15'));
      const mt = get('quantityMT');
      const vol = get('volumeM3');
      if (!(dens > 0)) return;
      if (mt === '' && vol === '') return;
      parts.push({
        label: get('label') || '',
        density15: dens,
        quantityMT: mt === '' ? null : parseFloat(mt),
        volumeM3: vol === '' ? null : parseFloat(vol),
        tempC: parseFloat(get('tempC')) || 15,
      });
    });
    const method = document.getElementById('mix-method').value;
    const result = typeof blendFuels === 'function'
      ? blendFuels(parts, method)
      : null;
    const box = document.getElementById('mix-result');
    if (!result || !result.blendedDensity15) {
      box.innerHTML = '<div class="hint">Enter at least two parcels with density and MT (or volume).</div>';
      return;
    }
    // Also offer to copy blended density into bunker plan
    box.innerHTML = `<div class="bunker-mix-result">
      <div class="bunker-stat"><div class="bunker-stat-label">Blended density @15°C</div><div class="bunker-stat-value">${fmt(result.blendedDensity15, 4)}</div></div>
      <div class="bunker-stat"><div class="bunker-stat-label">Total quantity</div><div class="bunker-stat-value">${fmt(result.totalMT, 3)} MT</div></div>
      <div class="bunker-stat"><div class="bunker-stat-label">Total vol @15°C</div><div class="bunker-stat-value">${fmt(result.totalVol15, 2)} m³</div></div>
      <div class="bunker-stat"><div class="bunker-stat-label">Blended WCF</div><div class="bunker-stat-value">${fmt(result.blendedWcf, 4)}</div></div>
    </div>
    <div class="btn-row" style="margin-top:10px">
      <button class="btn small" id="btn-mix-to-plan">Use density in bunker plan</button>
      <button class="btn small" id="btn-mix-qty-to-plan">Use total MT as quantity to receive</button>
    </div>
    <table class="data-table" style="margin-top:10px"><thead><tr><th>Parcel</th><th>ρ15</th><th>MT</th><th>m³@15</th></tr></thead>
    <tbody>${result.parts.map((p)=>`<tr><td>${escapeHtml(p.label)}</td><td>${fmt(p.density15,4)}</td><td>${fmt(p.quantityMT,3)}</td><td>${fmt(p.volume15,2)}</td></tr>`).join('')}</tbody></table>`;
    document.getElementById('btn-mix-to-plan').onclick = () => {
      document.getElementById('b-dens').value = result.blendedDensity15;
      showToast('Blended density copied to bunker plan');
    };
    document.getElementById('btn-mix-qty-to-plan').onclick = () => {
      document.getElementById('b-qty').value = result.totalMT;
      updateEtaPreview();
      showToast('Total MT copied to quantity to receive');
    };
  };

  // History
  const ops = STATE.bundle.bunkerOps || [];
  if (ops.length) {
    const hist = document.createElement('div');
    hist.className = 'form-panel';
    hist.style.marginTop = '18px';
    hist.innerHTML = `<div class="section-title" style="margin-top:0">Recent bunker ops</div>
      <table class="data-table"><thead><tr><th>Date</th><th>Status</th><th>Grade</th><th>Planned</th><th>Received</th><th>Rate</th><th>BDN</th></tr></thead>
      <tbody>${ops.slice(0,12).map((o)=>`<tr>
        <td>${(o.createdAt||'').slice(0,16).replace('T',' ')}</td>
        <td><span class="pill ${o.status==='active'||o.status==='paused'?'warn':(o.status==='completed'?'good':'')}">${o.status||(o.applied?'completed':'preview')}</span></td>
        <td>${o.fuelGrade}</td>
        <td>${fmt(o.quantityMT??o.plannedMT,2)}</td>
        <td>${o.receivedMT!=null?fmt(o.receivedMT,2):'–'}</td>
        <td>${o.rateMTPerHour?fmt(o.rateMTPerHour,1):'–'}</td>
        <td>${escapeHtml(o.bdn?.bdnNo||'–')}</td></tr>`).join('')}</tbody></table>`;
    main.appendChild(hist);
  }

  async function loadActiveBunker() {
    try {
      const res = await Api.bunkerActive(STATE.activeVesselId);
      if (res.active) renderLiveBunkerPanel(res.active);
      else {
        stopBunkerLiveTimer();
        activeWrap.innerHTML = '';
        panel.style.display = '';
      }
    } catch (_) { /* ignore */ }
  }

  function renderLiveBunkerPanel(op) {
    panel.style.display = 'none';
    let current = op;

    function paint() {
      const live = typeof bunkerProgress === 'function'
        ? bunkerProgress({
          plannedMT: current.quantityMT ?? current.plannedMT,
          receivedMT: current.intakeMode === 'manual' ? current.receivedMT : null,
          rateMTPerHour: current.rateMTPerHour,
          startedAt: current.startedAt,
          pausedAt: current.status === 'paused' ? (current.pausedAt || new Date().toISOString()) : null,
          elapsedPausedMs: current.elapsedPausedMs || 0,
        })
        : (current.progress || {});

      // Project tanks locally for smooth UI
      const planned = live.plannedMT || 1;
      const received = live.receivedMT || 0;
      const dens = current.density15;
      const tempC = current.tempC ?? 15;
      const tanks = (current.allocations || []).map((a) => {
        const share = (Number(a.mt) || 0) / planned;
        const receivedTank = Math.round(received * share * 1000) / 1000;
        const addVol = dens && typeof volumeFromMT === 'function' ? volumeFromMT(receivedTank, dens, tempC) : null;
        return {
          ...a,
          receivedMT: receivedTank,
          currentWeight: (a.beforeWeight || 0) + receivedTank,
          currentVolume: addVol != null ? (a.beforeVolume || 0) + addVol : null,
          targetWeight: (a.beforeWeight || 0) + (Number(a.mt) || 0),
        };
      });

      const pct = Math.min(100, live.percentComplete || 0);
      activeWrap.innerHTML = `
        <div class="form-panel bunker-live">
          <div class="bunker-live-head">
            <div>
              <div class="section-title" style="margin-top:0">Live bunkering · ${escapeHtml((current.fuelGrade||'').toUpperCase())}
                <span class="pill ${current.status==='paused'?'warn':'good'}">${current.status||'active'}</span>
              </div>
              <div class="hint">BDN ${escapeHtml(current.bdn?.bdnNo||'–')} · mode ${escapeHtml(current.mode||'')} · started ${(current.startedAt||'').slice(0,16).replace('T',' ')}</div>
            </div>
            <div class="btn-row">
              ${current.status==='paused'
                ? '<button class="btn primary small" id="btn-live-resume">Resume</button>'
                : '<button class="btn small" id="btn-live-pause">Pause</button>'}
              <button class="btn small" id="btn-live-sync">Sync tanks now</button>
              <button class="btn primary small" id="btn-live-complete">Complete (current intake)</button>
              <button class="btn small" id="btn-live-complete-full">Complete (full planned)</button>
              <button class="btn small" id="btn-live-cancel">Cancel</button>
            </div>
          </div>

          <div class="bunker-kpi-grid">
            <div class="bunker-stat"><div class="bunker-stat-label">To receive</div><div class="bunker-stat-value">${fmt(live.plannedMT,2)} <span class="unit">MT</span></div></div>
            <div class="bunker-stat accent"><div class="bunker-stat-label">Current intake</div><div class="bunker-stat-value">${fmt(live.receivedMT,2)} <span class="unit">MT</span></div></div>
            <div class="bunker-stat"><div class="bunker-stat-label">Remaining</div><div class="bunker-stat-value">${fmt(live.remainingMT,2)} <span class="unit">MT</span></div></div>
            <div class="bunker-stat"><div class="bunker-stat-label">Pumping rate</div><div class="bunker-stat-value">${fmt(live.rateMTPerHour,1)} <span class="unit">MT/h</span></div></div>
            <div class="bunker-stat"><div class="bunker-stat-label">Time used</div><div class="bunker-stat-value">${escapeHtml(live.timeUsedLabel||'—')}</div></div>
            <div class="bunker-stat"><div class="bunker-stat-label">Time remaining</div><div class="bunker-stat-value">${escapeHtml(live.timeRemainingLabel||'—')}</div></div>
          </div>

          <div class="bunker-progress-bar"><div style="width:${pct}%"></div></div>
          <div class="hint" style="margin:6px 0 12px">${fmt(pct,1)}% complete${live.etaAt && current.status!=='paused' ? ` · ETA ${live.etaAt.slice(11,16)} UTC` : ''}</div>

          <div class="form-row-3">
            <div class="form-row"><label>Update rate (MT/h)</label><input id="live-rate" type="number" step="any" value="${current.rateMTPerHour||0}"></div>
            <div class="form-row"><label>Set intake manually (MT)</label><input id="live-recv" type="number" step="any" value="${current.intakeMode==='manual'? (current.receivedMT??'') : ''}" placeholder="auto from rate"></div>
            <div class="form-row" style="display:flex;align-items:flex-end;gap:8px">
              <button class="btn" id="btn-live-rate">Update rate / intake</button>
            </div>
          </div>

          <div class="section-title">Live tank updates</div>
          <div class="scroll-x"><table class="data-table">
            <thead><tr>
              <th>Tank</th><th>Side</th><th>Before MT</th><th>Intake MT</th><th>Current MT</th><th>Target MT</th><th>Current m³</th><th>%</th>
            </tr></thead>
            <tbody>${tanks.map((a)=>`<tr>
              <td class="tname">${escapeHtml(a.name)}</td>
              <td>${a.side||''}</td>
              <td>${fmt(a.beforeWeight,2)}</td>
              <td><b>${fmt(a.receivedMT,3)}</b></td>
              <td>${fmt(a.currentWeight,2)}</td>
              <td>${fmt(a.targetWeight,2)}</td>
              <td>${a.currentVolume!=null?fmt(a.currentVolume,1):'–'}</td>
              <td>${a.capacity?fmt((a.currentVolume!=null?a.currentVolume:a.beforeVolume||0)/a.capacity*100,0)+'%':'–'}</td>
            </tr>`).join('')}</tbody>
          </table></div>

          <div class="section-title">Update from tank soundings / gauges</div>
          <p class="hint">Enter current weight (MT) or volume (m³) after a sounding round — intake is recalculated as current − before.</p>
          <div class="scroll-x"><table class="data-table">
            <thead><tr><th>Tank</th><th>Before MT</th><th>Current MT</th><th>Current m³</th></tr></thead>
            <tbody>${(current.allocations||[]).map((a)=>`<tr data-sound="${a.tankId}">
              <td>${escapeHtml(a.name)}</td>
              <td>${fmt(a.beforeWeight,2)}</td>
              <td><input type="number" step="any" data-sw data-tank="${a.tankId}" placeholder="MT" style="width:100px"></td>
              <td><input type="number" step="any" data-sv data-tank="${a.tankId}" placeholder="m³" style="width:100px"></td>
            </tr>`).join('')}</tbody>
          </table></div>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn" id="btn-live-soundings">Apply sounding updates</button>
          </div>
        </div>`;

      document.getElementById('btn-live-pause')?.addEventListener('click', async () => {
        try {
          const res = await Api.bunkerUpdate(STATE.activeVesselId, current.id, { action: 'pause' });
          current = res.operation;
          paint();
        } catch (e) { showToast(e.message); }
      });
      document.getElementById('btn-live-resume')?.addEventListener('click', async () => {
        try {
          const res = await Api.bunkerUpdate(STATE.activeVesselId, current.id, { action: 'resume' });
          current = res.operation;
          paint();
        } catch (e) { showToast(e.message); }
      });
      document.getElementById('btn-live-rate').onclick = async () => {
        const rate = parseFloat(document.getElementById('live-rate').value);
        const recvRaw = document.getElementById('live-recv').value;
        const body = { rateMTPerHour: rate };
        if (recvRaw !== '') {
          body.receivedMT = parseFloat(recvRaw) || 0;
          body.intakeMode = 'manual';
        } else {
          body.intakeMode = 'rate';
        }
        try {
          const res = await Api.bunkerUpdate(STATE.activeVesselId, current.id, body);
          current = res.operation;
          showToast('Live op updated');
          paint();
        } catch (e) { showToast(e.message); }
      };
      document.getElementById('btn-live-sync').onclick = async () => {
        try {
          const res = await Api.bunkerUpdate(STATE.activeVesselId, current.id, { syncTanks: true });
          current = res.operation;
          await reloadBundle();
          showToast('Tank ROB synced to current intake');
          paint();
        } catch (e) { showToast(e.message); }
      };
      async function finishBunker(usePlanned) {
        const label = usePlanned ? 'full planned quantity' : 'current intake';
        if (!confirm(`Complete bunkering with ${label} and finalize tank ROB + voyage received totals?`)) return;
        try {
          await Api.bunkerComplete(STATE.activeVesselId, current.id, { usePlanned: !!usePlanned });
          await reloadBundle();
          stopBunkerLiveTimer();
          showToast(usePlanned ? 'Bunkering completed (full planned MT)' : 'Bunkering completed (current intake)');
          navigate('bunkering');
        } catch (e) { showToast(e.message); }
      }
      document.getElementById('btn-live-complete').onclick = () => finishBunker(false);
      document.getElementById('btn-live-complete-full').onclick = () => finishBunker(true);
      document.getElementById('btn-live-cancel').onclick = async () => {
        if (!confirm('Cancel this live bunkering operation? Tank ROB will not be finalized.')) return;
        try {
          await Api.bunkerCancel(STATE.activeVesselId, current.id);
          await reloadBundle();
          stopBunkerLiveTimer();
          showToast('Bunkering cancelled');
          navigate('bunkering');
        } catch (e) { showToast(e.message); }
      };
      document.getElementById('btn-live-soundings').onclick = async () => {
        const tankUpdates = [];
        document.querySelectorAll('[data-sw]').forEach((el) => {
          const w = el.value;
          const vEl = document.querySelector(`[data-sv][data-tank="${el.dataset.tank}"]`);
          const v = vEl?.value;
          if (w === '' && v === '') return;
          tankUpdates.push({
            tankId: el.dataset.tank,
            weightMT: w === '' ? null : parseFloat(w),
            volumeM3: v === '' ? null : parseFloat(v),
          });
        });
        if (!tankUpdates.length) { showToast('Enter at least one current MT or m³'); return; }
        try {
          const res = await Api.bunkerUpdate(STATE.activeVesselId, current.id, {
            tankUpdates,
            syncTanks: true,
          });
          current = res.operation;
          await reloadBundle();
          showToast('Intake updated from soundings');
          paint();
        } catch (e) { showToast(e.message); }
      };
    }

    paint();
    stopBunkerLiveTimer();
    _bunkerLiveTimer = setInterval(() => {
      if (STATE.route.page !== 'bunkering') {
        stopBunkerLiveTimer();
        return;
      }
      paint();
    }, 1000);
  }

  loadActiveBunker();
}

/* ---------- Report ---------- */
function renderReport(main) {
  const v = STATE.bundle.voyage || {};
  main.innerHTML += `<div class="page-head no-print"><div><h1>Voyage Report</h1>
    <div class="desc">Printable ROB summary</div></div>
    <div class="btn-row"><button class="btn primary" onclick="window.print()">Print / PDF</button>
    <button class="btn" id="btn-save-voy">Save voyage details</button></div></div>`;

  const form = document.createElement('div');
  form.className = 'form-panel no-print';
  form.innerHTML = `
    <div class="form-row-2">
      <div class="form-row"><label>Voyage No.</label><input id="v-voyage" value="${v.voyageNo||''}"></div>
      <div class="form-row"><label>Port</label><input id="v-port" value="${v.port||''}"></div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label>Report type</label>
        <select id="v-type">${['Departure','Arrival','Weekly Monitoring','Pre-Bunkering','Bunker Survey'].map(o=>`<option ${v.reportType===o?'selected':''}>${o}</option>`).join('')}</select></div>
      <div class="form-row"><label>Date</label><input id="v-date" type="date" value="${v.date||''}"></div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label>Trim (m)</label><input id="v-trim" type="number" step="any" value="${v.trim??0}"></div>
      <div class="form-row"><label>Heel (°)</label><input id="v-heel" type="number" step="any" value="${v.heel??0}"></div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label>Draft Fwd</label><input id="v-dfwd" type="number" step="any" value="${v.draftFwd??0}"></div>
      <div class="form-row"><label>Draft Aft</label><input id="v-daft" type="number" step="any" value="${v.draftAft??0}"></div>
    </div>`;
  main.appendChild(form);

  document.getElementById('btn-save-voy').onclick = async () => {
    const voyage = {
      ...v,
      vessel: vesselName(),
      voyageNo: document.getElementById('v-voyage').value,
      port: document.getElementById('v-port').value,
      reportType: document.getElementById('v-type').value,
      date: document.getElementById('v-date').value,
      trim: parseFloat(document.getElementById('v-trim').value)||0,
      heel: parseFloat(document.getElementById('v-heel').value)||0,
      draftFwd: parseFloat(document.getElementById('v-dfwd').value)||0,
      draftAft: parseFloat(document.getElementById('v-daft').value)||0,
    };
    await persistPart('voyage', voyage);
    showToast('Voyage details saved');
    navigate('report');
  };

  let html = `<div class="form-panel"><h2 style="margin-top:0">${vesselName()}</h2>
    <div style="color:var(--text-dim);margin-bottom:12px">${v.reportType||''} · Voy ${v.voyageNo||''} · ${v.port||''} · ${v.date||''}
    · Trim ${fmt(v.trim,2)} m · Heel ${fmt(v.heel,2)}°</div>`;
  let gVol = 0, gWt = 0;
  for (const c of CATS) {
    const tanks = (STATE.bundle.tanks[c.id] || []).filter((t) => getReading(t.id));
    if (!tanks.length) continue;
    html += `<div class="section-title"><span class="cat-dot cat-${c.id}"></span>${c.label}</div>
      <table class="data-table"><thead><tr><th>Tank</th><th>Cap</th><th>Reading</th><th>Temp</th><th>Dens</th><th>Vol</th><th>MT</th></tr></thead><tbody>`;
    let sVol = 0, sWt = 0;
    for (const t of tanks) {
      const r = getReading(t.id);
      sVol += r.result.volumeObserved||0; sWt += r.result.weightMT||0;
      html += `<tr><td>${t.name}</td><td>${fmt(t.capacity,1)}</td><td>${fmt(r.reading,1)}</td>
        <td>${fmt(r.tempC,1)}</td><td>${r.density15!=null?fmt(r.density15,4):'–'}</td>
        <td>${fmt(r.result.volumeObserved,2)}</td><td>${r.result.weightMT!=null?fmt(r.result.weightMT,2):'–'}</td></tr>`;
    }
    gVol += sVol; gWt += sWt;
    html += `<tr><td colspan="5"><b>Subtotal</b></td><td><b>${fmt(sVol,2)}</b></td><td><b>${fmt(sWt,2)}</b></td></tr></tbody></table>`;
  }
  html += `<div class="section-title">Grand total: ${fmt(gVol,2)} m³ · ${fmt(gWt,2)} MT</div></div>`;
  main.innerHTML += html;
}

/* ---------- Vessel setup ---------- */
function renderSetup(main) {
  main.innerHTML += `<div class="page-head"><div><h1>Vessel Setup</h1>
    <div class="desc">Create multiple vessel records. Each vessel is stored in its own database folder and can be selected anytime.</div></div></div>`;

  const list = document.createElement('div');
  list.className = 'form-panel';
  list.innerHTML = `<div class="section-title" style="margin-top:0">Saved vessels</div>
    <table class="data-table"><thead><tr><th>Name</th><th>IMO</th><th>Updated</th><th></th></tr></thead>
    <tbody>${STATE.vessels.map((v)=>`<tr>
      <td class="tname">${v.name}${v.id===STATE.activeVesselId?' <span class="pill good">active</span>':''}</td>
      <td>${v.imo||'–'}</td><td>${(v.updatedAt||'').slice(0,16).replace('T',' ')}</td>
      <td class="btn-row">
        <button class="btn small" data-load="${v.id}">Load</button>
        <button class="btn small danger" data-del="${v.id}">Delete</button>
      </td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">No vessels yet</td></tr>'}
    </tbody></table>`;
  main.appendChild(list);

  list.querySelectorAll('[data-load]').forEach((btn) => {
    btn.onclick = async () => {
      await Api.setActive(btn.dataset.load);
      STATE.activeVesselId = btn.dataset.load;
      await reloadBundle();
      const st = await Api.getStatus();
      STATE.vessels = st.vessels;
      showToast('Vessel loaded');
      navigate('dashboard');
    };
  });
  list.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Delete this vessel database folder?')) return;
      await Api.deleteVessel(btn.dataset.del);
      const st = await Api.getStatus();
      STATE.vessels = st.vessels;
      STATE.activeVesselId = st.activeVesselId;
      if (STATE.activeVesselId) await reloadBundle();
      else STATE.bundle = null;
      navigate('setup');
    };
  });

  const form = document.createElement('div');
  form.className = 'form-panel';
  form.style.marginTop = '16px';
  const cur = STATE.bundle?.vessel || {};
  form.innerHTML = `<div class="section-title" style="margin-top:0">${cur.id ? 'Edit active vessel' : 'Create new vessel'}</div>
    <div class="form-row-2">
      <div class="form-row"><label>Vessel name</label><input id="s-name" value="${cur.name||''}"></div>
      <div class="form-row"><label>IMO</label><input id="s-imo" value="${cur.imo||''}"></div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label>Call sign</label><input id="s-call" value="${cur.callSign||''}"></div>
      <div class="form-row"><label>Flag</label><input id="s-flag" value="${cur.flag||''}"></div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label>Type</label><input id="s-type" value="${cur.type||''}"></div>
      <div class="form-row"><label>Owner / manager</label><input id="s-owner" value="${cur.owner||''}"></div>
    </div>
    <div class="form-row"><label>Notes</label><textarea id="s-notes" class="textarea-json" style="min-height:80px">${cur.notes||''}</textarea></div>
    <div class="btn-row">
      <button class="btn primary" id="btn-save-vessel">${cur.id?'Save vessel details':'Create vessel'}</button>
      <button class="btn" id="btn-new-vessel">Create blank vessel</button>
      <button class="btn" id="btn-clone-vessel">Clone active as new</button>
    </div>`;
  main.appendChild(form);

  document.getElementById('btn-save-vessel').onclick = async () => {
    const details = {
      name: document.getElementById('s-name').value.trim(),
      imo: document.getElementById('s-imo').value.trim(),
      callSign: document.getElementById('s-call').value.trim(),
      flag: document.getElementById('s-flag').value.trim(),
      type: document.getElementById('s-type').value.trim(),
      owner: document.getElementById('s-owner').value.trim(),
      notes: document.getElementById('s-notes').value.trim(),
    };
    if (!details.name) { showToast('Vessel name required'); return; }
    if (STATE.activeVesselId && STATE.bundle?.vessel) {
      await Api.updateVessel(STATE.activeVesselId, details);
      await reloadBundle();
    } else {
      const v = await Api.createVessel(details);
      await Api.setActive(v.id);
      STATE.activeVesselId = v.id;
      await reloadBundle();
    }
    const st = await Api.getStatus();
    STATE.vessels = st.vessels;
    showToast('Vessel saved');
    navigate('setup');
  };

  document.getElementById('btn-new-vessel').onclick = async () => {
    const name = prompt('New vessel name?');
    if (!name) return;
    const v = await Api.createVessel({ name });
    await Api.setActive(v.id);
    STATE.activeVesselId = v.id;
    await reloadBundle();
    const st = await Api.getStatus();
    STATE.vessels = st.vessels;
    showToast('Blank vessel created');
    navigate('setup');
  };

  document.getElementById('btn-clone-vessel').onclick = async () => {
    if (!STATE.bundle) { showToast('No active vessel'); return; }
    const name = prompt('Name for cloned vessel?', vesselName() + ' (copy)');
    if (!name) return;
    const v = await Api.createVessel({
      name,
      imo: STATE.bundle.vessel.imo,
      tanks: STATE.bundle.tanks,
      readings: {},
      voyage: { ...STATE.bundle.voyage, vessel: name },
      bunkering: STATE.bundle.bunkering,
    });
    await Api.setActive(v.id);
    STATE.activeVesselId = v.id;
    await reloadBundle();
    const st = await Api.getStatus();
    STATE.vessels = st.vessels;
    showToast('Vessel cloned');
    navigate('setup');
  };
}

/* ---------- Settings / backup / sync ---------- */
function renderSettings(main) {
  const s = STATE.settings || {};
  main.innerHTML += `<div class="page-head"><div><h1>Backup, Import & Sync</h1>
    <div class="desc">Save database offline, import backups, and sync between local and Proxmox LXC when the server is online.</div></div></div>`;

  const cols = document.createElement('div');
  cols.className = 'two-col';
  cols.innerHTML = `
    <div class="form-panel">
      <div class="section-title" style="margin-top:0">Backup</div>
      <p style="color:var(--text-dim);font-size:13px">Download a full JSON backup of all vessels, tanks, calibrations, readings, and settings.</p>
      <button class="btn primary" id="btn-backup">Download backup</button>
    </div>
    <div class="form-panel">
      <div class="section-title" style="margin-top:0">Import backup</div>
      <p style="color:var(--text-dim);font-size:13px">Merge or restore from a previously saved backup file.</p>
      <input type="file" id="import-file" accept="application/json,.json">
      <label style="display:block;margin:8px 0;font-size:13px;color:var(--text-dim)">
        <input type="checkbox" id="import-merge" checked> Merge with existing vessels</label>
      <button class="btn primary" id="btn-import">Import</button>
    </div>
    <div class="form-panel">
      <div class="section-title" style="margin-top:0">Remote sync (Proxmox / office)</div>
      <div class="form-row"><label>Peer sync URL</label>
        <input id="sync-url" value="${s.syncUrl||''}" placeholder="http://192.168.1.50:3080"></div>
      <div class="btn-row">
        <button class="btn" id="btn-save-sync">Save settings</button>
        <button class="btn" id="btn-pull">Pull from peer</button>
        <button class="btn primary" id="btn-push">Push to peer</button>
        <button class="btn" id="btn-flush">Flush offline queue</button>
      </div>
      <div class="hint" style="margin-top:8px;color:var(--text-faint);font-size:12px">
        Local and LXC instances can sync when either becomes reachable. Offline edits stay in IndexedDB until flushed.
      </div>
    </div>
    <div class="form-panel">
      <div class="section-title" style="margin-top:0">Export active vessel</div>
      <p style="color:var(--text-dim);font-size:13px">Save only the currently selected vessel folder as JSON.</p>
      <button class="btn" id="btn-export-vessel">Export active vessel</button>
    </div>`;
  main.appendChild(cols);

  document.getElementById('btn-backup').onclick = async () => {
    const backup = await Api.backup();
    downloadJson('fuel-tms-backup.json', backup);
    showToast('Backup downloaded');
  };
  document.getElementById('btn-import').onclick = async () => {
    const file = document.getElementById('import-file').files[0];
    if (!file) { showToast('Choose a backup file'); return; }
    const merge = document.getElementById('import-merge').checked;
    await Api.importBackup(file, merge);
    const st = await Api.getStatus();
    STATE.vessels = st.vessels;
    STATE.activeVesselId = st.activeVesselId;
    STATE.settings = st.settings;
    if (STATE.activeVesselId) await reloadBundle();
    showToast('Backup imported');
    navigate('setup');
  };
  document.getElementById('btn-save-sync').onclick = async () => {
    STATE.settings = await Api.saveSettings({ syncUrl: document.getElementById('sync-url').value.trim(), syncEnabled: true });
    showToast('Sync settings saved');
  };
  document.getElementById('btn-pull').onclick = async () => {
    try {
      const url = document.getElementById('sync-url').value.trim();
      const res = await Api.syncPull(url);
      const st = await Api.getStatus();
      STATE.vessels = st.vessels;
      STATE.activeVesselId = st.activeVesselId;
      if (STATE.activeVesselId) await reloadBundle();
      showToast('Pulled ' + (res.results||[]).length + ' vessel(s)');
    } catch (e) { showToast(e.message); }
  };
  document.getElementById('btn-push').onclick = async () => {
    try {
      const url = document.getElementById('sync-url').value.trim();
      await Api.syncPush(url);
      showToast('Pushed to peer');
    } catch (e) { showToast(e.message); }
  };
  document.getElementById('btn-flush').onclick = async () => {
    const r = await Api.flushQueue();
    showToast('Flushed ' + r.flushed + ' queued change(s)');
    if (STATE.activeVesselId) await reloadBundle();
    render();
  };
  document.getElementById('btn-export-vessel').onclick = () => {
    if (!STATE.bundle) { showToast('No active vessel'); return; }
    downloadJson((STATE.activeVesselId || 'vessel') + '.json', STATE.bundle);
  };
}

/* ---------- VCF / WCF manual calculator + reference tables ---------- */
function renderVcfWcf(main) {
  main.innerHTML += `<div class="page-head"><div><h1>VCF / WCF Calculator</h1>
    <div class="desc">Single manual ASTM Table 54B (VCF) and Table 56-style (WCF) calculation, plus reference tables.</div></div></div>
    <div class="help-box"><b>VCF</b> corrects observed volume to 15°C. <b>WCF</b> = density@15 − 0.0011 (air buoyancy).
    Weight MT = (observed m³ × VCF) × WCF. Enter density + temperature; optionally volume <i>or</i> MT.</div>`;

  const panel = document.createElement('div');
  panel.className = 'form-panel';
  panel.style.maxWidth = '820px';
  panel.innerHTML = `
    <div class="section-title" style="margin-top:0">Manual calculation</div>
    <div class="form-row-3">
      <div class="form-row"><label>Density @15°C (kg/L)</label><input id="vw-dens" type="number" step="any" placeholder="0.9584" value="0.9584"></div>
      <div class="form-row"><label>Temperature (°C)</label><input id="vw-temp" type="number" step="any" value="25"></div>
      <div class="form-row"><label>Observed volume (m³)</label><input id="vw-vol" type="number" step="any" placeholder="optional"></div>
    </div>
    <div class="form-row-3">
      <div class="form-row"><label>Quantity (MT)</label><input id="vw-mt" type="number" step="any" placeholder="optional — or volume above"></div>
      <div class="form-row"><label>SG → density</label>
        <div style="display:flex;gap:6px">
          <input id="vw-sg" type="number" step="any" placeholder="SG / RD">
          <button type="button" class="btn small" id="btn-vw-sg">SG→ρ</button>
        </div></div>
      <div class="form-row" style="display:flex;align-items:flex-end">
        <button class="btn primary" id="btn-vw-calc" style="width:100%">Calculate VCF / WCF</button>
      </div>
    </div>
    <div id="vw-result" style="margin-top:14px"></div>`;
  main.appendChild(panel);

  const tablesWrap = document.createElement('div');
  tablesWrap.className = 'form-panel';
  tablesWrap.style.marginTop = '18px';
  tablesWrap.innerHTML = `
    <div class="section-title" style="margin-top:0">Reference tables</div>
    <div class="form-row-3">
      <div class="form-row"><label>Density min</label><input id="vw-dmin" type="number" step="0.01" value="0.85"></div>
      <div class="form-row"><label>Density max</label><input id="vw-dmax" type="number" step="0.01" value="0.99"></div>
      <div class="form-row" style="display:flex;align-items:flex-end">
        <button class="btn" id="btn-vw-tables" style="width:100%">Refresh tables</button>
      </div>
    </div>
    <div class="section-title">WCF (density → weight correction)</div>
    <div class="scroll-x" id="vw-wcf-table"></div>
    <div class="section-title">VCF (ASTM 54B) — density × temperature</div>
    <div class="scroll-x" id="vw-vcf-table"></div>
    <p class="hint">Highlighted row/column match the density and temperature used in the manual calculation above (when tables are refreshed after calculating).</p>`;
  main.appendChild(tablesWrap);

  async function runCalc() {
    const dens = parseFloat(document.getElementById('vw-dens').value);
    const temp = parseFloat(document.getElementById('vw-temp').value);
    const vol = document.getElementById('vw-vol').value;
    const mt = document.getElementById('vw-mt').value;
    if (!(dens > 0)) { showToast('Enter density @15°C'); return null; }
    if (Number.isNaN(temp)) { showToast('Enter temperature'); return null; }

    let result;
    try {
      result = await Api.vcfWcfCalc({
        density15: dens,
        tempC: temp,
        volumeObserved: vol === '' ? null : parseFloat(vol),
        quantityMT: mt === '' ? null : parseFloat(mt),
      });
    } catch (e) {
      // Offline / local fallback
      if (typeof vcf54B !== 'function') { showToast(e.message); return null; }
      const vcf = vcf54B(dens, temp);
      const wcf = wcf56(dens);
      result = { density15: dens, tempC: temp, vcf, wcf };
      if (vol !== '') {
        result.volumeObserved = parseFloat(vol);
        result.volume15 = result.volumeObserved * vcf;
        result.weightMT = result.volume15 * wcf;
      } else if (mt !== '' && typeof volumeFromMT === 'function') {
        result.quantityMT = parseFloat(mt);
        result.volumeObserved = volumeFromMT(result.quantityMT, dens, temp);
        result.volume15 = wcf > 0 ? result.quantityMT / wcf : null;
      }
    }

    const box = document.getElementById('vw-result');
    box.innerHTML = `<div class="bunker-kpi-grid">
      <div class="bunker-stat accent"><div class="bunker-stat-label">VCF (54B)</div><div class="bunker-stat-value">${fmt(result.vcf, 4)}</div></div>
      <div class="bunker-stat accent"><div class="bunker-stat-label">WCF (56)</div><div class="bunker-stat-value">${fmt(result.wcf, 4)}</div></div>
      <div class="bunker-stat"><div class="bunker-stat-label">Density @15</div><div class="bunker-stat-value">${fmt(result.density15, 4)}</div></div>
      <div class="bunker-stat"><div class="bunker-stat-label">Temp</div><div class="bunker-stat-value">${fmt(result.tempC, 1)} <span class="unit">°C</span></div></div>
      ${result.volumeObserved != null ? `<div class="bunker-stat"><div class="bunker-stat-label">Observed vol</div><div class="bunker-stat-value">${fmt(result.volumeObserved, 3)} <span class="unit">m³</span></div></div>` : ''}
      ${result.volume15 != null ? `<div class="bunker-stat"><div class="bunker-stat-label">Volume @15°C</div><div class="bunker-stat-value">${fmt(result.volume15, 3)} <span class="unit">m³</span></div></div>` : ''}
      ${result.weightMT != null ? `<div class="bunker-stat"><div class="bunker-stat-label">Weight in air</div><div class="bunker-stat-value">${fmt(result.weightMT, 3)} <span class="unit">MT</span></div></div>` : ''}
      ${result.quantityMT != null && result.volumeObserved != null ? `<div class="bunker-stat"><div class="bunker-stat-label">From MT → obs vol</div><div class="bunker-stat-value">${fmt(result.volumeObserved, 3)} <span class="unit">m³</span></div></div>` : ''}
    </div>
    <p class="hint" style="margin-top:10px">Vol@15 = obs × VCF · Weight MT = Vol@15 × WCF · WCF = ρ15 − 0.0011</p>`;
    return result;
  }

  async function loadTables(highlight) {
    const dmin = parseFloat(document.getElementById('vw-dmin').value) || 0.85;
    const dmax = parseFloat(document.getElementById('vw-dmax').value) || 0.99;
    const q = `densMin=${dmin}&densMax=${dmax}&densStep=0.01&temps=0,5,10,15,20,25,30,35,40,45,50`;
    let data;
    try {
      data = await Api.vcfWcfTables(q);
    } catch (e) {
      // Build locally
      if (typeof vcf54B !== 'function') { showToast(e.message); return; }
      const temps = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
      const wcf = []; const vcf = [];
      for (let d = dmin; d <= dmax + 1e-9; d = Math.round((d + 0.01) * 1000) / 1000) {
        const dens = Math.round(d * 1000) / 1000;
        wcf.push({ density15: dens, wcf: wcf56(dens) });
        const row = { density15: dens };
        temps.forEach((t) => { row['t' + t] = vcf54B(dens, t); });
        vcf.push(row);
      }
      data = { temps, wcf, vcf };
    }

    const hlDens = highlight?.density15;
    const hlTemp = highlight?.tempC;

    const wcfEl = document.getElementById('vw-wcf-table');
    wcfEl.innerHTML = `<table class="data-table compact ref-table"><thead><tr><th>Density @15</th><th>WCF</th></tr></thead>
      <tbody>${data.wcf.map((r) => {
        const on = hlDens != null && Math.abs(r.density15 - hlDens) < 0.005;
        return `<tr class="${on ? 'row-hl' : ''}"><td>${fmt(r.density15, 3)}</td><td>${fmt(r.wcf, 4)}</td></tr>`;
      }).join('')}</tbody></table>`;

    const temps = data.temps || [];
    const vcfEl = document.getElementById('vw-vcf-table');
    vcfEl.innerHTML = `<table class="data-table compact ref-table sticky-head">
      <thead><tr><th>ρ15 \\ T°C</th>${temps.map((t) => {
        const on = hlTemp != null && Math.abs(t - hlTemp) < 0.01;
        return `<th class="${on ? 'col-hl' : ''}">${t}</th>`;
      }).join('')}</tr></thead>
      <tbody>${data.vcf.map((r) => {
        const onRow = hlDens != null && Math.abs(r.density15 - hlDens) < 0.005;
        return `<tr class="${onRow ? 'row-hl' : ''}"><td><b>${fmt(r.density15, 3)}</b></td>${temps.map((t) => {
          const onCol = hlTemp != null && Math.abs(t - hlTemp) < 0.01;
          const cell = r['t' + t];
          return `<td class="${onCol ? 'col-hl' : ''}${onRow && onCol ? ' cell-hl' : ''}">${cell != null ? fmt(cell, 4) : '–'}</td>`;
        }).join('')}</tr>`;
      }).join('')}</tbody></table>`;
  }

  document.getElementById('btn-vw-calc').onclick = async () => {
    const r = await runCalc();
    if (r) {
      showToast(`VCF ${fmt(r.vcf, 4)} · WCF ${fmt(r.wcf, 4)}`);
      await loadTables(r);
    }
  };
  document.getElementById('btn-vw-tables').onclick = async () => {
    const dens = parseFloat(document.getElementById('vw-dens').value);
    const temp = parseFloat(document.getElementById('vw-temp').value);
    await loadTables(Number.isFinite(dens) ? { density15: dens, tempC: temp } : null);
  };
  document.getElementById('btn-vw-sg').onclick = async () => {
    const sg = parseFloat(document.getElementById('vw-sg').value);
    if (Number.isNaN(sg)) { showToast('Enter SG'); return; }
    try {
      if (!STATE.conversionTable) STATE.conversionTable = await Api.request('/api/reference/conversion');
      const dens = sgToDensity15(sg, STATE.conversionTable.rdToDensity15);
      if (dens == null) { showToast('SG out of range'); return; }
      document.getElementById('vw-dens').value = dens;
      showToast(`Density ≈ ${dens}`);
    } catch (e) { showToast(e.message); }
  };

  loadTables({ density15: 0.9584, tempC: 25 });
}

/* ---------- ISO 8217 marine fuel specification ---------- */
function formatIsoLimit(lim) {
  if (!lim) return '—';
  if (lim.text) return lim.text;
  if (lim.note && lim.min == null && lim.max == null) return lim.note;
  const parts = [];
  if (lim.min != null) parts.push(`min ${lim.min}`);
  if (lim.max != null) parts.push(`max ${lim.max}`);
  if (!parts.length && lim.note) return lim.note;
  return parts.join(' · ') || '—';
}

function renderIsoSpecTable(block) {
  if (!block) return '<div class="empty-state">No data</div>';
  const grades = block.grades || [];
  const params = block.parameters || [];
  return `<div class="scroll-x"><table class="data-table compact ref-table sticky-head iso-table">
    <thead><tr><th>Parameter</th><th>Unit</th>${grades.map((g) => `<th>${escapeHtml(g)}</th>`).join('')}</tr></thead>
    <tbody>${params.map((p) => `<tr>
      <td class="tname">${escapeHtml(p.name)}${p.note ? `<div class="hint">${escapeHtml(p.note)}</div>` : ''}</td>
      <td>${escapeHtml(p.unit || '—')}</td>
      ${grades.map((g) => `<td>${escapeHtml(formatIsoLimit(p.limits?.[g]))}</td>`).join('')}
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function renderIso8217(main) {
  main.innerHTML += `<div class="page-head"><div><h1>ISO 8217 Marine Fuel Specs</h1>
    <div class="desc">Reference limits for distillate and residual marine fuels (ISO 8217:2017).</div></div></div>
    <div class="help-box" id="iso-note">Loading specification tables…</div>`;

  const tabs = document.createElement('div');
  tabs.className = 'btn-row';
  tabs.style.marginBottom = '12px';
  tabs.innerHTML = `
    <button class="btn primary small" data-iso-tab="dist">Distillates (DMX–DMB)</button>
    <button class="btn small" data-iso-tab="res">Residuals (RMA–RMK)</button>
    <button class="btn small" data-iso-tab="both">Both tables</button>`;
  main.appendChild(tabs);

  const body = document.createElement('div');
  body.id = 'iso-body';
  main.appendChild(body);

  let data = null;

  function paint(tab) {
    if (!data) return;
    tabs.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('primary', b.dataset.isoTab === tab);
    });
    let html = '';
    if (tab === 'dist' || tab === 'both') {
      html += `<div class="form-panel"><div class="section-title" style="margin-top:0">${escapeHtml(data.distillates.caption)}</div>
        ${renderIsoSpecTable(data.distillates)}</div>`;
    }
    if (tab === 'res' || tab === 'both') {
      html += `<div class="form-panel" style="margin-top:14px"><div class="section-title" style="margin-top:0">${escapeHtml(data.residuals.caption)}</div>
        ${renderIsoSpecTable(data.residuals)}</div>`;
    }
    body.innerHTML = html;
  }

  tabs.querySelectorAll('button').forEach((b) => {
    b.onclick = () => paint(b.dataset.isoTab);
  });

  (async () => {
    try {
      data = await Api.iso8217();
      document.getElementById('iso-note').innerHTML =
        `<b>${escapeHtml(data.standard)}</b> — ${escapeHtml(data.title)}.<br>${escapeHtml(data.note || '')}`;
      paint('dist');
    } catch (e) {
      document.getElementById('iso-note').textContent = e.message;
    }
  })();
}

function renderAbout(main) {
  main.innerHTML += `<div class="page-head"><div><h1>About</h1></div></div>
  <div class="form-panel" style="max-width:760px;line-height:1.7;color:var(--text-dim);font-size:13.5px">
    <p style="color:var(--text)"><b>Vessel Fuel Tank Management System</b> — multi-vessel sounding calculator with editable calibration database, voyage fuel planning, and bunkering distribution.</p>
    <p><b>Correction tanks</b> use double bilinear interpolation (trim then list) plus a volume curve.
    <b>Direct tanks</b> use trim×heel volume grids. Weight uses ASTM Table 54B VCF and WCF (ρ15 − 0.0011).</p>
    <p>Each vessel is stored under <code>data/vessels/&lt;id&gt;/</code>. The app runs as a local web server (Debian / Proxmox LXC) and as a mobile-friendly PWA for Android. Offline edits queue until the server is reachable; peer sync pushes/pulls full vessel databases.</p>
    <p>Original CAPTAIN VENIAMIS calibration tables are seeded as the default vessel.</p>
    <p><b>Import / edit:</b> Excel workbook (Tank1–Tank4), tank-list CSV, per-tank calibration CSV/Excel, or PDF sounding tables (Calibration DB).</p>
    <p><b>Live bunkering:</b> enter MT to receive and pumping rate (MT/h) for time used / remaining, watch live tank intake, sync soundings, and blend parcels of different density (WCF @15°C).</p>
    <p><b>SG ↔ density:</b> convert specific gravity / relative density to density @15°C (and back) from the workbook Conversion sheet — on tank sounding and bunkering pages.</p>
    <p><b>Reference:</b> standalone <b>VCF / WCF</b> calculator with tables, and <b>ISO 8217:2017</b> marine fuel specification limits.</p>
  </div>`;
}

/* ---------- Boot ---------- */
async function boot() {
  Api.onStatus((online) => {
    STATE.online = online;
    const dot = document.querySelector('.status-dot');
    if (dot) {
      dot.classList.toggle('online', online);
      dot.classList.toggle('offline', !online);
    }
  });

  document.getElementById('menu-toggle')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-backdrop').classList.toggle('show');
  });
  document.getElementById('sidebar-backdrop')?.addEventListener('click', closeMobileNav);

  try {
    const st = await Api.getStatus();
    STATE.vessels = st.vessels || [];
    STATE.activeVesselId = st.activeVesselId;
    STATE.settings = st.settings || {};
    STATE.online = true;
    if (STATE.activeVesselId) await reloadBundle();
    await Api.flushQueue();
  } catch (e) {
    STATE.online = false;
    const st = await OfflineDB.idbGet('status');
    if (st) {
      STATE.vessels = st.vessels || [];
      STATE.activeVesselId = st.activeVesselId;
      STATE.settings = st.settings || {};
    }
    if (STATE.activeVesselId) {
      STATE.bundle = await OfflineDB.idbGet('vessel:' + STATE.activeVesselId);
    }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  render();
  setInterval(() => { if (navigator.onLine) Api.flushQueue(); }, 30000);
}

document.addEventListener('DOMContentLoaded', boot);
