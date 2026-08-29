import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Engine } from './engine.js';
import { VERSION } from './defaults.js';
import { Store } from './store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(here, '..', 'public');
const dataDirectory = path.resolve(process.env.PBB_DATA_DIR || '/data');
const port = Number(process.env.PBB_WEBUI_PORT || process.env.WEBUI_PORT || 9899);
const host = process.env.PBB_LISTEN_ADDRESS || '0.0.0.0';
const adminToken = process.env.PBB_ADMIN_TOKEN || '';

const store = new Store(dataDirectory);
await store.initialize();
const engine = new Engine(store);
engine.start();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      if (!authorized(request)) return json(response, 401, { error: '需要管理令牌' });
      return await handleApi(request, response, url);
    }
    return await serveStatic(response, url.pathname);
  } catch (error) {
    return json(response, 500, { error: error instanceof Error ? error.message : String(error) });
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
  if (!adminToken) return true;
  const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  return bearer === adminToken || request.headers['x-pbb-token'] === adminToken;
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/status') {
    return json(response, 200, engine.snapshot());
  }
  if (request.method === 'GET' && url.pathname === '/api/config') {
    return json(response, 200, store.publicConfig());
  }
  if (request.method === 'PUT' && url.pathname === '/api/config') {
    const result = await store.updateConfig(await readJsonBody(request));
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
  if (request.method === 'POST' && url.pathname === '/api/test-connection') {
    return json(response, 200, await engine.testConnection());
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
    if (size > 1_000_000) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
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
    'cache-control': filename.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'"
  });
  createReadStream(filename).pipe(response);
}

function json(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(JSON.stringify(value));
}

function mimeType(filename) {
  if (filename.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filename.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filename.endsWith('.svg')) return 'image/svg+xml';
  return 'text/html; charset=utf-8';
}
