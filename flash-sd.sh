#!/usr/bin/env bash
#
# flash-sd.sh — Flash an SD card with headless Raspberry Pi OS for BoatCore V1.0
#
# Usage:
#   ./flash-sd.sh [options]
#
# Options:
#   -d DISK       Target disk (e.g. disk4). Auto-detected if only one removable disk.
#   -n HOSTNAME   Pi hostname (default: castaway)
#   -u USER       Pi username (default: chuck)
#   -p PASSWORD   Pi password (default: prompt)
#   -s SSID       WiFi SSID (default: prompt)
#   -w WIFIPASS   WiFi password (default: prompt)
#   -i IMAGE      Path to .img or .img.xz file (default: downloads latest Pi OS Lite 64-bit)
#   -h            Show this help
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Defaults
HOSTNAME="castaway"
USERNAME="chuck"
PASSWORD=""
WIFI_SSID=""
WIFI_PASS=""
IMAGE=""
DISK=""

usage() {
    sed -n '3,14p' "$0" | sed 's/^# \?//'
    exit 0
}

while getopts "d:n:u:p:s:w:i:h" opt; do
    case $opt in
        d) DISK="$OPTARG" ;;
        n) HOSTNAME="$OPTARG" ;;
        u) USERNAME="$OPTARG" ;;
        p) PASSWORD="$OPTARG" ;;
        s) WIFI_SSID="$OPTARG" ;;
        w) WIFI_PASS="$OPTARG" ;;
        i) IMAGE="$OPTARG" ;;
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

# -- Prompt for missing values --
if [[ -z "$PASSWORD" ]]; then
    read -rsp "Password for user '$USERNAME' on the Pi: " PASSWORD
    echo
    [[ -n "$PASSWORD" ]] || fail "Password cannot be empty"
fi

if [[ -z "$WIFI_SSID" ]]; then
    read -rp "WiFi SSID: " WIFI_SSID
    [[ -n "$WIFI_SSID" ]] || fail "WiFi SSID cannot be empty"
fi

if [[ -z "$WIFI_PASS" ]]; then
    read -rsp "WiFi password: " WIFI_PASS
    echo
    [[ -n "$WIFI_PASS" ]] || fail "WiFi password cannot be empty"
fi

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
echo "  WiFi:     $WIFI_SSID"
echo ""

# Show disk info
diskutil info "$DEVICE" 2>/dev/null | grep -E '(Device / Media Name|Disk Size|Volume Name)' | sed 's/^/  /'
echo ""

warn "THIS WILL ERASE ALL DATA ON $DEVICE"
read -rp "Type 'yes' to continue: " CONFIRM
[[ "$CONFIRM" == "yes" ]] || { echo "Aborted."; exit 1; }

# -- Download Pi OS image if needed --
IMAGE_DIR="$SCRIPT_DIR/.cache"
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

# -- Create firstrun.sh for headless setup --
# This script runs once on first boot, then removes itself from cmdline.txt
cat > "$BOOT_MOUNT/firstrun.sh" << 'FIRSTRUN_EOF'
#!/bin/bash
set -e

# --- Network ---
# Configure WiFi via NetworkManager (Bookworm uses nmcli, not wpa_supplicant)
if ! nmcli connection show "__WIFI_SSID__" &>/dev/null; then
    nmcli device wifi connect "__WIFI_SSID__" password "__WIFI_PASS__" || true
fi

# Disable WiFi power saving (prevents SSH dropouts)
nmcli connection modify preconfigured wifi.powersave 2 2>/dev/null || true

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
    picocom \
    watchdog

# Install OLED display library
pip3 install --break-system-packages luma.oled 2>/dev/null || pip3 install luma.oled || true

# --- EG25-G Quectel modem/GPS setup ---
# Disable ModemManager — it grabs the AT port and blocks GPS/firmware access
systemctl stop ModemManager 2>/dev/null || true
systemctl disable ModemManager 2>/dev/null || true

# udev rule: if ModemManager is ever re-enabled, ignore NMEA + AT ports
mkdir -p /etc/udev/rules.d
cat > /etc/udev/rules.d/99-eg25g-gps.rules << 'UDEVEOF'
# Quectel EG25-G: let firmware own the NMEA and AT ports
SUBSYSTEM=="tty", KERNEL=="ttyUSB1", ATTRS{idVendor}=="2c7c", ENV{ID_MM_PORT_IGNORE}="1"
SUBSYSTEM=="tty", KERNEL=="ttyUSB2", ATTRS{idVendor}=="2c7c", ENV{ID_MM_PORT_IGNORE}="1"
UDEVEOF
udevadm control --reload-rules 2>/dev/null || true

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

# --- Set up SSH deploy key for GitHub ---
USER_HOME="/home/__USERNAME__"
SSH_DIR="$USER_HOME/.ssh"
mkdir -p "$SSH_DIR"

ssh-keygen -t ed25519 -f "$SSH_DIR/deploy_key" -N "" -q
cat >> "$SSH_DIR/config" << 'SSHEOF'
Host github.com
  IdentityFile ~/.ssh/deploy_key
  StrictHostKeyChecking accept-new
SSHEOF

chown -R __USERNAME__:__USERNAME__ "$SSH_DIR"
chmod 700 "$SSH_DIR"
chmod 600 "$SSH_DIR/deploy_key" "$SSH_DIR/config"
chmod 644 "$SSH_DIR/deploy_key.pub"

# --- Write MQTT env file ---
cat > "$USER_HOME/.env" << 'ENVEOF'
__MQTT_ENV__
ENVEOF
chown __USERNAME__:__USERNAME__ "$USER_HOME/.env"

# --- Create the post-boot setup script ---
# This script clones the repo and installs services (requires the deploy key to be
# added to GitHub first, so it can't run automatically)
cat > "$USER_HOME/setup-boat.sh" << 'SETUPEOF'
#!/bin/bash
set -euo pipefail

echo "==> BoatCore post-boot setup"

# Clone repository
if [[ ! -d ~/AutonomousBoat ]]; then
    echo "==> Cloning AutonomousBoat repo..."
    echo ""
    echo "    IMPORTANT: First add your deploy key to GitHub:"
    echo "    Settings -> Deploy keys -> Add deploy key"
    echo ""
    echo "    Your public key:"
    cat ~/.ssh/deploy_key.pub
    echo ""
    read -rp "Press Enter after adding the key to GitHub... "
    git clone git@github.com:robertkirk13/AutonomousBoat.git ~/AutonomousBoat
else
    echo "==> Repo already cloned, pulling latest..."
    cd ~/AutonomousBoat && git pull
fi

# Install systemd services
echo "==> Installing systemd services..."
sudo cp ~/AutonomousBoat/boat-firmware.service /etc/systemd/system/
sudo cp ~/AutonomousBoat/ssd1306-dashboard.service /etc/systemd/system/

# Fix camera service paths for this user
sed "s|/home/pi|/home/$(whoami)|g; s|User=pi|User=$(whoami)|" \
    ~/AutonomousBoat/camera-stream.service | sudo tee /etc/systemd/system/camera-stream.service > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable boat-firmware ssd1306-dashboard camera-stream

echo "==> Services installed and enabled (will start on next boot or manually)."
echo ""
echo "    To start now:"
echo "      sudo systemctl start boat-firmware"
echo "      sudo systemctl start ssd1306-dashboard"
echo "      sudo systemctl start camera-stream"
echo ""
echo "    To deploy firmware, run from your Mac:"
echo "      cd firmware"
echo "      cargo build --release --target aarch64-unknown-linux-gnu"
echo "      scp target/aarch64-unknown-linux-gnu/release/boat-firmware __USERNAME__@__HOSTNAME__.local:~/"
echo "      ssh __USERNAME__@__HOSTNAME__.local 'sudo systemctl restart boat-firmware'"
echo ""
echo "==> Setup complete!"
SETUPEOF
chmod +x "$USER_HOME/setup-boat.sh"
chown __USERNAME__:__USERNAME__ "$USER_HOME/setup-boat.sh"

# --- Clean up firstrun from cmdline.txt ---
sed -i 's| systemd.run=/boot/firmware/firstrun.sh||' /boot/firmware/cmdline.txt
sed -i 's| systemd.run_success_action=reboot||' /boot/firmware/cmdline.txt

# Reboot to apply hostname and I2C/SPI changes
rm -f /boot/firmware/firstrun.sh
reboot
FIRSTRUN_EOF

# Substitute placeholders in firstrun.sh
sed -i '' "s|__WIFI_SSID__|${WIFI_SSID}|g" "$BOOT_MOUNT/firstrun.sh"
sed -i '' "s|__WIFI_PASS__|${WIFI_PASS}|g" "$BOOT_MOUNT/firstrun.sh"
sed -i '' "s|__HOSTNAME__|${HOSTNAME}|g" "$BOOT_MOUNT/firstrun.sh"
sed -i '' "s|__USERNAME__|${USERNAME}|g" "$BOOT_MOUNT/firstrun.sh"

# Read MQTT env from firmware/.env
MQTT_ENV=""
if [[ -f "$SCRIPT_DIR/firmware/.env" ]]; then
    MQTT_ENV=$(cat "$SCRIPT_DIR/firmware/.env")
else
    warn "firmware/.env not found — MQTT credentials will need to be set manually on the Pi"
    MQTT_ENV="# MQTT credentials not configured — edit this file
MQTT_HOST=
MQTT_PORT=8883
MQTT_USER=
MQTT_PASS="
fi
# Escape for sed
MQTT_ENV_ESCAPED=$(echo "$MQTT_ENV" | sed 's/[&/\]/\\&/g' | tr '\n' '\r')
sed -i '' "s|__MQTT_ENV__|${MQTT_ENV_ESCAPED}|" "$BOOT_MOUNT/firstrun.sh"
# Fix the \r back to newlines
tr '\r' '\n' < "$BOOT_MOUNT/firstrun.sh" > "$BOOT_MOUNT/firstrun.sh.tmp"
mv "$BOOT_MOUNT/firstrun.sh.tmp" "$BOOT_MOUNT/firstrun.sh"

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
echo "  2. Wait 3-5 minutes for first-boot setup (packages install, reboot)"
echo "  3. SSH in:  ssh ${USERNAME}@${HOSTNAME}.local"
echo "  4. Run:     ~/setup-boat.sh"
echo "     (This will prompt you to add the deploy key to GitHub, then clones the repo"
echo "      and installs all systemd services)"
echo "  5. Deploy firmware from your Mac:"
echo "     cd firmware"
echo "     cargo build --release --target aarch64-unknown-linux-gnu"
echo "     scp target/aarch64-unknown-linux-gnu/release/boat-firmware ${USERNAME}@${HOSTNAME}.local:~/"
echo "     ssh ${USERNAME}@${HOSTNAME}.local 'sudo systemctl restart boat-firmware'"
echo ""
