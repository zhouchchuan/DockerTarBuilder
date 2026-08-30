import { isXunlei } from './classifier.js';

const MONTH_MS = 31 * 24 * 60 * 60 * 1000;

export function sessionKey(downloaderId, torrent, peer) {
  return [downloaderId, torrent.hash, peer.ip, peer.port, peer.peerId || peer.client || 'unknown'].join('|');
}

export function updatePeerSession(previous, { downloaderId, torrent, peer, now = Date.now() }) {
  const uploaded = Math.max(0, Number(peer.uploaded || 0));
  const progress = clamp(Number(peer.progress || 0), 0, 1);
  const state = previous ? structuredClone(previous) : {
    downloaderId,
    torrentHash: torrent.hash,
    ip: peer.ip,
    port: peer.port,
    peerId: peer.peerId || '',
    client: peer.client || '',
    firstSeenAt: new Date(now).toISOString(),
    initialProgress: progress,
    maximumProgress: progress,
    accumulatedUploaded: uploaded,
    lastUploaded: uploaded
  };

  if (previous) {
    const delta = uploaded >= Number(previous.lastUploaded || 0)
      ? uploaded - Number(previous.lastUploaded || 0)
      : uploaded;
    state.accumulatedUploaded = Number(previous.accumulatedUploaded || 0) + Math.max(0, delta);
  }
  state.lastUploaded = uploaded;
  state.lastProgress = progress;
  state.maximumProgress = Math.max(Number(state.maximumProgress || 0), progress);
  state.lastSeenAt = new Date(now).toISOString();
  state.client = peer.client || state.client;
  return state;
}

export function evaluateBehavior({ peer, torrent, session, config }) {
  if (!config?.enabled) return null;
  const size = Math.max(0, Number(torrent.total_size || torrent.size || 0));
  const uploaded = Math.max(0, Number(session.accumulatedUploaded || 0));
  const minimum = Math.max(0, Number(config.minimumUploadedBytes || 0));
  if (!size || uploaded < minimum) return null;

  const progress = clamp(Number(peer.progress || 0), 0, 1);
  const tolerance = clamp(Number(config.excessProgressPercent ?? 10) / 100, 0, 10);
  const uploadedRatio = uploaded / size;
  const excess = uploadedRatio - progress;
  const rewind = Number(session.maximumProgress || progress) - progress;
  const rewindTolerance = clamp(Number(config.progressRewindPercent ?? 10) / 100, 0, 1);

  let kind = '';
  if (excess > tolerance) kind = 'over_download';
  else if (rewind > rewindTolerance) kind = 'progress_rewind';
  if (!kind) return null;

  return {
    kind,
    action: isXunlei(peer) ? 'block_endpoint' : 'block_ip',
    reason: kind === 'over_download'
      ? `过度下载：实际上传 ${(uploadedRatio * 100).toFixed(1)}%，Peer进度 ${(progress * 100).toFixed(1)}%，误差 ${(excess * 100).toFixed(1)}%`
      : `进度倒退：最高 ${(Number(session.maximumProgress) * 100).toFixed(1)}%，当前 ${(progress * 100).toFixed(1)}%`,
    evidence: {
      torrentSize: size,
      uploadedBytes: uploaded,
      uploadedPercent: uploadedRatio * 100,
      reportedProgressPercent: progress * 100,
      excessPercent: excess * 100,
      rewindPercent: rewind * 100
    }
  };
}

export function pruneRuntimeState(runtime, now = Date.now()) {
  const cutoff = now - MONTH_MS;
  for (const [key, value] of Object.entries(runtime.peerSessions || {})) {
    if (Date.parse(value.lastSeenAt || 0) < cutoff) delete runtime.peerSessions[key];
  }
  for (const [key, value] of Object.entries(runtime.ipHistory || {})) {
    if (Date.parse(value.lastSeenAt || 0) < cutoff) delete runtime.ipHistory[key];
  }
}

function clamp(value, minimum, maximum) {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}
