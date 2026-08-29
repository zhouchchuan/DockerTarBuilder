# PeerBander Beyonder 0.0.2 架构

```text
qBittorrent Precision Web API
           │ 登录、种子、Peer
           ▼
      周期扫描引擎
           │
           ▼
  地址保护 → Allow 规则 → 迅雷识别 → 普通规则
                         │             │
                         ▼             ▼
                    IP:端口封禁      整 IP 封禁
                         │             │
                         └──────┬──────┘
                                ▼
                      qB Precision 封禁列表
```

## 优先级

1. 受保护地址永远不自动封禁。
2. 任意命中的 Allow 规则覆盖其他自动规则。
3. 迅雷内置识别强制使用 Endpoint 封禁。
4. 其余客户端按用户规则执行 `block_ip`、`block_endpoint` 或 `observe`。
5. 同一次扫描中，如果同一 IP 同时出现整 IP 与 Endpoint 决策，整 IP 决策只适用于明确命中的纯吸血规则。

## 数据文件

- `/data/config.json`：qB 连接和扫描设置，权限 0600。
- `/data/rules.json`：匹配规则。
- `/data/events.json`：实际写入封禁列表的事件。

服务写文件时先写临时文件再原子替换，降低意外断电导致配置损坏的风险。
