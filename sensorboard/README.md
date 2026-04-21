# Sensorboard

ESP-IDF-based work for a separate ESP32-S3 sensor board. This part of the repo is for bring-up and experiments that are adjacent to the boat controller, but it is not part of the Raspberry Pi deployment flow.

## Current Project

- [`TestProject/`](./TestProject/README.md) - payload sensor suite bring-up and CAN telemetry on ESP32-S3
- CAN protocol reference: [`../docs/CAN.md`](../docs/CAN.md)

Use the Pi-side docs in `docs/` for the main boat deployment path. Use the project-level README inside each sensorboard experiment for build and flash instructions.
