(function () {
  'use strict';
  if (window !== window.top || location.origin !== 'https://jiami.ttplays.uk:6067' || window.__wuaiInstalled) return;
  window.__wuaiInstalled = true;
  var manifests = new Map(), active = null, pending = false;
  function https(value) {
    try { var u = new URL(value, location.href); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; }
    catch (_) { return ''; }
  }
  function remember(value) {
    var u = https(value);
    if (u && /\.(m3u8|mpd)(?:\?|$)/i.test(u)) {
      manifests.set(u, Date.now());
      if (manifests.size > 20) manifests.delete(manifests.keys().next().value);
    }
  }
  var originalFetch = window.fetch;
  if (originalFetch) window.fetch = function (input) { remember(typeof input === 'string' ? input : input && input.url); return originalFetch.apply(this, arguments); };
  var originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, address) { if (/^GET$/i.test(method)) remember(address); return originalOpen.apply(this, arguments); };
  function source(video) {
    var direct = video.currentSrc || video.src;
    if (direct && !direct.startsWith('blob:')) return https(direct);
    var tag = video.querySelector('source[src]');
    if (tag && !tag.src.startsWith('blob:')) return https(tag.src);
    // Only infer an MSE manifest when there is one unambiguous current request.
    var recent = Array.from(manifests).filter(function (entry) { return Date.now() - entry[1] < 15000 && /\.m3u8(?:\?|$)/i.test(entry[0]); });
    return recent.length === 1 && document.querySelectorAll('video').length === 1 ? recent[0][0] : '';
  }
  function open(video, automatic) {
    if (pending || !video || !window.WuAiNative) return;
    var address = source(video);
    if (!address) { if (!automatic) button.textContent = '暂未找到可播放地址'; return; }
    pending = true; active = video; video.pause();
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    window.WuAiNative.open(JSON.stringify({ url: address, page: location.href, position: Math.max(0, video.currentTime || 0) * 1000 }));
  }
  window.__wuaiReturn = function (ms) {
    pending = false;
    if (active && Number.isFinite(ms)) { try { active.currentTime = ms / 1000; } catch (_) {} }
  };
  var button = document.createElement('button');
  button.textContent = '兼容播放'; button.type = 'button';
  button.style.cssText = 'display:none;position:fixed;right:14px;top:14px;z-index:2147483647;border:1px solid #ffffff55;border-radius:18px;background:#141d2de8;color:white;padding:9px 14px;font:14px sans-serif;';
  button.addEventListener('click', function () { open(active, false); });
  document.addEventListener('error', function (event) {
    var v = event.target;
    if (v instanceof HTMLVideoElement && v.error && (v.error.code === 3 || v.error.code === 4)) open(v, true);
  }, true);
  document.addEventListener('play', function (event) { if (event.target instanceof HTMLVideoElement) active = event.target; }, true);
  function refresh() {
    if (!document.body) return;
    if (!button.isConnected) document.body.appendChild(button);
    var videos = Array.from(document.querySelectorAll('video'));
    var visible = videos.filter(function (v) { var r = v.getBoundingClientRect(); return r.width > 100 && r.height > 60 && r.bottom > 0 && r.top < innerHeight; });
    if (!visible.includes(active)) active = visible[0] || null;
    button.style.display = active && !pending ? 'block' : 'none';
    if (active) button.textContent = '兼容播放';
  }
  setInterval(refresh, 1000);
  document.addEventListener('DOMContentLoaded', refresh, { once: true });
})();
