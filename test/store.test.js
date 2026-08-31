import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Store } from '../src/store.js';

test('0.0.2 single downloader config migrates without losing its password', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pbb-store-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'config.json'), JSON.stringify({
    enabled: true,
    scanIntervalSeconds: 5,
    qbittorrent: { url: 'http://192.0.2.5:9191', username: 'admin', password: 'secret' }
  }));
  await writeFile(path.join(directory, 'rules.json'), JSON.stringify([
    { id: 'custom', enabled: true, priority: 1, field: 'client', operator: 'equals', pattern: 'Custom', action: 'allow' }
  ]));
  const store = new Store(directory);
  await store.initialize();
  assert.equal(store.config.downloaders.length, 1);
  assert.equal(store.config.downloaders[0].id, 'primary');
  assert.equal(store.config.downloaders[0].password, 'secret');
  assert.equal(store.config.scanIntervalSeconds, 15);
  assert.equal(store.publicConfig().downloaders[0].password, '********');
  assert.equal(store.rules.filter((rule) => rule.id.startsWith('client-gopeed-')).length, 3);
  assert.ok(store.rules.some((rule) => rule.id === 'custom'));

  await store.updateConfig({ downloaders: [{ ...store.publicConfig().downloaders[0], name: 'NAS qB', password: '********' }] });
  assert.equal(store.config.downloaders[0].password, 'secret');
  const runtime = JSON.parse(await readFile(path.join(directory, 'runtime.json'), 'utf8'));
  assert.deepEqual(runtime.activeBans, []);
});
