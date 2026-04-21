# Deploy Assets

This directory holds deployment-time assets that are copied or transformed onto the Raspberry Pi.

## Contents

- `systemd/` - systemd unit templates for the firmware, OLED dashboard, and optional camera streamer

## Notes

The service files in `systemd/` are source templates. They are written with the default Pi username `chuck`, and the provisioning flow rewrites those paths during install when needed.

For the actual deployment steps, use [`../docs/DEPLOY.md`](../docs/DEPLOY.md).
