#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PACKAGE_DIR="$SCRIPT_DIR"
BUILD_DIR="$PACKAGE_DIR/build"
RESOURCES_DIR="$BUILD_DIR/resources"
ASSET_DIR="$RESOURCES_DIR/ProvisioningAssets"
APP_BUNDLE="$BUILD_DIR/BoatProvisioner.app"
EXECUTABLE_NAME="BoatProvisioner"

mkdir -p "$ASSET_DIR"

echo "==> Preparing provisioning assets"
"$REPO_ROOT/scripts/prepare-provisioning-assets.sh" -o "$ASSET_DIR"

echo "==> Copying flash script"
cp "$REPO_ROOT/scripts/flash-sd.sh" "$RESOURCES_DIR/flash-sd.sh"
chmod +x "$RESOURCES_DIR/flash-sd.sh"

echo "==> Building macOS app executable"
swift build --configuration release --package-path "$PACKAGE_DIR"

EXECUTABLE_PATH="$PACKAGE_DIR/.build/release/$EXECUTABLE_NAME"
[[ -x "$EXECUTABLE_PATH" ]] || {
    echo "==> ERROR: expected executable not found at $EXECUTABLE_PATH" >&2
    exit 1
}

echo "==> Packaging .app bundle"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"

cp "$EXECUTABLE_PATH" "$APP_BUNDLE/Contents/MacOS/$EXECUTABLE_NAME"
cp -R "$RESOURCES_DIR/." "$APP_BUNDLE/Contents/Resources/"

cat > "$APP_BUNDLE/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>BoatProvisioner</string>
    <key>CFBundleIdentifier</key>
    <string>com.robertkirk.boatprovisioner</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>BoatProvisioner</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>14.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
EOF

if command -v codesign >/dev/null 2>&1; then
    codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null 2>&1 || true
fi

echo ""
echo "==> App bundle ready:"
echo "    $APP_BUNDLE"
