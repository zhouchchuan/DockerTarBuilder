export const VERSION = '0.0.6';

export const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: 3,
  enabled: false,
  scanIntervalSeconds: 5,
  eventLimit: 5000,
  decisionCooldownSeconds: 600,
  banDurationDays: 7,
  qbittorrent: {
    url: '',
    username: '',
    password: ''
  },
  downloaders: [],
  behavior: {
    enabled: false,
    xunleiProtectionEnabled: true,
    minimumUploadedBytes: 50_000_000,
    excessProgressPercent: 10,
    progressRewindPercent: 10
  }
});

// The initial list mirrors the rule shapes visible in the user's reference
// screenshots. Every rule is editable and additional clients can be added.
export const DEFAULT_RULES = Object.freeze([
  {
    id: 'allow-xunlei-0019', enabled: true, priority: 1000,
    field: 'client', operator: 'contains', pattern: 'Xunlei 0.0.1.9',
    action: 'allow', comment: '允许指定迅雷版本 0.0.1.9'
  },
  {
    id: 'allow-xunlei-0018', enabled: true, priority: 1000,
    field: 'client', operator: 'contains', pattern: 'Xunlei 0.0.1.8',
    action: 'allow', comment: '允许指定迅雷版本 0.0.1.8'
  },
  ...['-hp', '-xm', '-dt', '-sd'].map((pattern) => ({
    id: `peerid-${pattern.slice(1)}`,
    enabled: true,
    priority: 100,
    field: 'peerId',
    operator: 'startsWith',
    pattern,
    action: 'block_ip',
    comment: `已知纯吸血 PeerID ${pattern}`
  })),
  {
    id: 'peerid-rn000', enabled: true, priority: 100,
    field: 'peerId', operator: 'contains', pattern: '-rn0.0.0',
    action: 'block_ip', comment: '已知纯吸血 PeerID -rn0.0.0'
  },
  {
    id: 'client-gopeed-dev-exact', enabled: true, priority: 120,
    field: 'client', operator: 'equals', pattern: 'Gopeed dev',
    action: 'block_ip', comment: '已知纯吸血客户端 Gopeed dev'
  },
  {
    id: 'client-gopeed-bt-prefix', enabled: true, priority: 120,
    field: 'client', operator: 'startsWith', pattern: 'Gopeed bt-',
    action: 'block_ip', comment: '已知纯吸血客户端 Gopeed bt-'
  },
  {
    id: 'client-gopeed-dev-bt-prefix', enabled: true, priority: 120,
    field: 'client', operator: 'startsWith', pattern: 'Gopeed dev bt-',
    action: 'block_ip', comment: '已知纯吸血客户端 Gopeed dev bt-'
  },
  ...['hp/torrent', 'hp', 'dt/torrent', 'dt', 'xm/torrent', 'xm'].map((pattern) => ({
    id: `client-${pattern.replace('/', '-')}`,
    enabled: true,
    priority: 90,
    field: 'client',
    operator: 'startsWith',
    pattern,
    action: 'block_ip',
    comment: `已知纯吸血客户端 ${pattern}`
  }))
]);
