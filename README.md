# PeerBander Beyonder 0.0.2

面向群晖 DS1823xs+ 的独立 qBittorrent Peer 防护容器。它通过 qBittorrent Web API 读取活动种子和 Peer，按规则将封禁目标写入 qBittorrent Precision 的封禁列表。

## 0.0.2 的封禁原则

0.0.2 新增 qB 登录兼容：同时接受 HTTP 200/204、会话 Cookie，以及 qB 的本机/子网免认证模式。

- 明确白名单优先级最高；默认允许 `Xunlei 0.0.1.9`、`Xunlei 0.0.1.8`。
- 迅雷（客户端名称或 `-XL` PeerID）：只封禁当前 `IP:端口`。
- 已知纯吸血客户端：封禁整个 IP。初始规则包含截图中的 `-hp`、`-xm`、`-dt`、`-sd`、`-rn0.0.0` 及对应客户端名称。
- 正常或未知客户端：只观察，不自动封禁。
- 局域网、回环、链路本地、CGNAT 等地址：内置保护，不自动封禁。
- 自动检查默认关闭，必须由用户在 WebUI 中主动启用。

> 精准 `IP:端口` 写入使用 `/api/v2/transfer/banPeerEndpoints`，因此必须连接 **qBittorrent Precision 0.1.3 或更高版本**。它不会在接口缺失时降级为整 IP 封禁。

## 群晖 DS1823xs+ 安装

1. 从 GitHub Actions 的 `peerbander-beyonder-ds1823xs-0.0.2-amd64` 构建产物下载 TAR。
2. DSM Container Manager → 映像 → 新增 → 从文件添加，选择 TAR。
3. 新建容器并选择 `host` 网络。
4. 映射群晖目录（例如 `/volume1/docker/peerbander-beyonder`）到容器 `/data`，权限为读写。默认以 UID/GID `1000:1000` 保存文件，可通过 `PUID`、`PGID` 修改。
5. 可设置 `PBB_WEBUI_PORT=9899`。不要在 host 网络模式中添加端口映射。
6. 启动后打开 `http://群晖IP:9899`。
7. 在“设置”中填写 qBittorrent Precision WebUI 地址、用户名和密码，先点击“测试 qB 连接”。
8. 确认连接成功后再开启“启用自动检查”。

配置、规则和封禁记录均保存在 `/data`，更新或重建容器不会丢失。

## 环境变量

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `PBB_WEBUI_PORT` | `9899` | 管理页面监听端口 |
| `PUID` | `1000` | 持久化文件所属用户 ID |
| `PGID` | `1000` | 持久化文件所属用户组 ID |
| `PBB_LISTEN_ADDRESS` | `0.0.0.0` | 管理页面监听地址 |
| `PBB_DATA_DIR` | `/data` | 持久化数据目录 |
| `PBB_ADMIN_TOKEN` | 空 | 可选的 WebUI/API 管理令牌 |
| `PBB_QB_URL` | 空 | 可选；通过环境变量预设 qB 地址 |
| `PBB_QB_USERNAME` | 空 | 可选；通过环境变量预设用户名 |
| `PBB_QB_PASSWORD` | 空 | 可选；通过环境变量预设密码 |
| `PBB_SCAN_INTERVAL` | `5` | 扫描间隔，单位秒 |
| `PBB_ENABLED` | `false` | 是否启动后立即扫描 |

## 本地测试与构建

项目没有第三方运行依赖：

```bash
npm test
docker build --platform linux/amd64 -t peerbander-beyonder:0.0.2 .
docker save -o peerbander-beyonder-ds1823xs-0.0.2-amd64.tar peerbander-beyonder:0.0.2
```

GitHub 工作流会自动执行语法检查、单元测试、容器启动与持久化检查，再生成 TAR 和 SHA-256 文件。

## 项目边界

这是独立实现，不复制 PeerBanHelper 的付费功能、商标或界面资源。设计参考其通过下载器 Web API 工作及 Docker host 网络部署的公开方式；规则与精准 Endpoint 行为由本项目独立实现。
