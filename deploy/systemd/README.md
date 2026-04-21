# Systemd Units

Systemd unit templates for services that run on the Pi.

## Units

- `boat-firmware.service` - launches the Rust firmware binary from the user's home directory
- `ssd1306-dashboard.service` - runs the Python OLED dashboard and shutdown helper
- `camera-stream.service` - optional MJPEG camera stream service

## Install

If the Pi user is the default `chuck`, copying the files directly is fine. If the Pi uses a different username, rewrite the home-directory paths during install:

```bash
sed "s|/home/chuck|$HOME|g" deploy/systemd/boat-firmware.service | sudo tee /etc/systemd/system/boat-firmware.service > /dev/null
sed "s|/home/chuck|$HOME|g" deploy/systemd/ssd1306-dashboard.service | sudo tee /etc/systemd/system/ssd1306-dashboard.service > /dev/null
sed "s|/home/chuck|$HOME|g; s|User=chuck|User=$USER|g" deploy/systemd/camera-stream.service | sudo tee /etc/systemd/system/camera-stream.service > /dev/null
sudo systemctl daemon-reload
```

Then enable whichever services you want:

```bash
sudo systemctl enable boat-firmware ssd1306-dashboard
sudo systemctl start boat-firmware ssd1306-dashboard
```

The provisioning script already does this rewrite automatically.
