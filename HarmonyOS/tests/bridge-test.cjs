const fs = require('fs'), vm = require('vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('entry/src/main/resources/rawfile/web-bridge.js','utf8');
function fixture(origin='https://jiami.ttplays.uk:6067') {
  const listeners={}, opened=[], buttons=[], timers=[];
  class Video { constructor(src){this.currentSrc=src;this.currentTime=12;this.error=null;this.paused=false;}
    pause(){this.paused=true;} querySelector(){return null;} getBoundingClientRect(){return {width:300,height:200,top:10,bottom:210};} }
  const video=new Video('https://media.test/video.mp4?token=x');
  const doc={body:{appendChild(b){b.isConnected=true;}},querySelectorAll:()=>[video],fullscreenElement:null,
    createElement(){const b={style:{},addEventListener(k,f){b[k]=f;}};buttons.push(b);return b;},
    addEventListener(k,f){listeners[k]=f;}};
  function XHR(){} XHR.prototype.open=function(){};
  const win={WuAiNative:{open(s){opened.push(JSON.parse(s));}},fetch:()=>Promise.resolve({})};win.top=win;
  const context={window:win,location:{origin,href:origin+'/watch/1'},document:doc,URL,XMLHttpRequest:XHR,HTMLVideoElement:Video,
    setInterval:f=>timers.push(f),innerHeight:800,Map,Date,Number,Array};
  vm.runInNewContext(source,context);
  return {video,opened,listeners,buttons,timers,win,doc};
}
let f=fixture(); f.timers[0](); f.buttons[0].click();
assert.equal(f.opened[0].url,f.video.currentSrc);assert.equal(f.opened[0].position,12000);assert(f.video.paused);
f.buttons[0].click();assert.equal(f.opened.length,1,'prevent duplicate playback');
f.win.__wuaiReturn(1500);assert.equal(f.video.currentTime,1.5);
f=fixture();f.video.error={code:2};f.listeners.error({target:f.video});assert.equal(f.opened.length,0,'network error stays in browser');
f.video.error={code:4};f.listeners.error({target:f.video});assert.equal(f.opened.length,1,'unsupported codec enters fallback');
f=fixture();f.video.currentSrc='blob:local';f.win.fetch('https://cdn.test/live.m3u8?token=a');f.timers[0]();f.buttons[0].click();assert.equal(f.opened[0].url,'https://cdn.test/live.m3u8?token=a');
f=fixture();f.video.currentSrc='blob:local';f.win.fetch('https://cdn.test/a.m3u8');f.win.fetch('https://cdn.test/b.m3u8');f.timers[0]();f.buttons[0].click();assert.equal(f.opened.length,0,'ambiguous MSE source not guessed');
f=fixture('https://untrusted.test');assert.equal(f.buttons.length,0,'bridge restricted to site');
console.log('PASS web player bridge: direct URL, timeline, duplicate, unsupported, network, MSE, origin');
