import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyPeer, formatEndpoint, isProtectedAddress, isXunlei } from '../src/classifier.js';

const rules = [
  { id: 'allow-19', enabled: true, priority: 1000, field: 'client', operator: 'contains', pattern: '0.0.1.9', action: 'allow', comment: 'allowed version' },
  { id: 'hp', enabled: true, priority: 100, field: 'peerId', operator: 'startsWith', pattern: '-hp', action: 'block_ip', comment: 'pure leecher' }
];

test('Xunlei client is blocked by exact endpoint', () => {
  const result = classifyPeer({ ip: '203.0.113.10', port: 6881, client: 'Xunlei 0.0.1.7', peerId: '-XL0017-' }, rules);
  assert.equal(result.action, 'block_endpoint');
});

test('Xunlei version allow rule overrides builtin endpoint action', () => {
  const result = classifyPeer({ ip: '203.0.113.10', port: 6881, client: 'Xunlei 0.0.1.9', peerId: '-XL0019-' }, rules);
  assert.equal(result.action, 'allow');
  assert.equal(result.ruleId, 'allow-19');
});

test('Xunlei block IP rule is forced to endpoint and protection can be disabled', () => {
  const block = [{ id: 'x', enabled: true, priority: 10, field: 'client', operator: 'contains', pattern: '0.0.1.7', action: 'block_ip', comment: 'blocked version' }];
  const peer = { ip: '203.0.113.10', port: 6881, client: 'Xunlei 0.0.1.7', peerId: '-XL0017-' };
  assert.equal(classifyPeer(peer, block).action, 'block_endpoint');
  assert.equal(classifyPeer(peer, [], { xunleiProtectionEnabled: false }).action, 'observe');
});

test('pure leecher signature blocks whole public IP', () => {
  const result = classifyPeer({ ip: '198.51.100.20', port: 51413, client: 'Unknown', peerId: '-hp0001-' }, rules);
  assert.equal(result.action, 'block_ip');
});

test('normal peer is observed and never automatically blocked', () => {
  const result = classifyPeer({ ip: '198.51.100.21', port: 51413, client: 'Transmission 4.0.6', peerId: '-TR4060-' }, rules);
  assert.equal(result.action, 'observe');
});

test('private and local addresses are protected', () => {
  for (const ip of ['127.0.0.1', '10.0.0.2', '172.16.0.2', '192.168.50.20', '::1', 'fd00::1', 'fe80::1']) {
    assert.equal(isProtectedAddress(ip), true, ip);
    assert.equal(classifyPeer({ ip, port: 6881, client: 'Xunlei', peerId: '-XL0017-' }, rules).action, 'allow');
  }
});

test('Xunlei identifiers and IPv6 endpoint formatting', () => {
  assert.equal(isXunlei({ client: '迅雷 0.0.1.9' }), true);
  assert.equal(isXunlei({ peerId: '-XL0019-' }), true);
  assert.equal(formatEndpoint('2001:db8::1', 6881), '[2001:db8::1]:6881');
});
