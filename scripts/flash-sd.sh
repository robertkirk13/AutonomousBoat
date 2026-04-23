#!/usr/bin/env bash
#
# flash-sd.sh — Flash an SD card with headless Raspberry Pi OS for BoatCore V1.0
#
# Usage:
#   ./scripts/flash-sd.sh [options]
#
# Options:
#   -d DISK       Target disk (e.g. disk4). Auto-detected if only one removable disk.
#   -n HOSTNAME   Pi hostname (default: castaway)
#   -u USER       Pi username (default: chuck)
#   -p PASSWORD   Pi password (default: prompt)
#   -s SSID       WiFi SSID (default: prompt)
#   -w WIFIPASS   WiFi password (default: prompt)
#   -S HOTSPOT    Hotspot SSID (default: <hostname>-setup)
#   -W HOTPASS    Hotspot password (default: auto-generated)
#   -A ASSETDIR   Use pre-staged provisioning assets from this directory
#   -i IMAGE      Path to .img or .img.xz file (default: downloads latest Pi OS Lite 64-bit)
#   -y            Skip the destructive confirmation prompt
#   -h            Show this help
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Defaults
HOSTNAME="castaway"
USERNAME="chuck"
PASSWORD=""
WIFI_SSID=""
WIFI_PASS=""
HOTSPOT_SSID=""
HOTSPOT_PASS=""
ASSET_DIR=""
IMAGE=""
DISK=""
AUTO_CONFIRM=0
TEMP_ASSET_DIR=""

usage() {
    sed -n '3,18p' "$0" | sed 's/^# \?//'
    exit 0
}

while getopts "d:n:u:p:s:w:S:W:A:i:yh" opt; do
    case $opt in
        d) DISK="$OPTARG" ;;
        n) HOSTNAME="$OPTARG" ;;
        u) USERNAME="$OPTARG" ;;
        p) PASSWORD="$OPTARG" ;;
        s) WIFI_SSID="$OPTARG" ;;
        w) WIFI_PASS="$OPTARG" ;;
        S) HOTSPOT_SSID="$OPTARG" ;;
        W) HOTSPOT_PASS="$OPTARG" ;;
        A) ASSET_DIR="$OPTARG" ;;
        i) IMAGE="$OPTARG" ;;
        y) AUTO_CONFIRM=1 ;;
        h) usage ;;
        *) usage ;;
    esac
done

# -- Colors --
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}==> ${NC}$*"; }
ok()    { echo -e "${GREEN}==> ${NC}$*"; }
warn()  { echo -e "${YELLOW}==> ${NC}$*"; }
fail()  { echo -e "${RED}==> ERROR: ${NC}$*"; exit 1; }

escape_sed_replacement() {
    printf '%s' "$1" | sed -e 's/[\\/&|]/\\&/g'
}

quote_for_shell() {
    printf '%q' "$1"
}

cleanup() {
    if [[ -n "${TEMP_ASSET_DIR:-}" && -d "${TEMP_ASSET_DIR:-}" ]]; then
        rm -rf "$TEMP_ASSET_DIR"
    fi
}

trap cleanup EXIT

prepare_assets() {
    local helper
    helper="$SCRIPT_DIR/prepare-provisioning-assets.sh"

    if [[ -n "$ASSET_DIR" ]]; then
        [[ -d "$ASSET_DIR" ]] || fail "Asset directory not found: $ASSET_DIR"
    else
        TEMP_ASSET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/boat-assets.XXXXXX")"
        info "Preparing provisioning assets"
        "$helper" -o "$TEMP_ASSET_DIR"
        ASSET_DIR="$TEMP_ASSET_DIR"
    fi

    [[ -f "$ASSET_DIR/repo-bundle.tar.gz" ]] || fail "Missing repo-bundle.tar.gz in $ASSET_DIR"
    [[ -f "$ASSET_DIR/boat-firmware" ]] || fail "Missing boat-firmware in $ASSET_DIR"
    [[ -f "$ASSET_DIR/mqtt.env" ]] || fail "Missing mqtt.env in $ASSET_DIR"
}

# -- Prompt for missing values --
if [[ -z "$PASSWORD" ]]; then
    read -rsp "Password for user '$USERNAME' on the Pi: " PASSWORD
    echo
    [[ -n "$PASSWORD" ]] || fail "Password cannot be empty"
fi

if [[ -z "$WIFI_SSID" ]]; then
    read -rp "WiFi SSID (leave blank to skip client WiFi): " WIFI_SSID
fi

if [[ -n "$WIFI_SSID" && -z "$WIFI_PASS" ]]; then
    read -rsp "WiFi password: " WIFI_PASS
    echo
    [[ -n "$WIFI_PASS" ]] || fail "WiFi password cannot be empty"
fi

if [[ -z "$HOTSPOT_SSID" ]]; then
    HOTSPOT_SSID="${HOSTNAME}-setup"
fi

if [[ -z "$HOTSPOT_PASS" ]]; then
    HOTSPOT_PASS="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | cut -c1-12)"
fi

[[ ${#HOTSPOT_PASS} -ge 8 ]] || fail "Hotspot password must be at least 8 characters"

# -- Detect or validate target disk --
if [[ "$(uname)" != "Darwin" ]]; then
    fail "This script is written for macOS. For Linux, adapt the diskutil commands."
fi

if [[ -z "$DISK" ]]; then
    # Auto-detect: find removable external disks
    REMOVABLE_DISKS=()
    while IFS= read -r line; do
        REMOVABLE_DISKS+=("$line")
    done < <(diskutil list external physical 2>/dev/null | grep -oE '/dev/disk[0-9]+' | sort -u | sed 's|/dev/||')

    if [[ ${#REMOVABLE_DISKS[@]} -eq 0 ]]; then
        fail "No removable disks found. Insert an SD card and retry, or specify with -d"
    elif [[ ${#REMOVABLE_DISKS[@]} -eq 1 ]]; then
        DISK="${REMOVABLE_DISKS[0]}"
        info "Auto-detected SD card: /dev/$DISK"
    else
        echo "Multiple removable disks found:"
        for d in "${REMOVABLE_DISKS[@]}"; do
            diskutil info "/dev/$d" 2>/dev/null | grep -E '(Device / Media Name|Disk Size)' | sed "s/^/  $d: /"
        done
        read -rp "Enter disk name (e.g. disk4): " DISK
    fi
fi

DISK="${DISK#/dev/}"  # strip /dev/ prefix if provided
RDISK="/dev/r${DISK}" # raw device for faster writes
DEVICE="/dev/${DISK}"

# Sanity checks
[[ -e "$DEVICE" ]] || fail "Disk $DEVICE does not exist"
[[ "$DISK" != "disk0" ]] || fail "Refusing to write to disk0 (boot disk)"
[[ "$DISK" != "disk1" ]] || fail "Refusing to write to disk1 (likely boot disk)"

# Show what we're about to do
echo ""
info "Configuration:"
echo "  Disk:     $DEVICE"
echo "  Hostname: $HOSTNAME"
echo "  User:     $USERNAME"
echo "  WiFi:     ${WIFI_SSID:-<not configured>}"
echo "  Hotspot:  $HOTSPOT_SSID"
echo "  Hotspot password: $HOTSPOT_PASS"
if [[ -n "$ASSET_DIR" ]]; then
    echo "  Assets:   $ASSET_DIR"
else
    echo "  Assets:   auto-build from current repo"
fi
echo ""

# Show disk info
diskutil info "$DEVICE" 2>/dev/null | grep -E '(Device / Media Name|Disk Size|Volume Name)' | sed 's/^/  /'
echo ""

warn "THIS WILL ERASE ALL DATA ON $DEVICE"
if [[ "$AUTO_CONFIRM" != "1" ]]; then
    read -rp "Type 'yes' to continue: " CONFIRM
    [[ "$CONFIRM" == "yes" ]] || { echo "Aborted."; exit 1; }
fi

prepare_assets

# -- Download Pi OS image if needed --
IMAGE_DIR="$REPO_ROOT/.cache"
mkdir -p "$IMAGE_DIR"

if [[ -z "$IMAGE" ]]; then
    IMAGE_URL="https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2024-11-19/2024-11-19-raspios-bookworm-arm64-lite.img.xz"
    IMAGE_FILE="$IMAGE_DIR/raspios-bookworm-arm64-lite.img.xz"
    UNCOMPRESSED="$IMAGE_DIR/raspios-bookworm-arm64-lite.img"

    if [[ -f "$UNCOMPRESSED" ]]; then
        info "Using cached image: $UNCOMPRESSED"
        IMAGE="$UNCOMPRESSED"
    elif [[ -f "$IMAGE_FILE" ]]; then
        info "Decompressing cached image..."
        xz -dk "$IMAGE_FILE"
        IMAGE="$UNCOMPRESSED"
    else
        info "Downloading Raspberry Pi OS Lite (64-bit)..."
        curl -L --progress-bar -o "$IMAGE_FILE" "$IMAGE_URL"
        info "Decompressing..."
        xz -dk "$IMAGE_FILE"
        IMAGE="$UNCOMPRESSED"
    fi
elif [[ "$IMAGE" == *.xz ]]; then
    UNCOMPRESSED="${IMAGE%.xz}"
    if [[ ! -f "$UNCOMPRESSED" ]]; then
        info "Decompressing $IMAGE..."
        xz -dk "$IMAGE"
    fi
    IMAGE="$UNCOMPRESSED"
fi

[[ -f "$IMAGE" ]] || fail "Image file not found: $IMAGE"

# -- Flash the image --
info "Unmounting $DEVICE..."
diskutil unmountDisk "$DEVICE" 2>/dev/null || true

info "Flashing $IMAGE -> $RDISK (this takes a few minutes)..."
sudo dd if="$IMAGE" of="$RDISK" bs=1m status=progress
sync

info "Re-mounting boot partition..."
sleep 2
diskutil mountDisk "$DEVICE" 2>/dev/null || true
sleep 2

# -- Find the boot partition --
BOOT_MOUNT=""
for mount_point in /Volumes/bootfs /Volumes/boot; do
    if [[ -d "$mount_point" ]]; then
        BOOT_MOUNT="$mount_point"
        break
    fi
done

[[ -n "$BOOT_MOUNT" ]] || fail "Could not find boot partition. Check if the SD card mounted correctly."
info "Boot partition mounted at: $BOOT_MOUNT"

# -- Enable SSH --
touch "$BOOT_MOUNT/ssh"
ok "SSH enabled"

# -- Set user credentials --
# Raspberry Pi OS Bookworm uses userconf.txt: username:encrypted-password
ENCRYPTED_PASS=$(openssl passwd -6 "$PASSWORD")
echo "${USERNAME}:${ENCRYPTED_PASS}" > "$BOOT_MOUNT/userconf.txt"
ok "User '$USERNAME' configured"

# -- Stage provisioning assets for first boot --
INSTALLER_STAGING="$BOOT_MOUNT/boat-installer"
rm -rf "$INSTALLER_STAGING"
mkdir -p "$INSTALLER_STAGING"
cp "$ASSET_DIR/repo-bundle.tar.gz" "$INSTALLER_STAGING/"
cp "$ASSET_DIR/boat-firmware" "$INSTALLER_STAGING/"
cp "$ASSET_DIR/mqtt.env" "$INSTALLER_STAGING/"
ok "Provisioning assets staged for first boot"

# -- Create firstrun.sh for headless setup --
# This script runs once on first boot, then removes itself from cmdline.txt
cat > "$BOOT_MOUNT/firstrun.sh" << 'FIRSTRUN_EOF'
#!/bin/bash
set -e

# --- Network ---
# Bookworm uses NetworkManager; keep client Wi-Fi, hotspot, and cellular under it.
cat > /etc/default/boat-network << 'NETCFGEOF'
WIFI_CLIENT_IFACE=wlan0
WIFI_CLIENT_CONN_NAME=boat-uplink
WIFI_CLIENT_SSID=__WIFI_SSID_SHELL__
WIFI_CLIENT_PASS=__WIFI_PASS_SHELL__
WIFI_CLIENT_PRIORITY=100
WIFI_CLIENT_ROUTE_METRIC=200
HOTSPOT_CONN_NAME=boat-hotspot
HOTSPOT_SSID=__HOTSPOT_SSID_SHELL__
HOTSPOT_PASS=__HOTSPOT_PASS_SHELL__
HOTSPOT_VIF_IFACE=ap0
HOTSPOT_BOOT_MODE=vif-only
HOTSPOT_BAND=bg
HOTSPOT_IPV4_CIDR=10.43.0.1/24
MODEMMANAGER_ENABLE=1
NETCFGEOF
chmod 600 /etc/default/boat-network
. /etc/default/boat-network

if [[ -n "$WIFI_CLIENT_SSID" ]]; then
    if ! nmcli connection show "boat-uplink" &>/dev/null; then
        nmcli connection add type wifi ifname wlan0 con-name "boat-uplink" ssid "$WIFI_CLIENT_SSID" || true
    fi

    nmcli connection modify "boat-uplink" \
        connection.interface-name wlan0 \
        connection.autoconnect yes \
        connection.autoconnect-priority 100 \
        802-11-wireless-security.key-mgmt wpa-psk \
        802-11-wireless-security.psk "$WIFI_CLIENT_PASS" \
        802-11-wireless.powersave 2 \
        ipv4.route-metric 200 \
        ipv6.route-metric 200 || true

    nmcli connection up "boat-uplink" || true
fi

# --- Set hostname ---
raspi-config nonint do_hostname "__HOSTNAME__"

# --- Enable I2C and SPI ---
raspi-config nonint do_i2c 0
raspi-config nonint do_spi 0

# --- Install system packages ---
apt-get update -y
apt-get install -y \
    i2c-tools \
    python3-smbus2 \
    python3-spidev \
    python3-gpiod \
    python3-pip \
    python3-picamera2 \
    python3-serial \
    git \
    iw \
    dnsmasq-base \
    modemmanager \
    picocom \
    watchdog

# Install OLED display library
pip3 install --break-system-packages luma.oled 2>/dev/null || pip3 install luma.oled || true

# --- EG25-G Quectel modem/GPS setup ---
# Keep ModemManager enabled for cellular, but leave GPS/NMEA ports free.
mkdir -p /etc/udev/rules.d
cat > /etc/udev/rules.d/99-eg25g-gps.rules << 'UDEVEOF'
# Quectel EG25-G: let firmware own the NMEA and AT ports
SUBSYSTEM=="tty", KERNEL=="ttyUSB1", ATTRS{idVendor}=="2c7c", ENV{ID_MM_PORT_IGNORE}="1"
SUBSYSTEM=="tty", KERNEL=="ttyUSB2", ATTRS{idVendor}=="2c7c", ENV{ID_MM_PORT_IGNORE}="1"
UDEVEOF
udevadm control --reload-rules 2>/dev/null || true
udevadm trigger --subsystem-match=tty 2>/dev/null || true
systemctl enable ModemManager 2>/dev/null || true
systemctl restart ModemManager 2>/dev/null || true

# --- Hardware watchdog ---
# Enable the BCM2835 hardware watchdog — reboots the Pi if the system hangs
# The kernel module is loaded automatically on Pi OS, just needs the daemon configured
cat > /etc/watchdog.conf << 'WDEOF'
# Hardware watchdog on BCM2835
watchdog-device = /dev/watchdog
watchdog-timeout = 15
# Reboot if any of these fail
max-load-1 = 24
min-memory = 1
# Interval between watchdog keepalives (seconds)
interval = 10
# Log watchdog activity
log-dir = /var/log/watchdog
WDEOF

# Enable the watchdog service
systemctl enable watchdog
# Add dtparam for hardware watchdog to config.txt
if ! grep -q 'dtparam=watchdog=on' /boot/firmware/config.txt; then
    echo 'dtparam=watchdog=on' >> /boot/firmware/config.txt
fi

# --- Camera (IMX219) setup ---
# Disable camera auto-detect and explicitly load IMX219 overlay
sed -i 's/^camera_auto_detect=1/camera_auto_detect=0/' /boot/firmware/config.txt
if ! grep -q 'dtoverlay=imx219' /boot/firmware/config.txt; then
    # Add under [all] section if it exists, otherwise append
    if grep -q '^\[all\]' /boot/firmware/config.txt; then
        sed -i '/^\[all\]/a dtoverlay=imx219' /boot/firmware/config.txt
    else
        printf '\n[all]\ndtoverlay=imx219\n' >> /boot/firmware/config.txt
    fi
fi

# --- Install staged BoatCore payload ---
USER_HOME="/home/__USERNAME__"
INSTALL_STAGING="/boot/firmware/boat-installer"
REPO_ARCHIVE="$INSTALL_STAGING/repo-bundle.tar.gz"
FIRMWARE_ARTIFACT="$INSTALL_STAGING/boat-firmware"
MQTT_ENV_ARTIFACT="$INSTALL_STAGING/mqtt.env"

rm -rf "$USER_HOME/AutonomousBoat"
mkdir -p "$USER_HOME/AutonomousBoat"
tar -xzf "$REPO_ARCHIVE" -C "$USER_HOME/AutonomousBoat"
install -m 0755 "$FIRMWARE_ARTIFACT" "$USER_HOME/boat-firmware"
install -m 0600 "$MQTT_ENV_ARTIFACT" "$USER_HOME/.env"
chown -R __USERNAME__:__USERNAME__ "$USER_HOME/AutonomousBoat" "$USER_HOME/boat-firmware" "$USER_HOME/.env"

# --- Create a local reinstall helper ---
cat > "$USER_HOME/setup-boat.sh" << 'SETUPEOF'
#!/bin/bash
set -euo pipefail

echo "==> Reinstalling BoatCore services from the local checkout"

sudo install -m 0755 ~/AutonomousBoat/scripts/boat-network.sh /usr/local/sbin/boat-network.sh

sed "s|/home/chuck|$HOME|g" \
    ~/AutonomousBoat/deploy/systemd/boat-firmware.service | sudo tee /etc/systemd/system/boat-firmware.service > /dev/null

sed "s|/home/chuck|$HOME|g" \
    ~/AutonomousBoat/deploy/systemd/boat-estop.service | sudo tee /etc/systemd/system/boat-estop.service > /dev/null

sed "s|/home/chuck|$HOME|g" \
    ~/AutonomousBoat/deploy/systemd/ssd1306-dashboard.service | sudo tee /etc/systemd/system/ssd1306-dashboard.service > /dev/null

sed "s|/home/chuck|$HOME|g; s|User=chuck|User=$USER|g" \
    ~/AutonomousBoat/deploy/systemd/camera-stream.service | sudo tee /etc/systemd/system/camera-stream.service > /dev/null

sudo cp ~/AutonomousBoat/deploy/systemd/boat-hotspot.service /etc/systemd/system/
sudo /usr/local/sbin/boat-network.sh install

sudo systemctl daemon-reload
sudo systemctl enable boat-firmware boat-estop ssd1306-dashboard camera-stream boat-hotspot

if ! sudo systemctl start boat-hotspot; then
    echo "==> Hotspot auto-start skipped (the Pi Wi-Fi radio may not support concurrent AP+client mode)."
    echo "    You can still force AP takeover later with:"
    echo "      sudo /usr/local/sbin/boat-network.sh hotspot-up takeover"
fi

sudo systemctl restart boat-estop boat-firmware ssd1306-dashboard camera-stream
echo "==> BoatCore services installed and started"
SETUPEOF
chmod +x "$USER_HOME/setup-boat.sh"
chown __USERNAME__:__USERNAME__ "$USER_HOME/setup-boat.sh"

# --- Install systemd services immediately ---
install -m 0755 "$USER_HOME/AutonomousBoat/scripts/boat-network.sh" /usr/local/sbin/boat-network.sh

sed "s|/home/chuck|$USER_HOME|g" \
    "$USER_HOME/AutonomousBoat/deploy/systemd/boat-firmware.service" > /etc/systemd/system/boat-firmware.service

sed "s|/home/chuck|$USER_HOME|g" \
    "$USER_HOME/AutonomousBoat/deploy/systemd/boat-estop.service" > /etc/systemd/system/boat-estop.service

sed "s|/home/chuck|$USER_HOME|g" \
    "$USER_HOME/AutonomousBoat/deploy/systemd/ssd1306-dashboard.service" > /etc/systemd/system/ssd1306-dashboard.service

sed "s|/home/chuck|$USER_HOME|g; s|User=chuck|User=__USERNAME__|g" \
    "$USER_HOME/AutonomousBoat/deploy/systemd/camera-stream.service" > /etc/systemd/system/camera-stream.service

cp "$USER_HOME/AutonomousBoat/deploy/systemd/boat-hotspot.service" /etc/systemd/system/
/usr/local/sbin/boat-network.sh install

systemctl daemon-reload
systemctl enable boat-firmware boat-estop ssd1306-dashboard camera-stream boat-hotspot

if ! systemctl start boat-hotspot; then
    echo "==> Hotspot auto-start skipped (the Pi Wi-Fi radio may not support concurrent AP+client mode)." >&2
fi

systemctl restart boat-estop boat-firmware ssd1306-dashboard camera-stream

# Remove staged artifacts after a successful install to free boot-partition space.
rm -rf "$INSTALL_STAGING"

# --- Clean up firstrun from cmdline.txt ---
sed -i 's| systemd.run=/boot/firmware/firstrun.sh||' /boot/firmware/cmdline.txt
sed -i 's| systemd.run_success_action=reboot||' /boot/firmware/cmdline.txt

# Reboot to apply hostname and I2C/SPI changes
rm -f /boot/firmware/firstrun.sh
reboot
FIRSTRUN_EOF

# Substitute placeholders in firstrun.sh
WIFI_SSID_SHELL_ESCAPED="$(escape_sed_replacement "$(quote_for_shell "$WIFI_SSID")")"
WIFI_PASS_SHELL_ESCAPED="$(escape_sed_replacement "$(quote_for_shell "$WIFI_PASS")")"
HOTSPOT_SSID_SHELL_ESCAPED="$(escape_sed_replacement "$(quote_for_shell "$HOTSPOT_SSID")")"
HOTSPOT_PASS_SHELL_ESCAPED="$(escape_sed_replacement "$(quote_for_shell "$HOTSPOT_PASS")")"
HOSTNAME_ESCAPED="$(escape_sed_replacement "$HOSTNAME")"
USERNAME_ESCAPED="$(escape_sed_replacement "$USERNAME")"

sed -i '' "s|__WIFI_SSID_SHELL__|${WIFI_SSID_SHELL_ESCAPED}|g" "$BOOT_MOUNT/firstrun.sh"
sed -i '' "s|__WIFI_PASS_SHELL__|${WIFI_PASS_SHELL_ESCAPED}|g" "$BOOT_MOUNT/firstrun.sh"
sed -i '' "s|__HOTSPOT_SSID_SHELL__|${HOTSPOT_SSID_SHELL_ESCAPED}|g" "$BOOT_MOUNT/firstrun.sh"
sed -i '' "s|__HOTSPOT_PASS_SHELL__|${HOTSPOT_PASS_SHELL_ESCAPED}|g" "$BOOT_MOUNT/firstrun.sh"
sed -i '' "s|__HOSTNAME__|${HOSTNAME_ESCAPED}|g" "$BOOT_MOUNT/firstrun.sh"
sed -i '' "s|__USERNAME__|${USERNAME_ESCAPED}|g" "$BOOT_MOUNT/firstrun.sh"

chmod +x "$BOOT_MOUNT/firstrun.sh"

# -- Add firstrun.sh to cmdline.txt --
CMDLINE="$BOOT_MOUNT/cmdline.txt"
if [[ -f "$CMDLINE" ]]; then
    # Append systemd.run directive to run firstrun.sh on first boot
    if ! grep -q 'firstrun.sh' "$CMDLINE"; then
        sed -i '' 's/$/ systemd.run=\/boot\/firmware\/firstrun.sh systemd.run_success_action=reboot/' "$CMDLINE"
        ok "cmdline.txt updated for first-boot provisioning"
    fi
else
    warn "cmdline.txt not found — firstrun.sh may not execute automatically"
fi

# -- Eject --
info "Unmounting SD card..."
diskutil unmountDisk "$DEVICE"

echo ""
ok "SD card is ready!"
echo ""
echo "  Next steps:"
echo "  1. Insert the SD card into the Pi and power it on"
echo "  2. Wait 5-10 minutes for first-boot setup, package install, service install, and reboot"
if [[ -n "$WIFI_SSID" ]]; then
    echo "  3. Once it comes back, it should already be running on ${WIFI_SSID} and/or the hotspot below"
else
    echo "  3. It will come up on the hotspot below, and can later use cellular or takeover mode"
fi
echo "  4. Optional direct-attach hotspot:"
echo "     SSID:     ${HOTSPOT_SSID}"
echo "     Password: ${HOTSPOT_PASS}"
echo "     Pi IP:    10.43.0.1"
echo "  5. If you ever want to reinstall services from the local checkout on the Pi:"
echo "     ~/setup-boat.sh"
echo ""
