const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('WuAiZhiBo/AudioRecovery.js', 'utf8');
let checks = 0;
function check(value, name) { assert.ok(value, name); checks++; }
function fixture(origin = 'https://jiami.ttplays.uk:6067') {
  const listeners = {}, messages = [], actions = {};
  let time = 1000;
  const document = { hidden: false, addEventListener(n, f) { (listeners[n] ||= []).push(f); } };
  const emit = (name, target, extra = {}) => (listeners[name] || []).forEach(f => f({target, ...extra}));
  class Media {
    constructor() { Object.assign(this, {isConnected: true, ended: false, error: null, muted: false, volume: 1, currentSrc: 'https://media/video', paused: false, calls: 0}); }
    pause() { this.paused = true; emit('pause', this); return 'original-return'; }
    play() { this.calls++; if (this.reject) return Promise.reject(new Error('NotAllowedError')); this.paused = false; emit('playing', this); return Promise.resolve(); }
  }
  class Video extends Media {}
  const mediaSession = {setActionHandler(name, fn) { actions[name] = fn; return 42; }};
  const context = {location: {origin}, document, navigator: {mediaSession}, HTMLMediaElement: Media, HTMLVideoElement: Video, performance: {now: () => time}, Date, Math,
    webkit: {messageHandlers: {WuAiAudio: {postMessage: m => messages.push(m)}}}, addEventListener: document.addEventListener};
  context.window = context;
  vm.runInNewContext(source, context);
  const video = new Video();
  function start(v = video) { v.paused = false; emit('playing', v); }
  function args() { const m = messages.filter(m => m.event === 'playing').at(-1); return [m.doc, m.media, 7]; }
  function systemPause(v = video) { v.paused = true; emit('pause', v); }
  start();
  return {api: context.__WuAiAudio103, video, start, args, emit, systemPause, document, actions, mediaSession, messages, Video, advance: n => time += n};
}
(async () => {
  check(!fixture('https://third-party.example').api, 'third-party frame is not controlled');
  let f = fixture(); check(await f.api.resume(...f.args()) === 'cancelled', 'pause alone cannot resume');
  f = fixture(); check(f.api.arm(...f.args()), 'arm current audible video');
  check(f.video.paused, 'pause while headset absent'); f.advance(800);
  check(await f.api.resume(...f.args()) === 'resumed' && f.video.calls === 1, 'one continuation of current video');
  check(await f.api.resume(...f.args()) === 'cancelled' && f.video.calls === 1, 'ticket consumed');
  f = fixture(); f.systemPause(); f.advance(500); check(f.api.arm(...f.args()), 'pause notification race');
  f = fixture(); f.systemPause(); f.advance(800); check(!f.api.arm(...f.args()), 'already paused before route loss');
  f = fixture(); check(f.video.pause() === 'original-return', 'preserve original pause result');
  check(!f.api.arm(...f.args()), 'page or user pause never auto-resumes');
  f = fixture(); f.api.arm(...f.args()); f.emit('pointerdown', f.video, {isTrusted: true});
  check(await f.api.resume(...f.args()) === 'cancelled', 'touch during loss cancels');
  f = fixture(); f.api.arm(...f.args()); f.emit('keydown', f.video, {isTrusted: true});
  check(await f.api.resume(...f.args()) === 'cancelled', 'key during loss cancels');
  f = fixture(); f.api.arm(...f.args()); f.video.currentSrc = 'https://media/next';
  check(await f.api.resume(...f.args()) === 'cancelled', 'source replacement');
  f = fixture(); f.api.arm(...f.args()); f.video.isConnected = false;
  check(await f.api.resume(...f.args()) === 'cancelled', 'removed element');
  f = fixture(); f.api.arm(...f.args()); f.document.hidden = true;
  check(await f.api.resume(...f.args()) === 'cancelled', 'hidden document');
  f = fixture(); f.api.arm(...f.args()); f.advance(12001);
  check(await f.api.resume(...f.args()) === 'cancelled', 'expiry');
  f = fixture(); f.api.arm(...f.args()); f.video.reject = true;
  check(await f.api.resume(...f.args()) === 'play-rejected', 'play promise rejection consumed');
  await f.api.resume(...f.args()); check(f.video.calls === 1, 'no retry loop on rejection');
  f = fixture(); f.video.muted = true; check(!f.api.arm(...f.args()), 'silent video ineligible');
  f = fixture(); f.video.volume = 0; check(!f.api.arm(...f.args()), 'zero volume ineligible');
  f = fixture(); f.video.ended = true; check(!f.api.arm(...f.args()), 'ended video ineligible');
  f = fixture(); f.api.arm(...f.args()); f.advance(1000); f.systemPause();
  check(await f.api.resume(...f.args()) === 'cancelled', 'later ambiguous native pause');
  f = fixture(); const oldArgs = f.args(); f.api.arm(...oldArgs); f.start(new f.Video());
  check(await f.api.resume(...oldArgs) === 'cancelled', 'another active video');
  f = fixture(); f.api.arm(...f.args());
  check(await f.api.resume('old-document', f.args()[1], 7) === 'cancelled', 'stale document');
  f = fixture(); let called = 0;
  check(f.mediaSession.setActionHandler('pause', () => { called++; }) === 42, 'preserve media session registration result');
  f.api.arm(...f.args()); f.actions.pause();
  check(called === 1 && await f.api.resume(...f.args()) === 'cancelled', 'registered headset pause handler respected');
  f = fixture(); f.api.arm(...f.args()); f.emit('pagehide');
  check(await f.api.resume(...f.args()) === 'cancelled', 'navigation invalidates document ticket');
  f = fixture(); f.api.arm(...f.args()); f.api.cancel();
  check(await f.api.resume(...f.args()) === 'cancelled', 'native cancellation');
  console.log(`Audio bridge: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exitCode = 1; });
