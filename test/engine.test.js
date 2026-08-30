import assert from 'node:assert/strict';
import test from 'node:test';

import { Engine } from '../src/engine.js';

test('engine isolates multiple downloaders and writes timed IP/endpoint bans', async () => {
  const addedEvents = [];
  const store = fixtureStore();
  store.config.downloaders = [
    { id: 'd1', name: 'qB 1', enabled: true, url: 'http://127.0.0.1:1', username: 'a', password: 'b' },
    { id: 'd2', name: 'qB 2', enabled: true, url: 'http://127.0.0.1:2', username: 'a', password: 'b' }
  ];
  store.rules = [{ id: 'hp', enabled: true, priority: 100, field: 'peerId', operator: 'startsWith', pattern: '-hp', action: 'block_ip', comment: 'pure' }];
  store.addEvents = async (events) => { addedEvents.push(...events); store.events.unshift(...events); };
  const engine = new Engine(store);
  const calls = { d1IPs: [], d1Endpoints: [], d2IPs: [] };
  engine.clients.set('d1', fakeClient([
    { ip: '198.51.100.7', port: 6881, client: 'hp/torrent', peerId: '-hp0001-', progress: 0, uploaded: 0 },
    { ip: '203.0.113.9', port: 51413, client: 'Xunlei 0.0.1.7', peerId: '-XL0017-', progress: 0, uploaded: 0 }
  ], calls.d1IPs, calls.d1Endpoints));
  engine.clients.set('d2', fakeClient([
    { ip: '203.0.113.10', port: 51413, client: 'Transmission 4.0.6', peerId: '-TR4060-', progress: 0, uploaded: 0 }
  ], calls.d2IPs, []));

  const result = await engine.scan();
  assert.equal(result.ok, true);
  assert.equal(result.downloaderCount, 2);
  assert.deepEqual(calls.d1IPs, ['198.51.100.7']);
  assert.deepEqual(calls.d1Endpoints, ['203.0.113.9:51413']);
  assert.deepEqual(calls.d2IPs, []);
  assert.equal(addedEvents.length, 2);
  assert.ok(addedEvents.every((event) => Date.parse(event.expiresAt) - Date.parse(event.bannedAt) === 7 * 86400000));
  assert.equal(store.runtime.activeBans.length, 2);
});

test('expired bans are removed from their downloader and history is marked', async () => {
  const store = fixtureStore();
  store.config.downloaders = [{ id: 'd1', name: 'qB 1', enabled: true, url: 'http://127.0.0.1:1', username: 'a', password: 'b' }];
  store.runtime.activeBans = [{ eventId: 'e1', downloaderId: 'd1', target: '198.51.100.9', expiresAt: '2026-01-01T00:00:00.000Z' }];
  store.events = [{ id: 'e1' }];
  const removed = [];
  store.markEventsUnbanned = async (ids, timestamp) => { store.events[0].unbannedAt = timestamp; assert.deepEqual(ids, ['e1']); };
  const engine = new Engine(store);
  engine.clients.set('d1', { updateConfig() {}, removeBans: async (targets) => removed.push(...targets) });
  const result = await engine.expireBans(Date.parse('2026-01-08T00:00:00.000Z'));
  assert.equal(result.expired, 1);
  assert.deepEqual(removed, ['198.51.100.9']);
  assert.equal(store.runtime.activeBans.length, 0);
  assert.ok(store.events[0].unbannedAt);
});

test('analytics reports rolling unique IPs, client bytes and peer categories', () => {
  const store = fixtureStore();
  const now = Date.parse('2026-08-30T00:00:00.000Z');
  store.runtime.clientBytes = { qBittorrent: 750, Xunlei: 250 };
  store.runtime.ipHistory = {
    one: { downloaderId: 'd1', downloaderName: 'qB 1', ip: '198.51.100.1', lastSeenAt: '2026-08-29T00:00:00.000Z' },
    two: { downloaderId: 'd2', downloaderName: 'qB 2', ip: '198.51.100.1', lastSeenAt: '2026-08-28T00:00:00.000Z' },
    old: { downloaderId: 'd1', downloaderName: 'qB 1', ip: '198.51.100.2', lastSeenAt: '2026-01-01T00:00:00.000Z' }
  };
  const engine = new Engine(store);
  engine.currentPeers = [
    { peer: { client: 'qBittorrent' }, decision: { action: 'observe' } },
    { peer: { client: 'Gopeed' }, decision: { action: 'block_ip' } },
    { peer: { client: 'Xunlei', peerId: '-XL0019-' }, decision: { action: 'block_endpoint' } }
  ];
  const result = engine.analytics(now);
  assert.equal(result.monthlyUniqueIPs, 1);
  assert.equal(result.monthlyUniqueByDownloader.length, 2);
  assert.equal(result.clientDownloads[0].percent, 75);
  assert.deepEqual(result.peerCategories.map((item) => item.count), [1, 1, 1]);
});

function fixtureStore() {
  return {
    config: {
      enabled: true, scanIntervalSeconds: 5, decisionCooldownSeconds: 600, banDurationDays: 7,
      downloaders: [], behavior: { enabled: false, xunleiProtectionEnabled: true }, eventLimit: 5000
    },
    rules: [], events: [],
    runtime: { peerSessions: {}, ipHistory: {}, clientBytes: {}, activeBans: [] },
    activeBan(downloaderId, target) { return this.runtime.activeBans.find((ban) => ban.downloaderId === downloaderId && ban.target === target); },
    async addEvents(events) { this.events.unshift(...events); },
    async markEventsUnbanned() {}, async saveRuntime() {}
  };
}

function fakeClient(peers, ipCalls, endpointCalls) {
  return {
    updateConfig() {}, version: async () => 'v5.2.3',
    torrents: async () => [{ hash: 'a', name: 'fixture', size: 1_000_000_000, total_size: 1_000_000_000 }],
    peers: async () => peers,
    banIPs: async (values) => ipCalls.push(...values),
    banEndpoints: async (values) => endpointCalls.push(...values),
    removeBans: async () => {}
  };
}
