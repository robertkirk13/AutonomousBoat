/// OLED display is handled by the Python systemd service (ssd1306-dashboard.service).
/// The SSD1306 is write-only on I2C and needs blocking access, which doesn't fit
/// our async I2C bus owner pattern. The Python service provides a full dashboard
/// with power readings, wifi status, and WILSON branding.
use tokio_util::sync::CancellationToken;

pub async fn run(cancel: CancellationToken) {
    tracing::info!("Display handled by Python ssd1306-dashboard.service");
    cancel.cancelled().await;
    tracing::info!("Display task stopped");
}
