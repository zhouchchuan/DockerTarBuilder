import net from 'node:net';

export function isXunlei(peer) {
  const client = String(peer.client || '');
  const peerId = String(peer.peerId || peer.peer_id_client || '');
  return /xunlei|thunder|迅雷/i.test(client) || /^-?XL/i.test(peerId);
}

export function isProtectedAddress(address) {
  const ip = String(address || '').toLowerCase().split('%')[0];
  const family = net.isIP(ip);
  if (!family) return true;
  if (family === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  }
  return ip === '::' || ip === '::1' || ip.startsWith('fe8') || ip.startsWith('fe9')
    || ip.startsWith('fea') || ip.startsWith('feb') || ip.startsWith('fc') || ip.startsWith('fd')
    || ip.startsWith('ff');
}

export function formatEndpoint(ip, port) {
  if (net.isIP(ip) === 6) return `[${ip}]:${port}`;
  return `${ip}:${port}`;
}

export function matchRule(rule, peer) {
  const value = String(peer[rule.field] || '');
  const pattern = String(rule.pattern || '');
  const left = value.toLocaleLowerCase('en-US');
  const right = pattern.toLocaleLowerCase('en-US');
  switch (rule.operator) {
    case 'equals': return left === right;
    case 'startsWith': return left.startsWith(right);
    case 'endsWith': return left.endsWith(right);
    case 'regex': return new RegExp(pattern, 'i').test(value);
    case 'contains':
    default: return left.includes(right);
  }
}

export function classifyPeer(peer, rules) {
  if (!peer.ip || !peer.port || isProtectedAddress(peer.ip)) {
    return { action: 'allow', reason: 'protected_or_invalid_address', ruleId: null };
  }

  const ordered = [...rules]
    .filter((rule) => rule.enabled !== false)
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));

  // Explicit allow rules always win, including version-level Xunlei allows.
  const allow = ordered.find((rule) => rule.action === 'allow' && matchRule(rule, peer));
  if (allow) return { action: 'allow', reason: allow.comment || 'allow_rule', ruleId: allow.id };

  // Xunlei is handled before generic leech rules. It must never be widened to
  // an IP-wide ban because other clients can share the same public address.
  if (isXunlei(peer)) {
    return { action: 'block_endpoint', reason: 'xunlei_precision_endpoint', ruleId: 'builtin-xunlei' };
  }

  const matched = ordered.find((rule) => rule.action !== 'allow' && matchRule(rule, peer));
  if (!matched) return { action: 'observe', reason: 'no_rule_matched', ruleId: null };
  return { action: matched.action, reason: matched.comment || 'matched_rule', ruleId: matched.id };
}
