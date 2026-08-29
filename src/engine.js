import { classifyPeer, formatEndpoint } from './classifier.js';
import { QBittorrentClient } from './qbittorrent.js';
import { VERSION } from './defaults.js';

export class Engine {
  constructor(store) {
    this.store = store;
    this.client = new QBittorrentClient(store.config.qbittorrent);
    this.timer = null;
    this.scanning = false;
    this.recentDecisions = new Map();
    this.currentPeers = [];
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
      endpointBanCount: 0
    };
  }

  start() {
    this.reschedule();
    if (this.store.config.enabled) void this.scan();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  reconfigure() {
    this.client.updateConfig(this.store.config.qbittorrent);
    this.status.qbConnected = false;
    this.status.qbVersion = '';
    this.status.lastError = '';
    this.reschedule();
    if (this.store.config.enabled) void this.scan();
  }

  reschedule() {
    this.stop();
    if (!this.store.config.enabled) return;
    const interval = this.store.config.scanIntervalSeconds * 1000;
    this.timer = setInterval(() => void this.scan(), interval);
    this.timer.unref?.();
  }

  snapshot() {
    return {
      ...this.status,
      enabled: Boolean(this.store.config.enabled),
      configured: this.client.isConfigured(),
      scanning: this.scanning,
      ruleCount: this.store.rules.length,
      eventCount: this.store.events.length
    };
  }

  async testConnection() {
    const testClient = new QBittorrentClient(this.store.config.qbittorrent);
    const version = await testClient.version();
    return { ok: true, version };
  }

  async scan({ force = false } = {}) {
    if (this.scanning) return { skipped: true, reason: 'scan_in_progress' };
    if (!this.store.config.enabled && !force) return { skipped: true, reason: 'service_disabled' };
    this.scanning = true;
    const scanStartedAt = Date.now();
    try {
      const qbVersion = await this.client.version();
      const torrents = await this.client.torrents();
      const peerGroups = await mapLimit(torrents, 6, async (torrent) => ({
        torrent,
        peers: await this.client.peers(torrent.hash)
      }));

      const peers = [];
      const ipDecisions = new Map();
      const endpointDecisions = new Map();
      for (const { torrent, peers: torrentPeers } of peerGroups) {
        for (const peer of torrentPeers) {
          const enriched = {
            ...peer,
            torrentHash: torrent.hash,
            torrentName: torrent.name
          };
          const decision = classifyPeer(enriched, this.store.rules);
          const record = { peer: enriched, decision };
          peers.push(record);
          if (decision.action === 'block_ip') ipDecisions.set(peer.ip, record);
          if (decision.action === 'block_endpoint') {
            endpointDecisions.set(formatEndpoint(peer.ip, peer.port), record);
          }
        }
      }

      // An explicit pure-leecher IP decision is stronger than an endpoint
      // decision for the same IP and avoids duplicate requests/events.
      for (const [endpoint, record] of endpointDecisions) {
        if (ipDecisions.has(record.peer.ip)) endpointDecisions.delete(endpoint);
      }

      const ipTargets = [...ipDecisions.keys()];
      const endpointTargets = [...endpointDecisions.keys()];
      if (ipTargets.length) await this.client.banIPs(ipTargets);
      if (endpointTargets.length) await this.client.banEndpoints(endpointTargets);

      const events = [];
      for (const [target, record] of [...ipDecisions, ...endpointDecisions]) {
        if (!this.shouldRecord(record.decision.action, target)) continue;
        events.push({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          target,
          action: record.decision.action,
          reason: record.decision.reason,
          ruleId: record.decision.ruleId,
          ip: record.peer.ip,
          port: record.peer.port,
          client: record.peer.client,
          peerId: record.peer.peerId,
          torrentHash: record.peer.torrentHash,
          torrentName: record.peer.torrentName
        });
      }
      if (events.length) await this.store.addEvents(events);

      this.currentPeers = peers.slice(0, 1000);
      this.status.qbConnected = true;
      this.status.qbVersion = qbVersion;
      this.status.lastError = '';
      this.status.lastScanAt = new Date().toISOString();
      this.status.scanCount += 1;
      this.status.torrentCount = torrents.length;
      this.status.peerCount = peers.length;
      this.status.ipBanCount += ipTargets.length;
      this.status.endpointBanCount += endpointTargets.length;
      return {
        ok: true,
        durationMs: Date.now() - scanStartedAt,
        torrentCount: torrents.length,
        peerCount: peers.length,
        ipBans: ipTargets.length,
        endpointBans: endpointTargets.length
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

  shouldRecord(action, target) {
    const now = Date.now();
    const key = `${action}|${target}`;
    const previous = this.recentDecisions.get(key) || 0;
    const cooldown = this.store.config.decisionCooldownSeconds * 1000;
    this.recentDecisions.set(key, now);
    for (const [oldKey, timestamp] of this.recentDecisions) {
      if (now - timestamp > cooldown * 2) this.recentDecisions.delete(oldKey);
    }
    return now - previous >= cooldown;
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
        // A torrent can disappear between list and peer queries. Ignore only
        // that known race; authentication/network failures remain visible.
        if (error.status === 404) result[index] = { torrent: values[index], peers: [] };
        else throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run));
  return result;
}
