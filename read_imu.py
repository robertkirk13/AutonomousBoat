import smbus2
import time

I2C_BUS = 1
BNO055_ADDR = 0x28

# BNO055 registers
OPR_MODE = 0x3D
EUL_HEADING_LSB = 0x1A  # Euler heading, roll, pitch (6 bytes)

# Operating modes
CONFIG_MODE = 0x00
NDOF_MODE = 0x0C

INTERVAL = 0.5  # seconds between reads

bus = smbus2.SMBus(I2C_BUS)


def setup_bno055():
    # Switch to config mode
    bus.write_byte_data(BNO055_ADDR, OPR_MODE, CONFIG_MODE)
    time.sleep(0.03)
    # Switch to NDOF (full fusion) mode
    bus.write_byte_data(BNO055_ADDR, OPR_MODE, NDOF_MODE)
    time.sleep(0.02)


def read_euler():
    # Read 6 bytes: heading LSB, heading MSB, roll LSB, roll MSB, pitch LSB, pitch MSB
    data = bus.read_i2c_block_data(BNO055_ADDR, EUL_HEADING_LSB, 6)
    heading = (data[1] << 8) | data[0]
    roll = (data[3] << 8) | data[2]
    pitch = (data[5] << 8) | data[4]
    # Convert to signed
    if heading > 32767:
        heading -= 65536
    if roll > 32767:
        roll -= 65536
    if pitch > 32767:
        pitch -= 65536
    # BNO055 Euler angles are in units of 1/16 degree
    return heading / 16.0, roll / 16.0, pitch / 16.0


setup_bno055()
print("Reading BNO055 Euler angles (Ctrl+C to stop)\n")

try:
    while True:
        heading, roll, pitch = read_euler()
        print(f"Heading: {heading:7.2f}°  Roll: {roll:7.2f}°  Pitch: {pitch:7.2f}°")
        time.sleep(INTERVAL)
except KeyboardInterrupt:
    print("\nStopped.")
finally:
    bus.close()
