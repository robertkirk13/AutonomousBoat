import smbus2

I2C_BUS = 1
ADDRESS = 0x45

bus = smbus2.SMBus(I2C_BUS)


def read_16bit(reg):
    raw = bus.read_word_data(ADDRESS, reg)
    return ((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF)


def read_24bit(reg):
    data = bus.read_i2c_block_data(ADDRESS, reg, 3)
    return (data[0] << 16) | (data[1] << 8) | data[2]


# Manufacturer ID (0x3E) - expect 0x5449 ("TI")
mfr = read_16bit(0x3E)
print(f"Manufacturer ID: 0x{mfr:04X} (expect 0x5449)")

# Device ID (0x3F) - expect 0x2280 for INA228
dev = read_16bit(0x3F)
print(f"Device ID:       0x{dev:04X} (expect 0x2280)")

# Config register (0x00)
cfg = read_16bit(0x00)
print(f"Config:          0x{cfg:04X}")

# Shunt voltage raw (0x04)
shunt_raw = read_24bit(0x04)
print(f"Shunt voltage raw: {shunt_raw} (0x{shunt_raw:06X})")

# Bus voltage raw (0x05)
vbus_raw = read_24bit(0x05)
print(f"Bus voltage raw:   {vbus_raw} (0x{vbus_raw:06X})")

bus.close()
