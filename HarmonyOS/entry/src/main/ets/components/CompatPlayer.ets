import { command } from '../model/Compat';

@Component
export struct CompatPlayer {
  @Prop source: string = '';
  @Prop caPath: string = '';
  @Prop cookies: string = '';
  @Prop startPosition: number = 0;
  @Prop @Watch('requestClose') closeRequest: number = 0;
  onClose: (position: number) => void = () => {};
  onSize: (width: number, height: number) => void = () => {};
  @StorageLink('wuaiForeground') @Watch('foregroundChanged') foreground: boolean = true;
  @State playbackPosition: number = 0;
  @State duration: number = 0;
  @State playing: boolean = false;
  @State waiting: boolean = true;
  @State message: string = '';
  @State subtitle: string = '';
  @State ready: boolean = false;
  @State closing: boolean = false;
  private surface: XComponentController = new XComponentController();
  private token: number = -1;
  private timer: number = -1;
  private polling: boolean = false;
  private disposed: boolean = false;
  private opening?: Promise<void>;
  private initialSeek: boolean = false;
  private previousWidth: number = 0;
  private previousHeight: number = 0;

  async open(): Promise<void> {
    try {
      const result = await command({ op: 'start', surface: this.surface.getXComponentSurfaceId(), url: this.source,
        ca: this.caPath, cookies: this.cookies });
      this.token = result.token ?? -1;
      if (this.disposed || this.closing) {
        await command({ op: 'close', token: this.token }); this.token = -1; return;
      }
      if (!this.foreground) await command({ op: 'pause', token: this.token });
      this.timer = setInterval(() => { this.poll(); }, 300);
    } catch (_) { this.message = '暂时无法播放，请检查网络后重试'; this.waiting = false; }
  }
  async poll(): Promise<void> {
    if (this.polling || this.closing || this.disposed || this.token < 0) return;
    this.polling = true;
    try {
      const s = await command({ op: 'status', token: this.token });
      if (this.closing || this.disposed || s.stale) return;
      this.playbackPosition = s.position ?? 0; this.duration = s.duration ?? 0;
      this.ready = s.ready ?? false; this.playing = s.playing ?? false;
      this.waiting = s.waiting ?? false; this.subtitle = s.subtitle ?? '';
      if (s.error) { this.message = '视频加载失败，可返回网页或重试'; this.waiting = false; }
      else if (s.warning) this.message = '当前音轨无法播放';
      if (this.ready && !this.initialSeek) {
        this.initialSeek = true;
        if (this.startPosition > 0 && this.duration > 0) await command({ op: 'seek', token: this.token, position: this.startPosition });
      }
      if ((s.width ?? 0) > 0 && (s.width !== this.previousWidth || s.height !== this.previousHeight)) {
        this.previousWidth = s.width ?? 0; this.previousHeight = s.height ?? 0;
        this.onSize(this.previousWidth, this.previousHeight);
      }
    } catch (_) { this.message = '播放器暂时不可用，请返回网页重试'; this.waiting = false; }
    finally { this.polling = false; }
  }
  foregroundChanged(): void {
    if (!this.foreground && this.token >= 0) command({ op: 'pause', token: this.token }).catch(() => {});
  }
  async toggle(): Promise<void> {
    if (!this.ready || this.closing) return;
    try {
      if (this.duration > 0 && this.playbackPosition >= this.duration - 100) await command({ op: 'seek', token: this.token, position: 0 });
      await command({ op: this.playing ? 'pause' : 'play', token: this.token });
      await this.poll();
    } catch (_) { this.message = '播放操作失败，请重试'; }
  }
  seek(value: number): void {
    if (this.ready && this.duration > 0) command({ op: 'seek', token: this.token, position: value }).catch(() => {});
  }
  requestClose(): void { this.close(); }
  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true; clearInterval(this.timer);
    if (this.opening) await this.opening;
    try { if (this.token >= 0) await command({ op: 'close', token: this.token }); }
    finally { this.token = -1; this.onClose(this.playbackPosition); }
  }
  aboutToDisappear(): void {
    this.disposed = true; clearInterval(this.timer);
    if (this.token >= 0) command({ op: 'close', token: this.token }).catch(() => {});
  }
  clock(ms: number): string {
    const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }
  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      XComponent({ id: 'wuai-compat', type: XComponentType.SURFACE, controller: this.surface })
        .width('100%').height('100%').onLoad(() => { this.opening = this.open(); })
      if (this.waiting && !this.message) {
        Column({ space: 12 }) {
          LoadingProgress().width(36).height(36).color('#FF294D')
          Text('正在缓冲…').fontColor(Color.White).fontSize(14)
        }.width('100%').height('100%').justifyContent(FlexAlign.Center)
      }
      Column({ space: 12 }) {
        Row() {
          Button(this.closing ? '正在返回…' : '返回网页').onClick(() => { this.close(); }).enabled(!this.closing)
          Blank()
          Text('兼容播放 · AV1').fontColor('#C0D1EE').fontSize(13)
        }
        Blank()
        if (this.message) { Text(this.message).fontColor(Color.White).fontSize(15).backgroundColor('#B0222222').padding(12) }
        if (this.subtitle) { Text(this.subtitle).fontColor(Color.White).fontSize(18).backgroundColor('#99000000').padding(8) }
        Row({ space: 12 }) {
          Button(this.playing ? '暂停' : '播放').onClick(() => { this.toggle(); }).enabled(this.ready && !this.closing)
          Text(this.clock(this.playbackPosition)).fontColor(Color.White).fontSize(12)
          Slider({ value: this.playbackPosition, min: 0, max: Math.max(1, this.duration), step: 1000 })
            .layoutWeight(1).enabled(this.ready && this.duration > 0 && !this.closing)
            .onChange((value: number, mode: SliderChangeMode) => { if (mode === SliderChangeMode.End || mode === SliderChangeMode.Click) this.seek(value); })
          Text(this.duration > 0 ? this.clock(this.duration) : '直播').fontColor(Color.White).fontSize(12)
        }.backgroundColor('#B0000000').padding(8)
      }.padding(18).width('100%').height('100%')
    }.width('100%').height('100%').backgroundColor(Color.Black)
  }
}
