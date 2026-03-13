#!/usr/bin/env python3
"""Test script for EG25-G GPS (Quectel module over USB serial).
Sends AT+QGPS=1 to enable the GNSS engine, then reads NMEA from the NMEA port.
"""

import serial
import time
import signal
import sys

AT_PORT = "/dev/ttyUSB2"
NMEA_PORT = "/dev/ttyUSB1"
BAUD = 115200

running = True

def handle_signal(signum, frame):
    global running
    print(f"\nReceived signal {signum}, stopping...")
    running = False

signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)


def send_at(port, cmd, timeout=2):
    """Send an AT command and print the response lines."""
    port.write((cmd + "\r\n").encode())
    port.flush()
    deadline = time.time() + timeout
    while time.time() < deadline:
        line = port.readline().decode(errors="replace").strip()
        if line:
            print(f"  < {line}")
        if line in ("OK", "ERROR") or "+CME ERROR" in line:
            return line
    return ""


def enable_gps():
    """Open AT port and send AT+QGPS=1 to start the GNSS engine."""
    print(f"Opening AT port {AT_PORT}...")
    try:
        at = serial.Serial(AT_PORT, BAUD, timeout=2)
    except serial.SerialException as e:
        print(f"Could not open AT port: {e}")
        return False

    print("Sending AT...")
    resp = send_at(at, "AT")

    print("Checking GPS status (AT+QGPS?)...")
    send_at(at, "AT+QGPS?")

    print("Enabling GPS (AT+QGPS=1)...")
    resp = send_at(at, "AT+QGPS=1")
    if "ERROR" in resp:
        print("  (GPS may already be enabled, continuing)")

    at.close()
    return True


def parse_nmea_coord(coord, hemisphere):
    """Parse NMEA DDMM.MMMMM coordinate with N/S/E/W hemisphere."""
    if not coord or not hemisphere:
        return None
    dot = coord.index(".")
    if dot < 3:
        return None
    degrees = float(coord[: dot - 2])
    minutes = float(coord[dot - 2 :])
    result = degrees + minutes / 60.0
    if hemisphere in ("S", "W"):
        result = -result
    return result


def parse_rmc(sentence):
    """Parse $GNRMC / $GPRMC sentence. Returns (lat, lon, speed_mps) or None."""
    data = sentence.split("*")[0]
    fields = data.split(",")
    if len(fields) < 8:
        return None
    if fields[2] != "A":
        return None
    lat = parse_nmea_coord(fields[3], fields[4])
    lon = parse_nmea_coord(fields[5], fields[6])
    if lat is None or lon is None:
        return None
    speed_knots = float(fields[7]) if fields[7] else 0.0
    speed_mps = speed_knots * 0.514444
    return lat, lon, speed_mps


def parse_gga(sentence):
    """Parse $GNGGA / $GPGGA for fix quality and satellite count."""
    data = sentence.split("*")[0]
    fields = data.split(",")
    if len(fields) < 10:
        return None
    fix_quality = int(fields[6]) if fields[6] else 0
    num_sats = int(fields[7]) if fields[7] else 0
    altitude = float(fields[9]) if fields[9] else 0.0
    return fix_quality, num_sats, altitude


def main():
    if not enable_gps():
        sys.exit(1)

    print(f"\nOpening NMEA port {NMEA_PORT}...")
    try:
        nmea = serial.Serial(NMEA_PORT, BAUD, timeout=1)
    except serial.SerialException as e:
        print(f"Could not open NMEA port: {e}")
        sys.exit(1)

    print("Waiting for GPS fix (this can take 30s-few minutes cold start)...\n")

    fix_count = 0
    last_print = 0

    while running:
        raw = nmea.readline().decode(errors="replace").strip()
        if not raw:
            continue

        # Show all sentence types briefly on first few lines
        if fix_count == 0 and time.time() - last_print > 5:
            print(f"  [NMEA] {raw[:80]}")
            last_print = time.time()

        # Parse RMC for position
        if raw.startswith("$GNRMC") or raw.startswith("$GPRMC"):
            result = parse_rmc(raw)
            if result:
                lat, lon, speed = result
                fix_count += 1
                print(
                    f"  FIX #{fix_count}: lat={lat:.6f}  lon={lon:.6f}  "
                    f"speed={speed:.2f} m/s"
                )

        # Parse GGA for satellite info
        elif raw.startswith("$GNGGA") or raw.startswith("$GPGGA"):
            info = parse_gga(raw)
            if info:
                fix_q, sats, alt = info
                fix_str = {0: "none", 1: "GPS", 2: "DGPS", 6: "estimated"}.get(
                    fix_q, str(fix_q)
                )
                print(
                    f"  SATS: {sats}  fix={fix_str}  alt={alt:.1f}m",
                    end="    \r",
                )

    nmea.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
