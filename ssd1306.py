from luma.core.interface.serial import i2c
from luma.oled.device import ssd1306
from luma.core.render import canvas
from PIL import ImageFont

WIDTH = 128
HEIGHT = 64

# Use the built-in default font (Pillow bitmap font)
FONT = ImageFont.load_default()


class Display:
    def __init__(self, port=1, address=0x3C):
        serial = i2c(port=port, address=address)
        self.device = ssd1306(serial, width=WIDTH, height=HEIGHT, rotate=2)

    def clear(self):
        with canvas(self.device) as draw:
            draw.rectangle((0, 0, WIDTH - 1, HEIGHT - 1), fill="black")

    def off(self):
        self.device.hide()

    def draw(self, callback):
        """Call callback(draw) with a Pillow ImageDraw context."""
        with canvas(self.device) as draw:
            callback(draw)
