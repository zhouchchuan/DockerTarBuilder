#!/bin/sh
set -eu

data_dir="${PBB_DATA_DIR:-/data}"
run_uid="${PUID:-1000}"
run_gid="${PGID:-1000}"

mkdir -p "$data_dir"

if [ "$(id -u)" = "0" ]; then
  if [ "${PBB_SKIP_CHOWN:-0}" != "1" ]; then
    chown -R "$run_uid:$run_gid" "$data_dir"
  fi
  exec su-exec "$run_uid:$run_gid" node src/server.js
fi

exec node src/server.js

