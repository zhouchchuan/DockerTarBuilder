import assert from 'node:assert/strict';
import test from 'node:test';

import { createClientId } from '../public/id.js';

test('LAN HTTP fallback creates unique rule and downloader identifiers', () => {
  const first = createClientId('rule', {});
  const second = createClientId('rule', {});
  const downloader = createClientId('downloader', {});

  assert.match(first, /^rule-/);
  assert.notEqual(first, second);
  assert.match(downloader, /^downloader-/);
});

test('secure contexts keep using randomUUID', () => {
  assert.equal(createClientId('rule', { randomUUID: () => 'secure-uuid' }), 'secure-uuid');
});
