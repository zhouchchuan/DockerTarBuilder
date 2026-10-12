# 吾爱直播 iOS 1.0.3（Build 4）

以纯网页封装版 1.0.2 Build 3 为基线，提交为 `870f41521613b30dfa0ff4142dd26f805c486188`。入口 https://jiami.ttplays.uk:6067/ ，包名 `com.chatapp.bqimvip`，最低 iOS 16.0，iPhone arm64。保持 UIKit + WKWebView，无第三方播放器。

## 本次故障与修复范围

用户报告：iOS 26.1 / AirPods Pro 3，耳机始终戴着，视频却出现类似摘耳或重新戴入时的暂停，偶尔浮现 AirPods 图标；酷狗音乐播放正常。上述现象不能单独证明蓝牙物理断连。1.0.2 没有处理音频路由变化及网页视频恢复。

1.0.3 将音频会话配置为 playback / moviePlayback，播放时激活；不申请麦克风，不切换 HFP 通话模式，不强制输出到扬声器。

当系统实际通知蓝牙音频输出丢失，或 iOS 17+ 明确报告 routeDisconnected 中断时，记录此前正在播放的同一个网页视频。若 12 秒内同一蓝牙输出标识恢复，路由稳定 0.8 秒后，前台最多尝试续播一次。兼容网页 pause 比系统路由通知先到的 0.75 秒时序窗口。断开期间保持暂停，续播不刷新页面、不重新加载视频、不修改播放进度。

任何用户交互、显式 pause()、注册的耳机暂停指令、后续不明原因暂停、来电/Siri/不明中断、进入后台、页面/视频变化或等待超时，都取消待续播任务。播放被 WebKit 拒绝时不循环强制播放。单独的网页暂停不会触发恢复，不能仅凭 AirPods 图标认定断连。

音频桥接仅对入口同源的 HTTPS 页面和同源 iframe 生效；第三方跨域播放器仍由其自身处理。未确认的系统事件、原生耳机佩戴检测和 WebKit 独立媒体进程行为需要真实设备进一步验证。不能以构建通过代替故障已在 iOS 26.1 / AirPods Pro 3 上消失。

## 保留的行为

- 原启动逻辑、至少 1 秒的品牌过渡画面、桌面图标、Logo、编译后的 LaunchScreen/品牌素材。
- Cookie、登录存储、输入框缩放修复、横竖屏网页桥接、外部跳转。
- 1.0.2 的 -999 取消事件过滤、120 秒主请求超时、GET/HEAD 最多 2 次弱网重试、非模态失败提示和不自动重放 POST。
- 未加入后台播放权限或改变网站的播放内容。

## 构建与验证

GitHub Actions：分支 `wuaizhibo-ios-v1.0.3-web`，macos-15 / Xcode 16.4，Release / iphoneos / arm64。

`bash build-release.sh` 依次运行原弱网策略测试、Swift 音频恢复策略测试、Node 网页桥接测试，再执行 Xcode 编译。打包前逐字节核对 PreservedResources，并检查版本、包名、音频脚本和无签名描述文件。

按用户此前明确选择，本版只生成未签名 IPA；工作流不读取任何签名 Secrets，不包含证书、密码、私钥或 mobileprovision。安装前需要另行签名；同包名覆盖和数据保留也取决于实际签名身份。

## iOS 26.1 / AirPods Pro 3 真机验收（待执行）

| 场景 | 预期 |
| --- | --- |
| 耳机一直佩戴，连续播放至少 30 分钟，记录浮现图标时刻 | 检查异常暂停是否仍发生；不能仅凭图标判断路由变化 |
| 实际短暂断开同一耳机，12 秒内重连 | 丢失期间不外放，恢复后当前视频最多自动续播一次 |
| 超过 12 秒、换另一耳机、改为扬声器或有线耳机 | 保持暂停，由用户继续 |
| 按页面暂停、耳机按键暂停，或恢复等待中操作页面 | 不强制续播 |
| 来电、Siri、切换到其他 App、锁屏 | 不触发本修复的自动续播 |
| 切集、跳页、后退、重新加载 iframe、视频结束 | 不恢复旧视频 |
| 横竖屏/全屏、快进、音量、弱网缓冲和登录 | 保留基线行为 |
| 与 1.0.2 在同一手机/耳机/网络下对照 | 记录是否仍暂停、发生时间和当时操作 |

若仍出现问题，系统日志类别 `com.chatapp.bqimvip / AudioRecovery` 会记录路由原因代码、是否蓝牙输出、中断类别、暂停和续播结果。仅写本机系统日志，不收集视频地址、账号、Cookie、耳机名称或 UID，不上传数据。日志用于区分实际路由变化、系统中断和没有原生事件的网页暂停。

## API 依据

- [Apple：处理音频路由变化](https://developer.apple.com/documentation/avfaudio/responding-to-audio-route-changes)：输出丢失时应暂停，避免外放。
- [Apple：routeDisconnected 中断](https://developer.apple.com/documentation/avfaudio/avaudiosession/interruptionreason/routedisconnected)。
- [Apple：iOS 17 起的断连中断机制](https://developer.apple.com/documentation/avfaudio/avaudiosession/setprefersinterruptiononroutedisconnect(_:))：保留系统默认，不全局关闭断连保护。
