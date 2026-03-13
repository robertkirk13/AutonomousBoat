use crate::bus::{I2cBus, I2cError};
use crate::types::{EulerAngles, ImuData};

const OPR_MODE: u8 = 0x3D;
const EUL_HEADING_LSB: u8 = 0x1A;
const QUA_DATA_W_LSB: u8 = 0x20;
const CONFIG_MODE: u8 = 0x00;
const NDOF_MODE: u8 = 0x0C;
const QUA_SCALE: f64 = 16384.0; // 2^14

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

    /// Read both euler angles and quaternion from the BNO055.
    pub async fn read_imu(&self) -> Result<ImuData, I2cError> {
        // Read euler (6 bytes at 0x1A) and quaternion (8 bytes at 0x20)
        let eul = self.bus.read_block(self.addr, EUL_HEADING_LSB, 6).await?;
        let qua = self.bus.read_block(self.addr, QUA_DATA_W_LSB, 8).await?;

        let heading_raw = (eul[1] as i16) << 8 | eul[0] as i16;
        let roll_raw = (eul[3] as i16) << 8 | eul[2] as i16;
        let pitch_raw = (eul[5] as i16) << 8 | eul[4] as i16;

        // Quaternion: 4x little-endian i16, scale = 2^14
        let qw = ((qua[1] as i16) << 8 | qua[0] as i16) as f64 / QUA_SCALE;
        let qx = ((qua[3] as i16) << 8 | qua[2] as i16) as f64 / QUA_SCALE;
        let qy = ((qua[5] as i16) << 8 | qua[4] as i16) as f64 / QUA_SCALE;
        let qz = ((qua[7] as i16) << 8 | qua[6] as i16) as f64 / QUA_SCALE;

        Ok(ImuData {
            heading: heading_raw as f64 / 16.0,
            roll: roll_raw as f64 / 16.0,
            pitch: pitch_raw as f64 / 16.0,
            qw,
            qx,
            qy,
            qz,
        })
    }
}
