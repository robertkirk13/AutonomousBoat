import smbus2
import time
import subprocess

I2C_BUS = 1
DISPLAY_ADDR = 0x3C
WIDTH = 128
HEIGHT = 64
PAGES = HEIGHT // 8

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

# Battery capacity for SOC estimate (Ah)
BATT_CAPACITY_AH = 6.0

bus = smbus2.SMBus(I2C_BUS)

# ── Display functions ──

def send_command(cmd):
    bus.write_byte_data(DISPLAY_ADDR, 0x00, cmd)

def send_data(data):
    for i in range(0, len(data), 32):
        bus.write_i2c_block_data(DISPLAY_ADDR, 0x40, list(data[i:i + 32]))

def init_display():
    for cmd in [
        0xAE, 0xD5, 0x80, 0xA8, 0x3F, 0xD3, 0x00, 0x40,
        0x8D, 0x14, 0x20, 0x00, 0xA0, 0xC0, 0xDA, 0x12,
        0x81, 0xCF, 0xD9, 0xF1, 0xDB, 0x40, 0xA4, 0xA6, 0xAF,
    ]:
        send_command(cmd)

def clear_display():
    send_data([0x00] * (WIDTH * PAGES))

# 5x7 font - characters needed for the dashboard
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
    'A': [0x7E, 0x11, 0x11, 0x11, 0x7E],
    'B': [0x7F, 0x49, 0x49, 0x49, 0x36],
    'C': [0x3E, 0x41, 0x41, 0x41, 0x22],
    'D': [0x7F, 0x41, 0x41, 0x22, 0x1C],
    'K': [0x7F, 0x08, 0x14, 0x22, 0x41],
    'L': [0x7F, 0x40, 0x40, 0x40, 0x40],
    'M': [0x7F, 0x02, 0x0C, 0x02, 0x7F],
    'O': [0x3E, 0x41, 0x41, 0x41, 0x3E],
    'R': [0x7F, 0x09, 0x19, 0x29, 0x46],
    'S': [0x46, 0x49, 0x49, 0x49, 0x31],
    'T': [0x01, 0x01, 0x7F, 0x01, 0x01],
    'E': [0x7F, 0x49, 0x49, 0x49, 0x41],
    'H': [0x7F, 0x08, 0x08, 0x08, 0x7F],
    'I': [0x00, 0x41, 0x7F, 0x41, 0x00],
    'N': [0x7F, 0x04, 0x08, 0x10, 0x7F],
    'P': [0x7F, 0x09, 0x09, 0x09, 0x06],
    'a': [0x20, 0x54, 0x54, 0x54, 0x78],
    'd': [0x38, 0x44, 0x44, 0x48, 0x7F],
    'e': [0x38, 0x54, 0x54, 0x54, 0x18],
    'h': [0x7F, 0x08, 0x04, 0x04, 0x78],
    'k': [0x7F, 0x10, 0x28, 0x44, 0x00],
    'n': [0x7C, 0x08, 0x04, 0x04, 0x78],
    'o': [0x38, 0x44, 0x44, 0x44, 0x38],
    'r': [0x7C, 0x08, 0x04, 0x04, 0x08],
    'y': [0x0C, 0x50, 0x50, 0x50, 0x3C],
    '%': [0x23, 0x13, 0x08, 0x64, 0x62],
    'w': [0x3C, 0x40, 0x30, 0x40, 0x3C],
    't': [0x04, 0x3F, 0x44, 0x40, 0x20],
}

# 8x8 heart bitmap (1 page tall)
HEART = [
    0x0C, 0x1E, 0x3E, 0x7C, 0x7C, 0x3E, 0x1E, 0x0C,
]

# 8x8 wifi icon (signal arcs + dot)
WIFI_ON = [
    0x02, 0x05, 0x12, 0x24, 0x24, 0x12, 0x05, 0x02,
]

# 8x8 checkmark
ICON_CHECK = [
    0x00, 0x20, 0x40, 0x40, 0x20, 0x10, 0x08, 0x00,
]

# 8x8 X mark
ICON_X = [
    0x00, 0x41, 0x22, 0x14, 0x08, 0x14, 0x22, 0x41,
]

def set_cursor(page, col):
    send_command(0xB0 + page)
    send_command(0x00 | (col & 0x0F))
    send_command(0x10 | ((col >> 4) & 0x0F))

def draw_text(text, page, col):
    set_cursor(page, col)
    buf = []
    for ch in text:
        buf.extend(FONT.get(ch, FONT[' ']))
        buf.append(0x00)
    send_data(buf)

def draw_text_padded(text, page, col, width):
    """Draw text left-aligned and pad with blanks to fill exactly `width` pixels."""
    set_cursor(page, col)
    buf = []
    for ch in text:
        buf.extend(FONT.get(ch, FONT[' ']))
        buf.append(0x00)
    if len(buf) < width:
        buf.extend([0x00] * (width - len(buf)))
    send_data(buf[:width])

def draw_text_right(text, page, col, width):
    """Draw text right-aligned within `width` pixels starting at `col`."""
    set_cursor(page, col)
    buf = []
    for ch in text:
        buf.extend(FONT.get(ch, FONT[' ']))
        buf.append(0x00)
    pad = width - len(buf)
    if pad > 0:
        buf = [0x00] * pad + buf
    send_data(buf[:width])

def draw_bitmap(bitmap, page, col):
    set_cursor(page, col)
    send_data(bitmap)

def text_width(text):
    return len(text) * 6  # 5px glyph + 1px spacing

# Track previous values to only redraw what changed
prev = {}

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
    """Returns (voltage_V, current_A, power_W)"""
    vbus_raw = read_24bit(addr, 0x05) >> 4
    vbus = vbus_raw * 195.3125e-6

    cur_raw = signed(read_24bit(addr, 0x07) >> 4, 20)
    current = cur_raw * CURRENT_LSB

    pwr_raw = read_24bit(addr, 0x08)
    power = pwr_raw * 3.2 * CURRENT_LSB

    # Sign power based on current direction
    if current < 0:
        power = -power

    return vbus, current, power

def fmt_power_signed(watts):
    """Format with +/- sign for batteries."""
    sign = '+' if watts >= 0 else '-'
    return f"{sign}{abs(watts):.2f}W"

def fmt_power_abs(watts):
    """Format as absolute value for non-battery channels."""
    return f"{abs(watts):.2f}W"

def check_internet():
    """Return True if we can reach the internet."""
    try:
        subprocess.run(["ping", "-c", "1", "-W", "1", "8.8.8.8"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except Exception:
        return False

def estimate_soc(voltage):
    """Rough SOC from voltage (assumes ~3S LiFePO4 or similar)"""
    # Simple linear map: 10.0V=0%, 12.6V=100%
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
FIELD_W = 42   # enough for "+00.00W" (7 chars * 6px)
SOC_W = 30     # enough for "100%" (4 chars * 6px)
BOT_W = 36     # bottom row fields (6 chars * 6px), 3 * 36 = 108 < 128

def update_field(key, text, page, col, width, align="left"):
    """Only redraw if the text changed since last frame."""
    if prev.get(key) != text:
        if align == "right":
            draw_text_right(text, page, col, width)
        else:
            draw_text_padded(text, page, col, width)
        prev[key] = text

# ── Main loop ──

init_display()
clear_display()

# Draw static elements once
wilson_w = text_width("WILSON")
wil_col = (WIDTH - wilson_w) // 2
draw_text("WILSON", page=3, col=wil_col)

# Status icons centered on page 0: [check/X] [wifi]
status_col = (WIDTH - 18) // 2  # 8+2+8 = 18px for two icons

try:
    while True:
        # Read all sensors
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

        # === Status icons (center top) ===
        wifi = check_internet()
        wifi_key = "on" if wifi else "off"
        if prev.get("wifi") != wifi_key:
            draw_bitmap(ICON_CHECK if wifi else ICON_X, page=0, col=status_col)
            draw_bitmap(WIFI_ON, page=0, col=status_col + 10)
            prev["wifi"] = wifi_key

        # === Page 0 (top): DOCK power left, SOLAR power right ===
        update_field("dock", fmt_power_abs(readings["DOCK"][2]), 0, 0, FIELD_W)
        update_field("sol", fmt_power_abs(readings["SOL"][2]), 0, WIDTH - FIELD_W, FIELD_W, align="right")

        # === Page 2-3 (middle): LBATT left, RBATT right (signed) ===
        lbat_v, _, lbat_p = readings["LBAT"]
        update_field("lbat_p", fmt_power_signed(lbat_p), 2, 0, FIELD_W)
        update_field("lbat_s", f"{estimate_soc(lbat_v):.0f}%", 3, 0, SOC_W)

        rbat_v, _, rbat_p = readings["RBAT"]
        update_field("rbat_p", fmt_power_signed(rbat_p), 2, WIDTH - FIELD_W, FIELD_W, align="right")
        update_field("rbat_s", f"{estimate_soc(rbat_v):.0f}%", 3, WIDTH - SOC_W, SOC_W, align="right")

        # === Page 6 (bottom): LMOTOR left, CORE center, RMOTOR right ===
        update_field("lmot", fmt_power_abs(readings["LMOT"][2]), 6, 0, BOT_W)

        bot_center = (WIDTH - BOT_W) // 2
        update_field("core", fmt_power_abs(readings["CORE"][2]), 6, bot_center, BOT_W)

        update_field("rmot", fmt_power_abs(readings["RMOT"][2]), 6, WIDTH - BOT_W, BOT_W, align="right")

        time.sleep(1)

except KeyboardInterrupt:
    clear_display()
    send_command(0xAE)  # display off
    print("Stopped.")
finally:
    bus.close()
