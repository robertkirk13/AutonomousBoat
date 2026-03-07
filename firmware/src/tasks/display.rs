use crate::types::{EulerAngles, PowerState, ThermalState};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

/// OLED display task. Watches sensor state and renders to SSD1306.
/// For now, this is a stub — actual rendering requires spawn_blocking
/// with the ssd1306 crate since it needs blocking I2C.
pub async fn run(
    _imu_rx: watch::Receiver<Option<EulerAngles>>,
    _power_rx: watch::Receiver<PowerState>,
    _thermal_rx: watch::Receiver<ThermalState>,
    cancel: CancellationToken,
) {
    tracing::info!("Display task started (stub)");

    // TODO: Initialize SSD1306 via blocking I2C adapter, render status pages
    // For now just wait for shutdown
    cancel.cancelled().await;

    tracing::info!("Display task stopped");
}
