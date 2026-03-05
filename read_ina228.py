import smbus2
import time
import sys

I2C_BUS = 1
SENSORS = {"Left": 0x44, "Right": 0x45}
INTERVAL = 1.0

# Shunt / calibration
R_SHUNT = 0.001      # 1 mOhm
MAX_CURRENT = 40.0    # 40 A
CURRENT_LSB = MAX_CURRENT / (2**19)  # ~76.29 uA/LSB

# INA228 register addresses
REG_SHUNT_CAL = 0x02
REG_VBUS = 0x05
REG_CURRENT = 0x07
REG_POWER = 0x08

bus = smbus2.SMBus(I2C_BUS)


def write_16bit(addr, reg, value):
    msb = (value >> 8) & 0xFF
    lsb = value & 0xFF
    bus.write_word_data(addr, reg, (lsb << 8) | msb)


def read_24bit(addr, reg):
    data = bus.read_i2c_block_data(addr, reg, 3)
    return (data[0] << 16) | (data[1] << 8) | data[2]


def signed(val, bits):
    if val & (1 << (bits - 1)):
        val -= 1 << bits
    return val


# Calibrate all sensors
shunt_cal = int(13107.2e6 * CURRENT_LSB * R_SHUNT)
for name, addr in SENSORS.items():
    try:
        write_16bit(addr, REG_SHUNT_CAL, shunt_cal)
        print(f"Calibrated {name} (0x{addr:02X})")
    except OSError as e:
        print(f"Warning: {name} (0x{addr:02X}) not responding: {e}")

print()

try:
    while True:
        parts = []
        for name, addr in SENSORS.items():
            try:
                vbus_raw = read_24bit(addr, REG_VBUS) >> 4
                vbus_v = vbus_raw * 195.3125e-6

                current_raw = read_24bit(addr, REG_CURRENT) >> 4
                current_raw = signed(current_raw, 20)
                current_a = current_raw * CURRENT_LSB

                power_raw = read_24bit(addr, REG_POWER)
                power_w = power_raw * 3.2 * CURRENT_LSB

                parts.append(f"{name}: {vbus_v:.2f}V {current_a:.3f}A {power_w:.2f}W")
            except OSError:
                parts.append(f"{name}: ERROR")
        print("  |  ".join(parts))
        time.sleep(INTERVAL)
except KeyboardInterrupt:
    print("\nStopped.")
finally:
    bus.close()
