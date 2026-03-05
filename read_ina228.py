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
REG_CONFIG = 0x00
REG_SHUNT_CAL = 0x02
REG_VBUS = 0x05
REG_DIETEMP = 0x06
REG_CURRENT = 0x07
REG_POWER = 0x08
REG_ENERGY = 0x09
REG_CHARGE = 0x0A

bus = smbus2.SMBus(I2C_BUS)


def write_16bit(addr, reg, value):
    msb = (value >> 8) & 0xFF
    lsb = value & 0xFF
    bus.write_word_data(addr, reg, (lsb << 8) | msb)


def read_24bit(addr, reg):
    data = bus.read_i2c_block_data(addr, reg, 3)
    return (data[0] << 16) | (data[1] << 8) | data[2]


def read_40bit(addr, reg):
    data = bus.read_i2c_block_data(addr, reg, 5)
    return (data[0] << 32) | (data[1] << 24) | (data[2] << 16) | (data[3] << 8) | data[4]


def signed(val, bits):
    if val & (1 << (bits - 1)):
        val -= 1 << bits
    return val


# Energy LSB = 16 * 3.2 * CURRENT_LSB (in joules)
ENERGY_LSB = 16 * 3.2 * CURRENT_LSB

# Charge LSB = CURRENT_LSB (in coulombs)
CHARGE_LSB = CURRENT_LSB

# Calibrate and reset accumulators on all sensors
shunt_cal = int(13107.2e6 * CURRENT_LSB * R_SHUNT)
for name, addr in SENSORS.items():
    try:
        write_16bit(addr, REG_SHUNT_CAL, shunt_cal)
        # Reset energy/charge accumulators by setting RSTACC bit (bit 14) in CONFIG
        cfg = ((bus.read_word_data(addr, REG_CONFIG) & 0xFF) << 8) | ((bus.read_word_data(addr, REG_CONFIG) >> 8) & 0xFF)
        write_16bit(addr, REG_CONFIG, cfg | 0x4000)
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

                energy_raw = read_40bit(addr, REG_ENERGY)
                energy_j = energy_raw * ENERGY_LSB
                energy_wh = energy_j / 3600.0

                charge_raw = read_40bit(addr, REG_CHARGE)
                charge_raw = signed(charge_raw, 40)
                charge_c = charge_raw * CHARGE_LSB
                charge_ah = charge_c / 3600.0

                parts.append(f"{name}: {vbus_v:.2f}V {current_a:.3f}A {power_w:.2f}W {energy_wh:.4f}Wh {charge_ah:.4f}Ah")
            except OSError:
                parts.append(f"{name}: ERROR")
        print("  |  ".join(parts))
        time.sleep(INTERVAL)
except KeyboardInterrupt:
    print("\nStopped.")
finally:
    bus.close()
