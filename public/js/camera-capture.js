/**
 * Take a picture from the device camera — Android and Windows.
 *
 * Used wherever a photo (not signature/stamp) or a BDN document scan is
 * attached. Prefer a live getUserMedia preview when the browser allows it
 * (desktop Windows webcam, Android Chrome). If that fails — permission denied,
 * insecure context, or no camera API — fall back to a hidden file input with
 * capture="environment", which opens the system camera on Android and a file
 * picker on Windows.
 *
 * Signature / stamp / logo uploads must not use this helper: those stay as
 * choose-file or draw-on-screen only.
 */
(function (root) {
  'use strict';
  if (root.ChengCamera) return;

  let activeStream = null;
  let facingMode = 'environment';

  function stopStream() {
    if (!activeStream) return;
    try {
      activeStream.getTracks().forEach((t) => t.stop());
    } catch (_) { /* ignore */ }
    activeStream = null;
  }

  function canUseLiveCamera() {
    try {
      return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
    } catch (_) {
      return false;
    }
  }

  function ensureStyles() {
    if (document.getElementById('cheng-camera-styles')) return;
    const css = document.createElement('style');
    css.id = 'cheng-camera-styles';
    css.textContent = `
      .cheng-cam-overlay{
        position:fixed; inset:0; z-index:10050; display:flex; align-items:center; justify-content:center;
        background:rgba(0,0,0,0.72); padding:16px; box-sizing:border-box;
      }
      .cheng-cam-dialog{
        width:min(560px, 100%); background:var(--panel, #1a222c); border:1px solid var(--line-strong, #3a4654);
        border-radius:8px; overflow:hidden; color:var(--paper, #e8ecef);
        box-shadow:0 12px 40px rgba(0,0,0,0.45);
      }
      .cheng-cam-dialog h3{
        margin:0; padding:14px 16px; font-family:Oswald,sans-serif; font-size:13px;
        letter-spacing:0.08em; text-transform:uppercase; color:var(--brass, #c4a35a);
        border-bottom:1px solid var(--line, #2c3642);
      }
      .cheng-cam-video-wrap{
        position:relative; background:#000; aspect-ratio:4/3; max-height:min(60vh, 420px);
      }
      .cheng-cam-video-wrap video{
        width:100%; height:100%; object-fit:cover; display:block; background:#000;
      }
      .cheng-cam-actions{
        display:flex; flex-wrap:wrap; gap:8px; padding:12px 16px 16px; justify-content:flex-end;
      }
      .cheng-cam-actions button{
        font-family:Oswald,sans-serif; font-size:12px; letter-spacing:0.06em; text-transform:uppercase;
        padding:10px 16px; border-radius:3px; cursor:pointer; border:1px solid var(--brass-dim, #8a7340);
        background:transparent; color:var(--brass, #c4a35a);
      }
      .cheng-cam-actions button.cheng-cam-primary{
        background:var(--brass, #c4a35a); color:var(--ink, #0e141b); border-color:var(--brass, #c4a35a);
      }
      .cheng-cam-hint{
        padding:0 16px 8px; font-family:"IBM Plex Mono",monospace; font-size:11px;
        color:var(--paper-dim, #9aa5b1);
      }
      .cheng-cam-error{
        padding:24px 16px; font-family:"IBM Plex Mono",monospace; font-size:12px;
        color:var(--alert, #d07070); text-align:center;
      }
    `;
    document.head.appendChild(css);
  }

  function fileFromBlob(blob, basename) {
    const type = (blob && blob.type) || 'image/jpeg';
    const ext = type.indexOf('png') >= 0 ? 'png' : type.indexOf('webp') >= 0 ? 'webp' : 'jpg';
    const name = `${basename || 'photo'}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`;
    try {
      return new File([blob], name, { type, lastModified: Date.now() });
    } catch (_) {
      blob.name = name;
      blob.lastModified = Date.now();
      return blob;
    }
  }

  function openSystemCameraInput() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.setAttribute('capture', 'environment');
      input.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0;';
      let settled = false;
      const finish = (fn) => {
        if (settled) return;
        settled = true;
        try { input.remove(); } catch (_) { /* ignore */ }
        root.removeEventListener('focus', onFocus);
        fn();
      };
      const onFocus = () => {
        /* User cancelled the picker: change never fires. Give the OS a beat. */
        setTimeout(() => {
          if (!settled && !(input.files && input.files[0])) {
            finish(() => reject(new Error('cancelled')));
          }
        }, 600);
      };
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (file) finish(() => resolve(file));
        else finish(() => reject(new Error('cancelled')));
      });
      document.body.appendChild(input);
      root.addEventListener('focus', onFocus);
      try {
        input.click();
      } catch (err) {
        finish(() => reject(err || new Error('camera unavailable')));
      }
    });
  }

  function openLiveCameraModal(options) {
    ensureStyles();
    facingMode = (options && options.facingMode) || 'environment';
    const title = (options && options.title) || 'Take Picture';

    return new Promise((resolve, reject) => {
      const overlay = document.createElement('div');
      overlay.className = 'cheng-cam-overlay';
      overlay.innerHTML = `
        <div class="cheng-cam-dialog" role="dialog" aria-modal="true" aria-label="${title}">
          <h3>${title}</h3>
          <div class="cheng-cam-video-wrap"><video playsinline autoplay muted></video></div>
          <div class="cheng-cam-hint">Point the camera and tap Capture. On a laptop this uses the webcam.</div>
          <div class="cheng-cam-actions">
            <button type="button" data-cam="switch">Switch Camera</button>
            <button type="button" data-cam="cancel">Cancel</button>
            <button type="button" class="cheng-cam-primary" data-cam="shot">Capture</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const video = overlay.querySelector('video');
      let settled = false;

      const cleanup = () => {
        stopStream();
        try { overlay.remove(); } catch (_) { /* ignore */ }
      };
      const finishOk = (file) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(file);
      };
      const finishErr = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      async function start() {
        stopStream();
        try {
          activeStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: facingMode },
              width: { ideal: 1280 },
              height: { ideal: 960 }
            }
          });
          video.srcObject = activeStream;
          try { await video.play(); } catch (_) { /* autoplay policies */ }
        } catch (err) {
          finishErr(err);
        }
      }

      overlay.querySelector('[data-cam="cancel"]').addEventListener('click', () => {
        finishErr(new Error('cancelled'));
      });
      overlay.querySelector('[data-cam="switch"]').addEventListener('click', () => {
        facingMode = facingMode === 'environment' ? 'user' : 'environment';
        start();
      });
      overlay.querySelector('[data-cam="shot"]').addEventListener('click', () => {
        try {
          const w = video.videoWidth || 1280;
          const h = video.videoHeight || 960;
          if (!(w > 0 && h > 0)) {
            finishErr(new Error('Camera not ready'));
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, w, h);
          canvas.toBlob((blob) => {
            if (!blob) {
              finishErr(new Error('Could not capture frame'));
              return;
            }
            finishOk(fileFromBlob(blob, options && options.basename));
          }, 'image/jpeg', 0.88);
        } catch (err) {
          finishErr(err);
        }
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) finishErr(new Error('cancelled'));
      });

      start();
    });
  }

  /**
   * @param {{ title?: string, facingMode?: string, basename?: string, preferSystem?: boolean }} [options]
   * @returns {Promise<File|Blob>}
   */
  async function takePicture(options) {
    const opts = options || {};
    if (!opts.preferSystem && canUseLiveCamera()) {
      try {
        return await openLiveCameraModal(opts);
      } catch (err) {
        if (err && String(err.message) === 'cancelled') throw err;
        /* Fall through to the system camera / picker. */
      }
    }
    return openSystemCameraInput();
  }

  /** Put a captured File onto an existing <input type="file"> so existing change handlers run. */
  function assignFileToInput(input, file) {
    if (!input || !file) return false;
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Wire a Take Picture button. Prefer assigning onto fileInput so existing
   * upload/preview handlers stay in charge; otherwise call onFile(file).
   */
  function wireTakePictureButton(button, { fileInput, onFile, title, basename } = {}) {
    if (!button) return;
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      button.disabled = true;
      try {
        const file = await takePicture({ title, basename });
        if (!file) return;
        if (fileInput && assignFileToInput(fileInput, file)) return;
        if (typeof onFile === 'function') await onFile(file);
      } catch (err) {
        if (err && String(err.message) === 'cancelled') return;
        alert('Could not open the camera. Check camera permission, or choose a file instead.');
        console.warn('ChengCamera.takePicture failed', err);
      } finally {
        button.disabled = false;
      }
    });
  }

  root.ChengCamera = {
    takePicture,
    assignFileToInput,
    wireTakePictureButton,
    canUseLiveCamera
  };
})(typeof window !== 'undefined' ? window : globalThis);
