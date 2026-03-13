//! Motor output task: reads MotorCommand from nav/teleop and sends CAN frames.
//! Teleop commands take priority over autopilot commands.

use crate::config::{
    AUTOPILOT_COMMAND_TIMEOUT,
    CAN_TX_ID,
    MOTOR_OUTPUT_INTERVAL,
    TELEOP_COMMAND_TIMEOUT,
};
use crate::tasks::can::CanTxRequest;
use crate::types::{CanState, MotorCommand};
use std::time::Instant;
use tokio::sync::{mpsc, watch};
use tokio_util::sync::CancellationToken;

/// Encode motor command as a 4-byte CAN payload: [left_hi, left_lo, right_hi, right_lo]
/// where each value is a signed i16 in range -10000..10000 representing -1.0..1.0 thrust.
fn encode_motor(cmd: &MotorCommand) -> Vec<u8> {
    let left = (cmd.left.clamp(-1.0, 1.0) * 10000.0).round() as i16;
    let right = (cmd.right.clamp(-1.0, 1.0) * 10000.0).round() as i16;
    let left = left.to_be_bytes();
    let right = right.to_be_bytes();
    vec![
        left[0],
        left[1],
        right[0],
        right[1],
    ]
}

fn command_is_nonzero(cmd: &MotorCommand) -> bool {
    cmd.left.abs() > f64::EPSILON || cmd.right.abs() > f64::EPSILON
}

fn resolve_command(
    autopilot_cmd: &MotorCommand,
    autopilot_updated_at: Option<Instant>,
    teleop_cmd: &MotorCommand,
    teleop_updated_at: Option<Instant>,
    now: Instant,
) -> MotorCommand {
    let teleop_is_fresh = teleop_updated_at
        .map(|updated_at| now.duration_since(updated_at) <= TELEOP_COMMAND_TIMEOUT)
        .unwrap_or(false);
    if teleop_is_fresh {
        return teleop_cmd.clone();
    }

    let autopilot_is_fresh = autopilot_updated_at
        .map(|updated_at| now.duration_since(updated_at) <= AUTOPILOT_COMMAND_TIMEOUT)
        .unwrap_or(false);
    if autopilot_is_fresh {
        autopilot_cmd.clone()
    } else {
        MotorCommand::default()
    }
}

pub async fn run(
    motor_rx: watch::Receiver<MotorCommand>,
    teleop_rx: watch::Receiver<MotorCommand>,
    can_state_rx: watch::Receiver<CanState>,
    can_tx: mpsc::Sender<CanTxRequest>,
    cancel: CancellationToken,
) {
    tracing::info!("Motor output task started");

    let mut motor_rx = motor_rx;
    let mut teleop_rx = teleop_rx;
    let can_state_rx = can_state_rx;
    let mut interval = tokio::time::interval(MOTOR_OUTPUT_INTERVAL);
    let mut autopilot_cmd = motor_rx.borrow().clone();
    let mut autopilot_updated_at = None;
    let mut teleop_cmd = teleop_rx.borrow().clone();
    let mut teleop_updated_at = None;
    let mut teleop_timeout_reported = false;

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = interval.tick() => {}
        }

        let now = Instant::now();

        if matches!(motor_rx.has_changed(), Ok(true)) {
            autopilot_cmd = motor_rx.borrow_and_update().clone();
            autopilot_updated_at = Some(now);
        }

        if matches!(teleop_rx.has_changed(), Ok(true)) {
            teleop_cmd = teleop_rx.borrow_and_update().clone();
            teleop_updated_at = Some(now);
            teleop_timeout_reported = false;
        }

        if command_is_nonzero(&teleop_cmd)
            && teleop_updated_at
                .map(|updated_at| now.duration_since(updated_at) > TELEOP_COMMAND_TIMEOUT)
                .unwrap_or(false)
            && !teleop_timeout_reported
        {
            tracing::warn!("Teleop command stream timed out; stopping motors");
            teleop_timeout_reported = true;
        }

        let cmd = resolve_command(
            &autopilot_cmd,
            autopilot_updated_at,
            &teleop_cmd,
            teleop_updated_at,
            now,
        );

        if !can_state_rx.borrow().connected {
            continue;
        }

        let data = encode_motor(&cmd);
        if let Err(e) = can_tx.try_send(CanTxRequest {
            id: CAN_TX_ID,
            data,
        }) {
            tracing::debug!("Motor CAN TX send failed: {e}");
        }
    }

    // Stop motors on shutdown
    let data = encode_motor(&MotorCommand::default());
    if can_state_rx.borrow().connected {
        let _ = can_tx.try_send(CanTxRequest {
            id: CAN_TX_ID,
            data,
        });
    }

    tracing::info!("Motor output task stopped");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_motor_preserves_negative_values() {
        let bytes = encode_motor(&MotorCommand {
            left: -0.5,
            right: 0.25,
        });

        assert_eq!(bytes, vec![0xEC, 0x78, 0x09, 0xC4]);
    }

    #[test]
    fn stale_teleop_falls_back_to_safe_stop() {
        let now = Instant::now();
        let cmd = resolve_command(
            &MotorCommand::default(),
            None,
            &MotorCommand {
                left: 0.7,
                right: 0.7,
            },
            Some(now - TELEOP_COMMAND_TIMEOUT - std::time::Duration::from_millis(1)),
            now,
        );

        assert_eq!(cmd, MotorCommand::default());
    }

    #[test]
    fn fresh_teleop_overrides_autopilot() {
        let now = Instant::now();
        let cmd = resolve_command(
            &MotorCommand {
                left: 0.4,
                right: 0.4,
            },
            Some(now),
            &MotorCommand {
                left: -0.2,
                right: 0.2,
            },
            Some(now),
            now,
        );

        assert_eq!(
            cmd,
            MotorCommand {
                left: -0.2,
                right: 0.2,
            }
        );
    }
}
