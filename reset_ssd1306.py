import smbus2
import time

I2C_BUS = 1
ADDR = 0x3C

bus = smbus2.SMBus(I2C_BUS)

def cmd(c):
    bus.write_byte_data(ADDR, 0x00, c)

print("Step 1: Display OFF")
cmd(0xAE)
time.sleep(0.1)

print("Step 2: Set clock div")
cmd(0xD5); cmd(0x80)

print("Step 3: Set multiplex 64")
cmd(0xA8); cmd(0x3F)

print("Step 4: Set display offset 0")
cmd(0xD3); cmd(0x00)

print("Step 5: Set start line 0")
cmd(0x40)

print("Step 6: Charge pump ON")
cmd(0x8D); cmd(0x14)

print("Step 7: Memory mode horizontal")
cmd(0x20); cmd(0x00)

print("Step 8: Segment remap")
cmd(0xA1)

print("Step 9: COM scan direction")
cmd(0xC8)

print("Step 10: COM pins config")
cmd(0xDA); cmd(0x12)

print("Step 11: Contrast MAX")
cmd(0x81); cmd(0xFF)

print("Step 12: Precharge")
cmd(0xD9); cmd(0xF1)

print("Step 13: VCOMH deselect")
cmd(0xDB); cmd(0x40)

print("Step 14: Entire display ON (ignore RAM)")
cmd(0xA5)

print("Step 15: Normal (not inverted)")
cmd(0xA6)

print("Step 16: Display ON")
cmd(0xAF)

print()
print(">>> Screen should be ALL WHITE now (every pixel forced on)")
print(">>> If you see white, the display works. Press Enter to continue...")
input()

print("Step 17: Back to RAM mode")
cmd(0xA4)

print("Step 18: Filling RAM with checkerboard...")
# Set column and page range
cmd(0x21); cmd(0); cmd(127)  # column start/end
cmd(0x22); cmd(0); cmd(7)    # page start/end

for i in range(0, 1024, 32):
    page = i // 128
    buf = []
    for col in range(32):
        real_col = (i + col) % 128
        buf.append(0xAA if (page + real_col) % 2 == 0 else 0x55)
    bus.write_i2c_block_data(ADDR, 0x40, buf)

print()
print(">>> Screen should show CHECKERBOARD now.")
print(">>> If you see it, display is fully working!")

time.sleep(3)
bus.close()
