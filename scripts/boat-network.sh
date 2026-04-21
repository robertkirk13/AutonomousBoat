#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="${BOAT_NETWORK_CONFIG:-/etc/default/boat-network}"

if [[ -f "$CONFIG_FILE" ]]; then
    if [[ ! -r "$CONFIG_FILE" ]]; then
        printf '==> ERROR: %s is not readable. Run this command with sudo.\n' "$CONFIG_FILE" >&2
        exit 1
    fi
    # shellcheck disable=SC1090
    . "$CONFIG_FILE"
fi

WIFI_CLIENT_IFACE="${WIFI_CLIENT_IFACE:-wlan0}"
WIFI_CLIENT_CONN_NAME="${WIFI_CLIENT_CONN_NAME:-boat-uplink}"
WIFI_CLIENT_SSID="${WIFI_CLIENT_SSID:-}"
WIFI_CLIENT_PASS="${WIFI_CLIENT_PASS:-}"
WIFI_CLIENT_PRIORITY="${WIFI_CLIENT_PRIORITY:-100}"
WIFI_CLIENT_ROUTE_METRIC="${WIFI_CLIENT_ROUTE_METRIC:-200}"

HOTSPOT_CONN_NAME="${HOTSPOT_CONN_NAME:-boat-hotspot}"
HOTSPOT_SSID="${HOTSPOT_SSID:-}"
HOTSPOT_PASS="${HOTSPOT_PASS:-}"
HOTSPOT_VIF_IFACE="${HOTSPOT_VIF_IFACE:-ap0}"
HOTSPOT_BOOT_MODE="${HOTSPOT_BOOT_MODE:-vif-only}"
HOTSPOT_BAND="${HOTSPOT_BAND:-bg}"
HOTSPOT_CHANNEL="${HOTSPOT_CHANNEL:-}"
HOTSPOT_IPV4_CIDR="${HOTSPOT_IPV4_CIDR:-10.43.0.1/24}"

MODEMMANAGER_ENABLE="${MODEMMANAGER_ENABLE:-1}"

UDEV_RULE_PATH="/etc/udev/rules.d/99-eg25g-gps.rules"

log() {
    printf '==> %s\n' "$*"
}

warn() {
    printf '==> WARNING: %s\n' "$*" >&2
}

fail() {
    printf '==> ERROR: %s\n' "$*" >&2
    exit 1
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

ensure_root() {
    [[ "${EUID}" -eq 0 ]] || fail "Run this command with sudo"
}

validate_config() {
    [[ -n "$HOTSPOT_SSID" ]] || fail "HOTSPOT_SSID must be set in $CONFIG_FILE"
    [[ -n "$HOTSPOT_PASS" ]] || fail "HOTSPOT_PASS must be set in $CONFIG_FILE"

    if [[ ${#HOTSPOT_PASS} -lt 8 ]]; then
        fail "HOTSPOT_PASS must be at least 8 characters"
    fi

    if [[ -n "$WIFI_CLIENT_SSID" && -z "$WIFI_CLIENT_PASS" ]]; then
        fail "WIFI_CLIENT_PASS must be set when WIFI_CLIENT_SSID is configured"
    fi
}

write_modemmanager_rule() {
    cat > "$UDEV_RULE_PATH" <<'EOF'
# Quectel EG25-G: let ModemManager manage data while leaving GPS ports alone.
SUBSYSTEM=="tty", KERNEL=="ttyUSB1", ATTRS{idVendor}=="2c7c", ENV{ID_MM_PORT_IGNORE}="1"
SUBSYSTEM=="tty", KERNEL=="ttyUSB2", ATTRS{idVendor}=="2c7c", ENV{ID_MM_PORT_IGNORE}="1"
EOF
}

configure_modemmanager() {
    write_modemmanager_rule
    udevadm control --reload-rules >/dev/null 2>&1 || true
    udevadm trigger --subsystem-match=tty >/dev/null 2>&1 || true

    if [[ "$MODEMMANAGER_ENABLE" == "1" ]]; then
        systemctl enable ModemManager >/dev/null 2>&1 || true
        systemctl restart ModemManager >/dev/null 2>&1 || true
    else
        systemctl stop ModemManager >/dev/null 2>&1 || true
        systemctl disable ModemManager >/dev/null 2>&1 || true
    fi
}

ensure_wifi_client_profile() {
    [[ -n "$WIFI_CLIENT_SSID" ]] || return 0

    if ! nmcli connection show "$WIFI_CLIENT_CONN_NAME" >/dev/null 2>&1; then
        nmcli connection add type wifi \
            ifname "$WIFI_CLIENT_IFACE" \
            con-name "$WIFI_CLIENT_CONN_NAME" \
            ssid "$WIFI_CLIENT_SSID" >/dev/null
    fi

    nmcli connection modify "$WIFI_CLIENT_CONN_NAME" \
        connection.interface-name "$WIFI_CLIENT_IFACE" \
        connection.autoconnect yes \
        connection.autoconnect-priority "$WIFI_CLIENT_PRIORITY" \
        802-11-wireless-security.key-mgmt wpa-psk \
        802-11-wireless-security.psk "$WIFI_CLIENT_PASS" \
        802-11-wireless.powersave 2 \
        ipv4.route-metric "$WIFI_CLIENT_ROUTE_METRIC" \
        ipv6.route-metric "$WIFI_CLIENT_ROUTE_METRIC" >/dev/null
}

hotspot_iface_for_mode() {
    case "${1:-$HOTSPOT_BOOT_MODE}" in
        vif-only|vif)
            printf '%s\n' "$HOTSPOT_VIF_IFACE"
            ;;
        takeover)
            printf '%s\n' "$WIFI_CLIENT_IFACE"
            ;;
        *)
            fail "Unsupported hotspot mode: ${1:-$HOTSPOT_BOOT_MODE}"
            ;;
    esac
}

ensure_hotspot_profile() {
    local mode="${1:-$HOTSPOT_BOOT_MODE}"
    local iface
    iface="$(hotspot_iface_for_mode "$mode")"

    if ! nmcli connection show "$HOTSPOT_CONN_NAME" >/dev/null 2>&1; then
        nmcli connection add type wifi \
            ifname "$iface" \
            con-name "$HOTSPOT_CONN_NAME" \
            ssid "$HOTSPOT_SSID" >/dev/null
    fi

    nmcli connection modify "$HOTSPOT_CONN_NAME" \
        connection.interface-name "$iface" \
        connection.autoconnect no \
        802-11-wireless.mode ap \
        802-11-wireless.band "$HOTSPOT_BAND" \
        802-11-wireless-security.key-mgmt wpa-psk \
        802-11-wireless-security.psk "$HOTSPOT_PASS" \
        ipv4.method shared \
        ipv4.addresses "$HOTSPOT_IPV4_CIDR" \
        ipv6.method disabled >/dev/null

    if [[ -n "$HOTSPOT_CHANNEL" ]]; then
        nmcli connection modify "$HOTSPOT_CONN_NAME" 802-11-wireless.channel "$HOTSPOT_CHANNEL" >/dev/null
    fi
}

wifi_phy() {
    iw dev "$WIFI_CLIENT_IFACE" info | awk '/wiphy/ { print "phy" $2; exit }'
}

ensure_hotspot_vif() {
    if [[ "$HOTSPOT_VIF_IFACE" == "$WIFI_CLIENT_IFACE" ]]; then
        fail "HOTSPOT_VIF_IFACE must differ from WIFI_CLIENT_IFACE when using vif-only mode"
    fi

    if iw dev "$HOTSPOT_VIF_IFACE" info >/dev/null 2>&1; then
        return 0
    fi

    local phy
    local err_file
    phy="$(wifi_phy)"
    [[ -n "$phy" ]] || fail "Could not determine Wi-Fi phy for $WIFI_CLIENT_IFACE"
    err_file="$(mktemp)"

    if ! iw phy "$phy" interface add "$HOTSPOT_VIF_IFACE" type __ap 2>"$err_file"; then
        warn "Could not create AP interface $HOTSPOT_VIF_IFACE: $(tr '\n' ' ' <"$err_file")"
        rm -f "$err_file"
        return 1
    fi

    rm -f "$err_file"
    ip link set "$HOTSPOT_VIF_IFACE" up >/dev/null 2>&1 || true
    nmcli device set "$HOTSPOT_VIF_IFACE" managed yes >/dev/null 2>&1 || true
}

delete_hotspot_vif() {
    [[ "$HOTSPOT_VIF_IFACE" == "$WIFI_CLIENT_IFACE" ]] && return 0
    iw dev "$HOTSPOT_VIF_IFACE" del >/dev/null 2>&1 || true
}

start_hotspot() {
    local mode="${1:-$HOTSPOT_BOOT_MODE}"

    case "$mode" in
        vif-only|vif)
            if ! ensure_hotspot_vif; then
                warn "Leaving hotspot down because this radio cannot keep the AP on a separate interface"
                return 0
            fi
            ensure_hotspot_profile vif-only
            nmcli connection up "$HOTSPOT_CONN_NAME" ifname "$HOTSPOT_VIF_IFACE" >/dev/null
            ;;
        takeover)
            ensure_hotspot_profile takeover
            nmcli device disconnect "$WIFI_CLIENT_IFACE" >/dev/null 2>&1 || true
            nmcli connection up "$HOTSPOT_CONN_NAME" ifname "$WIFI_CLIENT_IFACE" >/dev/null
            ;;
        *)
            fail "Unsupported hotspot mode: $mode"
            ;;
    esac
}

stop_hotspot() {
    nmcli connection down "$HOTSPOT_CONN_NAME" >/dev/null 2>&1 || true
    delete_hotspot_vif
}

show_status() {
    printf 'Config file: %s\n' "$CONFIG_FILE"
    printf 'Client Wi-Fi: %s (%s)\n' "${WIFI_CLIENT_SSID:-disabled}" "$WIFI_CLIENT_IFACE"
    printf 'Hotspot: %s (%s)\n' "$HOTSPOT_SSID" "$HOTSPOT_VIF_IFACE"
    printf 'Hotspot boot mode: %s\n' "$HOTSPOT_BOOT_MODE"
    printf '\nNetworkManager devices:\n'
    nmcli -t -f DEVICE,TYPE,STATE,CONNECTION device status || true
    printf '\nActive connections:\n'
    nmcli -t -f NAME,TYPE,DEVICE connection show --active || true
}

install_profiles() {
    ensure_root
    require_cmd nmcli
    require_cmd iw
    require_cmd ip
    validate_config

    configure_modemmanager
    ensure_wifi_client_profile
    ensure_hotspot_profile "$HOTSPOT_BOOT_MODE"

    log "Network profiles updated"
}

usage() {
    cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  install                 Write ModemManager GPS rules and ensure NM profiles
  hotspot-up [mode]       Start hotspot in 'vif-only' or 'takeover' mode
  hotspot-down            Stop hotspot and remove the AP virtual interface
  status                  Show current config and active NM state
EOF
}

main() {
    local cmd="${1:-}"
    case "$cmd" in
        install)
            install_profiles
            ;;
        hotspot-up)
            ensure_root
            require_cmd nmcli
            require_cmd iw
            require_cmd ip
            validate_config
            start_hotspot "${2:-$HOTSPOT_BOOT_MODE}"
            ;;
        hotspot-down)
            ensure_root
            require_cmd nmcli
            require_cmd iw
            stop_hotspot
            ;;
        status)
            require_cmd nmcli
            show_status
            ;;
        ""|-h|--help|help)
            usage
            ;;
        *)
            usage
            fail "Unknown command: $cmd"
            ;;
    esac
}

main "$@"
