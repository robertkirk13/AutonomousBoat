# Firmware

Async Rust firmware for the Raspberry Pi boat controller. It owns the sensor polling, MQTT publishing, GPS ingest, navigation task graph, and the primary PWM ESC motor output path on GPIO12/GPIO13. CAN motor frames are still mirrored when the bus is available.

## Build

Hardware build for the Pi:

```bash
cargo build --release --target aarch64-unknown-linux-gnu
```

Simulation build on a dev machine:

```bash
cargo run --no-default-features --features sim
```

The default feature set is `hw`, which enables the Raspberry Pi hardware dependencies.

## Environment

The firmware reads MQTT settings from `.env` in the current working directory or next to the deployed binary:

```bash
MQTT_HOST=your-hivemq-host.s1.eu.hivemq.cloud
MQTT_PORT=8883
MQTT_USER=your_user
MQTT_PASS=your_pass
```

The deployed Pi service expects that file at `~/.env`.

## Important Paths

- `src/main.rs` - task orchestration and startup
- `src/tasks/` - sensor, GPS, CAN, nav, and motor tasks
- `src/drivers/` - BNO055, INA228, TMP1075, and MCP2515 drivers
- `src/mqtt.rs` - MQTT client, publishers, and inbound command handling
- `src/types.rs` - shared telemetry and control types

## CAN Protocol

- bus settings and frame map: [`../docs/CAN.md`](../docs/CAN.md)
- payload board telemetry uses CAN IDs `0x100` through `0x104`
- the core's mirrored motor command uses CAN ID `0x200`

For Pi deployment details, see [`../docs/DEPLOY.md`](../docs/DEPLOY.md).
