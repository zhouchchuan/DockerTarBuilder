import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateBehavior, updatePeerSession } from '../src/behavior.js';

const config = {
  enabled: true,
  minimumUploadedBytes: 50_000_000,
  excessProgressPercent: 10,
  progressRewindPercent: 10
};

test('1 GiB torrent with 2 GiB uploaded and 50% reported progress is over-download', () => {
  const peer = { ip: '203.0.113.1', port: 6881, client: 'Unknown', progress: 0.5, uploaded: 2_000_000_000 };
  const session = updatePeerSession(null, { downloaderId: 'd1', torrent: { hash: 'a' }, peer, now: 1 });
  const result = evaluateBehavior({ peer, torrent: { size: 1_000_000_000 }, session, config });
  assert.equal(result.kind, 'over_download');
  assert.equal(result.action, 'block_ip');
  assert.equal(Math.round(result.evidence.excessPercent), 150);
});

test('Xunlei reporting 65% after receiving only 10% is not a false positive', () => {
  const peer = { ip: '203.0.113.2', port: 6881, client: 'Xunlei 0.0.1.7', progress: 0.65, uploaded: 100_000_000 };
  const session = updatePeerSession(null, { downloaderId: 'd1', torrent: { hash: 'a' }, peer, now: 1 });
  assert.equal(evaluateBehavior({ peer, torrent: { size: 1_000_000_000 }, session, config }), null);
});

test('Xunlei over-download is restricted to the current endpoint', () => {
  const peer = { ip: '203.0.113.2', port: 6881, client: 'Xunlei', progress: 0.5, uploaded: 2_000_000_000 };
  const session = updatePeerSession(null, { downloaderId: 'd1', torrent: { hash: 'a' }, peer, now: 1 });
  assert.equal(evaluateBehavior({ peer, torrent: { size: 1_000_000_000 }, session, config }).action, 'block_endpoint');
});

test('session accumulates a reset upload counter across reconnects', () => {
  const torrent = { hash: 'a' };
  const first = updatePeerSession(null, { downloaderId: 'd1', torrent, peer: { uploaded: 900, progress: 0.2 }, now: 1 });
  const second = updatePeerSession(first, { downloaderId: 'd1', torrent, peer: { uploaded: 100, progress: 0.2 }, now: 2 });
  assert.equal(second.accumulatedUploaded, 1000);
});
