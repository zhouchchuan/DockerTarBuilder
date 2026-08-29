import assert from 'node:assert/strict';
import test from 'node:test';

import { Engine } from '../src/engine.js';

test('engine sends pure leech IP and Xunlei endpoint to separate qB lists', async () => {
  const addedEvents = [];
  const store = {
    config: {
      enabled: true, scanIntervalSeconds: 5, decisionCooldownSeconds: 600,
      qbittorrent: {}, eventLimit: 5000
    },
    rules: [{ id: 'hp', enabled: true, priority: 100, field: 'peerId', operator: 'startsWith', pattern: '-hp', action: 'block_ip', comment: 'pure' }],
    events: [],
    async addEvents(events) { addedEvents.push(...events); this.events.unshift(...events); }
  };
  const engine = new Engine(store);
  const calls = { ips: [], endpoints: [] };
  engine.client = {
    isConfigured: () => true,
    version: async () => 'v5.2.3',
    torrents: async () => [{ hash: 'a', name: 'fixture' }],
    peers: async () => [
      { ip: '198.51.100.7', port: 6881, client: 'hp/torrent', peerId: '-hp0001-' },
      { ip: '203.0.113.9', port: 51413, client: 'Xunlei 0.0.1.7', peerId: '-XL0017-' },
      { ip: '203.0.113.10', port: 51413, client: 'Transmission 4.0.6', peerId: '-TR4060-' }
    ],
    banIPs: async (values) => calls.ips.push(...values),
    banEndpoints: async (values) => calls.endpoints.push(...values)
  };

  const result = await engine.scan();
  assert.equal(result.ok, true);
  assert.deepEqual(calls.ips, ['198.51.100.7']);
  assert.deepEqual(calls.endpoints, ['203.0.113.9:51413']);
  assert.equal(addedEvents.length, 2);
  assert.deepEqual(addedEvents.map((event) => event.action).sort(), ['block_endpoint', 'block_ip']);
});
