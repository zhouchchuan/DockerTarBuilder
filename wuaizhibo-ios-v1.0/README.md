# 吾爱直播 iOS 1.0.4（Build 5）

基于 1.0.3 Build 4（提交 `47ee585da1f5382905f674f102caf3b9b90b4742`）。入口 https://jiami.ttplays.uk:6067/ ，包名 `com.chatapp.bqimvip`，最低 iOS 16.0，iPhone arm64。UIKit + WKWebView 网址封装，保留原启动画面、图标和 Logo。

## 故障证据与处理

服务器更换 IP 后，用户报告 App 点击选集不能切换，顶部提示网络较慢；同一入口在 Safari 可正常选集。站点的多个域名共用目录。录屏展示 Safari 可以切集，截图展示客户端失败栏；尚未取得旧版的具体导航错误码，也未在用户登录后的会员页面复现。缓存或旧连接是待验证的原因，不能仅凭更换 IP 认定根因。

1. 覆盖安装后的第一次启动，先清理本 App 的 WebKit 内存/磁盘网页缓存、Fetch 缓存及 Service Worker 注册，再打开入口。清理完成才记录版本迁移标记，后续启动不重复清理。保留 Cookie、localStorage、sessionStorage、IndexedDB；服务端会话是否有效仍由网站决定。
2. 首页及原生重试使用忽略本地缓存的请求；点击错误栏“重试”时先清理同样的缓存再重新请求失败页面。自动弱网重试仍最多两次，POST 等提交不自动重放。不修改域名、不硬编码服务器 IP、不绕过 TLS。
3. 网页 javascript:、blob:、data: 等交给 WebKit；仅已支持的电话、微信、支付宝等外部协议交给系统。新窗口使用 WebKit 提供的配置创建独立网页，保留 opener、原导航上下文，避免取消后重新发起请求；新页面上方可关闭返回。
4. 过滤 -999 取消事件和 WebKit 策略交接的 102 事件，避免误报网络故障。真正失败时显示错误类别和数字代码；本机 Navigation 日志只记录错误类别/代码，不记录登录信息或视频链接。

这不是系统 DNS 缓存刷新功能。系统和 WebKit 网络进程的 DNS、持久连接不能由公开 API 保证清除；若覆盖后仍失败，使用错误代码继续定位，而不是断言缓存已解决。

## 保留与版本记录

- 原品牌启动逻辑、至少一秒过渡画面、桌面图标、Logo 和编译后的 LaunchScreen 资源。
- 输入框缩放修复、横竖屏/全屏桥接、Cookie 与登录存储。
- 1.0.2：忽略 -999、120 秒原生主请求超时、GET/HEAD 有限重试及非模态错误栏。
- 1.0.3：蓝牙音频路由处理保持原代码。用户后续确认关闭 AirPods 自动入耳检测后不再暂停；本次不增加强制续播行为。

## GitHub 构建

分支 `wuaizhibo-ios-v1.0.4-web`，macos-15 / Xcode 16.4，Release / iphoneos / arm64。执行 `bash build-release.sh`，依次运行导航恢复、音频恢复、网页音频脚本测试，以及 macOS WebKit 缓存/跳转测试，再编译 iOS 应用。逐字节核对原品牌素材，校验版本、包名及无签名描述文件后输出 IPA。

WebKit 测试覆盖真实 Cookie 和 localStorage 在清缓存后保留、迁移仅执行一次、手动重试再次清理、脚本选集和新窗口 opener。macOS 测试不等于 iPhone 的 UIKit 界面或会员视频页面验收。

按用户选择，仅构建未签名 IPA，不上传或读取签名证书、密码和 Secrets。安装前使用与现有 1.0.3 相兼容的签名身份签名，并保持包名不变，才能覆盖保留旧数据。如果安装工具提示必须卸载，先停止，不要删除旧 App。

## 覆盖升级验收（真机待执行）

1. 保留手机上的 1.0.3，记录当前选集失败状态；签名 1.0.4 后直接覆盖安装，不先卸载。
2. 确认版本 1.0.4；首次启动等待网页加载，检查图标、启动 Logo、登录状态。
3. 打开原来出错的同一视频，依次点击 01 → 02 → 03 → 05，确认播放内容或时长确实切换，不能只看按钮变色。
4. 连续快速切换、返回再进入，测试原入口及网站内部跳转；新窗口关闭后能返回原页面。
5. 退出并再次启动，检查选集和登录；测试横竖屏、全屏和播放暂停。
6. 短暂断网后恢复，再点击“重试”，确认不会无限刷新；如果仍失败，保留错误栏完整数字代码和发生时刻。

验收成功只能说明新版在该场景恢复正常；由于同时调整缓存与跳转，不能单凭覆盖成功确定唯一根因。

## 公开 API 依据

- [Apple：WKWebsiteDataStore.removeData](https://developer.apple.com/documentation/webkit/wkwebsitedatastore/removedata(oftypes:modifiedsince:completionhandler:))
- [Apple：WebKit 网页缓存类型](https://developer.apple.com/documentation/webkit/wkwebsitedatatypediskcache)
- [WebKit：WKUIDelegate 新窗口配置契约](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKUIDelegate.h)
