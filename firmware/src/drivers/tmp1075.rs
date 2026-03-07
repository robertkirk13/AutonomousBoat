use crate::bus::{I2cBus, I2cError};

const TEMP_REG: u8 = 0x00;

pub struct Tmp1075 {
    bus: I2cBus,
    addr: u16,
}

impl Tmp1075 {
    pub fn new(bus: I2cBus, addr: u16) -> Self {
        Self { bus, addr }
    }

    /// Read temperature in degrees Celsius.
    pub async fn read_temp_c(&self) -> Result<f64, I2cError> {
        // read_word_data returns big-endian (we handle the smbus swap in bus.rs)
        let raw = self.bus.read_word_data(self.addr, TEMP_REG).await?;
        // Upper 12 bits are the temperature, 0.0625°C per LSB
        let raw12 = (raw >> 4) as i16;
        // Sign-extend from 12 bits
        let signed = if raw12 & 0x800 != 0 {
            raw12 - 4096
        } else {
            raw12
        };
        Ok(signed as f64 * 0.0625)
    }
}
