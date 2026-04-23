# Systemd Units

Systemd unit templates for services that run on the Pi.

## Units

- `boat-firmware.service` - launches the Rust firmware binary from the user's home directory
- `boat-estop.service` - watches a GPIO-backed maintained e-stop and stops/starts `boat-firmware`
- `ssd1306-dashboard.service` - runs the Python OLED dashboard and shutdown helper
- `camera-stream.service` - optional MJPEG camera stream service

## Install

If the Pi user is the default `chuck`, copying the files directly is fine. If the Pi uses a different username, rewrite the home-directory paths during install:

```bash
sed "s|/home/chuck|$HOME|g" deploy/systemd/boat-firmware.service | sudo tee /etc/systemd/system/boat-firmware.service > /dev/null
sed "s|/home/chuck|$HOME|g" deploy/systemd/boat-estop.service | sudo tee /etc/systemd/system/boat-estop.service > /dev/null
sed "s|/home/chuck|$HOME|g" deploy/systemd/ssd1306-dashboard.service | sudo tee /etc/systemd/system/ssd1306-dashboard.service > /dev/null
sed "s|/home/chuck|$HOME|g; s|User=chuck|User=$USER|g" deploy/systemd/camera-stream.service | sudo tee /etc/systemd/system/camera-stream.service > /dev/null
sudo systemctl daemon-reload
```

Then enable whichever services you want:

```bash
sudo systemctl enable boat-firmware boat-estop ssd1306-dashboard
sudo systemctl start boat-firmware boat-estop ssd1306-dashboard
```

## E-Stop Wiring

The default unit configuration assumes a maintained normally-closed e-stop wired between `GPIO5` and `GND`, using the Pi's internal pull-up:

- released and healthy loop: GPIO reads low
- pressed or broken wire: GPIO reads high and the firmware service is stopped

If you prefer a normally-open switch, change `ESTOP_ACTIVE_STATE=low` in both unit files.

The provisioning script already does this rewrite automatically.
