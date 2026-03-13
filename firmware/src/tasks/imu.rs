use crate::bus::I2cBus;
use crate::config::{BNO055_ADDR, IMU_INTERVAL};
use crate::drivers::bno055::Bno055;
use crate::types::EulerAngles;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

pub async fn run(
    bus: I2cBus,
    tx: watch::Sender<Option<EulerAngles>>,
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

        match imu.read_euler().await {
            Ok(angles) => {
                let _ = tx.send(Some(angles));
            }
            Err(e) => {
                tracing::warn!("BNO055 read error: {e}");
                let _ = tx.send(None);
            }
        }
    }

    tracing::info!("IMU task stopped");
}
