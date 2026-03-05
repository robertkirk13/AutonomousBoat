import smbus2
import time

I2C_BUS = 1
ADDRESS = 0x45
INTERVAL = 1.0

# INA228 register addresses
REG_VBUS = 0x05
REG_CURRENT = 0x07
REG_POWER = 0x08

bus = smbus2.SMBus(I2C_BUS)


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

        # Current: depends on calibration, default uncalibrated reads raw
        current_raw = read_24bit(REG_CURRENT) >> 4
        current_raw = signed(current_raw, 20)

        # Power: 3.2 * current_LSB * 2^18, raw 24-bit unsigned
        power_raw = read_24bit(REG_POWER)

        print(f"Bus: {vbus_v:.3f} V  |  Current raw: {current_raw}  |  Power raw: {power_raw}")
        time.sleep(INTERVAL)
except KeyboardInterrupt:
    print("\nStopped.")
finally:
    bus.close()
