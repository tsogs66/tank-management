/**
 * Task pane wiring: read the sheet, show what tidying would change, write it
 * back, then hand the workbook to the same import endpoint the web app uses.
 */
/* global Office, SheetClean, TankChiefApi */
(function () {
  'use strict';

  var els = {};
  var cfg = null;
  var lastPreview = null;

  function $(id) { return document.getElementById(id); }

  function status(msg, isError) {
    els.status.textContent = msg || '';
    els.status.style.color = isError ? '#c0392b' : '';
  }

  function num(n) { return n == null ? '—' : String(n); }

  function renderTidyReport(r) {
    if (!r) { els.tidyReport.innerHTML = ''; return; }
    var blocks = r.blocks || (r.report && r.report.blocks) || [];
    var rows = (Array.isArray(blocks) ? blocks : []).map(function (b) {
      return '<tr><td>' + (b.title ? escapeHtml(b.title) : '<span class="hint">untitled</span>')
        + '</td><td>' + num(b.headerRow) + '</td><td>' + num(b.rows) + '</td><td>' + num(b.columns)
        + '</td><td>' + (b.ragged ? '<span class="warn">' + b.ragged + ' over</span>' : '—') + '</td></tr>';
    }).join('');
    var t = r.report || r;
    els.tidyReport.innerHTML =
      '<p>' + num(t.blocks) + ' block(s) · ' + num(t.cellsSplit) + ' cell(s) split · '
      + num(t.columnsAdded) + ' column(s) added · ' + num(t.rowsAligned) + ' row(s) squared off · '
      + num(t.blankRowsRemoved) + ' blank row(s) dropped'
      + (t.mergedAreasUnmerged ? ' · ' + t.mergedAreasUnmerged + ' merge(s) undone' : '')
      + (t.raggedRows ? ' · <span class="warn">' + t.raggedRows + ' row(s) wider than their header</span>' : '')
      + '</p>'
      + (rows ? '<table><thead><tr><th>Block</th><th>Header</th><th>Rows</th><th>Cols</th><th>Over</th></tr></thead><tbody>' + rows + '</tbody></table>' : '');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function opts() {
    return { blockSpacer: els.spacer.checked };
  }

  async function refreshSheets() {
    var names = await SheetClean.listSheets();
    els.sheet.innerHTML = names.map(function (n) {
      return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>';
    }).join('');
  }

  async function onPreview() {
    try {
      status('Reading the sheet…');
      var p = await SheetClean.previewSheet(els.sheet.value, opts());
      lastPreview = p;
      renderTidyReport(p);
      status(p.before.rows + '×' + p.before.columns + ' → ' + p.after.rows + '×' + p.after.columns
        + '. Nothing written yet.');
    } catch (e) {
      status(e.message, true);
    }
  }

  async function onTidy() {
    try {
      status('Tidying…');
      var r = await SheetClean.tidySheet(els.sheet.value, opts());
      renderTidyReport(r);
      status('Sheet tidied. Undo in Excel puts it back.');
    } catch (e) {
      status(e.message, true);
    }
  }

  async function onConnect() {
    cfg.baseUrl = els.baseUrl.value.trim() || cfg.baseUrl;
    cfg.token = els.token.value.trim();
    try {
      status('Connecting…');
      var vessels = await TankChiefApi.listVessels(cfg);
      var list = Array.isArray(vessels) ? vessels : (vessels.vessels || []);
      els.vessel.innerHTML = list.map(function (v) {
        return '<option value="' + escapeHtml(v.id) + '">' + escapeHtml(v.name || v.id) + '</option>';
      }).join('');
      if (cfg.vesselId) els.vessel.value = cfg.vesselId;
      cfg.vesselId = els.vessel.value || cfg.vesselId;
      await TankChiefApi.saveSettings(cfg);
      status(list.length + ' vessel(s).');
    } catch (e) {
      status(e.message, true);
    }
  }

  function renderImport(res) {
    var tanks = (res.tanks || []).map(function (t) {
      return '<tr><td>' + escapeHtml(t.name || '') + '</td><td>'
        + (t.existing ? '<span class="warn">exists</span>' : 'new') + '</td><td>'
        + escapeHtml(t.category || '') + '</td><td>' + num(t.trimRows) + '</td><td>' + num(t.listRows) + '</td></tr>';
    }).join('');
    els.sendReport.innerHTML =
      '<p><b>' + escapeHtml(res.format || 'workbook') + '</b>: ' + num(res.tankCount || (res.tanks || []).length)
      + ' tank(s)' + (res.created != null ? ' · ' + res.created + ' created · ' + ((res.replaced != null ? res.replaced : res.updated) || 0) + ' replaced' : '')
      + ((res.warnings || []).length ? '<br><span class="hint">' + escapeHtml(res.warnings.slice(0, 4).join(' · ')) + '</span>' : '')
      + '</p>'
      + (tanks ? '<table><thead><tr><th>Tank</th><th></th><th>Cat</th><th>Trim</th><th>Heel</th></tr></thead><tbody>' + tanks + '</tbody></table>' : '');
  }

  async function send(preview) {
    cfg.vesselId = els.vessel.value || cfg.vesselId;
    if (!cfg.vesselId) { status('Pick a vessel first — press Connect.', true); return; }
    try {
      status(preview ? 'Sending the workbook for preview…' : 'Importing…');
      var blob = await TankChiefApi.currentWorkbookBlob();
      var name = (Office.context.document.url || 'workbook.xlsx').split(/[\\/]/).pop();
      var res = await TankChiefApi.sendWorkbook(cfg, blob, name, {
        preview: preview,
        replaceExisting: els.replace.checked,
      });
      renderImport(res);
      els.apply.hidden = !preview || !(res.tanks || []).length;
      await TankChiefApi.saveSettings(cfg);
      status(preview ? 'Preview only — nothing written to the vessel yet.' : 'Imported.');
    } catch (e) {
      status(e.message, true);
    }
  }

  Office.onReady(function (info) {
    if (info.host !== Office.HostType.Excel) return;
    ['pane', 'sheet', 'spacer', 'status', 'baseUrl', 'vessel', 'token', 'replace'].forEach(function (k) {
      els[k] = $(k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }));
    });
    els.tidyReport = $('tidy-report');
    els.sendReport = $('send-report');
    els.apply = $('btn-apply');

    cfg = TankChiefApi.loadSettings();
    els.baseUrl.value = cfg.baseUrl;
    els.token.value = cfg.token || '';

    $('btn-preview').onclick = onPreview;
    $('btn-tidy').onclick = onTidy;
    $('btn-connect').onclick = onConnect;
    $('btn-send').onclick = function () { send(true); };
    els.apply.onclick = function () { send(false); };
    els.vessel.onchange = function () { cfg.vesselId = els.vessel.value; };

    refreshSheets().then(function () { $('pane').hidden = false; })
      .catch(function (e) { $('pane').hidden = false; status(e.message, true); });
  });
}());
