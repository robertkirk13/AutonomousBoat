# Cloudflare Tunnel for the Boat

Exposes the on-Pi HLS camera stream over Cloudflare's edge so the
dashboard can reach it from anywhere — including over cellular, where
the Pi has no public IP.

## One-time setup on the Pi

```bash
# Install cloudflared (ARM64 build for Pi Zero 2W on 64-bit OS)
curl -L --output cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb && rm cloudflared.deb

# Authenticate against your Cloudflare account
sudo cloudflared tunnel login   # opens a browser on the Pi or prints a URL
sudo cloudflared tunnel create boat

# Note the UUID it prints. Copy/edit the config:
sudo cp deploy/cloudflared/config.example.yml /etc/cloudflared/config.yml
sudo $EDITOR /etc/cloudflared/config.yml          # fill in UUID + hostname
sudo cloudflared tunnel route dns boat cam.<your-domain>

# Install + start the systemd unit
sudo cp deploy/systemd/cloudflared.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

## Verify

From anywhere off the boat's LAN:

```bash
curl -I https://cam.<your-domain>/hls/stream.m3u8
```

Should return `200 OK` (or `403` if you've put Access in front, which is
expected before you authenticate).

## Dashboard wiring

Set the env var in the dashboard's `.env` (or your hosting platform's
env config):

```
VITE_CAMERA_URL=https://cam.<your-domain>
```

The dashboard appends `/hls/stream.m3u8` itself.

## Cost / bandwidth

- Cloudflare Tunnel itself is free.
- HLS at 640×480@15 averages ~400 kbps; at 1280×720@15 it's ~1 Mbps.
  Multiply by viewing time × number of viewers.
- T-Mobile MVNO upload is the bottleneck, not Cloudflare.
