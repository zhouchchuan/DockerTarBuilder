import webview from '@ohos.web.webview';
import common from '@ohos.app.ability.common';
import window from '@ohos.window';
import fs from '@ohos.file.fs';
import util from '@ohos.util';
import url from '@ohos.url';
import { Recovery } from '../model/Recovery';
import { WebBridge, WebVideoRequest } from '../model/Compat';
import { CompatPlayer } from '../components/CompatPlayer';

const HOME: string = 'https://jiami.ttplays.uk:6067/';
@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();
  private recovery: Recovery = new Recovery();
  private bridge: WebBridge = new WebBridge((value: string) => { this.openVideo(value); });
  private started: number = Date.now();
  private retryTimer: number = -1;
  private deadline: number = -1;
  private retrying: boolean = false;
  private caPath: string = '';
  private fullScreenHandler?: FullScreenExitHandler;
  private orientationTask: Promise<void> = Promise.resolve();
  @StorageLink('wuaiForeground') @Watch('foregroundChanged') foreground: boolean = true;
  @State scripts: ScriptItem[] = [];
  @State configured: boolean = false;
  @State splash: boolean = true;
  @State banner: string = '';
  @State mediaURL: string = '';
  @State mediaCookies: string = '';
  @State mediaPosition: number = 0;
  @State closeRequest: number = 0;

  aboutToAppear(): void { this.configure(); }
  async configure(): Promise<void> {
    const context = getContext(this) as common.UIAbilityContext;
    try {
      const script = await context.resourceManager.getRawFileContent('web-bridge.js');
      this.scripts = [{ script: new util.TextDecoder('utf-8').decodeWithStream(script), scriptRules: ['https://jiami.ttplays.uk:6067'] }];
      const ca = await context.resourceManager.getRawFileContent('ca.pem');
      this.caPath = context.filesDir + '/wuai-ca.pem';
      const f = fs.openSync(this.caPath, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
      try { fs.writeSync(f.fd, ca.buffer); } finally { fs.closeSync(f); }
    } catch (_) { this.banner = '兼容播放器初始化失败，网页仍可正常使用'; }
    this.configured = true;
  }
  aboutToDisappear(): void { clearTimeout(this.retryTimer); clearTimeout(this.deadline); }
  foregroundChanged(): void {
    try {
      if (this.foreground) this.controller.onActive();
      else { this.controller.runJavaScript('document.querySelectorAll("video,audio").forEach(function(v){v.pause()})').catch(() => {}); this.controller.onInactive(); }
    } catch (_) {}
  }
  orient(landscape: boolean): void {
    this.orientationTask = this.orientationTask.then(async () => {
      const win = await window.getLastWindow(getContext(this) as common.UIAbilityContext);
      await win.setPreferredOrientation(landscape ? window.Orientation.AUTO_ROTATION_LANDSCAPE : window.Orientation.PORTRAIT);
      await win.setWindowKeepScreenOn(this.mediaURL.length > 0 || this.fullScreenHandler !== undefined);
    }).catch(() => {});
  }
  begin(address: string): void {
    clearTimeout(this.retryTimer); clearTimeout(this.deadline);
    this.recovery.begin(address, this.retrying); this.banner = '';
    const generation = this.recovery.generation;
    this.deadline = setTimeout(() => {
      if (generation === this.recovery.generation && !this.recovery.committed && !this.recovery.failed) {
        // Keep a slow request running; never replace an unknown POST with GET.
        this.banner = '网络较慢，仍在加载…'; this.hideSplash();
      }
    }, 120000);
  }
  hideSplash(): void {
    setTimeout(() => { this.splash = false; }, Math.max(0, 1000 - (Date.now() - this.started)));
  }
  visible(address: string): void {
    if (!this.recovery.visible(address)) return;
    clearTimeout(this.deadline); clearTimeout(this.retryTimer); this.retrying = false; this.banner = ''; this.hideSplash();
  }
  fail(address: string, code: number, mainFrame: boolean): void {
    const wait = this.recovery.failure(address, code, mainFrame);
    if (wait < 0) return;
    clearTimeout(this.deadline); this.hideSplash();
    if (wait === 0) { this.banner = '页面暂时无法加载，请检查网络后重试'; return; }
    this.banner = '网络不稳定，正在重新连接…';
    const generation = this.recovery.generation;
    this.retryTimer = setTimeout(() => {
      if (generation !== this.recovery.generation || this.recovery.committed) return;
      this.retrying = true;
      this.controller.loadUrl(address);
    }, wait);
  }
  retry(): void {
    clearTimeout(this.retryTimer);
    // User action may revisit a failed form URL, but must not resubmit its body.
    this.recovery.method = 'GET'; this.retrying = false;
    this.controller.loadUrl(this.recovery.url.startsWith('https://') ? this.recovery.url : HOME);
  }
  openVideo(value: string): void {
    try {
      if (this.mediaURL || !this.caPath || value.length > 12000) return;
      const request = JSON.parse(value) as WebVideoRequest;
      const page = new url.URL(this.controller.getUrl());
      const claimed = new url.URL(request.page);
      const source = new url.URL(request.url);
      if (page.origin !== 'https://jiami.ttplays.uk:6067' || claimed.href !== page.href || source.protocol !== 'https:' || source.username || source.password) return;
      // Domain-scoped FFmpeg cookies are not raw headers, so redirects do not
      // forward a site's session cookie to an unrelated media host.
      let cookies = '';
      const webCookies = webview.WebCookieManager.fetchCookieSync(source.href);
      webCookies.split(';').forEach((part: string) => {
        const pair = part.trim();
        if (pair.includes('=') && !/[\r\n]/.test(pair)) cookies += `${pair}; path=/; domain=${source.hostname}; secure\n`;
      });
      this.mediaCookies = cookies;
      this.mediaPosition = Number.isFinite(request.position) ? Math.max(0, request.position) : 0;
      this.mediaURL = source.href;
      this.controller.runJavaScript('document.querySelectorAll("video,audio").forEach(function(v){v.pause()})').catch(() => {});
      this.orient(false);
    } catch (_) { this.controller.runJavaScript('window.__wuaiReturn && window.__wuaiReturn(0)').catch(() => {}); }
  }
  closeVideo(position: number): void {
    this.mediaURL = ''; this.mediaCookies = ''; this.orient(false);
    this.controller.runJavaScript(`window.__wuaiReturn && window.__wuaiReturn(${Math.max(0, Math.floor(position))})`).catch(() => {});
  }
  onBackPress(): boolean {
    if (this.mediaURL) { this.closeRequest++; return true; }
    if (this.fullScreenHandler) { this.fullScreenHandler.exitFullScreen(); return true; }
    if (this.controller.accessBackward()) { this.controller.backward(); return true; }
    return false;
  }
  build() {
    Stack() {
      if (this.configured) {
        Web({ src: HOME, controller: this.controller })
          .javaScriptAccess(true).domStorageAccess(true).databaseAccess(true)
          .fileAccess(false).mixedMode(MixedMode.None).mediaPlayGestureAccess(true)
          .javaScriptProxy({ object: this.bridge, name: 'WuAiNative', methodList: ['open'], controller: this.controller })
          .javaScriptOnDocumentStart(this.scripts)
          .onLoadIntercept((event) => {
            const request = event.data;
            if (request.isMainFrame()) this.recovery.method = request.getRequestMethod();
            if (request.isMainFrame() && request.isRequestGesture() && !request.isRedirect()) this.retrying = false;
            const address = request.getRequestUrl();
            if (/^(weixin|alipay|alipays):/i.test(address) && request.isMainFrame() && request.isRequestGesture()) {
              (getContext(this) as common.UIAbilityContext).startAbility({ action: 'ohos.want.action.viewData', uri: address }).catch(() => { this.banner = '未找到可打开此链接的应用'; });
              return true;
            }
            return !/^(https?:|about:|blob:)/i.test(address);
          })
          .onPageBegin((event) => { this.begin(event.url); })
          .onPageVisible((event) => { this.visible(event.url); })
          .onErrorReceive((event) => {
            if (event.request.isMainFrame() && event.request.getRequestUrl() === this.recovery.url) this.recovery.method = event.request.getRequestMethod();
            this.fail(event.request.getRequestUrl(), event.error.getErrorCode(), event.request.isMainFrame());
          })
          .onHttpErrorReceive((event) => {
            if (event.request.isMainFrame() && event.response.getResponseCode() >= 500) this.fail(event.request.getRequestUrl(), -2, true);
          })
          .onFullScreenEnter((event) => { this.fullScreenHandler = event.handler; this.orient((event.videoWidth ?? 0) > (event.videoHeight ?? 0)); })
          .onFullScreenExit(() => { this.fullScreenHandler = undefined; this.orient(false); })
          .backgroundColor('#051229').width('100%').height('100%')
      }
      if (this.splash) {
        Column({ space: 12 }) {
          Image($r('app.media.brand_logo')).width(128).height(128).objectFit(ImageFit.Contain).margin({ bottom: 6 })
          Text('吾爱直播').fontSize(30).fontWeight(FontWeight.Bold).fontColor(Color.White)
          Text('精彩内容 · 即刻呈现').fontSize(14).fontColor('#C0D1EE')
          LoadingProgress().width(26).height(26).color('#FF294D').margin({ top: 14 })
          Text('正在加载').fontSize(12).fontColor('#8FA3C2')
        }.width('100%').height('100%').justifyContent(FlexAlign.Center).backgroundColor('#051229')
      }
      if (this.banner) {
        Column() {
          Row({ space: 10 }) {
            Text(this.banner).fontSize(13).fontColor(Color.White).layoutWeight(1)
            Button('重试').fontSize(13).onClick(() => { this.retry(); })
            Button('关闭').fontSize(13).onClick(() => { this.banner = ''; })
          }.padding(12).backgroundColor('#EE202735')
          Blank()
        }.width('100%').height('100%').hitTestBehavior(HitTestMode.Transparent)
      }
      if (this.mediaURL) {
        CompatPlayer({ source: this.mediaURL, caPath: this.caPath, cookies: this.mediaCookies, startPosition: this.mediaPosition,
          closeRequest: this.closeRequest, onClose: (position: number) => { this.closeVideo(position); },
          onSize: (w: number, h: number) => { this.orient(w > h); } })
      }
    }.width('100%').height('100%').backgroundColor('#051229')
  }
}
