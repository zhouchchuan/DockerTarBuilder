(() => {
  'use strict';
  if (location.origin !== 'https://jiami.ttplays.uk:6067' || window.__WuAiAudio103) return;
  const docID = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
  const records = new WeakMap();
  let sequence = 0, active = null, ticket = null, intent = 0, lastIntent = -Infinity;
  const clock = () => performance.now();
  const send = (event, r) => {
    try { window.webkit.messageHandlers.WuAiAudio.postMessage({event, doc: docID, media: r ? r.id : ''}); } catch (_) {}
  };
  const record = v => {
    if (!records.has(v)) records.set(v, {v, id: String(++sequence), source: '', playing: false, pausedAt: -Infinity});
    return records.get(v);
  };
  const eligible = r => r && r.v.isConnected && !r.v.ended && !r.v.error && !r.v.muted && r.v.volume > 0 && !!r.v.currentSrc;
  const cancel = () => { ticket = null; intent++; lastIntent = clock(); send('cancel', active); };
  const originalPause = HTMLMediaElement.prototype.pause;
  // Page controls often call pause() before the pause event; retain that explicit intent.
  HTMLMediaElement.prototype.pause = function (...args) {
    if (active && active.v === this) cancel();
    return Reflect.apply(originalPause, this, args);
  };
  for (const name of ['pointerdown', 'touchstart', 'keydown']) {
    document.addEventListener(name, e => {
      if (!e.isTrusted) return;
      cancel();
      // Scrolling/volume/fullscreen interactions must not forget a video that keeps playing.
      if (eligible(active) && !active.v.paused) send('playing', active);
    }, true);
  }
  for (const name of ['playing', 'pause', 'ended', 'emptied', 'error', 'volumechange']) {
    document.addEventListener(name, e => {
      if (!(e.target instanceof HTMLVideoElement)) return;
      const r = record(e.target);
      if (name === 'playing' && eligible(r)) {
        if (active !== r) ticket = null;
        active = r; r.source = r.v.currentSrc; r.playing = true; r.pausedAt = -Infinity;
        send('playing', r);
      } else if (r === active) {
        if (name === 'pause') {
          if (r.playing) r.pausedAt = clock();
          r.playing = false;
          // Only the pause immediately surrounding route loss may be recovered.
          if (ticket && clock() - ticket.started > 750) cancel();
          send('pause', r);
        } else if (name !== 'volumechange' || !eligible(r)) {
          cancel(); active = null;
        }
      }
    }, true);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); }, true);
  window.addEventListener('pagehide', cancel, true);
  // Preserve site handlers, including explicit pause/stop from headset controls.
  if (navigator.mediaSession && typeof navigator.mediaSession.setActionHandler === 'function') {
    const session = navigator.mediaSession, original = session.setActionHandler;
    session.setActionHandler = function (action, handler) {
      const wrapped = (action === 'pause' || action === 'stop') && typeof handler === 'function'
        ? function (...args) { cancel(); return Reflect.apply(handler, this, args); } : handler;
      return Reflect.apply(original, this, [action, wrapped]);
    };
  }
  window.__WuAiAudio103 = Object.freeze({
    arm(doc, media, id) {
      const r = active, now = clock();
      if (doc !== docID || !eligible(r) || r.id !== media || document.hidden ||
          r.source !== r.v.currentSrc || now - lastIntent < 750 ||
          (!r.playing && now - r.pausedAt > 750)) return false;
      ticket = {id, r, source: r.v.currentSrc, intent, started: now};
      // Enforce privacy while the headset is absent without treating this as user intent.
      if (!r.v.paused) Reflect.apply(originalPause, r.v, []);
      return true;
    },
    cancel() { ticket = null; },
    async resume(doc, media, id) {
      const t = ticket; ticket = null;
      if (!t || t.id !== id || doc !== docID || t.r.id !== media || active !== t.r ||
          t.intent !== intent || document.hidden || !eligible(t.r) ||
          t.source !== t.r.v.currentSrc || clock() - t.started > 12000) return 'cancelled';
      if (!t.r.v.paused) return 'already-playing';
      try { await t.r.v.play(); return 'resumed'; } catch (_) { return 'play-rejected'; }
    }
  });
})();
