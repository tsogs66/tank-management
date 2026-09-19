/**
 * Talking to the Tank Chief server from the task pane.
 *
 * The add-in adds no import route of its own: it posts the workbook to the
 * same endpoint the web app's Add-tanks panel uses, so a book imported from
 * Excel lands exactly as one imported from the browser.
 */
(function (global) {
  'use strict';

  var SETTING = 'tankChief.connection';

  function loadSettings() {
    var fallback = { baseUrl: 'http://localhost:3000', vesselId: '', token: '' };
    try {
      var raw = global.Office && Office.context && Office.context.document
        ? Office.context.document.settings.get(SETTING)
        : global.localStorage.getItem(SETTING);
      return Object.assign(fallback, raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {});
    } catch (e) {
      return fallback;
    }
  }

  function saveSettings(cfg) {
    try {
      if (global.Office && Office.context && Office.context.document) {
        Office.context.document.settings.set(SETTING, cfg);
        return new Promise(function (resolve) { Office.context.document.settings.saveAsync(function () { resolve(); }); });
      }
      global.localStorage.setItem(SETTING, JSON.stringify(cfg));
    } catch (e) { /* a workbook opened read-only cannot keep settings */ }
    return Promise.resolve();
  }

  function headers(cfg) {
    var h = {};
    if (cfg.token) h.Authorization = 'Bearer ' + cfg.token;
    return h;
  }

  async function listVessels(cfg) {
    var res = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/api/vessels', { headers: headers(cfg) });
    if (!res.ok) throw new Error('Vessel list failed (' + res.status + ')');
    return res.json();
  }

  /**
   * The workbook as a file, to the endpoint the Add-tanks panel posts to.
   * preview:true asks the server what it found without writing anything.
   */
  async function sendWorkbook(cfg, blob, filename, opts) {
    opts = opts || {};
    var fd = new FormData();
    fd.append('file', blob, filename || 'workbook.xlsx');
    fd.append('preview', opts.preview ? 'true' : 'false');
    if (!opts.preview) {
      fd.append('replaceExisting', opts.replaceExisting ? 'true' : 'false');
      fd.append('updateExisting', opts.replaceExisting ? 'true' : 'false');
    }
    var url = cfg.baseUrl.replace(/\/$/, '') + '/api/vessels/' + encodeURIComponent(cfg.vesselId) + '/tanks/import-csv';
    var res = await fetch(url, { method: 'POST', body: fd, headers: headers(cfg) });
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(body.error || ('Import failed (' + res.status + ')'));
    return body;
  }

  /**
   * Office.js hands back the workbook in 4 MB slices; stitch them into the
   * blob the endpoint expects.
   */
  function currentWorkbookBlob() {
    return new Promise(function (resolve, reject) {
      Office.context.document.getFileAsync(Office.FileType.Compressed, { sliceSize: 4 * 1024 * 1024 }, function (result) {
        if (result.status !== Office.AsyncResultStatus.Succeeded) return reject(new Error(result.error.message));
        var file = result.value;
        var slices = [];
        var got = 0;
        function next(i) {
          file.getSliceAsync(i, function (sliceResult) {
            if (sliceResult.status !== Office.AsyncResultStatus.Succeeded) {
              file.closeAsync();
              return reject(new Error(sliceResult.error.message));
            }
            slices[i] = new Uint8Array(sliceResult.value.data);
            got++;
            if (got < file.sliceCount) return next(i + 1);
            file.closeAsync();
            resolve(new Blob(slices, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
          });
        }
        next(0);
      });
    });
  }

  var api = {
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    listVessels: listVessels,
    sendWorkbook: sendWorkbook,
    currentWorkbookBlob: currentWorkbookBlob,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.TankChiefApi = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
