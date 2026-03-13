# Deploying to the Pi

## Prerequisites

On your Mac:
- Rust with `aarch64-unknown-linux-gnu` target: `rustup target add aarch64-unknown-linux-gnu`
- Cross-linker: `brew install aarch64-unknown-linux-gnu`
- **Do NOT use `cross`** — it tries to run inside a Docker/Linux container and fails on macOS ARM. Use `cargo` directly with the cross-linker.

On the Pi:
- Raspberry Pi OS Lite (64-bit) with I2C/SPI enabled (see README.md steps 1-7)
- Python deps for OLED: `sudo apt install -y python3-smbus2 python3-pip && pip3 install luma.oled`

## 1. Build firmware

```bash
cd firmware
cargo build --release --target aarch64-unknown-linux-gnu
```

The binary is at `target/aarch64-unknown-linux-gnu/release/boat-firmware`.

## 2. Copy to Pi

```bash
scp target/aarch64-unknown-linux-gnu/release/boat-firmware chuck@castaway.local:~/
scp .env chuck@castaway.local:~/.env
```

Make sure `~/.env` on the Pi has your MQTT credentials:

```
MQTT_HOST=your-hivemq-host.s1.eu.hivemq.cloud
MQTT_PORT=8883
MQTT_USER=your_user
MQTT_PASS=your_pass
```

## 3. Quick test (manual run)

SSH into the Pi and run it directly to verify everything works:

```bash
ssh chuck@castaway.local
sudo ~/boat-firmware
```

You should see output like:
```
BoatCore firmware starting
I2C bus owner started on /dev/i2c-1
BNO055 initialized (NDOF mode)
MQTT started -> your-host:8883
GPS reading NMEA from /dev/ttyUSB1
MCP2515 CAN initialized (500kbps, normal mode)
```

Ctrl-C to stop.

## 4. Install as systemd service

```bash
# Copy service files (from the repo on the Pi)
cd ~/AutonomousBoat
sudo cp boat-firmware.service /etc/systemd/system/
sudo cp ssd1306-dashboard.service /etc/systemd/system/

# Reload and enable both services
sudo systemctl daemon-reload
sudo systemctl enable boat-firmware ssd1306-dashboard
sudo systemctl start boat-firmware ssd1306-dashboard
```

## 5. Verify

```bash
# Check firmware is running
sudo systemctl status boat-firmware

# Watch firmware logs
journalctl -u boat-firmware -f

# Check OLED dashboard is running
sudo systemctl status ssd1306-dashboard
```

## Service management

```bash
# Stop
sudo systemctl stop boat-firmware

# Restart
sudo systemctl restart boat-firmware

# Disable from starting on boot
sudo systemctl disable boat-firmware

# View recent logs
journalctl -u boat-firmware --since "5 min ago"

# Same commands work for ssd1306-dashboard
```

## Updating firmware

From your Mac:

```bash
cd firmware
cargo build --release --target aarch64-unknown-linux-gnu
scp target/aarch64-unknown-linux-gnu/release/boat-firmware chuck@castaway.local:~/
ssh chuck@castaway.local 'sudo systemctl restart boat-firmware'
```

## Updating Python display script

```bash
# Push changes to git, then on the Pi:
cd ~/AutonomousBoat && git pull
sudo systemctl restart ssd1306-dashboard
```

## Troubleshooting

**Firmware won't start / exits immediately:**
```bash
journalctl -u boat-firmware -n 50    # check last 50 log lines
```

**MQTT not connecting:**
- Check `~/.env` exists and has correct credentials
- Verify port 8883 is reachable: `openssl s_client -connect your-host:8883`

**I2C devices not found:**
```bash
i2cdetect -y 1    # should show 28, 3c, 40-48, 4a, 4b
```

**GPS not working:**
```bash
ls /dev/ttyUSB*    # should show ttyUSB0, ttyUSB1, ttyUSB2
```
If devices are missing, the EG25-G modem may not be powered or enumerated. Check USB connections. The firmware retries every 5s.

**Display stuck/garbled:**
```bash
sudo systemctl stop ssd1306-dashboard
sudo python3 ~/AutonomousBoat/reset_ssd1306.py
sudo systemctl start ssd1306-dashboard
```

**CAN bus errors:**
CAN TX errors are normal if there's no second node on the bus. The MCP2515 init retries every 5s if SPI isn't ready.
