import spidev
import time

# MCP2515 SPI config
SPI_BUS = 0
SPI_DEV = 0
SPI_SPEED = 1_000_000

# MCP2515 instructions
INST_RESET = 0xC0
INST_READ = 0x03
INST_WRITE = 0x02
INST_BIT_MODIFY = 0x05
INST_READ_STATUS = 0xA0

# MCP2515 registers
REG_CANSTAT = 0x0E
REG_CANCTRL = 0x0F
REG_CNF1 = 0x2A
REG_CNF2 = 0x29
REG_CNF3 = 0x28
REG_CANINTE = 0x2B
REG_CANINTF = 0x2C

# RX buffer 0
REG_RXB0CTRL = 0x60
REG_RXB0SIDH = 0x61
REG_RXB0SIDL = 0x62
REG_RXB0DLC = 0x65
REG_RXB0D0 = 0x66

# RX buffer 1
REG_RXB1CTRL = 0x70
REG_RXB1SIDH = 0x71
REG_RXB1SIDL = 0x72
REG_RXB1DLC = 0x75
REG_RXB1D0 = 0x76

# Filter/mask registers
REG_RXF0SIDH = 0x00
REG_RXF0SIDL = 0x01
REG_RXM0SIDH = 0x20
REG_RXM0SIDL = 0x21
REG_RXM1SIDH = 0x24
REG_RXM1SIDL = 0x25

spi = spidev.SpiDev()
spi.open(SPI_BUS, SPI_DEV)
spi.max_speed_hz = SPI_SPEED
spi.mode = 0b00


def reset():
    spi.xfer2([INST_RESET])
    time.sleep(0.1)

def read_reg(addr):
    resp = spi.xfer2([INST_READ, addr, 0x00])
    return resp[2]

def write_reg(addr, value):
    spi.xfer2([INST_WRITE, addr, value])

def bit_modify(addr, mask, value):
    spi.xfer2([INST_BIT_MODIFY, addr, mask, value])

def set_mode(mode):
    bit_modify(REG_CANCTRL, 0xE0, mode)
    time.sleep(0.01)
    actual = read_reg(REG_CANSTAT) & 0xE0
    return actual == mode

def read_rx_buffer(sidh_reg, sidl_reg, dlc_reg, d0_reg):
    """Read a received CAN frame from a buffer."""
    sidh = read_reg(sidh_reg)
    sidl = read_reg(sidl_reg)

    # Check extended frame
    is_extended = bool(sidl & 0x08)
    if is_extended:
        return None  # skip extended frames for now

    # Standard 11-bit ID
    arb_id = (sidh << 3) | ((sidl >> 5) & 0x07)

    # Check RTR
    dlc_raw = read_reg(dlc_reg)
    is_rtr = bool(dlc_raw & 0x40)
    dlc = dlc_raw & 0x0F
    if dlc > 8:
        dlc = 8

    data = []
    if not is_rtr:
        for i in range(dlc):
            data.append(read_reg(d0_reg + i))

    return {
        "id": arb_id,
        "rtr": is_rtr,
        "dlc": dlc,
        "data": data,
    }


print("MCP2515 CAN Listener")
print("=" * 40)

try:
    print("Resetting MCP2515...")
    reset()

    stat = read_reg(REG_CANSTAT) & 0xE0
    if stat != 0x80:
        raise RuntimeError(f"Not in config mode after reset (0x{stat:02X})")

    # 500kbps with 16 MHz oscillator
    write_reg(REG_CNF1, 0x00)
    write_reg(REG_CNF2, 0x91)
    write_reg(REG_CNF3, 0x01)

    # Accept all messages: set masks to 0x000
    write_reg(REG_RXM0SIDH, 0x00)
    write_reg(REG_RXM0SIDL, 0x00)
    write_reg(REG_RXM1SIDH, 0x00)
    write_reg(REG_RXM1SIDL, 0x00)

    # RXB0: accept any message, rollover to RXB1
    write_reg(REG_RXB0CTRL, 0x64)  # RXM=11 (any), BUKT=1 (rollover)
    write_reg(REG_RXB1CTRL, 0x60)  # RXM=11 (any)

    # Disable interrupts, clear flags
    write_reg(REG_CANINTE, 0x00)
    write_reg(REG_CANINTF, 0x00)

    # Enter normal mode (listen-only would be 0x60)
    print("Entering normal mode...")
    if not set_mode(0x00):
        raise RuntimeError("Failed to enter normal mode")
    print("  OK\n")

    print("Listening for CAN frames... (Ctrl+C to stop)")
    print(f"{'Time':>10}  {'ID':>5}  {'DLC':>3}  {'Data':<24}  {'ASCII'}")
    print("-" * 65)

    count = 0
    start = time.time()

    while True:
        intf = read_reg(REG_CANINTF)

        # Check RX buffer 0
        if intf & 0x01:
            frame = read_rx_buffer(REG_RXB0SIDH, REG_RXB0SIDL, REG_RXB0DLC, REG_RXB0D0)
            bit_modify(REG_CANINTF, 0x01, 0x00)  # clear RX0IF
            if frame:
                count += 1
                elapsed = time.time() - start
                hex_data = " ".join(f"{b:02X}" for b in frame["data"])
                ascii_data = "".join(chr(b) if 32 <= b < 127 else "." for b in frame["data"])
                rtr = " RTR" if frame["rtr"] else ""
                print(f"{elapsed:10.3f}  0x{frame['id']:03X}  {frame['dlc']:3d}  {hex_data:<24s}  {ascii_data}{rtr}")

        # Check RX buffer 1
        if intf & 0x02:
            frame = read_rx_buffer(REG_RXB1SIDH, REG_RXB1SIDL, REG_RXB1DLC, REG_RXB1D0)
            bit_modify(REG_CANINTF, 0x02, 0x00)  # clear RX1IF
            if frame:
                count += 1
                elapsed = time.time() - start
                hex_data = " ".join(f"{b:02X}" for b in frame["data"])
                ascii_data = "".join(chr(b) if 32 <= b < 127 else "." for b in frame["data"])
                rtr = " RTR" if frame["rtr"] else ""
                print(f"{elapsed:10.3f}  0x{frame['id']:03X}  {frame['dlc']:3d}  {hex_data:<24s}  {ascii_data}{rtr}")

        # Check for errors
        if intf & 0x80:  # MERRF - message error
            bit_modify(REG_CANINTF, 0x80, 0x00)
        if intf & 0x20:  # ERRIF - error interrupt
            bit_modify(REG_CANINTF, 0x20, 0x00)

        time.sleep(0.001)

except KeyboardInterrupt:
    elapsed = time.time() - start
    print(f"\n\nStopped. Received {count} frames in {elapsed:.1f}s.")

except Exception as e:
    print(f"\nERROR: {e}")

finally:
    spi.close()
