# LinuxServer.io runtime baseline

This image keeps the LinuxServer.io qBittorrent container runtime and replaces
only `/app/qbittorrent-nox` with the qBittorrent Precision build.

The retained LinuxServer.io behavior includes:

- s6-overlay service supervision;
- `PUID`, `PGID`, `TZ`, and `UMASK` handling;
- `/config` and `/downloads` volume layout;
- `WEBUI_PORT` and `TORRENTING_PORT` configuration;
- the default accepted legal notice and temporary WebUI password flow.

The DS1823xs+ target is `linux/amd64`. Use a new, empty `/config` directory for
this baseline because the earlier custom image used a different profile layout.

This baseline intentionally contains no PeerGuard enforcement. Its purpose is
to prove the LinuxServer.io runtime, host networking, WebUI, storage permissions,
download, and seeding behavior before the Endpoint control patch is added.


