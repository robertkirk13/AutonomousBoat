import smbus2

I2C_BUS = 1
bus = smbus2.SMBus(I2C_BUS)

# Scan for all devices on the bus
print("Scanning I2C bus for devices...")
found = []
for addr in range(0x03, 0x78):
    try:
        bus.read_byte(addr)
        found.append(addr)
        print(f"  Found device at 0x{addr:02X}")
    except OSError:
        pass

if not found:
    print("  No devices found!")

print()

# Check each expected INA228
EXPECTED = {"Left": 0x44, "Right": 0x45, "Aux": 0x40}

def read_16bit(addr, reg):
    raw = bus.read_word_data(addr, reg)
    return ((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF)

for name, addr in EXPECTED.items():
    print(f"--- {name} (0x{addr:02X}) ---")
    if addr not in found:
        print("  NOT FOUND on bus!")
        continue
    try:
        mfr = read_16bit(addr, 0x3E)
        dev = read_16bit(addr, 0x3F)
        cfg = read_16bit(addr, 0x00)
        adc = read_16bit(addr, 0x01)
        print(f"  Manufacturer ID: 0x{mfr:04X} (expect 0x5449)")
        print(f"  Device ID:       0x{dev:04X} (expect 0x2280)")
        print(f"  Config:          0x{cfg:04X}")
        print(f"  ADC Config:      0x{adc:04X}")
    except OSError as e:
        print(f"  Error reading registers: {e}")

bus.close()
