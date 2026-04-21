# CAN Protocol

This repo uses a single 500 kbps CAN bus with standard 11-bit identifiers.

## Bus Settings

- bitrate: `500000`
- frame type: standard CAN 2.0A, 11-bit IDs
- payload sensor frames: 4-byte little-endian IEEE-754 `float`
- motor mirror frame: 4-byte payload with two signed big-endian `i16` values

## Frame Map

| CAN ID | Producer | Consumer | Payload | Units / Meaning |
|--------|----------|----------|---------|-----------------|
| `0x100` | ESP32-S3 payload board | Pi core payload decoder | `float32_le` | water temperature in `deg F` |
| `0x101` | ESP32-S3 payload board | Pi core payload decoder | `float32_le` | `pH` |
| `0x102` | ESP32-S3 payload board | Pi core payload decoder | `float32_le` | conductivity in `mS/cm` |
| `0x103` | ESP32-S3 payload board | Pi core payload decoder | `float32_le` | turbidity in `NTU` |
| `0x104` | ESP32-S3 payload board | Pi core payload decoder | `float32_le` | sonar distance in `in` |
| `0x200` | Pi core | optional CAN listeners / motor mirror consumers | `[left_hi left_lo right_hi right_lo]` | mirrored motor command |

## Payload Sensor Frames

The current payload-board application in [`sensorboard/TestProject/main/main.c`](../sensorboard/TestProject/main/main.c) sends one float per frame:

- temperature: Fahrenheit
- pH: unitless pH value
- EC: millisiemens per centimeter
- turbidity: NTU
- sonar: inches

On the Pi side, the firmware decodes those frames in [`firmware/src/tasks/payload.rs`](../firmware/src/tasks/payload.rs) and republishes the merged state over MQTT on `boat/payload`.

Example decoding in Python:

```python
import struct

value = struct.unpack("<f", frame_bytes[:4])[0]
```

### Compatibility Note

The alternate file [`sensorboard/TestProject/main/main_normal.c`](../sensorboard/TestProject/main/main_normal.c) uses different units for two frames:

- `0x100` temperature in `deg C`
- `0x104` sonar distance in `mm`

The current Pi firmware and dashboard assume the `main.c` units above, not the `main_normal.c` units.

## Motor Mirror Frame

The boat core's primary motor output is PWM on GPIO12 and GPIO13. It also mirrors the resolved motor command onto CAN ID `0x200` in [`firmware/src/tasks/motor.rs`](../firmware/src/tasks/motor.rs).

Payload layout:

```text
byte 0: left motor high byte
byte 1: left motor low byte
byte 2: right motor high byte
byte 3: right motor low byte
```

Each motor value is a signed big-endian `i16` in the range `-10000..10000`, representing thrust `-1.0..1.0`.

Examples:

- stop: `00 00 00 00`
- full forward both motors: `27 10 27 10`
- full reverse both motors: `D8 F0 D8 F0`

## Source of Truth

- payload CAN IDs: [`sensorboard/TestProject/main/can_bus.h`](../sensorboard/TestProject/main/can_bus.h)
- payload transmit behavior: [`sensorboard/TestProject/main/main.c`](../sensorboard/TestProject/main/main.c)
- Pi-side CAN ID reservations: [`firmware/src/config.rs`](../firmware/src/config.rs)
- Pi-side payload decode: [`firmware/src/tasks/payload.rs`](../firmware/src/tasks/payload.rs)
- Pi-side motor mirror encoding: [`firmware/src/tasks/motor.rs`](../firmware/src/tasks/motor.rs)
