import gpiod
import time
import threading

CHIP = "/dev/gpiochip0"
FREQUENCY = 5  # 5 Hz base frequency
PERIOD = 1.0 / FREQUENCY

# All user-accessible GPIOs on the RPi Zero 2W 40-pin header
GPIOS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
         14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]

stop_event = threading.Event()


def pwm_loop(request, pin, duty_cycle):
    on_time = PERIOD * duty_cycle
    off_time = PERIOD - on_time
    while not stop_event.is_set():
        if on_time > 0:
            request.set_value(pin, gpiod.line.Value.ACTIVE)
            stop_event.wait(on_time)
        if off_time > 0:
            request.set_value(pin, gpiod.line.Value.INACTIVE)
            stop_event.wait(off_time)


config = {
    pin: gpiod.LineSettings(direction=gpiod.line.Direction.OUTPUT)
    for pin in GPIOS
}

request = gpiod.request_lines(CHIP, consumer="toggle_all_gpios", config=config)

# Spread duty cycles evenly: first GPIO ~4%, last ~100%
threads = []
for i, pin in enumerate(GPIOS):
    duty = (i + 1) / len(GPIOS)
    print(f"GPIO {pin:2d}: duty cycle {duty * 100:5.1f}%")
    t = threading.Thread(target=pwm_loop, args=(request, pin, duty), daemon=True)
    t.start()
    threads.append(t)

try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("\nStopping...")
    stop_event.set()
    for t in threads:
        t.join()
    for pin in GPIOS:
        request.set_value(pin, gpiod.line.Value.INACTIVE)
    request.release()
