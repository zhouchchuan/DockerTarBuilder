# 吾爱直播 · HarmonyOS 1.0.0

从 iOS 1.0.2 分支 `wuaizhibo-ios-v1.0.2-web`、提交 `870f41521613b30dfa0ff4142dd26f805c486188` 建立独立鸿蒙分支，保留原图标、Logo、启动文案和网页入口。使用 ArkTS / ArkUI / ArkWeb 和 HarmonyOS NDK，不是 Android APK 转包。

- 入口：<https://jiami.ttplays.uk:6067/>
- 包名：`com.chatapp.bqimvip`；版本 1.0.0，versionCode 1000000。
- 最低 HarmonyOS 5.0 / API 12；arm64-v8a；目标测试机 nova 13、HarmonyOS 6.1。
- 工具链：华为官方 command-line-tools 5.0.3.906、Java 17、Linux GitHub Actions，release / unsigned HAP。

## 加载与播放

启动显示原品牌画面至少一秒，页面可见后结束等待，不等待慢速图片加载。仅主文档临时网络错误自动重试两次，间隔 2/5 秒；取消、子资源和过期 URL 错误不弹窗；POST 不自动重放。等待超过 120 秒显示非阻塞提示，原请求继续。保留登录与网页缓存、网页后退及视频横竖屏。

网页默认使用系统 WebView 播放。可见视频提供“兼容播放”入口，网页媒体报解码/格式不支持时自动尝试兼容播放。兼容播放器使用 FFmpeg 8.0.1 + dav1d 1.5.3，实际输出视频与音频，支持暂停、拖动、返回网页、后台暂停；AV1 使用随包附带的软件解码，不依赖手机的 AV1 硬件能力。另包含 H.264/HEVC/VP8/VP9 常用软件解码器。

原生兼容播放支持 HTTPS 直链 MP4/WebM/MKV 和 HTTPS HLS。blob/MSE 仅在页面只有一个视频且近期只有一个明确 HLS 清单时推断地址，避免选错视频。DRM、不可恢复的 blob、多路歧义清单、跨域 iframe、自定义加密协议没有通用接管能力，仍由网页处理。软件 AV1 高分辨率性能、色彩/HDR及实际站点的鉴权策略需要真机验证，不能据云端编译承诺 4K 流畅播放。

HTTPS 使用 OpenSSL 3.5.9，启用证书校验并打包构建环境系统 CA。Cookie 按媒体域读取、附带域限制，未硬编码帐号或签名令牌；不忽略 TLS 错误。CA 与解码依赖需随维护版本更新。

## 构建与安装

推送 `wuaizhibo-harmonyos-v1.0.0` 分支的 `HarmonyOS/` 改动触发 `.github/workflows/wuai-harmony.yml`。下载 Actions 产物中的 `wazb-HarmonyOS-v1.0.0-arm64-unsigned.hap`。工作流校验 SDK/关键依赖 SHA256、运行导航与网页接管测试、真实 AV1 音视频解码、GLES 像素和 TLS 信任测试，并检查 HAP 的 ArkTS 字节码与 ARM64 库。

这是**未签名 HAP**，不能直接点击安装到普通手机。真机安装需在 DevEco Studio 使用华为开发者帐号和包含目标设备的 HarmonyOS 调试签名，或使用正式发布签名。Apple P12 / iOS 描述文件不能用于鸿蒙。仓库和工作流不保存任何私钥、签名密码或设备凭据。最低兼容声明不是已经完成 HarmonyOS 5.0 真机测试的证明。

## 开源组件

原生媒体输出代码复用本工作区 BTMobile HarmonyOS 项目，保留其 MIT 通知。FFmpeg 以 shared library 形式链接，开启 version3 / OpenSSL，禁用 GPL 与 nonfree，适用 LGPLv3；dav1d 为 BSD-2-Clause、OpenSSL 为 Apache-2.0、nlohmann/json 为 MIT。HAP 中包含许可文本，Actions 产物包含对应依赖源码、配置/构建脚本和应用源码，允许按 LGPL 要求修改、重新链接与重新构建。品牌资源沿用用户提供项目，仅供本项目使用。

## 真机验收

1. nova 13 / HarmonyOS 6.1 签名安装，核对图标、启动页、1.0.0、首页和登录保持。
2. 限速、高延迟、断网恢复、快速返回/跳转：页面不因子资源或取消加载弹出“加载失败”，自动重试最多两次，表单不重复提交。
3. H.264 普通网页播放；AV1 8-bit/10-bit、带音轨与无音轨 MP4/WebM、AV1 HLS；验证“兼容播放”、暂停、拖动、横竖屏、返回网页、后台暂停。
4. 站点真实 CDN 的 HTTPS、Cookie/Referer、拖动续播；证书错误必须拒绝。
5. 补充 HarmonyOS 5.0 设备验收和长时间播放温升/耗电测试。当前仓库不声称已完成这些真机检查。
