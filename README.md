# AutonomousBoat - BoatCore V1.0

Autonomous boat firmware (Rust/tokio) + React dashboard for Raspberry Pi Zero 2W with custom BoatCore V1.0 PCB.

## Repo Layout

- [`dashboard/`](dashboard/README.md) - React telemetry dashboard
- [`firmware/`](firmware/README.md) - Rust boat controller firmware
- [`simulator/`](simulator/README.md) - lightweight browser simulator and MQTT visualizer
- [`scripts/`](scripts/README.md) - Pi provisioning, diagnostics, and helper scripts
- [`deploy/`](deploy/README.md) - deployment templates and service assets
- [`docs/`](docs/README.md) - setup, deploy, and hardware notes
- [`sensorboard/`](sensorboard/README.md) - ESP-IDF experiments for the auxiliary sensor board

Each major subdirectory has its own README with local build, run, or deployment notes.

## Setup Docs

- Fresh Pi provisioning: [`docs/setup.md`](docs/setup.md)
- Firmware and service deployment: [`docs/DEPLOY.md`](docs/DEPLOY.md)
- EG25-G modem and GPS notes: [`docs/EG25G-GPS.md`](docs/EG25G-GPS.md)
- CAN bus frame map: [`docs/CAN.md`](docs/CAN.md)

## Hardware

### I2C Bus 1 Devices

| Address | Device  | Label         | Purpose              |
|---------|---------|---------------|----------------------|
| 0x28    | BNO055  | IMU           | 9-axis orientation   |
| 0x3C    | SSD1306 | Display       | 128x64 OLED          |
| 0x40    | INA228  | Left Motor    | Power monitor (U1)   |
| 0x41    | INA228  | Right Motor   | Power monitor (U6)   |
| 0x42    | INA228  | Payload       | Power monitor (U7)   |
| 0x43    | INA228  | Reel          | Power monitor (U8)   |
| 0x44    | INA228  | Left Battery  | Power monitor (U9)   |
| 0x45    | INA228  | Right Battery | Power monitor (U10)  |
| 0x46    | INA228  | Solar         | Power monitor (U11)  |
| 0x47    | INA228  | Dock Charger  | Power monitor (U12)  |
| 0x48    | INA228  | Core Digital  | Power monitor (U13)  |
| 0x4A    | TMP1075 | Temp Left     | Temperature sensor   |
| 0x4B    | TMP1075 | Temp Right    | Temperature sensor   |

### SPI Bus 0

| Device  | CE  | Speed | Purpose          |
|---------|-----|-------|------------------|
| MCP2515 | CE0 | 1 MHz | CAN controller   |

### GPIO

| Pin    | Function       |
|--------|----------------|
| GPIO12 | Left ESC PWM0  |
| GPIO13 | Right ESC PWM1 |
| GPIO18 | Fan PWM        |

### INA228 Calibration

- Shunt resistor: 1 mOhm
- Max current: 35A
- Current LSB: ~76.29 uA

### CAN Bus

- MCP2515 with 16 MHz crystal
- 500 kbps (CNF1=0x01, CNF2=0x91, CNF3=0x01)
- motor commands are mirrored onto CAN when the bus is present, but the primary ESC throttle path is hardware PWM on GPIO12/GPIO13
- protocol reference and ID map: [`docs/CAN.md`](docs/CAN.md)

## New Board Setup

For a fresh Pi, the recommended path is:

```bash
./macos/BoatProvisioner/build-app.sh
open ./macos/BoatProvisioner/build/BoatProvisioner.app
```

If you prefer the shell path, `./scripts/flash-sd.sh` still works too.

Both paths provision the SD card, stage the current repo and firmware onto it, install the base packages, optionally seed a NetworkManager client profile, write hotspot settings, keep cellular-compatible ModemManager/GPS rules in place, and fully install the services on first boot. If you want to do it by hand instead, use [`docs/setup.md`](docs/setup.md).

After first boot, the Pi will try to expose its own hotspot alongside client Wi-Fi on a separate AP interface when the radio supports it. If the built-in radio cannot do concurrent AP + client, you can still force a manual hotspot takeover later with `sudo /usr/local/sbin/boat-network.sh hotspot-up takeover`. `~/setup-boat.sh` remains on the Pi as a local reinstall helper if you ever want to reapply the service install.

### 1. Flash Raspberry Pi OS

Flash Raspberry Pi OS Lite (64-bit) to an SD card using Raspberry Pi Imager. In the imager settings:
- Set hostname (e.g. `castaway`)
- Enable SSH with password or key
- Configure WiFi (SSID + password)
- Set username/password (e.g. `chuck`)

### 2. Boot and SSH in

```bash
ssh chuck@castaway.local
```

### 3. Enable I2C and SPI

```bash
sudo raspi-config nonint do_i2c 0
sudo raspi-config nonint do_spi 0
```

Or interactively: `sudo raspi-config` -> Interface Options -> I2C (enable) -> SPI (enable)

### 4. Disable WiFi power saving

WiFi power management causes the Pi to drop SSH connections and become unreachable.

```bash
sudo nmcli connection modify preconfigured wifi.powersave 2
```

Verify after reboot:
```bash
iwconfig wlan0  # should show "Power Management:off"
```

### 5. Install system dependencies

```bash
sudo apt update
sudo apt install -y i2c-tools python3-smbus2 python3-spidev python3-gpiod git
```

For the fuller package list, camera support, watchdog setup, and GPS serial tooling, use [`docs/setup.md`](docs/setup.md) or the automated `./scripts/flash-sd.sh` path above.

### 6. Set up SSH deploy key and clone repo

```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N "" -q
cat ~/.ssh/deploy_key.pub
```

Add the public key to GitHub (repo Settings -> Deploy keys).

```bash
cat >> ~/.ssh/config << 'EOF'
Host github.com
  IdentityFile ~/.ssh/deploy_key
  StrictHostKeyChecking accept-new
EOF

git clone git@github.com:robertkirk13/AutonomousBoat.git ~/AutonomousBoat
```

### 7. Reboot

```bash
sudo reboot
```

### 8. Verify hardware

After reboot, verify all I2C devices are visible:

```bash
i2cdetect -y 1
```

Expected output should show devices at: 28, 3c, 40-48, 4a, 4b.

Run the test scripts to validate each subsystem:

```bash
cd ~/AutonomousBoat

# Power monitors
python3 scripts/check_ina228.py

# Continuous power readings
python3 scripts/read_ina228.py

# IMU
python3 scripts/read_imu.py

# Temperature sensors
python3 scripts/read_temp.py

# OLED display
python3 scripts/check_ssd1306.py

# CAN bus (TX test - expects TX errors without a second node)
sudo python3 scripts/check_can.py

# CAN bus listener
sudo python3 scripts/listen_can.py

# If display is stuck/blank after power loss
sudo python3 scripts/reset_ssd1306.py
```

### 9. Install OLED dashboard service

```bash
sudo cp deploy/systemd/ssd1306-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ssd1306-dashboard
sudo systemctl start ssd1306-dashboard
```

If your Pi username is not `chuck`, use the path-rewrite install commands in [`docs/DEPLOY.md`](docs/DEPLOY.md) or [`deploy/systemd/README.md`](deploy/systemd/README.md) instead of copying the unit verbatim.

Check status:
```bash
sudo systemctl status ssd1306-dashboard
journalctl -u ssd1306-dashboard -f
```

### 10. Build firmware (cross-compile from dev machine)

Requires rustup with the `aarch64-unknown-linux-gnu` target:

```bash
cd firmware
cargo build --release --target aarch64-unknown-linux-gnu
```

On macOS ARM, prefer `cargo` with the GNU cross-linker. See [`docs/DEPLOY.md`](docs/DEPLOY.md) for the full toolchain notes.

Copy the binary to the Pi:

```bash
scp target/aarch64-unknown-linux-gnu/release/boat-firmware chuck@castaway.local:~/
```

### 11. Install firmware service

Copy the MQTT credentials to the Pi:

```bash
scp firmware/.env chuck@castaway.local:~/.env
```

Install and enable the systemd service:

```bash
sudo cp deploy/systemd/boat-firmware.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable boat-firmware
sudo systemctl start boat-firmware
```

As with the OLED unit, use the rewrite-based install path from [`docs/DEPLOY.md`](docs/DEPLOY.md) if the Pi uses a different username.

Check status:
```bash
sudo systemctl status boat-firmware
journalctl -u boat-firmware -f
```

The firmware will auto-restart on failure. It reads MQTT credentials from `~/.env` (via the `EnvironmentFile` directive) and also checks for a `.env` file next to the binary.

### 12. Build dashboard

Requires [bun](https://bun.sh/) (not npm):

```bash
cd dashboard
bun install
bun run build
```

### 13. MQTT configuration

The firmware reads MQTT credentials from `firmware/.env`:

```
MQTT_HOST=your-hivemq-host.s1.eu.hivemq.cloud
MQTT_PORT=8883
MQTT_USER=your_user
MQTT_PASS=your_pass
```

The dashboard reads from `dashboard/.env.local`:

```
VITE_MQTT_HOST=your-hivemq-host.s1.eu.hivemq.cloud
VITE_MQTT_WS_PORT=8884
VITE_MQTT_USER=your_user
VITE_MQTT_PASS=your_pass
```

## MQTT Topics

| Topic         | Rate  | Content                    |
|---------------|-------|----------------------------|
| boat/power    | 1 Hz  | Voltage, current, power    |
| boat/imu      | 5 Hz  | Heading, roll, pitch       |
| boat/thermal  | 0.5 Hz| Temperatures, fan speed    |
| boat/status   | 0.1 Hz| Heartbeat, uptime          |

## Test Scripts

| Script              | Purpose                                    |
|---------------------|--------------------------------------------|
| `scripts/check_ina228.py`   | Probe all INA228s, read ID/config registers|
| `scripts/read_ina228.py`    | Continuous power/energy/charge readings    |
| `scripts/read_imu.py`       | BNO055 euler angle reader                  |
| `scripts/read_temp.py`      | TMP1075 dual temperature reader            |
| `scripts/debug_i2c.py`      | I2C bus scanner                            |
| `scripts/check_ssd1306.py`  | OLED dashboard with live power stats       |
| `scripts/reset_ssd1306.py`  | Reset display from stuck state             |
| `scripts/check_can.py`      | MCP2515 CAN TX test                        |
| `scripts/listen_can.py`     | MCP2515 CAN RX listener                    |
| `scripts/toggle_gpio21.py`  | GPIO21 PWM toggle test                     |
| `scripts/toggle_all_gpios.py` | All GPIO PWM test                        |
| `scripts/cpu_load.py`       | CPU burn test                              |
