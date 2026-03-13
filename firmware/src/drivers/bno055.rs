use crate::bus::{I2cBus, I2cError};
use crate::types::EulerAngles;

const OPR_MODE: u8 = 0x3D;
const EUL_HEADING_LSB: u8 = 0x1A;
const CONFIG_MODE: u8 = 0x00;
const NDOF_MODE: u8 = 0x0C;

pub struct Bno055 {
    bus: I2cBus,
    addr: u16,
}

impl Bno055 {
    pub fn new(bus: I2cBus, addr: u16) -> Self {
        Self { bus, addr }
    }

    /// Initialize BNO055 into NDOF (9-DOF fusion) mode.
    pub async fn setup(&self) -> Result<(), I2cError> {
        // BNO055 datasheet requires >= 400ms after power-on reset before mode writes
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;

        self.bus
            .write_byte_data(self.addr, OPR_MODE, CONFIG_MODE)
            .await?;
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;

        self.bus
            .write_byte_data(self.addr, OPR_MODE, NDOF_MODE)
            .await?;
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;

        Ok(())
    }

    /// Read euler angles (heading, roll, pitch) in degrees.
    pub async fn read_euler(&self) -> Result<EulerAngles, I2cError> {
        let data = self.bus.read_block(self.addr, EUL_HEADING_LSB, 6).await?;

        // 3x little-endian i16, in units of 1/16 degree
        let heading_raw = (data[1] as i16) << 8 | data[0] as i16;
        let roll_raw = (data[3] as i16) << 8 | data[2] as i16;
        let pitch_raw = (data[5] as i16) << 8 | data[4] as i16;

        Ok(EulerAngles {
            heading: heading_raw as f64 / 16.0,
            roll: roll_raw as f64 / 16.0,
            pitch: pitch_raw as f64 / 16.0,
        })
    }
}
