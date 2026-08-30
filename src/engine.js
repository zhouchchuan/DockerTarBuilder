import { evaluateBehavior, pruneRuntimeState, sessionKey, updatePeerSession } from './behavior.js';
import { classifyPeer, clientFamily, formatEndpoint, isProtectedAddress, isXunlei } from './classifier.js';
import { QBittorrentClient } from './qbittorrent.js';
import { VERSION } from './defaults.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 31 * DAY_MS;

export class Engine {
  constructor(store) {
    this.store = store;
    this.store.runtime ||= { peerSessions: {}, ipHistory: {}, clientBytes: {}, activeBans: [] };
    this.store.runtime.peerSessions ||= {};
    this.store.runtime.ipHistory ||= {};
    this.store.runtime.clientBytes ||= {};
    this.store.runtime.activeBans ||= [];
    this.clients = new Map();
    this.timer = null;
    this.maintenanceTimer = null;
    this.scanning = false;
    this.maintenanceRunning = false;
    this.currentPeers = [];
    this.downloaderStatus = new Map();
    this.status = {
      version: VERSION,
      startedAt: new Date().toISOString(),
      qbConnected: false,
      qbVersion: '',
      lastScanAt: '',
      lastError: '',
      scanCount: 0,
      torrentCount: 0,
      peerCount: 0,
      ipBanCount: 0,
      endpointBanCount: 0,
      activeBanCount: this.store.runtime.activeBans.length
    };
    this.syncClients();
  }

  downloaderConfigs() {
    return (this.store.config.downloaders || []).filter((item) => item.enabled !== false && item.url);
  }

  allDownloaderConfigs() {
    return (this.store.config.downloaders || []).filter((item) => item.url);
  }

  syncClients() {
    const wanted = new Set();
    for (const config of this.allDownloaderConfigs()) {
      wanted.add(config.id);
      const existing = this.clients.get(config.id);
      if (existing) existing.updateConfig(config);
      else this.clients.set(config.id, new QBittorrentClient(config));
    }
    for (const id of this.clients.keys()) {
      if (!wanted.has(id)) this.clients.delete(id);
    }
  }

  start() {
    this.reschedule();
    this.maintenanceTimer = setInterval(() => void this.expireBans(), 60_000);
    this.maintenanceTimer.unref?.();
    void this.expireBans();
    if (this.store.config.enabled) void this.scan();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    this.timer = null;
    this.maintenanceTimer = null;
  }

  reconfigure() {
    this.syncClients();
    this.status.qbConnected = false;
    this.status.qbVersion = '';
    this.status.lastError = '';
    this.reschedule();
    if (this.store.config.enabled) void this.scan();
  }

  reschedule() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.store.config.enabled) return;
    const interval = this.store.config.scanIntervalSeconds * 1000;
    this.timer = setInterval(() => void this.scan(), interval);
    this.timer.unref?.();
  }

  snapshot() {
    return {
      ...this.status,
      enabled: Boolean(this.store.config.enabled),
      configured: this.downloaderConfigs().length > 0,
      scanning: this.scanning,
      ruleCount: this.store.rules.length,
      eventCount: this.store.events.length,
      activeBanCount: this.store.runtime.activeBans.length,
      downloaderCount: this.downloaderConfigs().length,
      downloaders: [...this.downloaderStatus.values()]
    };
  }

  async testConnection(input = {}) {
    const config = input.id
      ? this.store.config.downloaders.find((item) => item.id === input.id)
      : input;
    if (!config?.url) throw new Error('请选择或填写下载器地址');
    const stored = this.store.config.downloaders.find((item) => item.id === config.id);
    const merged = { ...stored, ...config };
    if (!config.password || config.password === '********') merged.password = stored?.password || '';
    const testClient = new QBittorrentClient(merged);
    const version = await testClient.version();
    return { ok: true, version, name: merged.name || '' };
  }

  async beforeConfigUpdate(input) {
    if (!Array.isArray(input.downloaders)) return;
    const retained = new Set(input.downloaders.map((item) => item.id));
    const removedIds = new Set(this.store.config.downloaders.map((item) => item.id).filter((id) => !retained.has(id)));
    if (!removedIds.size) return;
    const removedBans = [];
    for (const downloaderId of removedIds) {
      const bans = this.store.runtime.activeBans.filter((ban) => ban.downloaderId === downloaderId);
      if (!bans.length) continue;
      const client = this.clients.get(downloaderId);
      if (!client) throw new Error(`删除下载器前无法解除其 ${bans.length} 条封禁：连接配置不可用`);
      await client.removeBans(bans.map((ban) => ban.target));
      removedBans.push(...bans);
    }
    if (removedBans.length) {
      const removed = new Set(removedBans);
      const timestamp = new Date().toISOString();
      this.store.runtime.activeBans = this.store.runtime.activeBans.filter((ban) => !removed.has(ban));
      await Promise.all([
        this.store.markEventsUnbanned(removedBans.map((ban) => ban.eventId), timestamp),
        this.store.saveRuntime()
      ]);
    }
  }

  async scan({ force = false } = {}) {
    if (this.scanning) return { skipped: true, reason: 'scan_in_progress' };
    if (!this.store.config.enabled && !force) return { skipped: true, reason: 'service_disabled' };
    this.scanning = true;
    const scanStartedAt = Date.now();
    try {
      await this.expireBans();
      const configs = this.downloaderConfigs();
      if (!configs.length) throw new Error('尚未配置已启用的 qBittorrent 下载器');

      const results = [];
      const allPeers = [];
      for (const config of configs) {
        const client = this.clients.get(config.id);
        try {
          const result = await this.scanDownloader(config, client, scanStartedAt);
          results.push(result);
          allPeers.push(...result.peers);
          this.downloaderStatus.set(config.id, {
            id: config.id,
            name: config.name,
            connected: true,
            version: result.qbVersion,
            torrentCount: result.torrentCount,
            peerCount: result.peerCount,
            lastError: ''
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({ ok: false, downloaderId: config.id, downloaderName: config.name, error: message, peers: [] });
          this.downloaderStatus.set(config.id, {
            id: config.id,
            name: config.name,
            connected: false,
            version: '',
            torrentCount: 0,
            peerCount: 0,
            lastError: message
          });
        }
      }

      pruneRuntimeState(this.store.runtime, scanStartedAt);
      await this.store.saveRuntime();
      const successes = results.filter((item) => item.ok);
      const failures = results.filter((item) => !item.ok);
      this.currentPeers = allPeers.slice(0, 5000);
      this.status.qbConnected = successes.length > 0;
      this.status.qbVersion = successes.map((item) => item.qbVersion).filter((value, index, list) => list.indexOf(value) === index).join(', ');
      this.status.lastError = failures.map((item) => `${item.downloaderName}: ${item.error}`).join('；');
      this.status.lastScanAt = new Date().toISOString();
      this.status.scanCount += 1;
      this.status.torrentCount = sum(successes, 'torrentCount');
      this.status.peerCount = allPeers.length;
      this.status.ipBanCount += sum(successes, 'ipBans');
      this.status.endpointBanCount += sum(successes, 'endpointBans');
      this.status.activeBanCount = this.store.runtime.activeBans.length;

      return {
        ok: successes.length > 0,
        durationMs: Date.now() - scanStartedAt,
        downloaderCount: successes.length,
        failedDownloaderCount: failures.length,
        torrentCount: this.status.torrentCount,
        peerCount: allPeers.length,
        ipBans: sum(successes, 'ipBans'),
        endpointBans: sum(successes, 'endpointBans'),
        results
      };
    } catch (error) {
      this.status.qbConnected = false;
      this.status.lastError = error instanceof Error ? error.message : String(error);
      this.status.lastScanAt = new Date().toISOString();
      return { ok: false, error: this.status.lastError };
    } finally {
      this.scanning = false;
    }
  }

  async scanDownloader(config, client, now) {
    const qbVersion = await client.version();
    await this.reconcileActiveBans(config.id, client, now);
    const torrents = await client.torrents();
    const peerGroups = await mapLimit(torrents, 6, async (torrent) => ({
      torrent,
      peers: await client.peers(torrent.hash)
    }));
    const peers = [];
    const ipDecisions = new Map();
    const endpointDecisions = new Map();

    for (const { torrent, peers: torrentPeers } of peerGroups) {
      for (const peer of torrentPeers) {
        const family = clientFamily(peer);
        const key = sessionKey(config.id, torrent, peer);
        const previous = this.store.runtime.peerSessions[key];
        const session = updatePeerSession(previous, { downloaderId: config.id, torrent, peer, now });
        this.store.runtime.peerSessions[key] = session;
        const transferred = Math.max(0, session.accumulatedUploaded - Number(previous?.accumulatedUploaded || 0));
        this.store.runtime.clientBytes[family] = Number(this.store.runtime.clientBytes[family] || 0) + transferred;

        const enriched = {
          ...peer,
          downloaderId: config.id,
          downloaderName: config.name,
          torrentHash: torrent.hash,
          torrentName: torrent.name,
          torrentSize: Number(torrent.total_size || torrent.size || 0),
          clientFamily: family
        };
        let decision = classifyPeer(enriched, this.store.rules, this.store.config.behavior);
        let behavior = null;
        if (decision.action !== 'allow') {
          behavior = evaluateBehavior({ peer: enriched, torrent, session, config: this.store.config.behavior });
          if (behavior && decision.action === 'observe') {
            decision = { action: behavior.action, reason: behavior.reason, ruleId: `behavior-${behavior.kind}` };
          }
        }
        const category = isXunlei(enriched)
          ? 'xunlei'
          : (decision.action === 'block_ip' || decision.action === 'block_endpoint' ? 'leecher' : 'normal');
        this.recordIP(config, enriched, family, category, now);

        const record = { peer: enriched, decision, behavior };
        peers.push(record);
        if (decision.action === 'block_ip') ipDecisions.set(peer.ip, record);
        if (decision.action === 'block_endpoint') endpointDecisions.set(formatEndpoint(peer.ip, peer.port), record);
      }
    }

    for (const [endpoint, record] of endpointDecisions) {
      if (ipDecisions.has(record.peer.ip)) endpointDecisions.delete(endpoint);
    }
    const ipTargets = [...ipDecisions.keys()].filter((target) => !this.store.activeBan(config.id, target));
    const endpointTargets = [...endpointDecisions.keys()].filter((target) => !this.store.activeBan(config.id, target));
    if (ipTargets.length) await client.banIPs(ipTargets);
    if (endpointTargets.length) await client.banEndpoints(endpointTargets);

    const events = [];
    const bannedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + Number(this.store.config.banDurationDays || 7) * DAY_MS).toISOString();
    for (const [target, record] of [...ipDecisions, ...endpointDecisions]) {
      if (!ipTargets.includes(target) && !endpointTargets.includes(target)) continue;
      const id = crypto.randomUUID();
      const event = {
        id,
        timestamp: bannedAt,
        bannedAt,
        expiresAt,
        target,
        action: record.decision.action,
        reason: record.decision.reason,
        ruleId: record.decision.ruleId,
        downloaderId: config.id,
        downloaderName: config.name,
        ip: record.peer.ip,
        port: record.peer.port,
        client: record.peer.client,
        peerId: record.peer.peerId,
        torrentHash: record.peer.torrentHash,
        torrentName: record.peer.torrentName,
        evidence: record.behavior?.evidence || null
      };
      events.push(event);
      this.store.runtime.activeBans.push({
        eventId: id,
        downloaderId: config.id,
        downloaderName: config.name,
        target,
        action: record.decision.action,
        bannedAt,
        expiresAt
      });
    }
    if (events.length) await this.store.addEvents(events);
    return {
      ok: true,
      downloaderId: config.id,
      downloaderName: config.name,
      qbVersion,
      torrentCount: torrents.length,
      peerCount: peers.length,
      ipBans: ipTargets.length,
      endpointBans: endpointTargets.length,
      peers
    };
  }

  recordIP(config, peer, family, category, now) {
    if (isProtectedAddress(peer.ip)) return;
    const key = `${config.id}|${peer.ip}`;
    const timestamp = new Date(now).toISOString();
    const previous = this.store.runtime.ipHistory[key];
    this.store.runtime.ipHistory[key] = {
      downloaderId: config.id,
      downloaderName: config.name,
      ip: peer.ip,
      firstSeenAt: previous?.firstSeenAt || timestamp,
      lastSeenAt: timestamp,
      clientFamily: family,
      category
    };
  }

  async reconcileActiveBans(downloaderId, client, now) {
    const tracked = this.store.runtime.activeBans.filter((ban) => ban.downloaderId === downloaderId);
    if (!tracked.length) return;
    const actual = new Set(await client.bannedPeers());
    const missing = tracked.filter((ban) => !actual.has(ban.target));
    if (!missing.length) return;

    const missingSet = new Set(missing);
    this.store.runtime.activeBans = this.store.runtime.activeBans.filter((ban) => !missingSet.has(ban));
    const timestamp = new Date(now).toISOString();
    await Promise.all([
      this.store.markEventsUnbanned(missing.map((ban) => ban.eventId), timestamp),
      this.store.saveRuntime()
    ]);
  }

  async expireBans(now = Date.now()) {
    if (this.maintenanceRunning) return { skipped: true };
    this.maintenanceRunning = true;
    try {
      const expired = this.store.runtime.activeBans.filter((ban) => Date.parse(ban.expiresAt) <= now);
      if (!expired.length) return { ok: true, expired: 0 };
      const removed = new Set();
      const byDownloader = groupBy(expired, (ban) => ban.downloaderId);
      for (const [downloaderId, bans] of byDownloader) {
        const client = this.clients.get(downloaderId);
        if (!client) continue;
        try {
          await client.removeBans(bans.map((ban) => ban.target));
          for (const ban of bans) removed.add(ban);
        } catch (error) {
          const status = this.downloaderStatus.get(downloaderId) || { id: downloaderId };
          status.lastError = `自动解封失败：${error instanceof Error ? error.message : String(error)}`;
          this.downloaderStatus.set(downloaderId, status);
        }
      }
      if (removed.size) {
        const timestamp = new Date(now).toISOString();
        this.store.runtime.activeBans = this.store.runtime.activeBans.filter((ban) => !removed.has(ban));
        await Promise.all([
          this.store.markEventsUnbanned([...removed].map((ban) => ban.eventId), timestamp),
          this.store.saveRuntime()
        ]);
      }
      this.status.activeBanCount = this.store.runtime.activeBans.length;
      return { ok: true, expired: removed.size };
    } finally {
      this.maintenanceRunning = false;
    }
  }

  analytics(now = Date.now()) {
    const cutoff = now - MONTH_MS;
    const monthly = Object.values(this.store.runtime.ipHistory)
      .filter((item) => Date.parse(item.lastSeenAt || 0) >= cutoff);
    const uniqueIPs = new Set(monthly.map((item) => item.ip));
    const downloaderMap = new Map();
    for (const item of monthly) {
      const entry = downloaderMap.get(item.downloaderId) || { id: item.downloaderId, name: item.downloaderName, ips: new Set() };
      entry.ips.add(item.ip);
      downloaderMap.set(item.downloaderId, entry);
    }

    const bytes = Object.entries(this.store.runtime.clientBytes)
      .map(([name, value]) => ({ name, bytes: Number(value || 0) }))
      .filter((item) => item.bytes > 0)
      .sort((a, b) => b.bytes - a.bytes);
    const totalBytes = bytes.reduce((total, item) => total + item.bytes, 0);
    for (const item of bytes) item.percent = totalBytes ? (item.bytes / totalBytes) * 100 : 0;

    const categories = { normal: 0, leecher: 0, xunlei: 0 };
    for (const record of this.currentPeers) {
      if (isXunlei(record.peer)) categories.xunlei += 1;
      else if (record.decision.action === 'block_ip' || record.decision.action === 'block_endpoint') categories.leecher += 1;
      else categories.normal += 1;
    }
    const categoryTotal = Object.values(categories).reduce((total, value) => total + value, 0);
    return {
      generatedAt: new Date(now).toISOString(),
      monthlyUniqueIPs: uniqueIPs.size,
      monthlyUniqueByDownloader: [...downloaderMap.values()].map((item) => ({
        id: item.id,
        name: item.name,
        count: item.ips.size
      })),
      clientDownloads: bytes,
      totalUploadedBytes: totalBytes,
      peerCategories: Object.entries(categories).map(([name, count]) => ({
        name,
        count,
        percent: categoryTotal ? (count / categoryTotal) * 100 : 0
      })),
      currentPeerCount: categoryTotal,
      activeBanCount: this.store.runtime.activeBans.length
    };
  }
}

async function mapLimit(values, concurrency, worker) {
  const result = new Array(values.length);
  let next = 0;
  async function run() {
    while (next < values.length) {
      const index = next++;
      try {
        result[index] = await worker(values[index], index);
      } catch (error) {
        if (error.status === 404) result[index] = { torrent: values[index], peers: [] };
        else throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run));
  return result;
}

function sum(values, field) {
  return values.reduce((total, item) => total + Number(item[field] || 0), 0);
}

function groupBy(values, keyFor) {
  const groups = new Map();
  for (const value of values) {
    const key = keyFor(value);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(value);
  }
  return groups;
}
