import smbus2
import time

I2C_BUS = 1
SENSORS = {"Left": 0x4A, "Right": 0x4B}
TEMP_REG = 0x00
INTERVAL = 1.0  # seconds between reads

bus = smbus2.SMBus(I2C_BUS)


def read_tmp1075(address):
    raw = bus.read_word_data(address, TEMP_REG)
    # TMP1075 returns MSB first, smbus reads LSB first — swap bytes
    raw = ((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF)
    # Temperature is in the upper 12 bits, 0.0625°C per LSB
    raw >>= 4
    if raw & 0x800:
        raw -= 4096
    return raw * 0.0625


try:
    while True:
        parts = []
        for name, addr in SENSORS.items():
            temp_c = read_tmp1075(addr)
            temp_f = temp_c * 9.0 / 5.0 + 32.0
            parts.append(f"{name}: {temp_c:.2f}°C / {temp_f:.2f}°F")
        print("  |  ".join(parts))
        time.sleep(INTERVAL)
except KeyboardInterrupt:
    print("\nStopped.")
finally:
    bus.close()
