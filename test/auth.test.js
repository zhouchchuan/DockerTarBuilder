import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AuthManager } from '../src/auth.js';

test('first-run administrator is persisted with a password hash and session survives restart', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pbb-auth-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  let currentTime = Date.parse('2026-08-30T00:00:00.000Z');
  const auth = new AuthManager(directory, { now: () => currentTime });
  await auth.initialize();
  assert.equal(auth.isConfigured(), false);

  await auth.setup('administrator', 'correct-horse-battery');
  assert.equal(await auth.authenticate('administrator', 'wrong-password'), false);
  assert.equal(await auth.authenticate('administrator', 'correct-horse-battery'), true);
  const storedText = await readFile(path.join(directory, 'auth.json'), 'utf8');
  assert.equal(storedText.includes('correct-horse-battery'), false);
  const stored = JSON.parse(storedText);
  assert.ok(stored.passwordHash);
  assert.ok(stored.passwordSalt);

  const cookie = auth.createSessionCookie();
  const request = { headers: { cookie: cookie.split(';')[0] } };
  assert.equal(auth.isRequestAuthenticated(request), true);

  const restarted = new AuthManager(directory, { now: () => currentTime });
  await restarted.initialize();
  assert.equal(restarted.isRequestAuthenticated(request), true);
  currentTime += 7 * 24 * 60 * 60 * 1000 + 1;
  assert.equal(restarted.isRequestAuthenticated(request), false);
});

test('administrator setup validates inputs and cannot replace an existing account', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pbb-auth-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const auth = new AuthManager(directory);
  await auth.initialize();
  await assert.rejects(() => auth.setup('ab', 'long-enough-password'), /3 到 64/);
  await assert.rejects(() => auth.setup('admin', 'short'), /8 到 128/);
  await auth.setup('admin', 'long-enough-password');
  await assert.rejects(() => auth.setup('other', 'another-long-password'), /已经创建/);
});
