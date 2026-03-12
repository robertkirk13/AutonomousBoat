//! MCP2515 CAN controller driver over SPI.
//! Mirrors the Python check_can.py / listen_can.py implementation.

use crate::types::CanFrame;
use std::io;

// SPI instructions
const INST_RESET: u8 = 0xC0;
const INST_READ: u8 = 0x03;
const INST_WRITE: u8 = 0x02;
const INST_BIT_MODIFY: u8 = 0x05;
const INST_RTS_TX0: u8 = 0x81;

// Registers
const REG_CANSTAT: u8 = 0x0E;
const REG_CANCTRL: u8 = 0x0F;
const REG_CNF1: u8 = 0x2A;
const REG_CNF2: u8 = 0x29;
const REG_CNF3: u8 = 0x28;
const REG_CANINTE: u8 = 0x2B;
const REG_CANINTF: u8 = 0x2C;

// TX buffer 0
const REG_TXB0CTRL: u8 = 0x30;
const REG_TXB0SIDH: u8 = 0x31;
const REG_TXB0SIDL: u8 = 0x32;
const REG_TXB0DLC: u8 = 0x35;
const REG_TXB0D0: u8 = 0x36;

// RX buffer 0
const REG_RXB0CTRL: u8 = 0x60;
const REG_RXB0SIDH: u8 = 0x61;
const REG_RXB0SIDL: u8 = 0x62;
const REG_RXB0DLC: u8 = 0x65;
const REG_RXB0D0: u8 = 0x66;

// RX buffer 1
const REG_RXB1CTRL: u8 = 0x70;
const REG_RXB1SIDH: u8 = 0x71;
const REG_RXB1SIDL: u8 = 0x72;
const REG_RXB1DLC: u8 = 0x75;
const REG_RXB1D0: u8 = 0x76;

// Filter/mask registers
const REG_RXM0SIDH: u8 = 0x20;
const REG_RXM0SIDL: u8 = 0x21;
const REG_RXM1SIDH: u8 = 0x24;
const REG_RXM1SIDL: u8 = 0x25;

#[derive(Debug)]
pub enum Mcp2515Error {
    Spi(io::Error),
    NotInConfigMode(u8),
    ModeChangeFailed { requested: u8, actual: u8 },
    TxBusy,
    TxError,
    TxTimeout,
}

impl std::fmt::Display for Mcp2515Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Mcp2515Error::Spi(e) => write!(f, "SPI error: {e}"),
            Mcp2515Error::NotInConfigMode(s) => write!(f, "not in config mode after reset (0x{s:02X})"),
            Mcp2515Error::ModeChangeFailed { requested, actual } => {
                write!(f, "mode change failed: requested 0x{requested:02X}, got 0x{actual:02X}")
            }
            Mcp2515Error::TxBusy => write!(f, "TX buffer stuck busy"),
            Mcp2515Error::TxError => write!(f, "TX error flag set"),
            Mcp2515Error::TxTimeout => write!(f, "TX timeout"),
        }
    }
}

impl std::error::Error for Mcp2515Error {}

impl From<io::Error> for Mcp2515Error {
    fn from(e: io::Error) -> Self {
        Mcp2515Error::Spi(e)
    }
}

/// Low-level MCP2515 SPI operations. All methods are blocking (run in spawn_blocking).
#[cfg(feature = "hw")]
pub struct Mcp2515 {
    spi: spidev::Spidev,
}

#[cfg(feature = "hw")]
impl Mcp2515 {
    pub fn open(dev: &str, speed_hz: u32) -> Result<Self, Mcp2515Error> {
        use spidev::{SpiModeFlags, Spidev, SpidevOptions};
        use std::path::Path;

        let mut spi = Spidev::open(Path::new(dev))?;
        let opts = SpidevOptions::new()
            .bits_per_word(8)
            .max_speed_hz(speed_hz)
            .mode(SpiModeFlags::SPI_MODE_0)
            .build();
        spi.configure(&opts)?;

        Ok(Self { spi })
    }

    fn reset(&mut self) -> Result<(), Mcp2515Error> {
        use std::io::Write;
        self.spi.write(&[INST_RESET])?;
        std::thread::sleep(std::time::Duration::from_millis(100));
        Ok(())
    }

    fn read_reg(&mut self, addr: u8) -> Result<u8, Mcp2515Error> {
        use spidev::SpidevTransfer;
        let tx = [INST_READ, addr, 0x00];
        let mut rx = [0u8; 3];
        let mut transfer = SpidevTransfer::read_write(&tx, &mut rx);
        self.spi.transfer(&mut transfer)?;
        Ok(rx[2])
    }

    fn write_reg(&mut self, addr: u8, value: u8) -> Result<(), Mcp2515Error> {
        use std::io::Write;
        self.spi.write(&[INST_WRITE, addr, value])?;
        Ok(())
    }

    fn bit_modify(&mut self, addr: u8, mask: u8, value: u8) -> Result<(), Mcp2515Error> {
        use std::io::Write;
        self.spi.write(&[INST_BIT_MODIFY, addr, mask, value])?;
        Ok(())
    }

    fn set_mode(&mut self, mode: u8) -> Result<(), Mcp2515Error> {
        self.bit_modify(REG_CANCTRL, 0xE0, mode)?;
        std::thread::sleep(std::time::Duration::from_millis(10));
        let actual = self.read_reg(REG_CANSTAT)? & 0xE0;
        if actual != mode {
            return Err(Mcp2515Error::ModeChangeFailed {
                requested: mode,
                actual,
            });
        }
        Ok(())
    }

    /// Initialize for 500kbps with 16MHz crystal, accept all messages.
    pub fn init_500k(&mut self) -> Result<(), Mcp2515Error> {
        self.reset()?;

        let stat = self.read_reg(REG_CANSTAT)? & 0xE0;
        if stat != 0x80 {
            return Err(Mcp2515Error::NotInConfigMode(stat));
        }

        // 500kbps with 16MHz crystal (BRP=1, 8 TQ per bit)
        self.write_reg(REG_CNF1, 0x01)?; // SJW=1, BRP=1
        self.write_reg(REG_CNF2, 0x91)?; // BTLMODE=1, SAM=0, PHSEG1=2, PRSEG=1
        self.write_reg(REG_CNF3, 0x01)?; // PHSEG2=1

        // One-shot mode
        self.bit_modify(REG_CANCTRL, 0x08, 0x08)?;

        // Accept all messages: masks to 0x000
        self.write_reg(REG_RXM0SIDH, 0x00)?;
        self.write_reg(REG_RXM0SIDL, 0x00)?;
        self.write_reg(REG_RXM1SIDH, 0x00)?;
        self.write_reg(REG_RXM1SIDL, 0x00)?;

        // RXB0: accept any, rollover to RXB1
        self.write_reg(REG_RXB0CTRL, 0x64)?;
        self.write_reg(REG_RXB1CTRL, 0x60)?;

        // Disable interrupts, clear flags
        self.write_reg(REG_CANINTE, 0x00)?;
        self.write_reg(REG_CANINTF, 0x00)?;

        // Enter normal mode
        self.set_mode(0x00)?;

        Ok(())
    }

    /// Send a standard CAN frame.
    pub fn send(&mut self, id: u16, data: &[u8]) -> Result<(), Mcp2515Error> {
        // Wait for TX buffer 0 to be free
        for _ in 0..100 {
            if self.read_reg(REG_TXB0CTRL)? & 0x08 == 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        if self.read_reg(REG_TXB0CTRL)? & 0x08 != 0 {
            return Err(Mcp2515Error::TxBusy);
        }

        // Set standard 11-bit ID
        let sidh = ((id >> 3) & 0xFF) as u8;
        let sidl = ((id & 0x07) << 5) as u8;
        self.write_reg(REG_TXB0SIDH, sidh)?;
        self.write_reg(REG_TXB0SIDL, sidl)?;

        // Set DLC and data
        let dlc = data.len().min(8) as u8;
        self.write_reg(REG_TXB0DLC, dlc)?;
        for i in 0..dlc as usize {
            self.write_reg(REG_TXB0D0 + i as u8, data[i])?;
        }

        // Request to send
        use std::io::Write;
        self.spi.write(&[INST_RTS_TX0])?;

        // Wait for completion
        for _ in 0..100 {
            let ctrl = self.read_reg(REG_TXB0CTRL)?;
            if ctrl & 0x08 == 0 {
                if ctrl & 0x10 != 0 {
                    return Err(Mcp2515Error::TxError);
                }
                return Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }

        Err(Mcp2515Error::TxTimeout)
    }

    /// Poll for received frames. Returns frames from both RX buffers.
    pub fn poll_rx(&mut self) -> Result<Vec<CanFrame>, Mcp2515Error> {
        let mut frames = Vec::new();
        let intf = self.read_reg(REG_CANINTF)?;

        // RX buffer 0
        if intf & 0x01 != 0 {
            if let Some(frame) = self.read_rx_buffer(REG_RXB0SIDH, REG_RXB0SIDL, REG_RXB0DLC, REG_RXB0D0)? {
                frames.push(frame);
            }
            self.bit_modify(REG_CANINTF, 0x01, 0x00)?;
        }

        // RX buffer 1
        if intf & 0x02 != 0 {
            if let Some(frame) = self.read_rx_buffer(REG_RXB1SIDH, REG_RXB1SIDL, REG_RXB1DLC, REG_RXB1D0)? {
                frames.push(frame);
            }
            self.bit_modify(REG_CANINTF, 0x02, 0x00)?;
        }

        // Clear error flags
        if intf & 0x80 != 0 {
            self.bit_modify(REG_CANINTF, 0x80, 0x00)?;
        }
        if intf & 0x20 != 0 {
            self.bit_modify(REG_CANINTF, 0x20, 0x00)?;
        }

        Ok(frames)
    }

    fn read_rx_buffer(
        &mut self,
        sidh_reg: u8,
        sidl_reg: u8,
        dlc_reg: u8,
        d0_reg: u8,
    ) -> Result<Option<CanFrame>, Mcp2515Error> {
        let sidh = self.read_reg(sidh_reg)?;
        let sidl = self.read_reg(sidl_reg)?;

        // Skip extended frames
        if sidl & 0x08 != 0 {
            return Ok(None);
        }

        // Standard 11-bit ID
        let id = ((sidh as u16) << 3) | ((sidl as u16 >> 5) & 0x07);

        let dlc_raw = self.read_reg(dlc_reg)?;
        let rtr = dlc_raw & 0x40 != 0;
        let dlc = (dlc_raw & 0x0F).min(8);

        let mut data = Vec::with_capacity(dlc as usize);
        if !rtr {
            for i in 0..dlc {
                data.push(self.read_reg(d0_reg + i)?);
            }
        }

        Ok(Some(CanFrame {
            id,
            rtr,
            dlc,
            data,
        }))
    }
}
