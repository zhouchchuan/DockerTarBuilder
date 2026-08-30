import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AuthManager } from './auth.js';
import { Engine } from './engine.js';
import { VERSION } from './defaults.js';
import { paginate } from './pagination.js';
import { Store } from './store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(here, '..', 'public');
const dataDirectory = path.resolve(process.env.PBB_DATA_DIR || '/data');
const port = Number(process.env.PBB_WEBUI_PORT || process.env.WEBUI_PORT || 9899);
const host = process.env.PBB_LISTEN_ADDRESS || '0.0.0.0';
const adminToken = process.env.PBB_ADMIN_TOKEN || '';

const auth = new AuthManager(dataDirectory);
await auth.initialize();
const store = new Store(dataDirectory);
await store.initialize();
const engine = new Engine(store);
engine.start();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname.startsWith('/api/auth/')) return await handleAuthApi(request, response, url);
      if (!authorized(request)) {
        const setupRequired = !auth.isConfigured();
        return json(response, 401, {
          error: setupRequired ? '请先创建管理员账号' : '请先登录',
          code: setupRequired ? 'setup_required' : 'authentication_required'
        });
      }
      return await handleApi(request, response, url);
    }
    return await serveWeb(request, response, url.pathname);
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    return json(response, status, {
      error: error instanceof Error ? error.message : String(error),
      ...(error?.code ? { code: error.code } : {})
    });
  }
});

server.listen(port, host, () => {
  console.log(`PeerBander Beyonder ${VERSION} listening on http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    engine.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}

function authorized(request) {
  if (auth.isRequestAuthenticated(request)) return true;
  if (!adminToken) return false;
  const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  return bearer === adminToken || request.headers['x-pbb-token'] === adminToken;
}

async function handleAuthApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/auth/status') {
    const authenticated = auth.isRequestAuthenticated(request);
    return json(response, 200, {
      configured: auth.isConfigured(),
      authenticated,
      ...(authenticated ? { username: auth.username() } : {})
    });
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/setup') {
    requireJsonRequest(request);
    const input = await readJsonBody(request);
    const username = await auth.setup(input.username, input.password);
    return json(response, 201, { ok: true, username }, { 'set-cookie': auth.createSessionCookie(username) });
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    requireJsonRequest(request);
    const input = await readJsonBody(request);
    if (!auth.isConfigured()) return json(response, 409, { error: '请先创建管理员账号', code: 'setup_required' });
    if (!await auth.authenticate(input.username, input.password)) {
      return json(response, 401, { error: '管理员账号或密码错误', code: 'invalid_credentials' });
    }
    return json(response, 200, { ok: true, username: auth.username() }, { 'set-cookie': auth.createSessionCookie() });
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    return json(response, 200, { ok: true }, { 'set-cookie': auth.clearSessionCookie() });
  }
  return json(response, 404, { error: '认证 API 不存在' });
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/status') {
    return json(response, 200, engine.snapshot());
  }
  if (request.method === 'GET' && url.pathname === '/api/config') {
    return json(response, 200, store.publicConfig());
  }
  if (request.method === 'PUT' && url.pathname === '/api/config') {
    const input = await readJsonBody(request);
    await engine.beforeConfigUpdate(input);
    const result = await store.updateConfig(input);
    engine.reconfigure();
    return json(response, 200, result);
  }
  if (request.method === 'GET' && url.pathname === '/api/rules') {
    return json(response, 200, store.rules);
  }
  if (request.method === 'PUT' && url.pathname === '/api/rules') {
    return json(response, 200, await store.replaceRules(await readJsonBody(request)));
  }
  if (request.method === 'GET' && url.pathname === '/api/events') {
    if (url.searchParams.has('page')) {
      return json(response, 200, paginate(
        store.events,
        url.searchParams.get('page'),
        url.searchParams.get('pageSize')
      ));
    }
    const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit')) || 200));
    return json(response, 200, store.events.slice(0, limit));
  }
  if (request.method === 'DELETE' && url.pathname === '/api/events') {
    await store.clearEvents();
    return json(response, 200, { ok: true });
  }
  if (request.method === 'GET' && url.pathname === '/api/peers') {
    return json(response, 200, engine.currentPeers);
  }
  if (request.method === 'GET' && url.pathname === '/api/analytics') {
    return json(response, 200, engine.analytics());
  }
  if (request.method === 'GET' && url.pathname === '/api/bans') {
    return json(response, 200, store.runtime.activeBans);
  }
  if (request.method === 'POST' && url.pathname === '/api/test-connection') {
    return json(response, 200, await engine.testConnection(await readJsonBody(request)));
  }
  if (request.method === 'POST' && url.pathname === '/api/scan') {
    return json(response, 200, await engine.scan({ force: true }));
  }
  return json(response, 404, { error: 'API 不存在' });
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) {
      const error = new Error('请求内容过大');
      error.statusCode = 413;
      error.code = 'request_too_large';
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('JSON 格式无效');
    error.statusCode = 400;
    error.code = 'invalid_json';
    throw error;
  }
}

function requireJsonRequest(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type'] || ''))) {
    const error = new Error('请求必须使用 JSON 格式');
    error.statusCode = 415;
    error.code = 'json_required';
    throw error;
  }
}

async function serveWeb(request, response, pathname) {
  const publicFiles = new Set(['/login.html', '/login.js', '/styles.css', '/enhancements.css']);
  if (publicFiles.has(pathname)) return await serveStatic(response, pathname);
  if (!auth.isRequestAuthenticated(request)) {
    if (pathname === '/' || pathname === '/index.html') return await serveStatic(response, '/login.html');
    return json(response, 401, { error: '请先登录', code: 'authentication_required' });
  }
  if (pathname === '/login.html') return redirect(response, '/');
  return await serveStatic(response, pathname);
}

async function serveStatic(response, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filename = path.resolve(publicDirectory, relative);
  if (!filename.startsWith(`${publicDirectory}${path.sep}`)) return json(response, 403, { error: '禁止访问' });
  try {
    await access(filename);
    const info = await stat(filename);
    if (!info.isFile()) throw new Error('not file');
  } catch {
    return json(response, 404, { error: '文件不存在' });
  }
  response.writeHead(200, {
    'content-type': mimeType(filename),
    'cache-control': filename.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  createReadStream(filename).pipe(response);
}

function json(response, status, value, headers = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    ...headers
  });
  response.end(JSON.stringify(value));
}

function redirect(response, location) {
  response.writeHead(302, { location, 'cache-control': 'no-store' });
  response.end();
}

function mimeType(filename) {
  if (filename.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filename.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filename.endsWith('.svg')) return 'image/svg+xml';
  return 'text/html; charset=utf-8';
}
