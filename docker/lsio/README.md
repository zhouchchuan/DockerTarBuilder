# LinuxServer.io Endpoint Alpha

This image keeps the LinuxServer.io qBittorrent container runtime and replaces
only `/app/qbittorrent-nox` with the qBittorrent Precision build.

The retained LinuxServer.io behavior includes:

- s6-overlay service supervision;
- `PUID`, `PGID`, `TZ`, and `UMASK` handling;
- `/config` and `/downloads` volume layout;
- `WEBUI_PORT` and `TORRENTING_PORT` configuration;
- the default accepted legal notice and temporary WebUI password flow.

The DS1823xs+ target is `linux/amd64`. Use a new, empty `/config` directory for
this image because the earlier custom image used a different profile layout.

Version `0.1.1-endpoint-alpha` adds a persistent exact Peer Endpoint blocklist.
The WebUI peer-list action calls the new `transfer/banPeerEndpoints` API and
blocks only the selected `IP:port`; the upstream `transfer/banPeers` IP-wide API
is retained for compatibility. Connections are disconnected from libtorrent's
network thread, and reconnect attempts from the same endpoint remain blocked.

The build runs exact-match tests for IPv4 and IPv6, including the required case
where `1.1.1.1:1234` is blocked while `1.1.1.1:8526` remains allowed.
