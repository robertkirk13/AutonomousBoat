# Setting Up a New Pi

This document covers first-time provisioning of a Raspberry Pi for the boat controller.

## Recommended Flow

From a macOS development machine:

```bash
./macos/BoatProvisioner/build-app.sh
open ./macos/BoatProvisioner/build/BoatProvisioner.app
```

If you prefer the script directly, `./scripts/flash-sd.sh` still works.

That provisioning path:

- flashes Raspberry Pi OS Lite
- creates the user and enables SSH
- enables I2C and SPI on first boot
- installs the Python and system packages the repo expects
- seeds NetworkManager with the uplink Wi-Fi profile when one is provided
- writes `/etc/default/boat-network` for the onboard hotspot
- keeps ModemManager enabled while reserving the EG25-G GPS ports
- stages the current repo, firmware binary, and MQTT env on the card
- installs the systemd services automatically on first boot
- leaves `~/setup-boat.sh` on the Pi as a local reinstall helper

After the Pi boots, wait for the first-boot setup and reboot cycle to finish. The system should then be running without any manual post-boot install step.

```bash
ssh chuck@castaway.local
```

If you ever want to reapply the service install from the local checkout on the Pi:

```bash
~/setup-boat.sh
```

## Manual Fallback

Use this path if you do not want to use `scripts/flash-sd.sh`.

### 1. Flash Raspberry Pi OS Lite

Use Raspberry Pi Imager and configure:

- hostname, for example `castaway`
- SSH enabled
- WiFi credentials
- a local username, for example `chuck`

### 2. Boot and enable interfaces

```bash
sudo raspi-config nonint do_i2c 0
sudo raspi-config nonint do_spi 0
sudo reboot
```

### 3. Install base packages

```bash
sudo apt update
sudo apt install -y \
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

pip3 install --break-system-packages luma.oled
```

### 3.5 Configure ESC PWM routing

The firmware expects the Wilson PWM support connectors to be wired as:

- left ESC throttle on PWM0 -> GPIO12 (Pi header pin 32)
- right ESC throttle on PWM1 -> GPIO13 (Pi header pin 33)

Make sure both Raspberry Pi hardware PWM channels are enabled and routed to GPIO12/GPIO13 in your boot overlay configuration before starting `boat-firmware`. If PWM is not configured, the firmware will log a warning and skip direct ESC output.

### 4. Keep ModemManager for LTE, but free the GPS ports

```bash
sudo tee /etc/udev/rules.d/99-eg25g-gps.rules > /dev/null <<'EOF'
# Quectel EG25-G: let firmware own the NMEA and AT ports
SUBSYSTEM=="tty", KERNEL=="ttyUSB1", ATTRS{idVendor}=="2c7c", ENV{ID_MM_PORT_IGNORE}="1"
SUBSYSTEM=="tty", KERNEL=="ttyUSB2", ATTRS{idVendor}=="2c7c", ENV{ID_MM_PORT_IGNORE}="1"
EOF

sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=tty
sudo systemctl enable ModemManager
sudo systemctl restart ModemManager
```

This keeps cellular data available through NetworkManager while leaving `/dev/ttyUSB1` and `/dev/ttyUSB2` available for the firmware and GPS scripts. See [`EG25G-GPS.md`](./EG25G-GPS.md) for more background.

### 5. Write the network config used by the hotspot helper

```bash
sudo tee /etc/default/boat-network > /dev/null <<'EOF'
WIFI_CLIENT_IFACE=wlan0
WIFI_CLIENT_CONN_NAME=boat-uplink
WIFI_CLIENT_SSID=your-shore-wifi
WIFI_CLIENT_PASS=your-shore-password
WIFI_CLIENT_PRIORITY=100
WIFI_CLIENT_ROUTE_METRIC=200
HOTSPOT_CONN_NAME=boat-hotspot
HOTSPOT_SSID=castaway-setup
HOTSPOT_PASS=choose-a-password
HOTSPOT_VIF_IFACE=ap0
HOTSPOT_BOOT_MODE=vif-only
HOTSPOT_BAND=bg
HOTSPOT_IPV4_CIDR=10.43.0.1/24
MODEMMANAGER_ENABLE=1
EOF

sudo chmod 600 /etc/default/boat-network
```

`HOTSPOT_BOOT_MODE=vif-only` is the safe default: it only starts the hotspot if the Wi-Fi chipset can host a separate AP interface. If you want the Pi to sacrifice client Wi-Fi and become only a hotspot, use `takeover`.

If you plan to rely on hotspot + cellular only, leave `WIFI_CLIENT_SSID` and `WIFI_CLIENT_PASS` blank.

### 6. Clone the repo with a deploy key

```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N "" -q
cat ~/.ssh/deploy_key.pub
```

Add that public key to the GitHub repo as a deploy key, then:

```bash
cat >> ~/.ssh/config << 'EOF'
Host github.com
  IdentityFile ~/.ssh/deploy_key
  StrictHostKeyChecking accept-new
EOF

git clone git@github.com:robertkirk13/AutonomousBoat.git ~/AutonomousBoat
```

### 7. Copy MQTT credentials

```bash
scp firmware/.env chuck@castaway.local:~/.env
```

Or create `~/.env` on the Pi manually with:

```bash
MQTT_HOST=your-hivemq-host.s1.eu.hivemq.cloud
MQTT_PORT=8883
MQTT_USER=your_user
MQTT_PASS=your_pass
```

### 8. Install services

```bash
cd ~/AutonomousBoat

sudo install -m 0755 scripts/boat-network.sh /usr/local/sbin/boat-network.sh
sudo cp deploy/systemd/boat-hotspot.service /etc/systemd/system/
sudo /usr/local/sbin/boat-network.sh install

sed "s|/home/chuck|$HOME|g" deploy/systemd/boat-firmware.service | sudo tee /etc/systemd/system/boat-firmware.service > /dev/null
sed "s|/home/chuck|$HOME|g" deploy/systemd/ssd1306-dashboard.service | sudo tee /etc/systemd/system/ssd1306-dashboard.service > /dev/null
sed "s|/home/chuck|$HOME|g; s|User=chuck|User=$USER|g" deploy/systemd/camera-stream.service | sudo tee /etc/systemd/system/camera-stream.service > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable boat-firmware ssd1306-dashboard camera-stream boat-hotspot
sudo systemctl start boat-firmware ssd1306-dashboard camera-stream
sudo systemctl start boat-hotspot
```

If `boat-hotspot` reports that concurrent AP + client mode is unavailable, the Pi will stay on its uplink Wi-Fi profile and you can still force a hotspot takeover later:

```bash
sudo /usr/local/sbin/boat-network.sh hotspot-up takeover
```

## Verification

From the repo root on the Pi:

```bash
python3 scripts/check_ina228.py
python3 scripts/read_imu.py
python3 scripts/read_temp.py
python3 scripts/check_ssd1306.py
sudo python3 scripts/check_can.py
sudo python3 scripts/check_gps.py
```

You can also verify the system services once installed:

```bash
sudo /usr/local/sbin/boat-network.sh status
sudo systemctl status boat-hotspot
sudo systemctl status boat-firmware
sudo systemctl status ssd1306-dashboard
```
