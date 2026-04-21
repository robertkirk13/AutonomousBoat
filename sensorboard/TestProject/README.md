# TestProject

ESP-IDF test application for the ESP32-S3 payload sensor board. The current `main.c` reads the thermistor, pH, EC, turbidity, and sonar sensors, then publishes the current readings on CAN.

The CAN frame IDs, encoding, and unit conventions are documented in [`../../docs/CAN.md`](../../docs/CAN.md).

## Tooling

- target: `esp32s3`
- build system: ESP-IDF / `idf.py`
- flash and monitor port: machine-specific

The checked-in `.vscode/settings.json` is an example from one workstation. Update the port and local ESP-IDF path for your machine before relying on it.

## Commands

```bash
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/tty.usbmodem101 flash
idf.py -p /dev/tty.usbmodem101 monitor
```

If you use the VS Code ESP-IDF extension, set the target and serial port there first, then the plain `idf.py` commands should work as expected.

## Important Paths

- `main/main.c` - current payload sensor app and CAN transmitter
- `main/main_normal.c` - alternate sensor app with different temperature / sonar units
- `main/can_bus.h` - CAN IDs and bus helper declarations
- `CMakeLists.txt` - project entrypoint
- `main/CMakeLists.txt` - main component registration
- `.devcontainer/` - devcontainer config for ESP-IDF work
