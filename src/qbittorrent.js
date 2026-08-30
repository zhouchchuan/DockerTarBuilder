import { VERSION } from './defaults.js';

function normalizeBaseUrl(value) {
  const url = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('qB 地址只支持 http 或 https');
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

export class QBittorrentClient {
  constructor(config) {
    this.updateConfig(config);
    this.cookie = '';
    this.loggedIn = false;
  }

  updateConfig(config) {
    this.config = structuredClone(config || {});
    this.baseUrl = this.config.url ? normalizeBaseUrl(this.config.url) : null;
    this.cookie = '';
    this.loggedIn = false;
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.config.username && this.config.password);
  }

  async login() {
    if (!this.isConfigured()) throw new Error('尚未配置 qBittorrent 地址、用户名和密码');
    const body = new URLSearchParams({
      username: this.config.username,
      password: this.config.password
    });
    const response = await fetch(new URL('/api/v2/auth/login', this.baseUrl), {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/x-www-form-urlencoded' }),
      body,
      signal: AbortSignal.timeout(10_000)
    });
    const text = await response.text();
    const reply = text.trim();
    // qB versions and reverse proxies differ here: successful logins can be
    // HTTP 200 + "Ok.", an empty 2xx response, or HTTP 204. A failed legacy
    // login can still be HTTP 200 + "Fails.", so do not accept arbitrary text.
    const acceptedReply = !reply || /^Ok\.?$/i.test(reply);
    if (!response.ok || !acceptedReply) {
      throw new Error(`qB 登录失败：HTTP ${response.status}${reply ? ` (${reply.slice(0, 120)})` : ''}`);
    }
    const setCookie = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')].filter(Boolean);
    this.cookie = setCookie.map((item) => item.split(';', 1)[0]).join('; ');
    // When qB's localhost/subnet authentication bypass is enabled it may not
    // return a session cookie. Mark the login complete and let the requested
    // API endpoint verify that the bypass is actually usable.
    this.loggedIn = true;
  }

  headers(extra = {}) {
    const origin = this.baseUrl?.origin || '';
    return {
      accept: 'application/json, text/plain, */*',
      origin,
      referer: `${origin}/`,
      'user-agent': `PeerBander-Beyonder/${VERSION}`,
      ...(this.cookie ? { cookie: this.cookie } : {}),
      ...extra
    };
  }

  async request(pathname, options = {}, retry = true) {
    if (!this.loggedIn) await this.login();
    const response = await fetch(new URL(pathname, this.baseUrl), {
      ...options,
      headers: this.headers(options.headers),
      signal: options.signal || AbortSignal.timeout(15_000)
    });
    if ((response.status === 401 || response.status === 403) && retry) {
      this.cookie = '';
      this.loggedIn = false;
      await this.login();
      return this.request(pathname, options, false);
    }
    if (!response.ok) {
      const body = (await response.text()).slice(0, 300);
      const error = new Error(`qB API ${pathname} 返回 HTTP ${response.status}${body ? `: ${body}` : ''}`);
      error.status = response.status;
      throw error;
    }
    return response;
  }

  async version() {
    return (await (await this.request('/api/v2/app/version')).text()).trim();
  }

  async torrents() {
    return (await (await this.request('/api/v2/torrents/info?filter=all')).json())
      .filter((torrent) => shouldInspectTorrent(torrent));
  }

  async peers(hash) {
    const response = await this.request(`/api/v2/sync/torrentPeers?hash=${encodeURIComponent(hash)}&rid=0`);
    const body = await response.json();
    return Object.values(body.peers || {}).map((peer) => ({
      ip: peer.ip,
      port: Number(peer.port || 0),
      client: String(peer.client || ''),
      peerId: String(peer.peer_id_client || ''),
      progress: Number(peer.progress || 0),
      uploaded: Number(peer.uploaded || 0),
      downloaded: Number(peer.downloaded || 0),
      uploadSpeed: Number(peer.up_speed || 0),
      downloadSpeed: Number(peer.dl_speed || 0)
    }));
  }

  async banIPs(ips) {
    if (!ips.length) return;
    await this.postForm('/api/v2/transfer/banPeers', { peers: [...new Set(ips)].join('|') });
  }

  async banEndpoints(endpoints) {
    if (!endpoints.length) return;
    try {
      await this.postForm('/api/v2/transfer/banPeerEndpoints', { peers: [...new Set(endpoints)].join('|') });
    } catch (error) {
      if (error.status === 404) {
        throw new Error('目标 qB 不支持精准 Endpoint API；请使用 qBittorrent Precision 0.1.3 或更高版本');
      }
      throw error;
    }
  }

  async bannedPeers() {
    const preferences = await (await this.request('/api/v2/app/preferences')).json();
    return String(preferences.banned_IPs || '')
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  async removeBans(targets) {
    const removing = new Set(targets.map((item) => String(item).trim()));
    if (!removing.size) return;
    const current = await this.bannedPeers();
    const remaining = current.filter((item) => !removing.has(item));
    if (remaining.length === current.length) return;
    await this.postForm('/api/v2/app/setPreferences', {
      json: JSON.stringify({ banned_IPs: remaining.join('\n') })
    });
  }

  async postForm(pathname, values) {
    const body = new URLSearchParams(values);
    await this.request(pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
  }
}

function shouldInspectTorrent(torrent) {
  if (Number(torrent.num_leechs || 0) > 0 || Number(torrent.num_seeds || 0) > 0) return true;
  return /upload|download|stalled|forced|meta/i.test(String(torrent.state || ''));
}
