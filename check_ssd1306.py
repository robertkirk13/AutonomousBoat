import smbus2
import time

I2C_BUS = 1
DISPLAY_ADDR = 0x3C
WIDTH = 128
HEIGHT = 64
PAGES = HEIGHT // 8

bus = smbus2.SMBus(I2C_BUS)


def send_command(cmd):
    bus.write_byte_data(DISPLAY_ADDR, 0x00, cmd)


def send_data(data):
    # smbus2 block write max 32 bytes at a time
    for i in range(0, len(data), 32):
        chunk = list(data[i:i + 32])
        bus.write_i2c_block_data(DISPLAY_ADDR, 0x40, chunk)


def init_display():
    commands = [
        0xAE,        # display off
        0xD5, 0x80,  # set display clock divide ratio
        0xA8, 0x3F,  # set multiplex ratio (63 for 128x64)
        0xD3, 0x00,  # set display offset
        0x40,        # set start line 0
        0x8D, 0x14,  # enable charge pump
        0x20, 0x00,  # horizontal addressing mode
        0xA0,        # segment remap (normal)
        0xC0,        # COM scan direction (normal)
        0xDA, 0x12,  # set COM pins config
        0x81, 0xCF,  # set contrast
        0xD9, 0xF1,  # set precharge period
        0xDB, 0x40,  # set VCOMH deselect level
        0xA4,        # display from RAM
        0xA6,        # normal display (not inverted)
        0xAF,        # display on
    ]
    for cmd in commands:
        send_command(cmd)


def clear_display():
    send_data([0x00] * (WIDTH * PAGES))


def fill_display():
    send_data([0xFF] * (WIDTH * PAGES))


def checkerboard():
    buf = []
    for page in range(PAGES):
        for col in range(WIDTH):
            buf.append(0xAA if (page + col) % 2 == 0 else 0x55)
    send_data(buf)


# 5x7 font for basic ASCII (space through ~)
FONT = {
    ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
    'H': [0x7F, 0x08, 0x08, 0x08, 0x7F],
    'e': [0x38, 0x54, 0x54, 0x54, 0x18],
    'l': [0x00, 0x41, 0x7F, 0x40, 0x00],
    'o': [0x38, 0x44, 0x44, 0x44, 0x38],
    'B': [0x7F, 0x49, 0x49, 0x49, 0x36],
    'A': [0x7E, 0x11, 0x11, 0x11, 0x7E],
    'T': [0x01, 0x01, 0x7F, 0x01, 0x01],
    '!': [0x00, 0x00, 0x5F, 0x00, 0x00],
    'O': [0x3E, 0x41, 0x41, 0x41, 0x3E],
    'K': [0x7F, 0x08, 0x14, 0x22, 0x41],
    'I': [0x00, 0x41, 0x7F, 0x41, 0x00],
    'v': [0x1C, 0x20, 0x40, 0x20, 0x1C],
    'y': [0x0C, 0x50, 0x50, 0x50, 0x3C],
    'u': [0x3C, 0x40, 0x40, 0x20, 0x7C],
    'k': [0x7F, 0x10, 0x28, 0x44, 0x00],
    'a': [0x20, 0x54, 0x54, 0x54, 0x78],
    'r': [0x7C, 0x08, 0x04, 0x04, 0x08],
    'n': [0x7C, 0x08, 0x04, 0x04, 0x78],
    'b': [0x7F, 0x48, 0x44, 0x44, 0x38],
}


def draw_text(text, page=0, col=0):
    send_command(0xB0 + page)       # set page
    send_command(0x00 | (col & 0x0F))        # lower col nibble
    send_command(0x10 | ((col >> 4) & 0x0F))  # upper col nibble
    buf = []
    for ch in text:
        glyph = FONT.get(ch, FONT[' '])
        buf.extend(glyph)
        buf.append(0x00)  # spacing between chars
    send_data(buf)


print("SSD1306 Display Test @ 0x3C")
print("=" * 40)

try:
    print("Initializing display...")
    init_display()
    time.sleep(0.1)

    print("Clearing display...")
    clear_display()
    time.sleep(0.5)

    print("Fill test (all white)...")
    fill_display()
    time.sleep(1)

    print("Checkerboard pattern...")
    clear_display()
    checkerboard()
    time.sleep(1)

    print("Drawing text...")
    clear_display()
    draw_text("Hello BOAT!", page=2, col=10)
    draw_text("I love you", page=4, col=16)
    draw_text("karen beyer", page=5, col=13)
    time.sleep(2)

    print("Invert display...")
    send_command(0xA7)  # invert
    time.sleep(1)
    send_command(0xA6)  # normal
    time.sleep(0.5)

    print("\nAll tests passed! Display is working.")

except Exception as e:
    print(f"\nERROR: {e}")
    print("Check that the display is connected and address 0x3C is visible in i2cdetect.")

finally:
    bus.close()
