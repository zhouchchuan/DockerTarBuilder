const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let token = localStorage.getItem('pbb-token') || '';

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401) {
    $('#tokenDialog').showModal();
    throw new Error('需要管理令牌');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function notify(message, error = false) {
  const box = $('#message');
  box.textContent = message;
  box.className = `message${error ? ' error' : ''}`;
  setTimeout(() => box.classList.add('hidden'), 4500);
}

function displayTime(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}

async function refreshStatus() {
  try {
    const status = await api('/api/status');
    $('#serviceState').textContent = status.enabled ? '运行中' : '已暂停';
    $('#serviceState').className = status.enabled ? 'ok' : '';
    $('#qbState').textContent = status.qbConnected ? '正常' : (status.configured ? '未连接' : '未配置');
    $('#qbState').className = status.qbConnected ? 'ok' : 'error';
    for (const key of ['scanCount', 'peerCount', 'ipBanCount', 'endpointBanCount', 'qbVersion', 'torrentCount']) {
      $(`#${key}`).textContent = status[key] ?? '—';
    }
    $('#lastScanAt').textContent = displayTime(status.lastScanAt);
    $('#lastError').textContent = status.lastError || '无';
  } catch (error) {
    if (!String(error).includes('管理令牌')) notify(error.message, true);
  }
}

async function refreshPeers() {
  const peers = await api('/api/peers');
  $('#peerRows').innerHTML = peers.map(({ peer, decision }) => `<tr>
    <td>${escapeHtml(`${peer.ip}:${peer.port}`)}</td><td>${escapeHtml(peer.client || 'Unknown')}</td>
    <td>${escapeHtml(peer.peerId || '')}</td><td title="${escapeHtml(peer.torrentHash)}">${escapeHtml(peer.torrentName || '')}</td>
    <td><span class="tag ${decision.action}">${actionName(decision.action)}</span></td></tr>`).join('') || '<tr><td colspan="5">暂无 Peer 数据</td></tr>';
}

async function refreshEvents() {
  const events = await api('/api/events?limit=500');
  $('#eventRows').innerHTML = events.map((event) => `<tr><td>${displayTime(event.timestamp)}</td>
    <td>${escapeHtml(event.target)}</td><td><span class="tag ${event.action}">${actionName(event.action)}</span></td>
    <td>${escapeHtml(event.client || 'Unknown')}</td><td>${escapeHtml(event.peerId || '')}</td>
    <td class="wrap">${escapeHtml(event.reason || '')}</td></tr>`).join('') || '<tr><td colspan="6">暂无封禁记录</td></tr>';
}

async function loadConfig() {
  const config = await api('/api/config');
  $('#enabled').checked = config.enabled;
  $('#qbUrl').value = config.qbittorrent.url || '';
  $('#qbUsername').value = config.qbittorrent.username || '';
  $('#qbPassword').value = '';
  $('#scanInterval').value = config.scanIntervalSeconds;
  $('#decisionCooldown').value = config.decisionCooldownSeconds;
}

async function loadRules() {
  $('#rulesEditor').value = JSON.stringify(await api('/api/rules'), null, 2);
}

function actionName(action) {
  return ({ allow: '放行', observe: '观察', block_ip: '整 IP', block_endpoint: 'IP:端口' })[action] || action;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

$$('nav button').forEach((button) => button.addEventListener('click', async () => {
  $$('nav button,.tab').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  $(`#${button.dataset.tab}`).classList.add('active');
  try {
    if (button.dataset.tab === 'events') await refreshEvents();
    if (button.dataset.tab === 'rules') await loadRules();
    if (button.dataset.tab === 'settings') await loadConfig();
  } catch (error) { notify(error.message, true); }
}));

$('#scanNow').addEventListener('click', async () => {
  try {
    const result = await api('/api/scan', { method: 'POST' });
    const message = result.ok
      ? `检查完成：整 IP ${result.ipBans}，IP:端口 ${result.endpointBans}`
      : (result.skipped ? '已有检查任务正在运行' : result.error);
    notify(message, !result.ok && !result.skipped);
    await Promise.all([refreshStatus(), refreshPeers()]);
  }
  catch (error) { notify(error.message, true); }
});

$('#saveConfig').addEventListener('click', async () => {
  const qbittorrent = { url: $('#qbUrl').value.trim(), username: $('#qbUsername').value.trim() };
  if ($('#qbPassword').value) qbittorrent.password = $('#qbPassword').value;
  try {
    await api('/api/config', { method: 'PUT', body: JSON.stringify({
      enabled: $('#enabled').checked,
      scanIntervalSeconds: Number($('#scanInterval').value),
      decisionCooldownSeconds: Number($('#decisionCooldown').value),
      qbittorrent
    }) });
    notify('设置已保存'); await refreshStatus();
  } catch (error) { notify(error.message, true); }
});

$('#testConnection').addEventListener('click', async () => {
  try { const result = await api('/api/test-connection', { method: 'POST' }); notify(`连接成功：${result.version}`); }
  catch (error) { notify(error.message, true); }
});

$('#saveRules').addEventListener('click', async () => {
  try { await api('/api/rules', { method: 'PUT', body: JSON.stringify(JSON.parse($('#rulesEditor').value)) }); notify('规则已保存'); }
  catch (error) { notify(error.message, true); }
});

$('#clearEvents').addEventListener('click', async () => {
  if (!confirm('确认清空全部封禁记录？')) return;
  try { await api('/api/events', { method: 'DELETE' }); await refreshEvents(); notify('记录已清空'); }
  catch (error) { notify(error.message, true); }
});

$('#saveToken').addEventListener('click', () => {
  token = $('#tokenInput').value;
  localStorage.setItem('pbb-token', token);
  setTimeout(() => { void refreshStatus(); void refreshPeers(); }, 0);
});

await Promise.allSettled([refreshStatus(), refreshPeers()]);
setInterval(() => { void refreshStatus(); }, 5000);
