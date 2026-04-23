# Deploying to the Pi

This document covers deploying or updating software on a provisioned Raspberry Pi. For first-boot provisioning, start with [`setup.md`](./setup.md) or use `./scripts/flash-sd.sh`.

## Assumptions

- the repo is cloned at `~/AutonomousBoat` on the Pi
- the firmware binary is copied to `~/boat-firmware`
- MQTT credentials live in `~/.env`
- hotspot/uplink settings live in `/etc/default/boat-network`
- the systemd templates come from `deploy/systemd/`

## Prerequisites

On your Mac:

- Rust with the `aarch64-unknown-linux-gnu` target: `rustup target add aarch64-unknown-linux-gnu`
- GNU cross-linker: `brew install aarch64-unknown-linux-gnu`
- On macOS ARM, use `cargo` directly. Do not use `cross` here.

On the Pi:

- Raspberry Pi OS Lite with I2C/SPI enabled
- base packages from [`setup.md`](./setup.md)
- repo checkout at `~/AutonomousBoat`

## 1. Build firmware

```bash
cd firmware
cargo build --release --target aarch64-unknown-linux-gnu
```

The binary is produced at `target/aarch64-unknown-linux-gnu/release/boat-firmware`.

## 2. Copy files to the Pi

```bash
scp target/aarch64-unknown-linux-gnu/release/boat-firmware chuck@castaway.local:~/boat-firmware
scp .env chuck@castaway.local:~/.env
```

If you are running those commands from the repo root instead of inside `firmware/`, use `firmware/target/...` and `firmware/.env`.

## 3. Quick test

```bash
ssh chuck@castaway.local
sudo ~/boat-firmware
```

You should see startup logs for the sensor tasks, MQTT, GPS, PWM ESC bringup, and CAN stack. Stop it with `Ctrl-C` after the smoke test.

## 4. Install or update services

From the Pi:

```bash
cd ~/AutonomousBoat
```

If the Pi username is the default `chuck`, direct copies are fine:

```bash
sudo install -m 0755 scripts/boat-network.sh /usr/local/sbin/boat-network.sh
sudo cp deploy/systemd/boat-firmware.service /etc/systemd/system/
sudo cp deploy/systemd/boat-estop.service /etc/systemd/system/
sudo cp deploy/systemd/ssd1306-dashboard.service /etc/systemd/system/
sudo cp deploy/systemd/boat-hotspot.service /etc/systemd/system/
```

If you used a different Pi username, rewrite the home-directory paths during install:

```bash
sudo install -m 0755 scripts/boat-network.sh /usr/local/sbin/boat-network.sh
sed "s|/home/chuck|$HOME|g" deploy/systemd/boat-firmware.service | sudo tee /etc/systemd/system/boat-firmware.service > /dev/null
sed "s|/home/chuck|$HOME|g" deploy/systemd/boat-estop.service | sudo tee /etc/systemd/system/boat-estop.service > /dev/null
sed "s|/home/chuck|$HOME|g" deploy/systemd/ssd1306-dashboard.service | sudo tee /etc/systemd/system/ssd1306-dashboard.service > /dev/null
sudo cp deploy/systemd/boat-hotspot.service /etc/systemd/system/
```

Optional camera service:

```bash
sed "s|/home/chuck|$HOME|g; s|User=chuck|User=$USER|g" deploy/systemd/camera-stream.service | sudo tee /etc/systemd/system/camera-stream.service > /dev/null
```

Reload and enable:

```bash
sudo /usr/local/sbin/boat-network.sh install
sudo systemctl daemon-reload
sudo systemctl enable boat-firmware boat-estop ssd1306-dashboard boat-hotspot
sudo systemctl start boat-firmware boat-estop ssd1306-dashboard boat-hotspot
```

If you want the camera stream too:

```bash
sudo systemctl enable camera-stream
sudo systemctl start camera-stream
```

## 5. Verify

```bash
sudo systemctl status boat-firmware
sudo systemctl status boat-estop
sudo systemctl status ssd1306-dashboard
sudo systemctl status boat-hotspot
journalctl -u boat-hotspot -n 50
journalctl -u boat-firmware -f
```

## E-Stop Behavior

The repo now supports a maintained GPIO e-stop without fully powering down the Pi:

- while the e-stop is held, `boat-estop.service` stops `boat-firmware`
- when the switch is released, `boat-estop.service` starts `boat-firmware` again
- `boat-firmware.service` also waits for a released e-stop before launching, so it will not arm on boot if the switch is still pressed

The default configuration is intended for a fail-safe normally-closed loop:

- wire the switch between `GPIO5` (header pin 29) and `GND`
- leave the unit files at `ESTOP_ACTIVE_STATE=high` and `ESTOP_BIAS=pull-up`
- released switch: GPIO stays low through the closed contact
- pressed switch or broken wire: GPIO floats high and stops the firmware

If you use a normally-open switch instead, change `ESTOP_ACTIVE_STATE=low` in both `boat-firmware.service` and `boat-estop.service`.

This is intentionally a service-level stop/start rather than a full Linux halt. On a Pi Zero 2 W, a true "halt on press, auto-boot on release" setup is not the easy path, and the usual wake pin (`GPIO3`) is already part of the boat's I2C bus.

## Updating Day-to-Day

Firmware:

```bash
cd firmware
cargo build --release --target aarch64-unknown-linux-gnu
scp target/aarch64-unknown-linux-gnu/release/boat-firmware chuck@castaway.local:~/boat-firmware
ssh chuck@castaway.local 'sudo systemctl restart boat-firmware'
```

Python scripts or unit-file changes:

```bash
ssh chuck@castaway.local
cd ~/AutonomousBoat
git pull
sudo install -m 0755 scripts/boat-network.sh /usr/local/sbin/boat-network.sh
sed "s|/home/chuck|$HOME|g" deploy/systemd/boat-firmware.service | sudo tee /etc/systemd/system/boat-firmware.service > /dev/null
sed "s|/home/chuck|$HOME|g" deploy/systemd/boat-estop.service | sudo tee /etc/systemd/system/boat-estop.service > /dev/null
sudo systemctl daemon-reload
sudo /usr/local/sbin/boat-network.sh install
sudo systemctl restart boat-estop boat-firmware ssd1306-dashboard
```

If the hotspot helper or its config changed, restart it too:

```bash
sudo systemctl restart boat-hotspot
```

## Troubleshooting

Firmware exits immediately:

```bash
journalctl -u boat-firmware -n 50
```

MQTT not connecting:

- check `~/.env`
- verify the broker host and port
- test TLS reachability with `openssl s_client -connect your-host:8883`

I2C devices missing:

```bash
i2cdetect -y 1
```

Display stuck or garbled:

```bash
sudo systemctl stop ssd1306-dashboard
sudo python3 ~/AutonomousBoat/scripts/reset_ssd1306.py
sudo systemctl start ssd1306-dashboard
```

GPS serial ports missing:

```bash
ls /dev/ttyUSB*
```

Hotspot did not come up:

```bash
sudo /usr/local/sbin/boat-network.sh status
journalctl -u boat-hotspot -n 50
```

If the hardware does not support concurrent AP + client mode, use:

```bash
sudo /usr/local/sbin/boat-network.sh hotspot-up takeover
```

CAN TX errors with no second node on the bus are expected.

If the firmware logs that PWM ESC outputs are unavailable, confirm that PWM0/PWM1 are enabled and routed to GPIO12/GPIO13 before restarting the service.
