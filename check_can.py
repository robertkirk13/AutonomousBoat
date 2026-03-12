import spidev
import time
import struct

# MCP2515 SPI config
SPI_BUS = 0
SPI_DEV = 0
SPI_SPEED = 1_000_000  # 1 MHz

# MCP2515 instructions
INST_RESET = 0xC0
INST_READ = 0x03
INST_WRITE = 0x02
INST_RTS_TX0 = 0x81
INST_READ_STATUS = 0xA0
INST_BIT_MODIFY = 0x05

# MCP2515 registers
REG_CANSTAT = 0x0E
REG_CANCTRL = 0x0F
REG_CNF1 = 0x2A
REG_CNF2 = 0x29
REG_CNF3 = 0x28
REG_CANINTE = 0x2B
REG_CANINTF = 0x2C
REG_TXB0CTRL = 0x30
REG_TXB0SIDH = 0x31
REG_TXB0SIDL = 0x32
REG_TXB0DLC = 0x35
REG_TXB0D0 = 0x36

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
    """Set MCP2515 operating mode. mode: 0x00=Normal, 0x40=Loopback, 0x60=Listen, 0x80=Config"""
    bit_modify(REG_CANCTRL, 0xE0, mode)
    time.sleep(0.01)
    actual = read_reg(REG_CANSTAT) & 0xE0
    if actual != mode:
        print(f"  WARNING: requested mode 0x{mode:02X}, got 0x{actual:02X}")
        return False
    return True


def init_can(bitrate_500k=True):
    """Initialize MCP2515 for 500kbps CAN with 8MHz crystal (common MCP2515 module clock)."""
    reset()

    # Verify chip is in config mode after reset
    stat = read_reg(REG_CANSTAT) & 0xE0
    if stat != 0x80:
        print(f"  ERROR: chip not in config mode after reset (CANSTAT=0x{stat:02X})")
        return False

    if bitrate_500k:
        # 500 kbps with 16 MHz oscillator (8 TQ per bit)
        # BRP=0 -> TQ = 2/16MHz = 125ns, SJW=1
        # PropSeg=2, PS1=3, PS2=2 -> 1+2+3+2 = 8 TQ -> 500kbps
        write_reg(REG_CNF1, 0x00)  # SJW=1, BRP=0
        write_reg(REG_CNF2, 0x91)  # BTLMODE=1, SAM=0, PHSEG1=2, PRSEG=1
        write_reg(REG_CNF3, 0x01)  # PHSEG2=1
    else:
        # 250 kbps with 16 MHz oscillator (16 TQ per bit)
        # BRP=1 -> TQ = 4/16MHz = 250ns, SJW=1
        write_reg(REG_CNF1, 0x01)  # SJW=1, BRP=1
        write_reg(REG_CNF2, 0x91)  # BTLMODE=1, SAM=0, PHSEG1=2, PRSEG=1
        write_reg(REG_CNF3, 0x01)  # PHSEG2=1

    # One-shot mode: don't retry on failed TX (avoids buffer stuck busy without ACK)
    bit_modify(REG_CANCTRL, 0x08, 0x08)  # OSM bit

    # Disable all interrupts for polling mode
    write_reg(REG_CANINTE, 0x00)
    # Clear all interrupt flags
    write_reg(REG_CANINTF, 0x00)

    return True


def send_message(arb_id, data):
    """Send a CAN message. arb_id: 11-bit standard ID, data: list of up to 8 bytes."""
    # Wait for TX buffer 0 to be free
    for _ in range(100):
        if not (read_reg(REG_TXB0CTRL) & 0x08):
            break
        time.sleep(0.001)
    else:
        print("  ERROR: TX buffer 0 stuck busy")
        return False

    # Set standard ID
    sidh = (arb_id >> 3) & 0xFF
    sidl = (arb_id & 0x07) << 5
    write_reg(REG_TXB0SIDH, sidh)
    write_reg(REG_TXB0SIDL, sidl)

    # Set DLC
    dlc = min(len(data), 8)
    write_reg(REG_TXB0DLC, dlc)

    # Load data bytes
    for i in range(dlc):
        write_reg(REG_TXB0D0 + i, data[i])

    # Request to send
    spi.xfer2([INST_RTS_TX0])

    # Wait for transmission (or error)
    for _ in range(100):
        ctrl = read_reg(REG_TXB0CTRL)
        if not (ctrl & 0x08):  # TXREQ cleared = done
            if ctrl & 0x10:  # TXERR
                print("  TX error flag set")
                return False
            return True
        time.sleep(0.001)

    print("  TX timeout")
    return False


def encode_string(text):
    """Encode a string into a list of CAN frames (8 bytes each)."""
    raw = text.encode("ascii")
    frames = []
    for i in range(0, len(raw), 8):
        chunk = list(raw[i:i + 8])
        frames.append(chunk)
    return frames


print("MCP2515 CAN Test (SPI)")
print("=" * 40)

try:
    print("Resetting MCP2515...")
    ok = init_can(bitrate_500k=True)
    if not ok:
        raise RuntimeError("Failed to initialize MCP2515")

    canstat = read_reg(REG_CANSTAT)
    canctrl = read_reg(REG_CANCTRL)
    print(f"  CANSTAT=0x{canstat:02X}  CANCTRL=0x{canctrl:02X}")
    print(f"  CNF1=0x{read_reg(REG_CNF1):02X}  CNF2=0x{read_reg(REG_CNF2):02X}  CNF3=0x{read_reg(REG_CNF3):02X}")

    # Normal mode — transmit on the real bus
    print("\nSwitching to normal mode...")
    if not set_mode(0x00):
        raise RuntimeError("Failed to enter normal mode")
    print("  OK — normal mode active")

    # Send "KAREN BEYER" continuously
    message = "KAREN BEYER"
    frames = encode_string(message)
    arb_id = 0x100  # arbitrary CAN ID

    print(f"\nSending \"{message}\" continuously (Ctrl+C to stop)")
    print(f"  Arbitration ID: 0x{arb_id:03X}")
    print(f"  Frames per cycle: {len(frames)}")

    count = 0
    while True:
        count += 1
        ok_all = True
        for i, frame_data in enumerate(frames):
            if not send_message(arb_id + i, frame_data):
                ok_all = False
        status = "OK" if ok_all else "FAIL"
        print(f"  [{count}] {status}", end="\r")
        time.sleep(0.1)

except KeyboardInterrupt:
    print(f"\n\nStopped after {count} transmissions.")

except Exception as e:
    print(f"\nERROR: {e}")
    print("Check that the MCP2515 module is wired to SPI0 (CE0) and powered.")

finally:
    spi.close()
