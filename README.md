# AutonomousBoat - BoatCore V1.0

Autonomous boat firmware (Rust/tokio) + React dashboard for Raspberry Pi Zero 2W with custom BoatCore V1.0 PCB.

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
| GPIO18 | Fan PWM        |

### INA228 Calibration

- Shunt resistor: 1 mOhm
- Max current: 35A
- Current LSB: ~76.29 uA

### CAN Bus

- MCP2515 with 16 MHz crystal
- 500 kbps (CNF1=0x01, CNF2=0x91, CNF3=0x01)

## New Board Setup

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
python3 check_ina228.py

# Continuous power readings
python3 read_ina228.py

# IMU
python3 read_imu.py

# Temperature sensors
python3 read_temp.py

# OLED display
python3 check_ssd1306.py

# CAN bus (TX test - expects TX errors without a second node)
sudo python3 check_can.py

# CAN bus listener
sudo python3 listen_can.py

# If display is stuck/blank after power loss
sudo python3 reset_ssd1306.py
```

### 9. Install OLED dashboard service

```bash
sudo cp ssd1306-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ssd1306-dashboard
sudo systemctl start ssd1306-dashboard
```

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

Or using cross:

```bash
cargo install cross
cross build --release --target aarch64-unknown-linux-gnu
```

Copy the binary to the Pi:

```bash
scp target/aarch64-unknown-linux-gnu/release/boat-firmware chuck@castaway.local:~/
```

### 11. Build dashboard

Requires [bun](https://bun.sh/) (not npm):

```bash
cd dashboard
bun install
bun run build
```

### 12. MQTT configuration

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
| `check_ina228.py`   | Probe all INA228s, read ID/config registers|
| `read_ina228.py`    | Continuous power/energy/charge readings    |
| `read_imu.py`       | BNO055 euler angle reader                  |
| `read_temp.py`      | TMP1075 dual temperature reader            |
| `debug_i2c.py`      | I2C bus scanner                            |
| `check_ssd1306.py`  | OLED dashboard with live power stats       |
| `reset_ssd1306.py`  | Reset display from stuck state             |
| `check_can.py`      | MCP2515 CAN TX test                        |
| `listen_can.py`     | MCP2515 CAN RX listener                   |
| `toggle_gpio21.py`  | GPIO21 PWM toggle test                     |
| `toggle_all_gpios.py` | All GPIO PWM test                        |
| `cpu_load.py`       | CPU burn test                              |
