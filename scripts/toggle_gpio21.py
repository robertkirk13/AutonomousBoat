import gpiod
import time

CHIP = "/dev/gpiochip0"
LINE = 21
TOGGLE_HZ = 5
PERIOD = 1.0 / TOGGLE_HZ

request = gpiod.request_lines(
    CHIP,
    consumer="toggle_gpio21",
    config={LINE: gpiod.LineSettings(direction=gpiod.line.Direction.OUTPUT)},
)

try:
    value = gpiod.line.Value.INACTIVE
    while True:
        value = (
            gpiod.line.Value.ACTIVE
            if value == gpiod.line.Value.INACTIVE
            else gpiod.line.Value.INACTIVE
        )
        request.set_value(LINE, value)
        time.sleep(PERIOD)
except KeyboardInterrupt:
    request.set_value(LINE, gpiod.line.Value.INACTIVE)
finally:
    request.release()
