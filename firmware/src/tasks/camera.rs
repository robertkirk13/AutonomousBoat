//! Camera service controller: persists settings to the env file and
//! starts/stops/restarts the `camera-stream` systemd unit so that the stream
//! is actually disabled (not merely hidden in the UI) when requested.

use crate::config::{CAMERA_ENV_FILE, CAMERA_SERVICE};
use crate::types::CameraSettings;
use std::io::Write;
use std::process::Command;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

pub async fn run(mut settings_rx: watch::Receiver<CameraSettings>, cancel: CancellationToken) {
    tracing::info!("Camera controller started");

    // Apply the initial settings once at startup so the env file matches the
    // firmware's idea of current state, then react to changes. Bind the clone
    // to a local so the watch::Ref (not Send) drops before the .await.
    let initial = settings_rx.borrow().clone();
    apply(&initial).await;

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            changed = settings_rx.changed() => {
                if changed.is_err() {
                    break;
                }
                let settings = settings_rx.borrow_and_update().clone();
                apply(&settings).await;
            }
        }
    }

    tracing::info!("Camera controller stopped");
}

async fn apply(settings: &CameraSettings) {
    if let Err(e) = write_env_file(settings) {
        tracing::warn!("Failed to write {CAMERA_ENV_FILE}: {e}");
    }

    let action = if settings.enabled { "restart" } else { "stop" };
    let label = if settings.enabled {
        format!(
            "restart (enabled, {}x{} @ {}fps)",
            settings.width, settings.height, settings.fps
        )
    } else {
        "stop".to_string()
    };

    // Firmware runs as root (see deploy/systemd/boat-firmware.service) so
    // systemctl works directly without sudo.
    let result = tokio::task::spawn_blocking(move || {
        Command::new("systemctl")
            .args([action, CAMERA_SERVICE])
            .status()
    })
    .await;

    match result {
        Ok(Ok(status)) if status.success() => {
            tracing::info!("Camera service {}", label);
        }
        Ok(Ok(status)) => {
            tracing::warn!("Camera systemctl {action} exited {status}");
        }
        Ok(Err(e)) => {
            tracing::warn!("Camera systemctl {action} failed to spawn: {e}");
        }
        Err(e) => {
            tracing::warn!("Camera systemctl task panicked: {e}");
        }
    }
}

fn write_env_file(settings: &CameraSettings) -> std::io::Result<()> {
    let tmp_path = format!("{CAMERA_ENV_FILE}.tmp");
    {
        let mut file = std::fs::File::create(&tmp_path)?;
        writeln!(file, "CAMERA_WIDTH={}", settings.width)?;
        writeln!(file, "CAMERA_HEIGHT={}", settings.height)?;
        writeln!(file, "CAMERA_FPS={}", settings.fps)?;
        file.sync_all()?;
    }
    std::fs::rename(&tmp_path, CAMERA_ENV_FILE)
}
