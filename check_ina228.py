import smbus2

I2C_BUS = 1
ADDRESSES = {
    0x40: "left_motor",
    0x41: "right_motor",
    0x42: "payload",
    0x43: "reel",
    0x44: "left_battery",
    0x45: "right_battery",
    0x46: "solar",
    0x47: "dock_charger",
    0x48: "core_digital",
}

bus = smbus2.SMBus(I2C_BUS)


def read_16bit(addr, reg):
    raw = bus.read_word_data(addr, reg)
    return ((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF)


def read_24bit(addr, reg):
    data = bus.read_i2c_block_data(addr, reg, 3)
    return (data[0] << 16) | (data[1] << 8) | data[2]


def check_ina228(addr, label):
    print(f"\n{'='*50}")
    print(f"  INA228 @ 0x{addr:02X} ({label})")
    print(f"{'='*50}")

    # Manufacturer ID (0x3E) - expect 0x5449 ("TI")
    mfr = read_16bit(addr, 0x3E)
    print(f"Manufacturer ID: 0x{mfr:04X} (expect 0x5449)")

    # Device ID (0x3F) - expect 0x2280 for INA228
    dev = read_16bit(addr, 0x3F)
    print(f"Device ID:       0x{dev:04X} (expect 0x2280)")

    # Config register (0x00)
    cfg = read_16bit(addr, 0x00)
    print(f"Config:          0x{cfg:04X}")

    # Shunt voltage raw (0x04)
    shunt_raw = read_24bit(addr, 0x04)
    print(f"Shunt voltage raw: {shunt_raw} (0x{shunt_raw:06X})")

    # Bus voltage raw (0x05) - dump individual bytes
    vbus_bytes = bus.read_i2c_block_data(addr, 0x05, 3)
    print(f"Bus voltage bytes: [{vbus_bytes[0]:02X}, {vbus_bytes[1]:02X}, {vbus_bytes[2]:02X}]")
    vbus_raw = (vbus_bytes[0] << 16) | (vbus_bytes[1] << 8) | vbus_bytes[2]
    print(f"Bus voltage raw:   {vbus_raw} (0x{vbus_raw:06X})")
    # Try interpreting different ways
    print(f"  >> 4 * 195.3125uV = {(vbus_raw >> 4) * 195.3125e-6:.4f} V")
    print(f"  no shift * 195.3125uV = {vbus_raw * 195.3125e-6:.4f} V")

    # Also try reading VBUS as 16-bit (reg 0x05) in case it's not 24-bit on this rev
    vbus_16 = read_16bit(addr, 0x05)
    print(f"Bus voltage 16bit: 0x{vbus_16:04X} = {vbus_16}")
    print(f"  * 195.3125uV = {vbus_16 * 195.3125e-6:.4f} V")
    print(f"  >> 4 * 195.3125uV = {(vbus_16 >> 4) * 195.3125e-6:.4f} V")
    print(f"  * 1.6mV (INA226 scale) = {vbus_16 * 1.6e-3:.4f} V")

    # ADC config register (0x01)
    adc_cfg = read_16bit(addr, 0x01)
    print(f"ADC Config:        0x{adc_cfg:04X}")


for addr, label in ADDRESSES.items():
    try:
        check_ina228(addr, label)
    except Exception as e:
        print(f"\n0x{addr:02X} ({label}): ERROR - {e}")

bus.close()
