// rk-bot dashboard — vanilla JS
(() => {
  const wsUrl = `ws://${location.host}/events`;
  let ws;
  let state = null;
  let currentFile = 'bot.yaml';
  let editorDirty = false;
  const $log = document.getElementById('logView');
  const $editor = document.getElementById('configEditor');
  const $saveNote = document.getElementById('saveNote');

  function connect() {
    ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => setNote('connected', 'ok'));
    ws.addEventListener('message', (e) => onMsg(JSON.parse(e.data)));
    ws.addEventListener('close', () => { setNote('reconnect…', 'warn'); setTimeout(connect, 1500); });
  }

  function setNote(txt, cls) { $saveNote.textContent = txt; $saveNote.className = 'saveNote ' + (cls || ''); }

  function onMsg(m) {
    if (m.t === 'state') { state = m; render(); }
    else if (m.t === 'log') appendLog(m.line, m.ts);
    else if (m.t === 'hello') $log.textContent = '';
  }

  function appendLog(line, ts) {
    const time = new Date(ts).toISOString().substring(11, 19);
    $log.textContent += `${time}  ${line}\n`;
    if ($log.textContent.length > 200_000) $log.textContent = $log.textContent.slice(-150_000);
    $log.scrollTop = $log.scrollHeight;
  }

  function render() {
    if (!state) return;
    renderStats(state.self, state.counters, state.paused);
    renderActors(state.actors, state.self);
    renderDrops(state.drops);
    document.getElementById('botState').textContent = state.paused ? 'PAUSED' : 'RUNNING';
    document.getElementById('botState').className = 'state ' + (state.paused ? 'paused' : 'running');
  }

  function renderStats(self, counters, paused) {
    const cells = [
      ['ID',   self.id != null ? '0x' + self.id.toString(16) : '?'],
      ['Map',  self.map ?? '?'],
      ['Pos',  self.pos ? `${self.pos.x}, ${self.pos.y}` : '?'],
      { k: 'HP',   v: self.hp != null && self.hpMax != null ? `${self.hp}/${self.hpMax}` : '?', cls: 'hp' },
      { k: 'SP',   v: self.sp != null && self.spMax != null ? `${self.sp}/${self.spMax}` : '?', cls: 'sp' },
      ['Dead', self.dead ? 'YES' : 'no', self.dead ? 'dead' : ''],
      ['Base EXP', self.baseExp ?? '?'],
      ['Job EXP',  self.jobExp ?? '?'],
      ['Kills',   counters.kills],
      ['Loot',    counters.loot],
      ['Exp+',    counters.exp],
      ['Bot',     paused ? 'paused' : 'running'],
    ];
    const $g = document.getElementById('statsGrid');
    $g.innerHTML = '';
    for (const c of cells) {
      const cell = Array.isArray(c) ? { k: c[0], v: c[1], cls: c[2] } : c;
      const el = document.createElement('div');
      el.className = 'cell ' + (cell.cls || '');
      el.innerHTML = `<div class="k">${escape(cell.k)}</div><div class="v">${escape(String(cell.v))}</div>`;
      $g.appendChild(el);
    }
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function renderActors(actors, self) {
    const rows = actors
      .map((a) => ({ ...a, d: self.pos && a.pos ? dist(self.pos, a.pos) : Infinity }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 30);
    document.getElementById('actorCount').textContent = actors.length;
    const $tb = document.querySelector('#actorTable tbody');
    $tb.innerHTML = rows.map(a => `
      <tr class="${!a.alive ? 'dead' : ''} ${a.id === self.id ? 'self' : ''}">
        <td>${escape(a.name ?? '?')}</td>
        <td>${a.kind}</td>
        <td>0x${a.id.toString(16)}</td>
        <td>${a.pos ? a.pos.x + ',' + a.pos.y : '?'}</td>
        <td>${isFinite(a.d) ? a.d.toFixed(1) : '?'}</td>
        <td>${a.alive ? '✓' : '×'}</td>
      </tr>
    `).join('');
  }

  function renderDrops(drops) {
    document.getElementById('dropCount').textContent = drops.length;
    const $tb = document.querySelector('#dropTable tbody');
    $tb.innerHTML = drops.map(d => `
      <tr>
        <td>0x${d.dropId.toString(16)}</td>
        <td>${d.itemId}</td>
        <td>${d.amount}</td>
        <td>${d.at.x.toFixed(0)},${d.at.y.toFixed(0)}</td>
        <td>${(d.age / 1000).toFixed(1)}s</td>
      </tr>
    `).join('');
  }

  function escape(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // Controls
  document.getElementById('btnPause').onclick = () => fetch('/api/pause', { method: 'POST' });
  document.getElementById('btnResume').onclick = () => fetch('/api/resume', { method: 'POST' });

  // Config editor
  document.querySelectorAll('.tab').forEach(btn => {
    btn.onclick = async () => {
      if (editorDirty && !confirm('Unsaved changes will be lost. Continue?')) return;
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFile = btn.dataset.file;
      await loadConfig();
    };
  });

  async function loadConfig() {
    const text = await fetch(`/api/config/${currentFile}`).then(r => r.text());
    $editor.value = text;
    editorDirty = false;
    setNote('loaded ' + currentFile, '');
  }
  $editor.addEventListener('input', () => { editorDirty = true; setNote('modified', 'warn'); });

  document.getElementById('btnSaveConfig').onclick = async () => {
    const res = await fetch(`/api/config/${currentFile}`, { method: 'PUT', body: $editor.value });
    if (res.ok) { editorDirty = false; setNote('saved ✓ (hot-reloaded)', 'ok'); }
    else setNote('save failed', 'err');
  };

  // Keyboard: cmd+s save
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      document.getElementById('btnSaveConfig').click();
    }
  });

  loadConfig();
  connect();
})();
