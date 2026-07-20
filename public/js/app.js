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

  if (!STATE.bundle && STATE.route.page !== 'setup' && STATE.route.page !== 'settings' && STATE.route.page !== 'about') {
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
  document.getElementById('btn-api-den').onclick = async () => {
    const api = parseFloat(document.getElementById('in-api').value);
    if (Number.isNaN(api)) { showToast('Enter API'); return; }
    try {
      const table = await Api.request('/api/reference/conversion');
      const rows = table.apiToDensity15 || [];
      let best = null; let bestD = Infinity;
      for (const [a, d] of rows) {
        const diff = Math.abs(a - api);
        if (diff < bestD) { bestD = diff; best = d; }
      }
      if (best == null) { showToast('No conversion data'); return; }
      document.getElementById('in-density').value = best;
      showToast(`Density @15°C ≈ ${best}`);
    } catch (e) { showToast(e.message); }
  };
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
    defs.push({ label: 'VCF (ASTM 54B)', formula: `ρ15=${inputs.density15}, T=${inputs.tempC}°C`, value: fmt(r.vcf,4) });
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
    </div>
    <div class="section-title">Import tanks from CSV</div>
    <input type="file" id="csv-file" accept=".csv,text/csv">
    <button class="btn" id="btn-import-csv" style="margin-top:8px">Import CSV</button>`;
  main.appendChild(form);

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
    showToast(`Imported ${res.imported} tanks`);
  };
}

/* ---------- Calibration editor ---------- */
function renderCalibrationList(main) {
  if (STATE.route.tankId) return renderCalibrationEditor(main, STATE.route.tankId);

  const head = document.createElement('div');
  head.className = 'page-head';
  head.innerHTML = `<div><h1>Calibration Database</h1>
    <div class="desc">Excel-style sounding tables (Tank1–Tank4 layout): SOUNDING/Depth × trim, volume curve, list/heel.</div></div>
    <div class="btn-row">
      <label class="btn">Import workbook<input type="file" id="excel-import" accept=".xlsm,.xlsx" hidden></label>
      <button class="btn" id="btn-import-repo-excel">Import repo workbook</button>
    </div>`;
  main.appendChild(head);

  const help = document.createElement('div');
  help.className = 'help-box';
  help.innerHTML = `Reference format from <b>TANK MANAGEMENT CAPTAIN VENIAMIS FINAL VERSION.xlsm</b> sheets <b>Tank1–Tank4</b>:
    row headers = sounding/ullage (or Depth), column headers = trim (m), then SOUNDING CM / VOLUME, then list/heel table.`;
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
      <button class="btn small" id="btn-export-tank">Export JSON</button>
      <button class="btn primary" id="btn-save-calib">Save calibration</button>
    </div>`;
  main.appendChild(head);
  document.getElementById('btn-back-tank').onclick = () => navigate(tank.category || 'fuel', tankId);

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

/* ---------- Bunkering with distribution ---------- */
function renderBunkering(main) {
  main.innerHTML += `<div class="page-head"><div><h1>Bunkering Operation</h1>
    <div class="desc">Enter received quantity, then choose how to distribute into storage / settling / service tanks.</div></div></div>
    <div class="help-box">Distribution modes: equal across storage (capacity-weighted free space), Port or Starboard only, No.1 or No.2 tanks only, settling/service only, or manual MT per tank. Optionally apply to ROB readings (volume-gauge increment).</div>`;

  const panel = document.createElement('div');
  panel.className = 'form-panel';
  panel.style.maxWidth = '900px';
  panel.innerHTML = `
    <div class="form-row-3">
      <div class="form-row"><label>Fuel grade</label>
        <select id="b-grade"><option value="hfo">HFO</option><option value="lsfo">LSFO</option>
        <option value="mdo">MDO</option><option value="mgo">MGO</option></select></div>
      <div class="form-row"><label>Received quantity (MT)</label><input id="b-qty" type="number" step="any" placeholder="e.g. 450"></div>
      <div class="form-row"><label>Density @15°C</label><input id="b-dens" type="number" step="any" placeholder="0.958"></div>
    </div>
    <div class="form-row-3">
      <div class="form-row"><label>Temp (°C)</label><input id="b-temp" type="number" step="any" value="15"></div>
      <div class="form-row"><label>BDN No.</label><input id="b-bdn" placeholder="BDN-..."></div>
      <div class="form-row"><label>Supplier / Barge</label><input id="b-sup" placeholder="Supplier"></div>
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
      <button class="btn" id="btn-preview-bunker">Preview distribution</button>
      <button class="btn primary" id="btn-apply-bunker">Apply to tanks</button>
    </div>
    <div id="bunker-result" style="margin-top:14px"></div>`;
  main.appendChild(panel);

  const modes = document.getElementById('distrib-modes');
  modes.querySelectorAll('input').forEach((inp) => {
    inp.onchange = () => {
      modes.querySelectorAll('.distrib-opt').forEach((el) => el.classList.remove('active'));
      inp.closest('.distrib-opt').classList.add('active');
      document.getElementById('manual-alloc').style.display = inp.value === 'manual' ? '' : 'none';
      if (inp.value === 'manual') renderManualAlloc();
    };
  });

  function renderManualAlloc() {
    const grade = document.getElementById('b-grade').value;
    const tanks = (STATE.bundle.tanks.fuel || []).filter((t) => !t.fuelGrade || t.fuelGrade === grade || t.fuelGrade === 'other' || (grade==='hfo'&&t.fuelGrade==='lsfo'));
    document.getElementById('manual-alloc').innerHTML = `<table class="data-table"><thead><tr><th>Tank</th><th>Role</th><th>Free (approx m³)</th><th>Allocate MT</th></tr></thead><tbody>
      ${tanks.map((t) => {
        const r = getReading(t.id);
        const free = Math.max(0, (t.capacity||0) - (r?.result?.volumeObserved||0));
        return `<tr><td>${t.name}</td><td>${t.fuelRole}</td><td>${fmt(free,1)}</td>
          <td><input type="number" step="any" data-manual="${t.id}" value="0" style="width:100px;background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:6px"></td></tr>`;
      }).join('')}
    </tbody></table>`;
  }

  async function run(apply) {
    const mode = document.querySelector('input[name="b-mode"]:checked').value;
    const manual = {};
    if (mode === 'manual') {
      document.querySelectorAll('[data-manual]').forEach((el) => {
        manual[el.dataset.manual] = parseFloat(el.value) || 0;
      });
    }
    const body = {
      quantityMT: parseFloat(document.getElementById('b-qty').value) || 0,
      fuelGrade: document.getElementById('b-grade').value,
      density15: document.getElementById('b-dens').value === '' ? null : parseFloat(document.getElementById('b-dens').value),
      tempC: parseFloat(document.getElementById('b-temp').value) || 15,
      mode,
      manual,
      apply,
      bdn: {
        bdnNo: document.getElementById('b-bdn').value,
        supplier: document.getElementById('b-sup').value,
      },
    };
    try {
      const res = await Api.bunkerDistribute(STATE.activeVesselId, body);
      if (apply) await reloadBundle();
      const el = document.getElementById('bunker-result');
      el.innerHTML = `<div class="section-title">Distribution ${apply ? 'applied' : 'preview'}</div>
        <table class="data-table"><thead><tr><th>Tank</th><th>Side</th><th>Before MT</th><th>Add MT</th><th>After vol</th></tr></thead><tbody>
        ${(res.allocations||[]).map((a)=>`<tr>
          <td>${a.name}</td><td>${a.side||''}</td><td>${fmt(a.beforeWeight,2)}</td>
          <td><b>${fmt(a.mt,3)}</b></td><td>${a.afterVolume!=null?fmt(a.afterVolume,2):'–'}</td>
        </tr>`).join('')}
        </tbody></table>`;
      showToast(apply ? 'Bunker applied to tanks' : 'Preview ready');
    } catch (e) {
      showToast(e.message);
    }
  }

  document.getElementById('btn-preview-bunker').onclick = () => run(false);
  document.getElementById('btn-apply-bunker').onclick = () => {
    if (!confirm('Apply bunker distribution to tank ROB readings?')) return;
    run(true);
  };

  // History
  const ops = STATE.bundle.bunkerOps || [];
  if (ops.length) {
    const hist = document.createElement('div');
    hist.className = 'form-panel';
    hist.style.marginTop = '18px';
    hist.innerHTML = `<div class="section-title" style="margin-top:0">Recent bunker ops</div>
      <table class="data-table"><thead><tr><th>Date</th><th>Grade</th><th>MT</th><th>Mode</th><th>BDN</th></tr></thead>
      <tbody>${ops.slice(0,10).map((o)=>`<tr>
        <td>${(o.createdAt||'').slice(0,16).replace('T',' ')}</td>
        <td>${o.fuelGrade}</td><td>${fmt(o.quantityMT,2)}</td><td>${o.mode}</td>
        <td>${o.bdn?.bdnNo||'–'}</td></tr>`).join('')}</tbody></table>`;
    main.appendChild(hist);
  }
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

function renderAbout(main) {
  main.innerHTML += `<div class="page-head"><div><h1>About</h1></div></div>
  <div class="form-panel" style="max-width:760px;line-height:1.7;color:var(--text-dim);font-size:13.5px">
    <p style="color:var(--text)"><b>Vessel Fuel Tank Management System</b> — multi-vessel sounding calculator with editable calibration database, voyage fuel planning, and bunkering distribution.</p>
    <p><b>Correction tanks</b> use double bilinear interpolation (trim then list) plus a volume curve.
    <b>Direct tanks</b> use trim×heel volume grids. Weight uses ASTM Table 54B VCF and WCF (ρ15 − 0.0011).</p>
    <p>Each vessel is stored under <code>data/vessels/&lt;id&gt;/</code>. The app runs as a local web server (Debian / Proxmox LXC) and as a mobile-friendly PWA for Android. Offline edits queue until the server is reachable; peer sync pushes/pulls full vessel databases.</p>
    <p>Original CAPTAIN VENIAMIS calibration tables are seeded as the default vessel.</p>
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
