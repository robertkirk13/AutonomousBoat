import smbus2
import time
import signal
from ssd1306 import Display, WIDTH, HEIGHT, FONT

I2C_BUS = 1

# INA228 addresses
INA_DOCK   = 0x47
INA_LBATT  = 0x44
INA_LMOTOR = 0x40
INA_CORE   = 0x48
INA_SOLAR  = 0x46
INA_RBATT  = 0x45
INA_RMOTOR = 0x41

# INA228 calibration
R_SHUNT = 0.001
MAX_CURRENT = 35.0
CURRENT_LSB = MAX_CURRENT / (2**19)

bus = smbus2.SMBus(I2C_BUS)
display = Display()

# ── INA228 functions ──

def write_16bit(addr, reg, value):
    msb = (value >> 8) & 0xFF
    lsb = value & 0xFF
    bus.write_word_data(addr, reg, (lsb << 8) | msb)

def read_24bit(addr, reg):
    data = bus.read_i2c_block_data(addr, reg, 3)
    return (data[0] << 16) | (data[1] << 8) | data[2]

def signed(val, bits):
    if val & (1 << (bits - 1)):
        val -= 1 << bits
    return val

def read_power(addr):
    vbus_raw = read_24bit(addr, 0x05) >> 4
    vbus = vbus_raw * 195.3125e-6
    cur_raw = signed(read_24bit(addr, 0x07) >> 4, 20)
    current = cur_raw * CURRENT_LSB
    pwr_raw = read_24bit(addr, 0x08)
    power = pwr_raw * 3.2 * CURRENT_LSB
    if current < 0:
        power = -power
    return vbus, current, power

def fmt_power_signed(watts):
    sign = '+' if watts >= 0 else '-'
    return f"{sign}{abs(watts):.2f}W"

def fmt_power_abs(watts):
    return f"{abs(watts):.2f}W"

def estimate_soc(voltage):
    soc = (voltage - 10.0) / (12.6 - 10.0) * 100
    return max(0, min(100, soc))

# ── Calibrate all INA228s ──

shunt_cal = int(13107.2e6 * CURRENT_LSB * R_SHUNT)
for addr in [INA_DOCK, INA_LBATT, INA_LMOTOR, INA_CORE, INA_SOLAR, INA_RBATT, INA_RMOTOR]:
    try:
        write_16bit(addr, 0x02, shunt_cal)
    except OSError:
        pass

# ── Signal handling ──

running = True

def handle_signal(signum, frame):
    global running
    print(f"Received signal {signum}, shutting down...", flush=True)
    running = False

signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)

# ── Main loop ──

print("Initializing display...", flush=True)

def render(draw, readings):
    # Title centered
    title = "WILSON"
    tw = draw.textlength(title, font=FONT)
    draw.text(((WIDTH - tw) / 2, 24), title, fill="white", font=FONT)

    # Row 0: DOCK left, SOLAR right
    dock_txt = fmt_power_abs(readings["DOCK"][2])
    sol_txt = fmt_power_abs(readings["SOL"][2])
    draw.text((0, 0), dock_txt, fill="white", font=FONT)
    sw = draw.textlength(sol_txt, font=FONT)
    draw.text((WIDTH - sw, 0), sol_txt, fill="white", font=FONT)

    # Row 2: LBATT / RBATT power (signed)
    lbat_v, _, lbat_p = readings["LBAT"]
    rbat_v, _, rbat_p = readings["RBAT"]

    lbat_txt = fmt_power_signed(lbat_p)
    rbat_txt = fmt_power_signed(rbat_p)
    draw.text((0, 16), lbat_txt, fill="white", font=FONT)
    rw = draw.textlength(rbat_txt, font=FONT)
    draw.text((WIDTH - rw, 16), rbat_txt, fill="white", font=FONT)

    # Row 3: SOC percentages
    lsoc = f"{estimate_soc(lbat_v):.0f}%"
    rsoc = f"{estimate_soc(rbat_v):.0f}%"
    draw.text((0, 28), lsoc, fill="white", font=FONT)
    rsw = draw.textlength(rsoc, font=FONT)
    draw.text((WIDTH - rsw, 28), rsoc, fill="white", font=FONT)

    # Bottom row: LMOTOR, CORE, RMOTOR
    lmot_txt = fmt_power_abs(readings["LMOT"][2])
    core_txt = fmt_power_abs(readings["CORE"][2])
    rmot_txt = fmt_power_abs(readings["RMOT"][2])

    draw.text((0, 54), lmot_txt, fill="white", font=FONT)
    cw = draw.textlength(core_txt, font=FONT)
    draw.text(((WIDTH - cw) / 2, 54), core_txt, fill="white", font=FONT)
    mw = draw.textlength(rmot_txt, font=FONT)
    draw.text((WIDTH - mw, 54), rmot_txt, fill="white", font=FONT)

print("Entering main loop...", flush=True)

while running:
    try:
        readings = {}
        for name, addr in [
            ("DOCK", INA_DOCK), ("LBAT", INA_LBATT), ("LMOT", INA_LMOTOR),
            ("CORE", INA_CORE), ("SOL", INA_SOLAR), ("RBAT", INA_RBATT),
            ("RMOT", INA_RMOTOR),
        ]:
            try:
                readings[name] = read_power(addr)
            except OSError:
                readings[name] = (0, 0, 0)

        display.draw(lambda draw: render(draw, readings))

    except OSError as e:
        print(f"Display I2C error: {e}", flush=True)

    time.sleep(1)

print("Cleaning up...", flush=True)
try:
    display.clear()
    display.off()
except OSError:
    pass
bus.close()
print("Stopped.", flush=True)
