# PeerBander Beyonder 0.0.5 架构

```text
多个 qBittorrent Precision Web API
                 │
                 ▼
       周期扫描 + Peer会话累计
                 │
       ┌─────────┴─────────┐
       ▼                   ▼
 图形化静态规则       进度/过度下载检查
       │                   │
       └─────────┬─────────┘
                 ▼
     Allow > 迅雷 Endpoint > 整IP
                 │
                 ▼
       7天活动封禁生命周期
                 │
       到期读取最新qB封禁列表
                 │
       只移除本工具登记的目标
```

## 判断优先级

1. 局域网、回环、链路本地和 CGNAT 地址永不自动封禁。
2. 任意明确 Allow 规则覆盖静态规则、迅雷内置规则和行为规则。
3. 迅雷封禁强制使用 Endpoint；关闭“迅雷反吸血”且未命中用户规则时只观察。
4. 已知吸血签名封禁整 IP。
5. 其他 Peer 在启用行为检查后，过度下载或进度倒退封禁整 IP。

## 持久化

- `/data/config.json`：多下载器、检查、阈值和封禁周期。
- `/data/rules.json`：图形化规则对应的数据。
- `/data/events.json`：封禁与解封时间历史。
- `/data/runtime.json`：Peer会话、客户端流量、近31天IP和未到期封禁。
- `/data/auth.json`：管理员账号、密码盐值与哈希、会话签名密钥；不保存明文密码。

所有文件使用临时文件加原子替换写入。运行数据保留31天 Peer/IP 状态，并在每次扫描时清理过期状态。

## 后台认证

首次打开管理页时创建管理员账号。登录成功后服务器签发只允许同站点访问的 HttpOnly Cookie，有效期7天；未登录请求无法读取后台页面或业务 API。`PBB_ADMIN_TOKEN` 仅作为旧版自动化 API 的兼容入口保留。

## 自动解封

qBittorrent Precision 0.1.3 会在 `app/preferences` 的 `banned_IPs` 中返回 IP 与 Endpoint。到期时 Beyonder 先读取最新列表，只删除自己的活动封禁目标，再通过 `app/setPreferences` 写回，因此不会用旧快照覆盖用户随后手动添加的其他条目。
