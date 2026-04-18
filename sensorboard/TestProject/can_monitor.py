"""
CAN Bus Monitor
Decodes sensor frames from the ESP32-S3 sensor board.

Requirements:
    pip install python-can

Usage:
    python can_monitor.py
"""

import struct
import can

# CAN message IDs (must match can_bus.h)
SENSOR_IDS = {
    0x100: "Temperature (F)",
    0x101: "pH",
    0x102: "EC (ms/cm)",
    0x103: "Turbidity (NTU)",
    0x104: "Sonar Distance (in)",
}

PORT     = "COM6"
BITRATE  = 500000


def decode_float(data: bytes) -> float:
    return struct.unpack("<f", data[:4])[0]


def main():
    bus = can.Bus(interface="slcan", channel=PORT, bitrate=BITRATE)
    print(f"Listening on {PORT} at {BITRATE} bps. Press Ctrl+C to stop.\n")

    try:
        for msg in bus:
            name = SENSOR_IDS.get(msg.arbitration_id)
            if name and len(msg.data) >= 4:
                value = decode_float(msg.data)
                print(f"[ID 0x{msg.arbitration_id:03X}] {name}: {value:.3f}")
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        bus.shutdown()


if __name__ == "__main__":
    main()
