import smbus2
import time

I2C_BUS = 1
ADDRESS = 0x45
INTERVAL = 1.0

# Shunt / calibration
R_SHUNT = 0.001      # 1 mOhm
MAX_CURRENT = 40.0    # 40 A
CURRENT_LSB = MAX_CURRENT / (2**19)  # ~76.29 uA/LSB

# INA228 register addresses
REG_CONFIG = 0x00
REG_SHUNT_CAL = 0x02
REG_VBUS = 0x05
REG_CURRENT = 0x07
REG_POWER = 0x08

bus = smbus2.SMBus(I2C_BUS)


def write_16bit(reg, value):
    msb = (value >> 8) & 0xFF
    lsb = value & 0xFF
    bus.write_word_data(ADDRESS, reg, (lsb << 8) | msb)


# Write calibration register: SHUNT_CAL = 13107.2 * 10^6 * CURRENT_LSB * R_SHUNT
shunt_cal = int(13107.2e6 * CURRENT_LSB * R_SHUNT)
write_16bit(REG_SHUNT_CAL, shunt_cal)


def read_16bit(reg):
    raw = bus.read_word_data(ADDRESS, reg)
    return ((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF)


def read_24bit(reg):
    data = bus.read_i2c_block_data(ADDRESS, reg, 3)
    return (data[0] << 16) | (data[1] << 8) | data[2]


def signed(val, bits):
    if val & (1 << (bits - 1)):
        val -= 1 << bits
    return val


try:
    while True:
        # Bus voltage: 195.3125 uV/LSB, upper 20 bits of 24-bit register
        vbus_raw = read_24bit(REG_VBUS) >> 4
        vbus_v = vbus_raw * 195.3125e-6

        # Current: CURRENT_LSB per LSB, upper 20 bits of 24-bit register, signed
        current_raw = read_24bit(REG_CURRENT) >> 4
        current_raw = signed(current_raw, 20)
        current_a = current_raw * CURRENT_LSB

        # Power: 3.2 * CURRENT_LSB per LSB, 24-bit unsigned
        power_raw = read_24bit(REG_POWER)
        power_w = power_raw * 3.2 * CURRENT_LSB

        print(f"Bus: {vbus_v:.3f} V  |  Current: {current_a:.3f} A  |  Power: {power_w:.3f} W")
        time.sleep(INTERVAL)
except KeyboardInterrupt:
    print("\nStopped.")
finally:
    bus.close()
