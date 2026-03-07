use crate::bus::{I2cBus, I2cError};
use crate::config::{CURRENT_LSB, R_SHUNT};
use crate::types::Ina228Reading;

// Register addresses
const REG_CONFIG: u8 = 0x00;
const REG_SHUNT_CAL: u8 = 0x02;
const REG_VBUS: u8 = 0x05;
const REG_CURRENT: u8 = 0x07;
const REG_POWER: u8 = 0x08;
const REG_ENERGY: u8 = 0x09;
const REG_CHARGE: u8 = 0x0A;

const ENERGY_LSB: f64 = 16.0 * 3.2 * CURRENT_LSB;
const CHARGE_LSB: f64 = CURRENT_LSB;

pub struct Ina228 {
    bus: I2cBus,
    addr: u16,
    label: String,
}

impl Ina228 {
    pub fn label(&self) -> &str {
        &self.label
    }
}

impl Ina228 {
    pub fn new(bus: I2cBus, addr: u16, label: &str) -> Self {
        Self {
            bus,
            addr,
            label: label.to_string(),
        }
    }

    /// Write calibration register and reset accumulators.
    pub async fn calibrate(&self) -> Result<(), I2cError> {
        let shunt_cal = (13107.2e6 * CURRENT_LSB * R_SHUNT) as u16;
        self.bus
            .write_word_data(self.addr, REG_SHUNT_CAL, shunt_cal)
            .await?;

        // Reset accumulators: set RSTACC bit (bit 14) in CONFIG
        let cfg = self.bus.read_word_data(self.addr, REG_CONFIG).await?;
        self.bus
            .write_word_data(self.addr, REG_CONFIG, cfg | 0x4000)
            .await?;

        Ok(())
    }

    /// Read all measurements from this channel.
    pub async fn read_all(&self) -> Result<Ina228Reading, I2cError> {
        // Bus voltage: 24-bit >> 4, * 195.3125e-6
        let vbus_data = self.bus.read_block(self.addr, REG_VBUS, 3).await?;
        let vbus_raw = ((vbus_data[0] as u32) << 16
            | (vbus_data[1] as u32) << 8
            | vbus_data[2] as u32)
            >> 4;
        let voltage_v = vbus_raw as f64 * 195.3125e-6;

        // Current: 24-bit >> 4, signed 20-bit
        let cur_data = self.bus.read_block(self.addr, REG_CURRENT, 3).await?;
        let cur_raw = ((cur_data[0] as u32) << 16
            | (cur_data[1] as u32) << 8
            | cur_data[2] as u32)
            >> 4;
        let cur_signed = sign_extend(cur_raw, 20);
        let current_a = cur_signed as f64 * CURRENT_LSB;

        // Power: 24-bit unsigned
        let pwr_data = self.bus.read_block(self.addr, REG_POWER, 3).await?;
        let pwr_raw =
            (pwr_data[0] as u32) << 16 | (pwr_data[1] as u32) << 8 | pwr_data[2] as u32;
        let power_w = pwr_raw as f64 * 3.2 * CURRENT_LSB;

        // Energy: 40-bit unsigned
        let eng_data = self.bus.read_block(self.addr, REG_ENERGY, 5).await?;
        let eng_raw = (eng_data[0] as u64) << 32
            | (eng_data[1] as u64) << 24
            | (eng_data[2] as u64) << 16
            | (eng_data[3] as u64) << 8
            | eng_data[4] as u64;
        let energy_wh = eng_raw as f64 * ENERGY_LSB / 3600.0;

        // Charge: 40-bit signed
        let chg_data = self.bus.read_block(self.addr, REG_CHARGE, 5).await?;
        let chg_raw = (chg_data[0] as u64) << 32
            | (chg_data[1] as u64) << 24
            | (chg_data[2] as u64) << 16
            | (chg_data[3] as u64) << 8
            | chg_data[4] as u64;
        let chg_signed = sign_extend_64(chg_raw, 40);
        let charge_ah = chg_signed as f64 * CHARGE_LSB / 3600.0;

        Ok(Ina228Reading {
            label: self.label.clone(),
            voltage_v,
            current_a,
            power_w,
            energy_wh,
            charge_ah,
        })
    }
}

fn sign_extend(val: u32, bits: u32) -> i32 {
    if val & (1 << (bits - 1)) != 0 {
        (val as i32) - (1 << bits)
    } else {
        val as i32
    }
}

fn sign_extend_64(val: u64, bits: u32) -> i64 {
    if val & (1u64 << (bits - 1)) != 0 {
        (val as i64) - (1i64 << bits)
    } else {
        val as i64
    }
}
