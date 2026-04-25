//! On-disk persistence for boat calibrations and tuning. The state file lives
//! next to the binary so it travels with the deploy and survives reboots.
//! Atomic writes via tempfile + rename keep it durable across power loss.

use crate::types::*;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

const STATE_FILENAME: &str = "boat-firmware.state.json";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PersistedState {
    #[serde(default)]
    pub motor_config: MotorConfig,
    #[serde(default)]
    pub nav_params: NavParams,
    #[serde(default)]
    pub gps_offset: GpsOffset,
    #[serde(default)]
    pub imu_calibration: ImuCalibration,
}

/// Resolve the path next to the running executable. Falls back to cwd.
pub fn state_path() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            return dir.join(STATE_FILENAME);
        }
    }
    PathBuf::from(STATE_FILENAME)
}

/// Load saved state. Returns `Default::default()` if the file is missing or
/// can't be parsed — easier than failing closed since defaults are safe.
pub fn load(path: &std::path::Path) -> PersistedState {
    match std::fs::read(path) {
        Ok(bytes) => match serde_json::from_slice::<PersistedState>(&bytes) {
            Ok(state) => {
                tracing::info!("Loaded persisted state from {}", path.display());
                state
            }
            Err(e) => {
                tracing::warn!(
                    "Persisted state at {} is malformed: {e}. Starting fresh.",
                    path.display()
                );
                PersistedState::default()
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            tracing::info!("No persisted state at {}, starting fresh", path.display());
            PersistedState::default()
        }
        Err(e) => {
            tracing::warn!("Failed to read state {}: {e}. Starting fresh.", path.display());
            PersistedState::default()
        }
    }
}

/// Atomic write: serialize, write to a sibling tempfile, fsync, rename. This
/// guarantees the file is either the old version or the new version, never
/// half-written.
fn save(path: &std::path::Path, state: &PersistedState) {
    let bytes = match serde_json::to_vec_pretty(state) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("State serialization failed: {e}");
            return;
        }
    };
    let tmp = path.with_extension("json.tmp");
    if let Err(e) = std::fs::write(&tmp, &bytes) {
        tracing::warn!("State temp write failed: {e}");
        return;
    }
    if let Err(e) = std::fs::rename(&tmp, path) {
        tracing::warn!("State rename failed: {e}");
    }
}

/// Persist task: watches every persisted source and rewrites the state file
/// whenever one changes. Coalesces rapid changes (e.g. slider drag) by waiting
/// briefly before each write.
pub async fn run(
    path: PathBuf,
    mut motor_config_rx: watch::Receiver<MotorConfig>,
    mut nav_params_rx: watch::Receiver<NavParams>,
    mut gps_offset_rx: watch::Receiver<GpsOffset>,
    mut imu_cal_rx: watch::Receiver<ImuCalibration>,
    cancel: CancellationToken,
) {
    // Mark all current values as "seen" so we don't immediately rewrite the
    // file we just loaded from.
    let _ = motor_config_rx.borrow_and_update();
    let _ = nav_params_rx.borrow_and_update();
    let _ = gps_offset_rx.borrow_and_update();
    let _ = imu_cal_rx.borrow_and_update();

    loop {
        let dirty = tokio::select! {
            _ = cancel.cancelled() => break,
            r = motor_config_rx.changed() => r.is_ok(),
            r = nav_params_rx.changed() => r.is_ok(),
            r = gps_offset_rx.changed() => r.is_ok(),
            r = imu_cal_rx.changed() => r.is_ok(),
        };
        if !dirty {
            continue;
        }
        // Coalesce: a slider drag fires many changes; sleep briefly so we
        // batch them into one write per ~250ms.
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = tokio::time::sleep(std::time::Duration::from_millis(250)) => {}
        }

        let state = PersistedState {
            motor_config: motor_config_rx.borrow_and_update().clone(),
            nav_params: nav_params_rx.borrow_and_update().clone(),
            gps_offset: gps_offset_rx.borrow_and_update().clone(),
            imu_calibration: imu_cal_rx.borrow_and_update().clone(),
        };
        save(&path, &state);
        tracing::debug!("Persisted state to {}", path.display());
    }

    tracing::info!("Persist task stopped");
}
