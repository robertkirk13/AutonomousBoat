import smbus2

WIDTH = 128
HEIGHT = 64
PAGES = HEIGHT // 8

# 5x7 font
FONT = {
    ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
    '0': [0x3E, 0x51, 0x49, 0x45, 0x3E],
    '1': [0x00, 0x42, 0x7F, 0x40, 0x00],
    '2': [0x42, 0x61, 0x51, 0x49, 0x46],
    '3': [0x21, 0x41, 0x45, 0x4B, 0x31],
    '4': [0x18, 0x14, 0x12, 0x7F, 0x10],
    '5': [0x27, 0x45, 0x45, 0x45, 0x39],
    '6': [0x3C, 0x4A, 0x49, 0x49, 0x30],
    '7': [0x01, 0x71, 0x09, 0x05, 0x03],
    '8': [0x36, 0x49, 0x49, 0x49, 0x36],
    '9': [0x06, 0x49, 0x49, 0x29, 0x1E],
    '.': [0x00, 0x60, 0x60, 0x00, 0x00],
    '-': [0x08, 0x08, 0x08, 0x08, 0x08],
    '+': [0x08, 0x08, 0x3E, 0x08, 0x08],
    'W': [0x3F, 0x40, 0x38, 0x40, 0x3F],
    'I': [0x00, 0x41, 0x7F, 0x41, 0x00],
    'L': [0x7F, 0x40, 0x40, 0x40, 0x40],
    'N': [0x7F, 0x04, 0x08, 0x10, 0x7F],
    'O': [0x3E, 0x41, 0x41, 0x41, 0x3E],
    'S': [0x46, 0x49, 0x49, 0x49, 0x31],
    '%': [0x23, 0x13, 0x08, 0x64, 0x62],
}

ICON_CHECK = [0x00, 0x20, 0x40, 0x40, 0x20, 0x10, 0x08, 0x00]
ICON_X = [0x00, 0x41, 0x22, 0x14, 0x08, 0x14, 0x22, 0x41]


class SSD1306:
    def __init__(self, bus, addr=0x3C):
        self.bus = bus
        self.addr = addr
        self._prev = {}

    def send_command(self, cmd):
        self.bus.write_byte_data(self.addr, 0x00, cmd)

    def send_data(self, data):
        for i in range(0, len(data), 32):
            self.bus.write_i2c_block_data(self.addr, 0x40, list(data[i:i + 32]))

    def init(self):
        for cmd in [
            0xAE, 0xD5, 0x80, 0xA8, 0x3F, 0xD3, 0x00, 0x40,
            0x8D, 0x14, 0x20, 0x00, 0xA0, 0xC0, 0xDA, 0x12,
            0x81, 0xFF, 0xD9, 0xF1, 0xDB, 0x40, 0xA4, 0xA6, 0xAF,
        ]:
            self.send_command(cmd)

    def clear(self):
        self.send_data([0x00] * (WIDTH * PAGES))

    def off(self):
        self.send_command(0xAE)

    def set_cursor(self, page, col):
        self.send_command(0xB0 + page)
        self.send_command(0x00 | (col & 0x0F))
        self.send_command(0x10 | ((col >> 4) & 0x0F))

    def draw_text(self, text, page, col):
        self.set_cursor(page, col)
        buf = []
        for ch in text:
            buf.extend(FONT.get(ch, FONT[' ']))
            buf.append(0x00)
        self.send_data(buf)

    def draw_text_padded(self, text, page, col, width):
        self.set_cursor(page, col)
        buf = []
        for ch in text:
            buf.extend(FONT.get(ch, FONT[' ']))
            buf.append(0x00)
        if len(buf) < width:
            buf.extend([0x00] * (width - len(buf)))
        self.send_data(buf[:width])

    def draw_text_right(self, text, page, col, width):
        self.set_cursor(page, col)
        buf = []
        for ch in text:
            buf.extend(FONT.get(ch, FONT[' ']))
            buf.append(0x00)
        pad = width - len(buf)
        if pad > 0:
            buf = [0x00] * pad + buf
        self.send_data(buf[:width])

    def draw_bitmap(self, bitmap, page, col):
        self.set_cursor(page, col)
        self.send_data(bitmap)

    def update_field(self, key, text, page, col, width, align="left"):
        if self._prev.get(key) != text:
            if align == "right":
                self.draw_text_right(text, page, col, width)
            else:
                self.draw_text_padded(text, page, col, width)
            self._prev[key] = text

    @staticmethod
    def text_width(text):
        return len(text) * 6
