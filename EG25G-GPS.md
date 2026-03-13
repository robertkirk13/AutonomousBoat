# EG25-G Quectel Module — GPS & ModemManager

## Overview

The Quectel EG25-G is an LTE Cat 4 modem with built-in GNSS (GPS/GLONASS/BeiDou/Galileo). On Wilson it provides both cellular connectivity and GPS positioning.

When plugged in via USB, the EG25-G exposes multiple serial ports:

| Port | Default Device | Function |
|------|---------------|----------|
| Diagnostics | `/dev/ttyUSB0` | Qualcomm DIAG (not used) |
| NMEA | `/dev/ttyUSB1` | GNSS NMEA sentence output |
| AT commands | `/dev/ttyUSB2` | AT command interface |
| Modem (PPP) | `/dev/ttyUSB3` | Data connection / PPP |

> Port numbering can shift if other USB serial devices are present. Check `dmesg | grep ttyUSB` after boot.

## ModemManager

**ModemManager** is a Linux daemon that auto-detects cellular modems and manages their lifecycle (SIM, network registration, data connections). It grabs the AT command port (`/dev/ttyUSB2`) on startup, which blocks our GPS scripts and firmware from using it.

### Check if ModemManager is running

```bash
systemctl status ModemManager
```

### Stop ModemManager (temporary, until next reboot)

```bash
sudo systemctl stop ModemManager
```

### Disable ModemManager (persists across reboots)

```bash
sudo systemctl stop ModemManager
sudo systemctl disable ModemManager
```

### Re-enable ModemManager

```bash
sudo systemctl enable ModemManager
sudo systemctl start ModemManager
```

### When do you need ModemManager?

- **Cellular data via NetworkManager** — ModemManager is required. NetworkManager uses it to bring up the LTE connection.
- **GPS only / manual AT commands** — ModemManager should be **disabled**. It locks the AT port and interferes with direct serial access.
- **Both cellular + GPS** — Use the udev rule below to let ModemManager manage the modem while keeping the GPS ports free.

## udev Rule: Let ModemManager Ignore GPS Ports

If you need cellular data **and** direct GPS access, create a udev rule to tell ModemManager to ignore specific ports rather than disabling it entirely.

```bash
# /etc/udev/rules.d/99-eg25g-gps.rules

# Tell ModemManager to ignore the Quectel EG25-G entirely
# (use this if you only need GPS, not cellular)
# SUBSYSTEM=="tty", ATTRS{idVendor}=="2c7c", ATTRS{idProduct}=="0125", ENV{ID_MM_DEVICE_IGNORE}="1"

# OR: only ignore NMEA and AT ports, let MM manage the modem port
# Adjust KERNEL patterns based on your actual port assignments
SUBSYSTEM=="tty", KERNEL=="ttyUSB1", ATTRS{idVendor}=="2c7c", ENV{ID_MM_PORT_IGNORE}="1"
SUBSYSTEM=="tty", KERNEL=="ttyUSB2", ATTRS{idVendor}=="2c7c", ENV{ID_MM_PORT_IGNORE}="1"
```

Apply the rule:

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
```

## Enabling GPS via AT Commands

The GNSS engine is off by default and must be enabled via the AT port before NMEA sentences will appear.

```bash
# Open a serial terminal to the AT port
sudo picocom -b 115200 /dev/ttyUSB2

# Basic connectivity check
AT
# Expected: OK

# Check GPS status
AT+QGPS?
# +QGPS: 0  means off, 1 means on

# Enable GPS
AT+QGPS=1
# Expected: OK (or ERROR if already enabled)

# Disable GPS (to save power)
AT+QGPSEND
# Expected: OK

# Query position directly (alternative to NMEA parsing)
AT+QGPSLOC=2
# Returns: +QGPSLOC: <UTC>,<lat>,<lon>,<hdop>,<alt>,<fix>,<cog>,<spkm>,<spkn>,<date>,<nsat>
# Returns: +CME ERROR: 516  if no fix yet
```

Exit picocom with `Ctrl-A` then `Ctrl-X`.

## Reading NMEA Output

Once GPS is enabled, NMEA sentences stream on the NMEA port:

```bash
sudo cat /dev/ttyUSB1
```

Key sentence types:
- `$GNRMC` / `$GPRMC` — Position, speed, and course (recommended for lat/lon)
- `$GNGGA` / `$GPGGA` — Fix quality, satellite count, altitude
- `$GNGSV` — Satellites in view (useful for debugging antenna issues)

## Test Script

Use `check_gps.py` in the repo root:

```bash
pip3 install pyserial
sudo python3 check_gps.py
```

This enables GPS via AT commands and prints parsed coordinates from NMEA.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Device or resource busy` on `/dev/ttyUSB2` | ModemManager holding the port | `sudo systemctl stop ModemManager` |
| No `/dev/ttyUSB*` devices | Module not powered or USB not connected | Check USB cable, check `lsusb` for `2c7c:0125` |
| NMEA sentences but no fix (`V` status) | No satellite lock | Move antenna outdoors, wait 1-3 min (cold start) |
| `+CME ERROR: 516` from `AT+QGPSLOC` | No fix yet | Wait for satellites, check antenna |
| Port numbers shifted | Other USB serial devices changed enumeration order | Check `dmesg \| grep ttyUSB`, update config |

## Useful AT Commands Reference

| Command | Description |
|---------|-------------|
| `AT+QGPS=1` | Enable GNSS engine |
| `AT+QGPSEND` | Disable GNSS engine |
| `AT+QGPS?` | Query GNSS engine status |
| `AT+QGPSLOC=2` | Get last known position |
| `AT+QGPSCFG="nmeasrc",1` | Enable NMEA output on AT port (instead of NMEA port) |
| `AT+QGPSCFG="gpsnmeatype",31` | Configure which NMEA sentences to output |
| `AT+QGPSCFG="gnssconfig",1` | GNSS constellation config (1=GPS only, 3=GPS+GLONASS, etc.) |
| `ATI` | Module identification |
| `AT+CPIN?` | SIM status |
| `AT+CSQ` | Signal strength |
| `AT+QENG="servingcell"` | Serving cell info |
