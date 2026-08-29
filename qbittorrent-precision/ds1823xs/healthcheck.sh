#!/bin/sh
set -eu

port="${QBT_WEBUI_PORT:-8080}"
case "$port" in
    ''|*[!0-9]*) exit 1 ;;
esac

status="$(curl --silent --show-error --max-time 3 \
    --output /dev/null \
    --write-out '%{http_code}' \
    "http://127.0.0.1:${port}/")" || exit 1

# Authentication or host-header rejection still proves the qBittorrent HTTP server is alive.
case "$status" in
    2??|3??|401|403) exit 0 ;;
    *) exit 1 ;;
esac

