# qBittorrent Precision V0.1.0 Base for Synology DS1823xs+

This directory builds an importable Docker image TAR specifically for Synology DS1823xs+.

- Platform: `linux/amd64`
- qBittorrent: `5.2.3`
- libtorrent: `1.2.20`
- Precision milestone: `0.1.0-base`

The GitHub Actions workflow builds the image, loads the exported TAR back into Docker, verifies the image architecture and qBittorrent version, creates a SHA-256 checksum, and uploads both files as one artifact.

Download the artifact named `qbittorrent-precision-ds1823xs-0.1.0-base-amd64`, unzip it, and import the contained `.tar` through Synology Container Manager → Image → Add From File.

