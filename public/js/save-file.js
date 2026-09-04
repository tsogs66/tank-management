/**
 * One way to put a file on the user's device, for every program in the suite.
 *
 * A backup that the program says it wrote and the user then cannot find is
 * worse than one that failed loudly, and each of the four ways a browser will
 * hand over a file is missing somewhere we run:
 *
 *   native      the Android application's own bridge. The Capacitor WebView
 *               has no download manager at all, so a blob anchor there is a
 *               no-op that reports success — this is the only path that
 *               actually writes a file on the phone.
 *   parent      Voyage / Tank running inside the ChEng AIO shell: the shell
 *               owns the native bridge, so the embed asks it, the same way
 *               printing already works.
 *   picker      desktop Chromium / Electron: the user chooses the folder.
 *   share       mobile browsers: Save to Files / Drive / USB.
 *   anchor      everything else, with a delayed revoke because a WebView
 *               needs a beat to start reading the blob.
 *
 * The returned `method` is what the caller tells the user, so "check your
 * Downloads folder" is never printed for a save that went somewhere else.
 */
(function (root) {
  'use strict';
  if (root.ChengSaveFile) return;

  const PARENT_TIMEOUT_MS = 20000;

  function appLabel() {
    try {
      if (root.Branding && Branding.APP_NAME) return Branding.APP_NAME;
      if (typeof APP_NAME === 'string' && APP_NAME) return APP_NAME;
    } catch (_) { /* ignore */ }
    return 'ChEng';
  }

  function safeFileName(name) {
    const base = String(name || '').trim().replace(/[\\/:*?"<>|]+/g, '-');
    return base || `cheng-backup-${Date.now()}.json`;
  }

  function nativeBridge() {
    try {
      const b = root.ChengAndroidFiles;
      if (b && typeof b.saveText === 'function') return b;
    } catch (_) { /* ignore */ }
    return null;
  }

  /** True when this window is an embed whose parent may hold the native bridge. */
  function hasParentShell() {
    if (!root.parent || root.parent === root) return false;
    try {
      if (root.parent.ChengSaveFile || root.parent.ChengPro || root.parent.ChengProShell) return true;
    } catch (_) {
      /* Cross-origin parent — assume a shell and let the timeout decide. */
      return true;
    }
    return false;
  }

  function saveViaNative(bridge, filename, text, mime) {
    let where = '';
    try {
      where = String(bridge.saveText(filename, text, mime || 'application/json') || '');
    } catch (err) {
      console.warn('Android file bridge failed', err);
      return null;
    }
    if (!where) return null;
    return { method: 'native', filename, where };
  }

  function saveViaParent(filename, text, mime) {
    return new Promise((resolve) => {
      const requestId = 'sv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        try { root.removeEventListener('message', onMsg); } catch (_) { /* ignore */ }
        clearTimeout(timer);
        resolve(value);
      };
      const onMsg = (ev) => {
        const msg = ev.data || {};
        if (msg.type !== 'chengaio-save-file-result' || msg.requestId !== requestId) return;
        finish(msg.saved || null);
      };
      root.addEventListener('message', onMsg);
      const timer = setTimeout(() => finish(null), PARENT_TIMEOUT_MS);
      try {
        root.parent.postMessage({
          type: 'chengaio-save-file',
          requestId,
          filename,
          text,
          mime: mime || 'application/json',
        }, '*');
      } catch (_) {
        finish(null);
      }
    });
  }

  async function saveViaPicker(blob, filename) {
    if (typeof root.showSaveFilePicker !== 'function') return null;
    const handle = await root.showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { method: 'picker', filename };
  }

  async function saveViaShare(blob, filename, mime) {
    const file = new File([blob], filename, { type: mime || 'application/json' });
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) return null;
    await navigator.share({
      files: [file],
      title: filename,
      text: `${appLabel()} backup — use Save to Files / Drive / USB so you can find it later.`,
    });
    return { method: 'share', filename };
  }

  function saveViaAnchor(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { a.remove(); } catch (_) { /* ignore */ }
      try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
    }, 4000);
    return { method: 'anchor', filename };
  }

  /**
   * Write JSON to the device.
   *
   * Rejects with a message when the user cancels — a cancelled save is not a
   * saved backup and must not be reported as one.
   */
  async function saveJson(name, data, opts) {
    const mime = (opts && opts.mime) || 'application/json';
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const filename = safeFileName(name);
    const blob = new Blob([text], { type: mime });

    const bridge = nativeBridge();
    if (bridge) {
      const saved = saveViaNative(bridge, filename, text, mime);
      if (saved) return saved;
    }

    if (hasParentShell()) {
      const saved = await saveViaParent(filename, text, mime);
      if (saved) return saved;
    }

    try {
      const saved = await saveViaPicker(blob, filename);
      if (saved) return saved;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('Save cancelled — nothing was written');
      }
      /* Picker unavailable or refused by the platform: try the next way. */
    }

    try {
      const saved = await saveViaShare(blob, filename, mime);
      if (saved) return saved;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('Share cancelled — the backup was not saved');
      }
    }

    return saveViaAnchor(blob, filename);
  }

  /** The sentence to show the user about where the file went. */
  function whereLabel(saved) {
    if (!saved) return 'saved';
    if (saved.method === 'native') {
      return saved.where ? `saved to ${saved.where}` : 'saved to your Downloads folder';
    }
    if (saved.method === 'picker') return 'saved to the folder you chose';
    if (saved.method === 'share') return 'shared — use Save to Files / Drive / USB';
    return `started — check Downloads for ${saved.filename}`;
  }

  /* Shell side: an embedded program asks this window to do the saving. */
  root.addEventListener('message', async (ev) => {
    const msg = ev.data || {};
    if (msg.type !== 'chengaio-save-file' || !msg.requestId) return;
    const reply = (saved) => {
      try {
        ev.source.postMessage({
          type: 'chengaio-save-file-result',
          requestId: msg.requestId,
          saved: saved || null,
        }, ev.origin || '*');
      } catch (_) { /* ignore */ }
    };
    /* Decline at once when this window can do no better than the embed could
       on its own — waiting out the timeout would only delay its own picker. */
    if (!nativeBridge()) { reply(null); return; }
    try {
      reply(saveViaNative(nativeBridge(), safeFileName(msg.filename),
        String(msg.text || ''), msg.mime));
    } catch (_) {
      reply(null);
    }
  });

  root.ChengSaveFile = { saveJson, whereLabel, safeFileName };
})(typeof window !== 'undefined' ? window : globalThis);
