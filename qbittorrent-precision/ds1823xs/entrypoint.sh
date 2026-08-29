#!/bin/sh
set -eu

downloads_path="/downloads"
profile_path="/config"
config_file="${profile_path}/qBittorrent/config/qBittorrent.conf"

fail() {
    echo "qBittorrent Precision: $*" >&2
    exit 1
}

validate_id() {
    name="$1"
    value="$2"
    case "$value" in
        ''|*[!0-9]*) fail "${name} must be a positive numeric ID" ;;
    esac
    [ "$value" -gt 0 ] || fail "${name} must be greater than zero"
}

verify_writable() {
    path="$1"
    probe="${path}/.precision-write-test.$$"
    : > "$probe" 2>/dev/null || fail "${path} is not writable by the configured container user"
    rm -f "$probe"
}

is_root=0
[ "$(id -u)" -eq 0 ] && is_root=1

if [ "$is_root" -eq 1 ]; then
    puid="${PUID:-1000}"
    pgid="${PGID:-1000}"
    validate_id PUID "$puid"
    validate_id PGID "$pgid"

    sed -i "s/^qbtUser:x:[0-9]*:/qbtUser:x:${pgid}:/" /etc/group
    sed -i "s/^qbtUser:x:[0-9]*:[0-9]*:/qbtUser:x:${puid}:${pgid}:/" /etc/passwd

    if [ -n "${PAGID:-}" ]; then
        old_ifs="$IFS"
        IFS=','
        for additional_gid in $PAGID; do
            additional_gid="$(echo "$additional_gid" | tr -d '[:space:]\"')"
            validate_id PAGID "$additional_gid"
            group_name="$(awk -F: -v gid="$additional_gid" '$3 == gid { print $1; exit }' /etc/group)"
            if [ -z "$group_name" ]; then
                group_name="qbtGroup-${additional_gid}"
                addgroup -g "$additional_gid" "$group_name"
            fi
            addgroup qbtUser "$group_name" >/dev/null 2>&1 || true
        done
        IFS="$old_ifs"
    fi

    mkdir -p "$profile_path" "$downloads_path"
    chown -R qbtUser:qbtUser "$profile_path"
    # Avoid a potentially destructive recursive ownership change of existing downloads.
    chown qbtUser:qbtUser "$downloads_path"
fi

mkdir -p "$(dirname "$config_file")"

if [ ! -f "$config_file" ]; then
    cat > "$config_file" <<EOF
[BitTorrent]
Session\DefaultSavePath=${downloads_path}
Session\Port=6881
Session\TempPath=${downloads_path}/temp
Session\TempPathEnabled=true
[Meta]
MigrationVersion=9999
[Preferences]
WebUI\Port=8080
EOF
fi

if [ "$is_root" -eq 1 ]; then
    chown -R qbtUser:qbtUser "$profile_path"
    doas -u qbtUser /bin/sh -c "test -w '$profile_path' && test -w '$downloads_path'" \
        || fail "mounted directories do not permit writes by PUID=${puid}, PGID=${pgid}"
else
    verify_writable "$profile_path"
    verify_writable "$downloads_path"
fi

if [ -n "${UMASK:-}" ]; then
    umask "$UMASK"
fi

run_qbittorrent() {
    # Function arguments are the optional arguments supplied after the image name.
    set -- qbittorrent-nox --profile="$profile_path" "$@"

    legal_notice="$(echo "${QBT_LEGAL_NOTICE:-}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
    if [ "$legal_notice" = "confirm" ]; then
        set -- "$@" --confirm-legal-notice
    fi

    if [ -n "${QBT_TORRENTING_PORT:-}" ]; then
        set -- "$@" --torrenting-port="$QBT_TORRENTING_PORT"
    fi

    if [ -n "${QBT_WEBUI_PORT:-}" ]; then
        set -- "$@" --webui-port="$QBT_WEBUI_PORT"
    fi

    if [ "$is_root" -eq 1 ]; then
        exec doas -u qbtUser "$@"
    else
        exec "$@"
    fi
}

run_qbittorrent "$@"

