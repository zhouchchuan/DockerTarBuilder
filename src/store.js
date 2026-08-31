import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_CONFIG, DEFAULT_RULES } from './defaults.js';

const DEFAULT_RUNTIME = Object.freeze({
  peerSessions: {},
  ipHistory: {},
  clientBytes: {},
  activeBans: []
});

function clone(value) {
  return structuredClone(value);
}

function normalizeDownloader(value, index = 0) {
  return {
    id: String(value?.id || `downloader-${Date.now()}-${index}`),
    name: String(value?.name || `qB下载器 ${index + 1}`),
    enabled: value?.enabled !== false,
    url: String(value?.url || '').trim(),
    username: String(value?.username || '').trim(),
    password: String(value?.password || '')
  };
}

function mergeConfig(stored = {}) {
  const legacy = {
    ...clone(DEFAULT_CONFIG.qbittorrent),
    ...(stored.qbittorrent || {})
  };
  let downloaders = Array.isArray(stored.downloaders)
    ? stored.downloaders.map(normalizeDownloader)
    : [];
  if (!downloaders.length && legacy.url) {
    downloaders = [normalizeDownloader({ id: 'primary', name: 'qB下载器 1', enabled: true, ...legacy }, 0)];
  }
  return {
    ...clone(DEFAULT_CONFIG),
    ...stored,
    qbittorrent: legacy,
    downloaders,
    behavior: {
      ...clone(DEFAULT_CONFIG.behavior),
      ...(stored.behavior || {})
    },
    schemaVersion: DEFAULT_CONFIG.schemaVersion
  };
}

function mergeRuntime(stored = {}) {
  return {
    ...clone(DEFAULT_RUNTIME),
    ...stored,
    peerSessions: { ...(stored.peerSessions || {}) },
    ipHistory: { ...(stored.ipHistory || {}) },
    clientBytes: { ...(stored.clientBytes || {}) },
    activeBans: Array.isArray(stored.activeBans) ? stored.activeBans : []
  };
}

async function readJson(filename, fallback) {
  try {
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return clone(fallback);
    throw error;
  }
}

export class Store {
  constructor(dataDirectory) {
    this.dataDirectory = dataDirectory;
    this.configFile = path.join(dataDirectory, 'config.json');
    this.rulesFile = path.join(dataDirectory, 'rules.json');
    this.eventsFile = path.join(dataDirectory, 'events.json');
    this.runtimeFile = path.join(dataDirectory, 'runtime.json');
    this.config = clone(DEFAULT_CONFIG);
    this.rules = [];
    this.events = [];
    this.runtime = clone(DEFAULT_RUNTIME);
  }

  async initialize() {
    await mkdir(this.dataDirectory, { recursive: true });
    const storedConfig = await readJson(this.configFile, DEFAULT_CONFIG);
    this.config = mergeConfig(storedConfig);
    this.rules = await readJson(this.rulesFile, DEFAULT_RULES);
    if (Number(storedConfig.schemaVersion || 0) < 3) this.addVersion3Rules();
    this.events = await readJson(this.eventsFile, []);
    this.runtime = mergeRuntime(await readJson(this.runtimeFile, DEFAULT_RUNTIME));
    this.applyEnvironment();
    this.config.scanIntervalSeconds = clampNumber(this.config.scanIntervalSeconds, 15, 300, 15);
    await Promise.all([
      this.writeAtomic(this.configFile, this.config),
      this.writeAtomic(this.rulesFile, this.rules),
      this.writeAtomic(this.eventsFile, this.events),
      this.writeAtomic(this.runtimeFile, this.runtime)
    ]);
  }

  addVersion3Rules() {
    const additions = DEFAULT_RULES.filter((rule) => rule.id.startsWith('client-gopeed-'));
    for (const addition of additions) {
      const exists = this.rules.some((rule) => rule.field === addition.field
        && rule.operator === addition.operator
        && String(rule.pattern).toLowerCase() === String(addition.pattern).toLowerCase());
      if (!exists) this.rules.push(clone(addition));
    }
  }

  applyEnvironment() {
    const env = process.env;
    if (env.PBB_QB_URL) this.config.qbittorrent.url = env.PBB_QB_URL;
    if (env.PBB_QB_USERNAME) this.config.qbittorrent.username = env.PBB_QB_USERNAME;
    if (env.PBB_QB_PASSWORD) this.config.qbittorrent.password = env.PBB_QB_PASSWORD;
    if (env.PBB_QB_URL) {
      const first = this.config.downloaders[0] || normalizeDownloader({ id: 'primary', name: 'qB下载器 1' });
      Object.assign(first, {
        url: env.PBB_QB_URL,
        username: env.PBB_QB_USERNAME || first.username,
        password: env.PBB_QB_PASSWORD || first.password
      });
      if (!this.config.downloaders.length) this.config.downloaders.push(first);
    }
    if (env.PBB_SCAN_INTERVAL) {
      const value = Number(env.PBB_SCAN_INTERVAL);
      if (Number.isFinite(value)) this.config.scanIntervalSeconds = value;
    }
    if (env.PBB_ENABLED) this.config.enabled = /^(1|true|on)$/i.test(env.PBB_ENABLED);
  }

  publicConfig() {
    const config = clone(this.config);
    config.qbittorrent.password = config.qbittorrent.password ? '********' : '';
    config.downloaders = config.downloaders.map((item) => ({
      ...item,
      password: item.password ? '********' : ''
    }));
    return config;
  }

  async updateConfig(input) {
    const next = mergeConfig({ ...this.config, ...input });
    if (Array.isArray(input.downloaders)) {
      const oldById = new Map(this.config.downloaders.map((item) => [item.id, item]));
      next.downloaders = input.downloaders.map((item, index) => {
        const normalized = normalizeDownloader(item, index);
        const old = oldById.get(normalized.id);
        if ((!item.password || item.password === '********') && old) normalized.password = old.password;
        return normalized;
      });
    }
    next.scanIntervalSeconds = clampNumber(next.scanIntervalSeconds, 15, 300, 15);
    next.eventLimit = clampNumber(next.eventLimit, 100, 50_000, 5000);
    next.decisionCooldownSeconds = clampNumber(next.decisionCooldownSeconds, 30, 86_400, 600);
    next.banDurationDays = clampNumber(next.banDurationDays, 1, 365, 7);
    next.behavior.enabled = Boolean(next.behavior.enabled);
    next.behavior.xunleiProtectionEnabled = next.behavior.xunleiProtectionEnabled !== false;
    next.behavior.minimumUploadedBytes = clampNumber(next.behavior.minimumUploadedBytes, 0, 1_000_000_000_000, 50_000_000);
    next.behavior.excessProgressPercent = clampNumber(next.behavior.excessProgressPercent, 0, 1000, 10);
    next.behavior.progressRewindPercent = clampNumber(next.behavior.progressRewindPercent, 0, 100, 10);
    this.config = next;
    await this.writeAtomic(this.configFile, this.config);
    return this.publicConfig();
  }

  async replaceRules(rules) {
    if (!Array.isArray(rules)) throw new TypeError('rules must be an array');
    this.rules = rules.map(normalizeRule);
    await this.writeAtomic(this.rulesFile, this.rules);
    return clone(this.rules);
  }

  async addEvents(events) {
    this.events.unshift(...events);
    this.events.length = Math.min(this.events.length, this.config.eventLimit);
    await this.writeAtomic(this.eventsFile, this.events);
  }

  async markEventsUnbanned(eventIds, timestamp) {
    const ids = new Set(eventIds);
    let changed = false;
    for (const event of this.events) {
      if (ids.has(event.id) && !event.unbannedAt) {
        event.unbannedAt = timestamp;
        changed = true;
      }
    }
    if (changed) await this.writeAtomic(this.eventsFile, this.events);
  }

  async clearEvents() {
    this.events = [];
    await this.writeAtomic(this.eventsFile, this.events);
  }

  activeBan(downloaderId, target) {
    return this.runtime.activeBans.find((ban) => ban.downloaderId === downloaderId && ban.target === target);
  }

  async saveRuntime() {
    await this.writeAtomic(this.runtimeFile, this.runtime);
  }

  async writeAtomic(filename, value) {
    const temporary = `${filename}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, filename);
  }
}

export function normalizeRule(rule, index = 0) {
  const allowedFields = new Set(['client', 'peerId', 'ip']);
  const allowedOperators = new Set(['equals', 'contains', 'startsWith', 'endsWith', 'regex']);
  const allowedActions = new Set(['allow', 'observe', 'block_ip', 'block_endpoint']);
  const normalized = {
    id: String(rule.id || `rule-${Date.now()}-${index}`),
    enabled: rule.enabled !== false,
    priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 0,
    field: String(rule.field || 'client'),
    operator: String(rule.operator || 'contains'),
    pattern: String(rule.pattern || ''),
    action: String(rule.action || 'observe'),
    comment: String(rule.comment || '')
  };
  if (!allowedFields.has(normalized.field)) throw new TypeError(`invalid rule field: ${normalized.field}`);
  if (!allowedOperators.has(normalized.operator)) throw new TypeError(`invalid rule operator: ${normalized.operator}`);
  if (!allowedActions.has(normalized.action)) throw new TypeError(`invalid rule action: ${normalized.action}`);
  if (!normalized.pattern) throw new TypeError('rule pattern is required');
  if (normalized.operator === 'regex') new RegExp(normalized.pattern, 'i');
  return normalized;
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}
