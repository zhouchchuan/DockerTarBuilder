[![GitHub](https://img.shields.io/github/license/wukongdaily/DockerTarBuilder.svg?label=LICENSE&logo=github&logoColor=%20)](https://github.com/wukongdaily/DockerTarBuilder/blob/master/LICENSE)
![GitHub Stars](https://img.shields.io/github/stars/wukongdaily/DockerTarBuilder.svg?style=flat&logo=appveyor&label=Stars&logo=github)
![GitHub Forks](https://img.shields.io/github/forks/wukongdaily/DockerTarBuilder.svg?style=flat&logo=appveyor&label=Forks&logo=github)

## qBittorrent Precision 0.2.0-alpha.1

The `qbittorrent-precision-lsio` branch builds the first qBittorrent Precision release with PeerGuard integrated into qBittorrent/libtorrent instead of running an external high-frequency Web API polling container.

- qBittorrent `5.2.3` official source and libtorrent `v2.0.14`
- LinuxServer.io runtime layout for Synology DS1823xs+ (`linux/amd64`)
- event-driven peer classification at the BitTorrent handshake
- exact `IP+port` blocking for Xunlei, with allow rules for `0.0.1.9` and `0.0.1.8`
- whole-IP blocking for confirmed pure-leecher families such as Gopeed
- dedicated seven-day runtime blocklist that does not repeatedly rewrite the original qBittorrent IP filter
- PeerGuard disabled by default for this alpha; authenticated control API under `/api/v2/peerguard`
- original manual IP and `IP+port` ban behavior, seven-day WebUI login, and batch torrent import retained

## 🤔 这是什么？
它是一个工作流。可快速构建指定架构/平台的docker镜像

## 使用说明
https://wkdaily.cpolar.cn/archives/gc
## 教学视频
https://www.bilibili.com/video/BV1EZ421M7mL
## 解压工具
> Windows 上推荐使用7zip<br>
> macOS 推荐使用MacZip<br>
> Linux上推荐直接用tar 命令

## 相关项目
https://github.com/wukongdaily/OrangePiShell
## 在哪里可以搜索或查询docker镜像的详细信息
### [查询镜像的详细信息 点击这里直达](https://docker.fxxk.dedyn.io/)

