export const VERSION = '0.0.2';

export const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  scanIntervalSeconds: 5,
  eventLimit: 5000,
  decisionCooldownSeconds: 600,
  qbittorrent: {
    url: '',
    username: '',
    password: ''
  },
  behavior: {
    enabled: false,
    minimumUploadedBytes: 50_000_000,
    maximumUploadDownloadRatio: 1.5,
    progressRewindPercent: 7
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
