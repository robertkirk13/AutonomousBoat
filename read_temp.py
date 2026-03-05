import smbus2
import time

I2C_BUS = 1
ADDRESS = 0x4A
TEMP_REG = 0x00
INTERVAL = 1.0  # seconds between reads

bus = smbus2.SMBus(I2C_BUS)

try:
    while True:
        raw = bus.read_word_data(ADDRESS, TEMP_REG)
        # TMP1075 returns MSB first, smbus reads LSB first — swap bytes
        raw = ((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF)
        # Temperature is in the upper 12 bits, 0.0625°C per LSB
        raw >>= 4
        if raw & 0x800:
            raw -= 4096
        temp_c = raw * 0.0625
        temp_f = temp_c * 9.0 / 5.0 + 32.0
        print(f"{temp_c:.2f}°C / {temp_f:.2f}°F")
        time.sleep(INTERVAL)
except KeyboardInterrupt:
    print("\nStopped.")
finally:
    bus.close()
