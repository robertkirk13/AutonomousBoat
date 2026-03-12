import smbus2
import time
import signal
from ssd1306 import SSD1306, WIDTH

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
display = SSD1306(bus)

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

# ── Layout constants ──
FIELD_W = 42
SOC_W = 30
BOT_W = 36

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
display.init()
print("Clearing display...", flush=True)
display.clear()

# Draw static elements once
wilson_w = SSD1306.text_width("WILSON")
wil_col = (WIDTH - wilson_w) // 2
display.draw_text("WILSON", page=3, col=wil_col)

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

        # Page 0: DOCK left, SOLAR right
        display.update_field("dock", fmt_power_abs(readings["DOCK"][2]), 0, 0, FIELD_W)
        display.update_field("sol", fmt_power_abs(readings["SOL"][2]), 0, WIDTH - FIELD_W, FIELD_W, align="right")

        # Page 2-3: LBATT left, RBATT right (signed)
        lbat_v, _, lbat_p = readings["LBAT"]
        display.update_field("lbat_p", fmt_power_signed(lbat_p), 2, 0, FIELD_W)
        display.update_field("lbat_s", f"{estimate_soc(lbat_v):.0f}%", 3, 0, SOC_W)

        rbat_v, _, rbat_p = readings["RBAT"]
        display.update_field("rbat_p", fmt_power_signed(rbat_p), 2, WIDTH - FIELD_W, FIELD_W, align="right")
        display.update_field("rbat_s", f"{estimate_soc(rbat_v):.0f}%", 3, WIDTH - SOC_W, SOC_W, align="right")

        # Page 6: LMOTOR left, CORE center, RMOTOR right
        display.update_field("lmot", fmt_power_abs(readings["LMOT"][2]), 6, 0, BOT_W)
        bot_center = (WIDTH - BOT_W) // 2
        display.update_field("core", fmt_power_abs(readings["CORE"][2]), 6, bot_center, BOT_W)
        display.update_field("rmot", fmt_power_abs(readings["RMOT"][2]), 6, WIDTH - BOT_W, BOT_W, align="right")

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
