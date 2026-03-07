use crate::bus::I2cBus;
use crate::config::{INA228_CHANNELS, POWER_INTERVAL};
use crate::drivers::ina228::Ina228;
use crate::types::PowerState;
use std::time::Instant;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

pub async fn run(
    bus: I2cBus,
    tx: watch::Sender<PowerState>,
    cancel: CancellationToken,
) {
    let sensors: Vec<Ina228> = INA228_CHANNELS
        .iter()
        .map(|(addr, label)| Ina228::new(bus.clone(), *addr, label))
        .collect();

    // Calibrate all channels
    for sensor in &sensors {
        match sensor.calibrate().await {
            Ok(()) => tracing::info!("INA228 calibrated: {}", sensor.label()),
            Err(e) => tracing::warn!("INA228 calibration failed for {}: {e}", sensor.label()),
        }
    }

    tracing::info!("Power monitoring started ({} channels)", sensors.len());

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = tokio::time::sleep(POWER_INTERVAL) => {}
        }

        let mut readings = Vec::with_capacity(sensors.len());
        for sensor in &sensors {
            match sensor.read_all().await {
                Ok(reading) => readings.push(reading),
                Err(e) => {
                    tracing::warn!("INA228 read error ({}): {e}", sensor.label());
                }
            }
        }

        let _ = tx.send(PowerState {
            channels: readings,
            timestamp: Some(Instant::now()),
        });
    }

    tracing::info!("Power task stopped");
}

