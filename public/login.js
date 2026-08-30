const $ = (selector) => document.querySelector(selector);
let setupMode = false;

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function showError(message) {
  $('#authError').textContent = message;
  $('#authError').classList.toggle('hidden', !message);
}

function configureForm(status) {
  if (status.authenticated) {
    window.location.replace('/');
    return;
  }
  setupMode = !status.configured;
  $('#authTitle').textContent = setupMode ? '创建管理员账号' : '管理员登录';
  $('#authDescription').textContent = setupMode
    ? '这是第一次打开后台。请先设置管理员账号和密码。'
    : '请输入管理员账号和密码后进入后台。';
  $('#authSubmit').textContent = setupMode ? '创建并进入后台' : '登录';
  $('#confirmPasswordGroup').classList.toggle('hidden', !setupMode);
  $('#authPasswordConfirm').required = setupMode;
  $('#authPassword').autocomplete = setupMode ? 'new-password' : 'current-password';
  $('#authForm').classList.remove('hidden');
  $('#authUsername').focus();
}

$('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const username = $('#authUsername').value.trim();
  const password = $('#authPassword').value;
  if (setupMode && password !== $('#authPasswordConfirm').value) {
    showError('两次输入的密码不一致');
    return;
  }
  const submit = $('#authSubmit');
  submit.disabled = true;
  submit.textContent = setupMode ? '正在创建…' : '正在登录…';
  try {
    await request(setupMode ? '/api/auth/setup' : '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    window.location.replace('/');
  } catch (error) {
    showError(error.message);
    submit.disabled = false;
    submit.textContent = setupMode ? '创建并进入后台' : '登录';
  }
});

try {
  configureForm(await request('/api/auth/status'));
} catch (error) {
  $('#authTitle').textContent = '后台暂时不可用';
  $('#authDescription').textContent = error.message;
}
