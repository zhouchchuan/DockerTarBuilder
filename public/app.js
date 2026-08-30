import { createClientId } from './id.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const COLORS = ['#4c82ff', '#2ecc71', '#f4b942', '#ff5964', '#b07cff', '#23b7c9', '#ff8a4c', '#7d8da8', '#e861a6', '#84cc5b'];
let token = localStorage.getItem('pbb-token') || '';
let rules = [];
let downloaders = [];

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
  setTimeout(() => box.classList.add('hidden'), 5000);
}

function displayTime(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}

function formatBytes(value) {
  let number = Number(value || 0);
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let unit = 0;
  while (number >= 1024 && unit < units.length - 1) { number /= 1024; unit += 1; }
  return `${number.toFixed(unit ? 2 : 0)} ${units[unit]}`;
}

async function refreshStatus() {
  try {
    const [status, analytics] = await Promise.all([api('/api/status'), api('/api/analytics')]);
    $('#serviceState').textContent = status.enabled ? '运行中' : '已暂停';
    $('#serviceState').className = status.enabled ? 'ok' : '';
    const connected = (status.downloaders || []).filter((item) => item.connected).length;
    $('#qbState').textContent = `${connected}/${status.downloaderCount || 0}`;
    $('#qbState').className = connected ? 'ok' : 'error';
    for (const key of ['scanCount', 'peerCount', 'activeBanCount', 'qbVersion', 'torrentCount', 'ipBanCount', 'endpointBanCount']) {
      $(`#${key}`).textContent = status[key] ?? '—';
    }
    $('#monthlyUniqueIPs').textContent = analytics.monthlyUniqueIPs ?? 0;
    $('#lastScanAt').textContent = displayTime(status.lastScanAt);
    $('#lastError').textContent = status.lastError || '无';
    $('#downloaderStatus').innerHTML = (status.downloaders || []).map((item) => `<div class="mini-card"><strong>${escapeHtml(item.name || item.id)}</strong><span class="${item.connected ? 'ok' : 'error'}">${item.connected ? '正常' : '未连接'}</span><small>${item.connected ? `${escapeHtml(item.version)} · ${item.torrentCount} 个种子 · ${item.peerCount} Peers` : escapeHtml(item.lastError || '')}</small></div>`).join('') || '<p class="hint">尚未连接下载器</p>';
  } catch (error) {
    if (!String(error).includes('管理令牌')) notify(error.message, true);
  }
}

async function refreshPeers() {
  const peers = await api('/api/peers');
  $('#peerRows').innerHTML = peers.map(({ peer, decision }) => `<tr>
    <td>${escapeHtml(peer.downloaderName || '')}</td><td>${escapeHtml(`${peer.ip}:${peer.port}`)}</td><td>${escapeHtml(peer.client || 'Unknown')}</td>
    <td>${escapeHtml(peer.peerId || '')}</td><td>${(Number(peer.progress || 0) * 100).toFixed(1)}%</td><td>${formatBytes(peer.uploaded)}</td>
    <td title="${escapeHtml(peer.torrentHash)}">${escapeHtml(peer.torrentName || '')}</td><td><span class="tag ${decision.action}">${actionName(decision.action)}</span></td></tr>`).join('') || '<tr><td colspan="8">暂无 Peer 数据</td></tr>';
}

async function refreshEvents() {
  const events = await api('/api/events?limit=1000');
  $('#eventRows').innerHTML = events.map((event) => `<tr><td>${escapeHtml(event.downloaderName || '旧版记录')}</td><td>${escapeHtml(event.target)}</td>
    <td><span class="tag ${event.action}">${actionName(event.action)}</span></td><td>${displayTime(event.bannedAt || event.timestamp)}</td>
    <td>${displayTime(event.expiresAt)}</td><td>${event.unbannedAt ? displayTime(event.unbannedAt) : '<span class="ok">生效中</span>'}</td>
    <td>${escapeHtml(event.client || 'Unknown')}</td><td class="wrap">${escapeHtml(event.reason || '')}${evidenceText(event.evidence)}</td></tr>`).join('') || '<tr><td colspan="8">暂无封禁记录</td></tr>';
}

function evidenceText(evidence) {
  if (!evidence) return '';
  return `<small class="evidence">种子 ${formatBytes(evidence.torrentSize)} · 上传 ${formatBytes(evidence.uploadedBytes)} · Peer进度 ${Number(evidence.reportedProgressPercent || 0).toFixed(1)}%</small>`;
}

async function refreshAnalytics() {
  const data = await api('/api/analytics');
  renderDonut($('#clientChart'), $('#clientLegend'), data.clientDownloads, 'bytes', (item) => formatBytes(item.bytes));
  const categoryNames = { normal: '正常客户端', leecher: '吸血客户端', xunlei: '迅雷客户端' };
  const categoryData = data.peerCategories.map((item) => ({ ...item, name: categoryNames[item.name] || item.name }));
  renderDonut($('#peerChart'), $('#peerLegend'), categoryData, 'count', (item) => `${item.count} 个 Peer`);
  $('#analyticsUniqueIPs').textContent = data.monthlyUniqueIPs;
  $('#uniqueByDownloader').innerHTML = data.monthlyUniqueByDownloader.map((item) => `<div class="mini-card"><strong>${escapeHtml(item.name || item.id)}</strong><span>${item.count}</span><small>近31天独立 IP</small></div>`).join('') || '<p class="hint">暂无 IP 数据</p>';
}

function renderDonut(chart, legend, items, valueKey, detail) {
  const values = items.filter((item) => Number(item[valueKey]) > 0);
  const total = values.reduce((sum, item) => sum + Number(item[valueKey]), 0);
  if (!total) {
    chart.style.background = '#262a31'; chart.innerHTML = '<span>暂无数据</span>'; legend.innerHTML = ''; return;
  }
  let position = 0;
  const stops = values.map((item, index) => {
    const start = position;
    position += Number(item[valueKey]) / total * 100;
    return `${COLORS[index % COLORS.length]} ${start}% ${position}%`;
  });
  chart.style.background = `conic-gradient(${stops.join(',')})`;
  chart.innerHTML = `<span><strong>${values.length}</strong><small>类客户端</small></span>`;
  legend.innerHTML = values.map((item, index) => `<div><i class="color-${index % COLORS.length}"></i><span>${escapeHtml(item.name)}</span><strong>${(Number(item[valueKey]) / total * 100).toFixed(1)}%</strong><small>${detail(item)}</small></div>`).join('');
}

async function loadConfig() {
  const config = await api('/api/config');
  $('#enabled').checked = config.enabled;
  $('#scanInterval').value = config.scanIntervalSeconds;
  $('#behaviorEnabled').checked = config.behavior.enabled;
  $('#xunleiProtectionEnabled').checked = config.behavior.xunleiProtectionEnabled;
  $('#excessProgressPercent').value = config.behavior.excessProgressPercent;
  $('#progressRewindPercent').value = config.behavior.progressRewindPercent;
  $('#minimumUploadedMB').value = Math.round(Number(config.behavior.minimumUploadedBytes || 0) / 1_000_000);
  $('#banDurationDays').value = config.banDurationDays;
  downloaders = config.downloaders || [];
  renderDownloaders();
}

function renderDownloaders() {
  $('#downloaderEditors').innerHTML = downloaders.map((item, index) => `<div class="downloader-editor" data-id="${escapeHtml(item.id)}">
    <div class="editor-head"><strong>下载器 ${index + 1}</strong><label class="inline-check"><input class="d-enabled" type="checkbox" ${item.enabled !== false ? 'checked' : ''}>启用</label></div>
    <div class="form-grid"><label>名称<input class="d-name" value="${escapeHtml(item.name || '')}" placeholder="qB下载器 ${index + 1}"></label>
    <label>WebUI 地址<input class="d-url" value="${escapeHtml(item.url || '')}" placeholder="http://192.168.50.82:5252"></label>
    <label>用户名<input class="d-user" value="${escapeHtml(item.username || '')}"></label><label>密码<input class="d-password" type="password" placeholder="${item.password ? '已保存，留空不修改' : ''}"></label></div>
    <div class="button-row"><button class="test-downloader" data-index="${index}">测试连接</button><button class="remove-downloader danger" data-index="${index}">删除</button></div>
  </div>`).join('') || '<p class="hint">尚未添加下载器，请点击“添加下载器”。</p>';
}

function collectDownloaders() {
  return $$('.downloader-editor').map((element) => ({
    id: element.dataset.id,
    enabled: element.querySelector('.d-enabled').checked,
    name: element.querySelector('.d-name').value.trim(),
    url: element.querySelector('.d-url').value.trim(),
    username: element.querySelector('.d-user').value.trim(),
    password: element.querySelector('.d-password').value || '********'
  }));
}

async function loadRules() {
  rules = await api('/api/rules');
  renderRules();
}

function renderRules() {
  $('#ruleRows').innerHTML = rules.map((rule, index) => `<tr data-index="${index}"><td><input class="r-enabled compact-check" type="checkbox" ${rule.enabled !== false ? 'checked' : ''}></td>
    <td>${select('r-field', [['client','客户端名称'],['peerId','PeerID'],['ip','IP地址']], rule.field)}</td>
    <td>${select('r-operator', [['equals','完全等于'],['startsWith','开头是'],['contains','包含'],['endsWith','结尾是'],['regex','正则表达式']], rule.operator)}</td>
    <td><input class="r-pattern" value="${escapeHtml(rule.pattern)}" placeholder="例如 Gopeed bt-"></td>
    <td>${select('r-action', [['allow','放行'],['observe','仅观察'],['block_ip','封禁整个IP'],['block_endpoint','精准IP:端口']], rule.action)}</td>
    <td><input class="r-priority number-small" type="number" value="${Number(rule.priority || 0)}"></td><td><input class="r-comment" value="${escapeHtml(rule.comment || '')}"></td>
    <td><button class="remove-rule danger" data-index="${index}">删除</button></td></tr>`).join('') || '<tr><td colspan="8">暂无规则</td></tr>';
}

function select(className, options, selected) {
  return `<select class="${className}">${options.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
}

function collectRules() {
  return $$('#ruleRows tr[data-index]').map((row) => {
    const previous = rules[Number(row.dataset.index)] || {};
    return {
      id: previous.id || createClientId('rule'), enabled: row.querySelector('.r-enabled').checked,
      priority: Number(row.querySelector('.r-priority').value), field: row.querySelector('.r-field').value,
      operator: row.querySelector('.r-operator').value, pattern: row.querySelector('.r-pattern').value.trim(),
      action: row.querySelector('.r-action').value, comment: row.querySelector('.r-comment').value.trim()
    };
  });
}

function actionName(action) {
  return ({ allow: '放行', observe: '观察', block_ip: '整 IP', block_endpoint: 'IP:端口' })[action] || action;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

$$('nav button').forEach((button) => button.addEventListener('click', async () => {
  $$('nav button,.tab').forEach((item) => item.classList.remove('active'));
  button.classList.add('active'); $(`#${button.dataset.tab}`).classList.add('active');
  try {
    if (button.dataset.tab === 'events') await refreshEvents();
    if (button.dataset.tab === 'analytics') await refreshAnalytics();
    if (button.dataset.tab === 'rules') await loadRules();
    if (button.dataset.tab === 'settings') await loadConfig();
  } catch (error) { notify(error.message, true); }
}));

$('#scanNow').addEventListener('click', async () => {
  try {
    const result = await api('/api/scan', { method: 'POST' });
    notify(result.ok ? `检查完成：整 IP ${result.ipBans}，IP:端口 ${result.endpointBans}` : (result.skipped ? '检查任务正在运行' : result.error), !result.ok && !result.skipped);
    await Promise.all([refreshStatus(), refreshPeers()]);
  } catch (error) { notify(error.message, true); }
});

$('#saveConfig').addEventListener('click', async () => {
  try {
    downloaders = collectDownloaders();
    await api('/api/config', { method: 'PUT', body: JSON.stringify({
      enabled: $('#enabled').checked, scanIntervalSeconds: Number($('#scanInterval').value),
      banDurationDays: Number($('#banDurationDays').value), downloaders,
      behavior: { enabled: $('#behaviorEnabled').checked, xunleiProtectionEnabled: $('#xunleiProtectionEnabled').checked,
        minimumUploadedBytes: Number($('#minimumUploadedMB').value) * 1_000_000,
        excessProgressPercent: Number($('#excessProgressPercent').value), progressRewindPercent: Number($('#progressRewindPercent').value) }
    }) });
    notify('设置已保存'); await Promise.all([loadConfig(), refreshStatus()]);
  } catch (error) { notify(error.message, true); }
});

$('#addDownloader').addEventListener('click', () => {
  downloaders = collectDownloaders();
  downloaders.push({ id: createClientId('downloader'), name: `qB下载器 ${downloaders.length + 1}`, enabled: true, url: '', username: '', password: '' });
  renderDownloaders();
});

$('#downloaderEditors').addEventListener('click', async (event) => {
  const remove = event.target.closest('.remove-downloader');
  if (remove) { downloaders = collectDownloaders(); downloaders.splice(Number(remove.dataset.index), 1); renderDownloaders(); return; }
  const test = event.target.closest('.test-downloader');
  if (!test) return;
  try {
    const item = collectDownloaders()[Number(test.dataset.index)];
    const result = await api('/api/test-connection', { method: 'POST', body: JSON.stringify(item) });
    notify(`连接成功：${result.version}`);
  } catch (error) { notify(error.message, true); }
});

$('#addRule').addEventListener('click', () => {
  rules = collectRules();
  rules.push({ id: createClientId('rule'), enabled: true, priority: 100, field: 'client', operator: 'startsWith', pattern: '', action: 'block_ip', comment: '' });
  renderRules();
});

$('#ruleRows').addEventListener('click', (event) => {
  const button = event.target.closest('.remove-rule');
  if (!button) return;
  rules = collectRules(); rules.splice(Number(button.dataset.index), 1); renderRules();
});

$('#saveRules').addEventListener('click', async () => {
  try { rules = collectRules(); await api('/api/rules', { method: 'PUT', body: JSON.stringify(rules) }); notify('规则已保存'); await loadRules(); }
  catch (error) { notify(error.message, true); }
});

$('#clearEvents').addEventListener('click', async () => {
  if (!confirm('确认清空封禁历史记录？正在生效的封禁不会被解除。')) return;
  try { await api('/api/events', { method: 'DELETE' }); await refreshEvents(); notify('历史记录已清空'); }
  catch (error) { notify(error.message, true); }
});

$('#refreshAnalytics').addEventListener('click', () => refreshAnalytics().catch((error) => notify(error.message, true)));
$('#saveToken').addEventListener('click', () => { token = $('#tokenInput').value; localStorage.setItem('pbb-token', token); setTimeout(() => void refreshStatus(), 0); });

await Promise.allSettled([refreshStatus(), refreshPeers()]);
setInterval(() => { void refreshStatus(); }, 5000);
