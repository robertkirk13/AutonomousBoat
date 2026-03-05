import gpiod
import time

CHIP = "/dev/gpiochip0"
LINE = 21
TOGGLE_HZ = 5
PERIOD = 1.0 / TOGGLE_HZ

chip = gpiod.Chip(CHIP)
line = chip.get_line(LINE)
line.request(consumer="toggle_gpio21", type=gpiod.LINE_REQ_DIR_OUT)

try:
    value = 0
    while True:
        value ^= 1
        line.set_value(value)
        time.sleep(PERIOD)
except KeyboardInterrupt:
    line.set_value(0)
finally:
    line.release()
