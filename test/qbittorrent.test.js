import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { QBittorrentClient } from '../src/qbittorrent.js';

test('qB client logs in, reads peers and uses separate ban APIs', async (context) => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({ method: request.method, url: request.url, body, cookie: request.headers.cookie });
    if (request.url === '/api/v2/auth/login') {
      response.setHeader('set-cookie', 'SID=test-session; HttpOnly; Path=/');
      return response.end('Ok.');
    }
    if (request.headers.cookie !== 'SID=test-session') {
      response.statusCode = 403;
      return response.end('Forbidden');
    }
    if (request.url === '/api/v2/app/version') return response.end('v5.2.3');
    if (request.url === '/api/v2/torrents/info?filter=all') {
      response.setHeader('content-type', 'application/json');
      return response.end(JSON.stringify([{ hash: 'abc', name: 'fixture', state: 'uploading', num_leechs: 1 }]));
    }
    if (request.url.startsWith('/api/v2/sync/torrentPeers')) {
      response.setHeader('content-type', 'application/json');
      return response.end(JSON.stringify({ peers: { one: { ip: '203.0.113.8', port: 6881, client: 'Xunlei', peer_id_client: '-XL0017-' } } }));
    }
    if (request.url === '/api/v2/transfer/banPeers' || request.url === '/api/v2/transfer/banPeerEndpoints') return response.end('');
    response.statusCode = 404;
    response.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => server.close());

  const address = server.address();
  const client = new QBittorrentClient({ url: `http://127.0.0.1:${address.port}`, username: 'admin', password: 'secret' });
  assert.equal(await client.version(), 'v5.2.3');
  assert.equal((await client.torrents()).length, 1);
  assert.deepEqual(await client.peers('abc'), [{
    ip: '203.0.113.8', port: 6881, client: 'Xunlei', peerId: '-XL0017-', progress: 0,
    uploaded: 0, downloaded: 0, uploadSpeed: 0, downloadSpeed: 0
  }]);
  await client.banIPs(['198.51.100.7']);
  await client.banEndpoints(['203.0.113.8:6881']);

  const ipBan = requests.find((item) => item.url === '/api/v2/transfer/banPeers');
  const endpointBan = requests.find((item) => item.url === '/api/v2/transfer/banPeerEndpoints');
  assert.equal(new URLSearchParams(ipBan.body).get('peers'), '198.51.100.7');
  assert.equal(new URLSearchParams(endpointBan.body).get('peers'), '203.0.113.8:6881');
});

test('qB client accepts HTTP 204 login without a cookie for auth-bypass setups', async (context) => {
  let loginCount = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/api/v2/auth/login') {
      loginCount += 1;
      response.statusCode = 204;
      return response.end();
    }
    if (request.url === '/api/v2/app/version') return response.end('v5.2.3');
    response.statusCode = 404;
    response.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => server.close());

  const address = server.address();
  const client = new QBittorrentClient({
    url: `http://127.0.0.1:${address.port}`,
    username: 'admin',
    password: 'secret'
  });
  assert.equal(await client.version(), 'v5.2.3');
  assert.equal(await client.version(), 'v5.2.3');
  assert.equal(loginCount, 1);
});

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
