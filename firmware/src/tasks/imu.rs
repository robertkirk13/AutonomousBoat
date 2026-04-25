use crate::bus::I2cBus;
use crate::config::{BNO055_ADDR, IMU_INTERVAL};
use crate::drivers::bno055::Bno055;
use crate::types::{ImuCalibration, ImuData, Quat};
use std::time::Instant;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

/// Hamilton product a * b.
fn quat_mul(a: Quat, b: Quat) -> Quat {
    Quat {
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    }
}

fn apply_calibration(raw: &ImuData, cal: &ImuCalibration) -> ImuData {
    let raw_quat = Quat {
        w: raw.qw,
        x: raw.qx,
        y: raw.qy,
        z: raw.qz,
    };
    let q = match cal.upright_quat_inv {
        Some(inv) => quat_mul(inv, raw_quat),
        None => raw_quat,
    };
    let mut heading = raw.heading;
    if cal.compass_offset_deg != 0.0 {
        heading = ((heading - cal.compass_offset_deg) % 360.0 + 360.0) % 360.0;
    }
    ImuData {
        heading,
        roll: raw.roll,
        pitch: raw.pitch,
        qw: q.w,
        qx: q.x,
        qy: q.y,
        qz: q.z,
        timestamp: raw.timestamp,
    }
}

pub async fn run(
    bus: I2cBus,
    tx: watch::Sender<Option<ImuData>>,
    cal_rx: watch::Receiver<ImuCalibration>,
    raw_tx: watch::Sender<Option<ImuData>>,
    cancel: CancellationToken,
) {
    let imu = Bno055::new(bus, BNO055_ADDR);

    // Retry setup — I2C may not be ready immediately on boot
    loop {
        match imu.setup().await {
            Ok(()) => {
                tracing::info!("BNO055 initialized (NDOF mode)");
                break;
            }
            Err(e) => {
                tracing::warn!("BNO055 setup failed: {e}, retrying in 2s");
                tokio::select! {
                    _ = cancel.cancelled() => return,
                    _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => {}
                }
            }
        }
    }

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = tokio::time::sleep(IMU_INTERVAL) => {}
        }

        match imu.read_imu().await {
            Ok(mut data) => {
                data.timestamp = Some(Instant::now());
                // Publish raw IMU on a separate channel so the calibrate-now
                // commands can snapshot pre-calibration values.
                let _ = raw_tx.send(Some(data.clone()));
                let calibrated = apply_calibration(&data, &cal_rx.borrow());
                let _ = tx.send(Some(calibrated));
            }
            Err(e) => {
                tracing::warn!("BNO055 read error: {e}");
                let _ = tx.send(None);
                let _ = raw_tx.send(None);
            }
        }
    }

    tracing::info!("IMU task stopped");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn imu(heading: f64) -> ImuData {
        ImuData {
            heading,
            roll: 0.0,
            pitch: 0.0,
            qw: 1.0,
            qx: 0.0,
            qy: 0.0,
            qz: 0.0,
            timestamp: None,
        }
    }

    #[test]
    fn no_calibration_is_identity() {
        let raw = imu(123.0);
        let out = apply_calibration(&raw, &ImuCalibration::default());
        assert_eq!(out.heading, 123.0);
        assert_eq!((out.qw, out.qx, out.qy, out.qz), (1.0, 0.0, 0.0, 0.0));
    }

    #[test]
    fn compass_offset_subtracts_and_wraps() {
        let cal = ImuCalibration {
            upright_quat_inv: None,
            compass_offset_deg: 90.0,
        };
        assert_eq!(apply_calibration(&imu(100.0), &cal).heading, 10.0);
        assert!((apply_calibration(&imu(45.0), &cal).heading - 315.0).abs() < 1e-9);
    }
}
