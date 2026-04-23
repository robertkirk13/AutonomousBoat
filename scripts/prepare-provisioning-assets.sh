#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

OUTPUT_DIR=""
FIRMWARE_BIN=""
MQTT_ENV_FILE=""

usage() {
    cat <<'EOF'
Usage: prepare-provisioning-assets.sh -o OUTPUT_DIR [-b FIRMWARE_BIN] [-e MQTT_ENV_FILE]

Creates a self-contained provisioning asset bundle:
  repo-bundle.tar.gz   Current repo snapshot (excluding heavy build/cache dirs)
  boat-firmware        aarch64 firmware binary
  mqtt.env             MQTT env file or a placeholder stub
EOF
}

info() { printf '==> %s\n' "$*"; }
fail() { printf '==> ERROR: %s\n' "$*" >&2; exit 1; }

while getopts "o:b:e:h" opt; do
    case "$opt" in
        o) OUTPUT_DIR="$OPTARG" ;;
        b) FIRMWARE_BIN="$OPTARG" ;;
        e) MQTT_ENV_FILE="$OPTARG" ;;
        h) usage; exit 0 ;;
        *) usage; exit 1 ;;
    esac
done

[[ -n "$OUTPUT_DIR" ]] || { usage; exit 1; }

mkdir -p "$OUTPUT_DIR"

REPO_ARCHIVE_OUT="$OUTPUT_DIR/repo-bundle.tar.gz"
FIRMWARE_OUT="$OUTPUT_DIR/boat-firmware"
MQTT_ENV_OUT="$OUTPUT_DIR/mqtt.env"

build_firmware() {
    command -v cargo >/dev/null 2>&1 || fail "cargo is required to build the firmware"
    command -v rustup >/dev/null 2>&1 || fail "rustup is required to verify the Rust target"
    command -v aarch64-unknown-linux-gnu-gcc >/dev/null 2>&1 || fail "aarch64-unknown-linux-gnu-gcc is required for firmware cross-compilation"

    if ! rustup target list --installed | grep -qx 'aarch64-unknown-linux-gnu'; then
        fail "Rust target aarch64-unknown-linux-gnu is not installed. Run: rustup target add aarch64-unknown-linux-gnu"
    fi

    info "Building Raspberry Pi firmware"
    (
        cd "$REPO_ROOT/firmware"
        cargo build --release --target aarch64-unknown-linux-gnu
    )

    FIRMWARE_BIN="$REPO_ROOT/firmware/target/aarch64-unknown-linux-gnu/release/boat-firmware"
}

prepare_repo_archive() {
    info "Creating repo bundle"
    tar \
        --exclude='.git' \
        --exclude='.cache' \
        --exclude='firmware/target' \
        --exclude='dashboard/node_modules' \
        --exclude='simulator/node_modules' \
        --exclude='dashboard/dist' \
        --exclude='simulator/dist' \
        --exclude='macos/BoatProvisioner/build' \
        --exclude='macos/BoatProvisioner/.build' \
        -czf "$REPO_ARCHIVE_OUT" \
        -C "$REPO_ROOT" .
}

prepare_firmware() {
    if [[ -z "$FIRMWARE_BIN" ]]; then
        build_firmware
    fi

    [[ -f "$FIRMWARE_BIN" ]] || fail "Firmware binary not found: $FIRMWARE_BIN"
    info "Staging firmware artifact"
    cp "$FIRMWARE_BIN" "$FIRMWARE_OUT"
    chmod +x "$FIRMWARE_OUT"
}

prepare_mqtt_env() {
    if [[ -z "$MQTT_ENV_FILE" ]]; then
        MQTT_ENV_FILE="$REPO_ROOT/firmware/.env"
    fi

    if [[ -f "$MQTT_ENV_FILE" ]]; then
        info "Staging MQTT env"
        cp "$MQTT_ENV_FILE" "$MQTT_ENV_OUT"
    else
        info "Writing MQTT placeholder env"
        cat > "$MQTT_ENV_OUT" <<'EOF'
# MQTT credentials not configured — edit on the Pi if needed
MQTT_HOST=
MQTT_PORT=8883
MQTT_USER=
MQTT_PASS=
EOF
    fi

    chmod 600 "$MQTT_ENV_OUT"
}

prepare_repo_archive
prepare_firmware
prepare_mqtt_env

info "Provisioning assets ready in $OUTPUT_DIR"
