//! Motor output task: reads MotorCommand from nav/teleop and sends CAN frames.
//! Teleop commands take priority over autopilot commands.

use crate::config::CAN_TX_ID;
use crate::tasks::can::CanTxRequest;
use crate::types::MotorCommand;
use tokio::sync::{mpsc, watch};
use tokio_util::sync::CancellationToken;

/// Encode motor command as a 4-byte CAN payload: [left_hi, left_lo, right_hi, right_lo]
/// where each value is u16 in range 0..10000 representing 0.0..1.0 thrust.
fn encode_motor(cmd: &MotorCommand) -> Vec<u8> {
    let left = (cmd.left.clamp(0.0, 1.0) * 10000.0) as u16;
    let right = (cmd.right.clamp(0.0, 1.0) * 10000.0) as u16;
    vec![
        (left >> 8) as u8,
        (left & 0xFF) as u8,
        (right >> 8) as u8,
        (right & 0xFF) as u8,
    ]
}

pub async fn run(
    motor_rx: watch::Receiver<MotorCommand>,
    teleop_rx: watch::Receiver<MotorCommand>,
    can_tx: mpsc::Sender<CanTxRequest>,
    cancel: CancellationToken,
) {
    tracing::info!("Motor output task started");

    let mut motor_rx = motor_rx;
    let mut teleop_rx = teleop_rx;
    let mut interval = tokio::time::interval(std::time::Duration::from_millis(50)); // 20Hz

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = interval.tick() => {}
        }

        // Teleop takes priority over autopilot
        let teleop = teleop_rx.borrow_and_update().clone();
        let cmd = if teleop.left != 0.0 || teleop.right != 0.0 {
            teleop
        } else {
            motor_rx.borrow_and_update().clone()
        };

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
    let _ = can_tx.try_send(CanTxRequest {
        id: CAN_TX_ID,
        data,
    });

    tracing::info!("Motor output task stopped");
}
