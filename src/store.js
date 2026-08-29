import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_CONFIG, DEFAULT_RULES } from './defaults.js';

function clone(value) {
  return structuredClone(value);
}

function mergeConfig(stored = {}) {
  return {
    ...clone(DEFAULT_CONFIG),
    ...stored,
    qbittorrent: {
      ...clone(DEFAULT_CONFIG.qbittorrent),
      ...(stored.qbittorrent || {})
    },
    behavior: {
      ...clone(DEFAULT_CONFIG.behavior),
      ...(stored.behavior || {})
    }
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
    this.config = clone(DEFAULT_CONFIG);
    this.rules = [];
    this.events = [];
  }

  async initialize() {
    await mkdir(this.dataDirectory, { recursive: true });
    this.config = mergeConfig(await readJson(this.configFile, DEFAULT_CONFIG));
    this.rules = await readJson(this.rulesFile, DEFAULT_RULES);
    this.events = await readJson(this.eventsFile, []);
    this.applyEnvironment();
    await Promise.all([
      this.writeAtomic(this.configFile, this.config),
      this.writeAtomic(this.rulesFile, this.rules),
      this.writeAtomic(this.eventsFile, this.events)
    ]);
  }

  applyEnvironment() {
    const env = process.env;
    if (env.PBB_QB_URL) this.config.qbittorrent.url = env.PBB_QB_URL;
    if (env.PBB_QB_USERNAME) this.config.qbittorrent.username = env.PBB_QB_USERNAME;
    if (env.PBB_QB_PASSWORD) this.config.qbittorrent.password = env.PBB_QB_PASSWORD;
    if (env.PBB_SCAN_INTERVAL) {
      const value = Number(env.PBB_SCAN_INTERVAL);
      if (Number.isFinite(value)) this.config.scanIntervalSeconds = value;
    }
    if (env.PBB_ENABLED) this.config.enabled = /^(1|true|on)$/i.test(env.PBB_ENABLED);
  }

  publicConfig() {
    const config = clone(this.config);
    config.qbittorrent.password = config.qbittorrent.password ? '********' : '';
    return config;
  }

  async updateConfig(input) {
    const next = mergeConfig({ ...this.config, ...input });
    if (input.qbittorrent) {
      next.qbittorrent = { ...this.config.qbittorrent, ...input.qbittorrent };
      if (!input.qbittorrent.password || input.qbittorrent.password === '********') {
        next.qbittorrent.password = this.config.qbittorrent.password;
      }
    }
    next.scanIntervalSeconds = Math.max(2, Math.min(300, Number(next.scanIntervalSeconds) || 5));
    next.eventLimit = Math.max(100, Math.min(50_000, Number(next.eventLimit) || 5000));
    next.decisionCooldownSeconds = Math.max(30, Math.min(86_400, Number(next.decisionCooldownSeconds) || 600));
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

  async clearEvents() {
    this.events = [];
    await this.writeAtomic(this.eventsFile, this.events);
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
