/**
 * Progress bar for work that takes long enough to look stalled: uploading a
 * capacity book or workbook, lifting the background off a photographed
 * signature, and backup / restore / peer sync / flushing the offline queue.
 *
 * Determinate where a percentage is genuinely known — bytes sent or received,
 * queued changes sent — and indeterminate only while waiting on the server,
 * so the bar never claims progress it cannot measure.
 */
const Progress = (() => {
  let timer = null;
  let startedAt = 0;

  function elapsedLabel(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function ensure(mountEl) {
    let box = document.getElementById('task-progress');
    if (!box) {
      box = document.createElement('div');
      box.id = 'task-progress';
      box.className = 'pdf-progress';
      box.innerHTML = `
        <div class="pdf-progress-head">
          <div class="pdf-progress-title" id="task-progress-title">Working…</div>
          <div class="pdf-progress-time" id="task-progress-time">0:00</div>
        </div>
        <div class="pdf-progress-bar" id="task-progress-bar"><div id="task-progress-fill"></div></div>
        <div class="pdf-progress-msg" id="task-progress-msg"></div>`;
    }
    if (mountEl && box.parentElement !== mountEl) mountEl.prepend(box);
    else if (!box.parentElement) document.body.appendChild(box);
    return box;
  }

  /** Open the bar. Returns the element so a caller can scroll it into view. */
  function start(mountEl, title, message) {
    const box = ensure(mountEl);
    box.style.display = '';
    box.classList.add('active');
    box.querySelector('#task-progress-title').textContent = title || 'Working…';
    box.querySelector('#task-progress-msg').textContent = message || '';
    box.querySelector('#task-progress-time').textContent = '0:00';
    set(0);
    startedAt = Date.now();
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      const t = document.getElementById('task-progress-time');
      if (t) t.textContent = elapsedLabel(Date.now() - startedAt);
    }, 500);
    return box;
  }

  /** pct null = indeterminate (waiting on something we cannot measure). */
  function set(pct, message) {
    const bar = document.getElementById('task-progress-bar');
    const fill = document.getElementById('task-progress-fill');
    const msg = document.getElementById('task-progress-msg');
    if (!bar || !fill) return;
    if (message != null && msg) msg.textContent = message;
    if (pct == null) {
      bar.classList.add('indeterminate');
      fill.style.width = '40%';
      return;
    }
    bar.classList.remove('indeterminate');
    fill.style.width = `${Math.max(2, Math.min(100, pct))}%`;
  }

  function done(message) {
    if (message) set(100, message);
    if (timer) { clearInterval(timer); timer = null; }
    const box = document.getElementById('task-progress');
    if (!box) return;
    window.setTimeout(() => {
      box.classList.remove('active');
      box.style.display = 'none';
    }, message ? 600 : 0);
  }

  /** Let the browser paint between chunks of synchronous work. */
  function yieldToPaint() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { start, set, done, yieldToPaint };
})();

window.Progress = Progress;
