/* Tank Chief notes and reminders. A ticked line appears when the program opens. */
(function () {
  const KEY = 'tankChiefNotes:v1';

  function embedded() {
    try {
      if (document.documentElement.classList.contains('chengaio-embed')) return true;
      if (typeof isAioEmbedded === 'function' && isAioEmbedded()) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  function vesselId() {
    try { return (typeof STATE !== 'undefined' && STATE.activeVesselId) ? String(STATE.activeVesselId) : ''; }
    catch (e) { return ''; }
  }

  function loadAll() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(raw) ? raw.filter((n) => n && n.id) : [];
    } catch (e) { return []; }
  }

  function saveAll(list) { localStorage.setItem(KEY, JSON.stringify(list)); }

  function forVessel(list) {
    const id = vesselId();
    return list.filter((n) => String(n.vesselId || '') === id);
  }

  function uid() {
    return 'n-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function deadlineState(value) {
    if (!value) return '';
    const t = new Date(value).getTime();
    if (Number.isNaN(t)) return '';
    if (t < Date.now()) return 'overdue';
    if (t - Date.now() < 24 * 60 * 60 * 1000) return 'soon';
    return 'later';
  }

  function deadlineLabel(value) {
    if (!value) return 'No deadline';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'No deadline';
    const when = d.toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const state = deadlineState(value);
    if (state === 'overdue') return 'Overdue · ' + when;
    if (state === 'soon') return 'Due within a day · ' + when;
    return 'Deadline · ' + when;
  }

  function sortNotes(list) {
    return list.slice().sort((a, b) => {
      const ae = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const be = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      const an = Number.isNaN(ae) ? Infinity : ae;
      const bn = Number.isNaN(be) ? Infinity : be;
      if (an !== bn) return an - bn;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
  }

  function ensureStyle() {
    if (document.getElementById('cheng-notes-style')) return;
    const style = document.createElement('style');
    style.id = 'cheng-notes-style';
    style.textContent = [
      '.note-lead{margin:0 0 12px;line-height:1.5;color:var(--text-dim,inherit);}',
      '.note-form{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:12px;}',
      '.note-form .span2{grid-column:1 / -1;}',
      '.note-form textarea{min-height:88px;resize:vertical;width:100%;box-sizing:border-box;}',
      '.note-form input[type="text"],.note-form input[type="datetime-local"],.note-form textarea{width:100%;box-sizing:border-box;font:inherit;color:inherit;}',
      '.note-check{display:flex;align-items:flex-start;gap:10px;min-height:44px;line-height:1.4;}',
      '.note-check input{width:20px;height:20px;margin-top:2px;flex:0 0 auto;}',
      '.note-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:start;padding:12px 0;border-top:1px solid var(--line,rgba(255,255,255,.12));}',
      '.note-main{min-width:0;}',
      '.note-main strong{display:block;line-height:1.35;}',
      '.note-main p{margin:4px 0 0;white-space:pre-wrap;line-height:1.45;color:var(--text-dim,inherit);}',
      '.note-when{margin-top:6px;font-size:12px;}',
      '.note-when.overdue{color:var(--danger,#e06a4c);font-weight:700;}',
      '.note-when.soon{color:var(--accent,#c4a46a);font-weight:700;}',
      '.note-actions{display:flex;flex-direction:column;gap:6px;}',
      '.note-pop{position:fixed;inset:0;z-index:8000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(4,10,18,.62);}',
      '.note-pop-card{width:min(560px,100%);max-height:min(80vh,720px);overflow:auto;background:var(--panel,#16324a);color:var(--text,#e9e4d6);border:1px solid var(--line,rgba(255,255,255,.2));border-radius:14px;padding:16px;}',
      '.note-pop-item{padding:10px 0;border-top:1px solid var(--line,rgba(255,255,255,.12));}',
      '.note-pop-item p{margin:4px 0 0;white-space:pre-wrap;}',
      '@media (max-width:700px){.note-form{grid-template-columns:1fr;}.note-row{grid-template-columns:auto minmax(0,1fr);}.note-actions{grid-column:1 / -1;flex-direction:row;flex-wrap:wrap;}}'
    ].join('');
    document.head.appendChild(style);
  }

  function paint(host) {
    if (!host) return;
    ensureStyle();
    const editing = host.dataset.editId || '';
    const mine = sortNotes(forVessel(loadAll()));
    const current = mine.find((n) => n.id === editing) || null;
    const remindCount = mine.filter((n) => n.remind).length;
    host.innerHTML =
      '<p class="note-lead">Save a note for this ship. Tick <b>Show when the program opens</b> and it is listed at startup, with its deadline.</p>' +
      '<form class="note-form" id="noteForm">' +
        '<div class="form-row"><label for="noteTitle">Title</label><input id="noteTitle" type="text" maxlength="160" value="' + esc(current ? current.title : '') + '" placeholder="Survey, certificate, spare, call"></div>' +
        '<div class="form-row"><label for="noteDeadline">Deadline</label><input id="noteDeadline" type="datetime-local" value="' + esc(current && current.deadline ? current.deadline : '') + '"></div>' +
        '<div class="form-row span2"><label for="noteBody">Note</label><textarea id="noteBody" maxlength="4000" placeholder="What has to be done">' + esc(current ? current.body : '') + '</textarea></div>' +
        '<label class="note-check span2"><input id="noteRemind" type="checkbox"' + ((current ? current.remind : true) ? ' checked' : '') + '><span>Show when the program opens</span></label>' +
        '<div class="btn-row span2"><button type="submit" class="btn primary" id="noteSave">' + (current ? 'Save changes' : 'Save note') + '</button><button type="button" class="btn" id="noteClear">Clear</button></div>' +
      '</form>' +
      '<p class="hint" id="noteRemindCount">' + remindCount + (remindCount === 1 ? ' reminder appears' : ' reminders appear') + ' when this program opens.</p>' +
      '<div id="noteList"></div>';
    const list = host.querySelector('#noteList');
    if (!mine.length) list.innerHTML = '<p class="hint">No notes for this ship yet.</p>';
    else {
      list.innerHTML = mine.map((n) => {
        const st = deadlineState(n.deadline);
        return '<article class="note-row"><label class="note-check"><input type="checkbox" data-remind="' + esc(n.id) + '"' + (n.remind ? ' checked' : '') + '><span>Show at open</span></label>' +
          '<div class="note-main"><strong>' + esc(n.title || 'Note') + '</strong>' + (n.body ? '<p>' + esc(n.body) + '</p>' : '') +
          '<div class="note-when ' + st + '">' + esc(deadlineLabel(n.deadline)) + '</div></div>' +
          '<div class="note-actions"><button type="button" class="btn small" data-edit="' + esc(n.id) + '">Edit</button>' +
          '<button type="button" class="btn small" data-delete="' + esc(n.id) + '">Delete</button></div></article>';
      }).join('');
    }
    host.querySelector('#noteForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const title = host.querySelector('#noteTitle').value.trim();
      const body = host.querySelector('#noteBody').value.trim();
      if (!title && !body) { host.querySelector('#noteTitle').focus(); return; }
      const now = new Date().toISOString();
      const next = loadAll();
      if (editing) {
        const row = next.find((n) => n.id === editing);
        if (row) {
          row.title = title; row.body = body;
          row.deadline = host.querySelector('#noteDeadline').value || '';
          row.remind = host.querySelector('#noteRemind').checked;
          row.vesselId = vesselId(); row.updatedAt = now;
        }
      } else {
        next.push({
          id: uid(), vesselId: vesselId(), title: title, body: body,
          deadline: host.querySelector('#noteDeadline').value || '',
          remind: host.querySelector('#noteRemind').checked,
          createdAt: now, updatedAt: now
        });
      }
      saveAll(next);
      delete host.dataset.editId;
      paint(host);
    });
    host.querySelector('#noteClear').addEventListener('click', () => { delete host.dataset.editId; paint(host); });
    list.addEventListener('click', (e) => {
      const edit = e.target.closest('[data-edit]');
      const del = e.target.closest('[data-delete]');
      if (edit) {
        host.dataset.editId = edit.getAttribute('data-edit');
        paint(host);
        host.querySelector('#noteTitle').focus();
      } else if (del) {
        const id = del.getAttribute('data-delete');
        const row = mine.find((n) => n.id === id);
        if (!window.confirm('Delete “' + ((row && row.title) || 'this note') + '”?')) return;
        saveAll(loadAll().filter((n) => n.id !== id));
        if (host.dataset.editId === id) delete host.dataset.editId;
        paint(host);
      }
    });
    list.addEventListener('change', (e) => {
      const box = e.target.closest('[data-remind]');
      if (!box) return;
      const next = loadAll();
      const row = next.find((n) => n.id === box.getAttribute('data-remind'));
      if (!row) return;
      row.remind = box.checked;
      row.updatedAt = new Date().toISOString();
      saveAll(next);
      const count = forVessel(next).filter((n) => n.remind).length;
      const hint = host.querySelector('#noteRemindCount');
      if (hint) hint.textContent = count + (count === 1 ? ' reminder appears' : ' reminders appear') + ' when this program opens.';
    });
  }

  function render(main) {
    ensureStyle();
    const wrap = document.createElement('div');
    wrap.className = 'form-panel';
    wrap.innerHTML = '<div class="page-head"><h1>Notes</h1><div class="desc">Reminders for this ship</div></div><div id="tankNotesHost"></div>';
    main.appendChild(wrap);
    paint(wrap.querySelector('#tankNotesHost'));
  }

  let prompted = false;
  function promptOnOpen() {
    if (prompted || embedded()) return;
    prompted = true;
    const due = sortNotes(forVessel(loadAll()).filter((n) => n.remind));
    if (!due.length) return;
    ensureStyle();
    const pop = document.createElement('div');
    pop.className = 'note-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'true');
    pop.setAttribute('aria-label', 'Reminders');
    pop.innerHTML = '<div class="note-pop-card"><h2>Reminders</h2><p class="note-lead">Ticked notes for this ship. Close leaves them set for the next time the program opens.</p>' +
      due.map((n) => '<div class="note-pop-item"><strong>' + esc(n.title || 'Note') + '</strong>' +
        (n.body ? '<p>' + esc(n.body) + '</p>' : '') +
        '<div class="note-when ' + deadlineState(n.deadline) + '">' + esc(deadlineLabel(n.deadline)) + '</div>' +
        '<div class="btn-row"><button type="button" class="btn" data-stop="' + esc(n.id) + '">Stop reminding</button></div></div>').join('') +
      '<div class="btn-row"><button type="button" class="btn" id="notePopClose">Close</button><button type="button" class="btn primary" id="notePopOpen">Open notes</button></div></div>';
    document.body.appendChild(pop);
    const close = () => pop.remove();
    pop.querySelector('#notePopClose').addEventListener('click', close);
    pop.querySelector('#notePopOpen').addEventListener('click', () => {
      close();
      if (typeof navigate === 'function') navigate('notes');
    });
    pop.addEventListener('click', (e) => {
      if (e.target === pop) close();
      const stop = e.target.closest('[data-stop]');
      if (!stop) return;
      const next = loadAll();
      const row = next.find((n) => n.id === stop.getAttribute('data-stop'));
      if (row) { row.remind = false; row.updatedAt = new Date().toISOString(); saveAll(next); }
      const item = stop.closest('.note-pop-item');
      if (item) item.remove();
      if (!pop.querySelector('.note-pop-item')) close();
      const host = document.getElementById('tankNotesHost');
      if (host) paint(host);
    });
  }

  window.TankNotes = { render: render, promptOnOpen: promptOnOpen };
})();
