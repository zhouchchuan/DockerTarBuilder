# PeerBander Beyonder 0.0.4

面向群晖 DS1823xs+ 的独立 qBittorrent Peer 防护容器。它通过 qBittorrent Web API 读取活动种子和 Peer，并把封禁目标写入 qBittorrent Precision 的封禁列表。

## 0.0.4 功能

- 修复群晖局域网 HTTP 环境下“新增规则”和“添加下载器”按钮无效。
- 整 IP 封禁直接持久化到 qB 的封禁列表，并自动对账、重试旧版假成功记录。

- 支持添加、删除和分别测试多个 qBittorrent 下载器。
- 图形化规则管理：客户端名称、PeerID、IP；支持完全等于、开头、包含、结尾和正则匹配。
- 明确白名单优先级最高；默认允许 `Xunlei 0.0.1.9`、`Xunlei 0.0.1.8`。
- 已知纯吸血客户端和过度下载 Peer 封禁整个 IP；默认包含 `Gopeed dev`、`Gopeed bt-` 等已确认标志。
- 迅雷（客户端名称或 `-XL` PeerID）只封禁当前 `IP:端口`；任何用户规则都不会把迅雷扩大为整 IP 封禁。
- 过度下载检查默认允许10个百分点误差，并允许 Peer 报告进度高于它从本下载器取得的数据比例。
- 进度倒退检查默认允许10个百分点误差。
- 封禁默认7天后自动从对应 qB 列表移除；再次连接并命中规则时重新封禁7天。
- 封禁记录显示下载器、封禁时间、预计解封时间、实际解封时间和行为证据。
- 数据分析显示各客户端获取数据占比，正常/吸血/迅雷 Peer 占比，以及近31天独立公网 IP。
- 配置、规则、记录、Peer会话、统计和未到期封禁均保存在 `/data`。

精准 `IP:端口` 依赖 `/api/v2/transfer/banPeerEndpoints`，必须连接 **qBittorrent Precision 0.1.3 或更高版本**。

## 过度下载判断

使用 qB API 的 Peer `uploaded` 字段，即本下载器实际上传给该 Peer 的字节数：

```text
实际上传比例 = 累计上传给Peer的字节数 / 种子总大小
异常误差     = 实际上传比例 - Peer报告进度
```

达到最低上传量后，只有异常误差大于后台设置的阈值才封禁。默认阈值为10%。例如1GB种子已向 Peer 上传2GB，而它报告50%进度，异常误差为150个百分点，会立即命中。若迅雷报告65%但仅从本下载器取得10%，误差为负数，属于从会员加速或其他 Peer 同时下载的正常情况，不会因行为检查误报。

## 从 0.0.2 升级

继续映射原来的 `/data` 目录即可。首次启动 0.0.3 或更高版本时会自动把旧版单一 `qbittorrent` 连接迁移成“qB下载器 1”，原密码、规则和封禁历史保留，并新增 `runtime.json`。建议升级前备份群晖上的 `/data` 目录。

## 群晖 DS1823xs+ 安装

1. 从 GitHub Actions 下载 `peerbander-beyonder-ds1823xs-0.0.4-amd64` 构建产物并解压 TAR。
2. DSM Container Manager → 映像 → 新增 → 从文件添加，选择 TAR。
3. 新建容器并选择 `host` 网络。
4. 映射群晖目录（例如 `/volume1/docker/peerbander-beyonder`）到容器 `/data`，权限为读写。
5. 可设置 `PBB_WEBUI_PORT=9899`；host 模式不要添加端口映射。
6. 打开 `http://群晖IP:9899`。
7. 在“设置”中添加一个或多个 qB 地址，逐个测试连接，然后保存并启用自动检查。

默认以 UID/GID `1000:1000` 保存持久化文件，可通过 `PUID`、`PGID` 修改。

## 环境变量

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `PBB_WEBUI_PORT` | `9899` | 管理页面监听端口 |
| `PUID` | `1000` | 持久化文件用户 ID |
| `PGID` | `1000` | 持久化文件用户组 ID |
| `PBB_LISTEN_ADDRESS` | `0.0.0.0` | 管理页面监听地址 |
| `PBB_DATA_DIR` | `/data` | 持久化目录 |
| `PBB_ADMIN_TOKEN` | 空 | 可选的 WebUI/API 管理令牌 |
| `PBB_QB_URL` | 空 | 可选；迁移/预设第一个 qB 地址 |
| `PBB_QB_USERNAME` | 空 | 可选；第一个 qB 用户名 |
| `PBB_QB_PASSWORD` | 空 | 可选；第一个 qB 密码 |
| `PBB_SCAN_INTERVAL` | `5` | 扫描间隔（秒） |
| `PBB_ENABLED` | `false` | 启动后立即扫描 |

## 本地测试与构建

项目没有第三方运行依赖：

```bash
npm test
docker build --platform linux/amd64 -t peerbander-beyonder:0.0.4 .
docker save -o peerbander-beyonder-ds1823xs-0.0.4-amd64.tar peerbander-beyonder:0.0.4
```

GitHub 工作流会执行语法检查、单元测试、容器启动和持久化检查，再生成 TAR 与 SHA-256 文件。

## 项目边界

这是独立实现，不复制 PeerBanHelper 的付费功能、商标或界面资源。设计参考其通过下载器 Web API 工作及 Docker host 网络部署的公开方式；行为检测、规则与精准 Endpoint 控制由本项目独立实现。
