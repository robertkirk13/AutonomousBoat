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

    if let Err(e) = imu.setup().await {
        tracing::error!("BNO055 setup failed: {e}");
        return;
    }
    tracing::info!("BNO055 initialized (NDOF mode)");

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
