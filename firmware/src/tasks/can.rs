//! CAN bus task: initializes MCP2515, polls for RX frames, handles TX requests.
//! Runs in spawn_blocking since SPI is synchronous.

use crate::config::{CAN_POLL_INTERVAL, CAN_SPI_DEV, CAN_SPI_SPEED_HZ};
use crate::types::{CanFrame, CanState};
use tokio::sync::{mpsc, watch};
use tokio_util::sync::CancellationToken;

/// TX request sent from other tasks to the CAN task.
pub struct CanTxRequest {
    pub id: u16,
    pub data: Vec<u8>,
}

/// Async entry point. Spawns the blocking SPI thread and bridges via channels.
pub async fn run(
    tx_rx: mpsc::Receiver<CanTxRequest>,
    state_tx: watch::Sender<CanState>,
    frame_tx: mpsc::Sender<CanFrame>,
    cancel: CancellationToken,
) {
    #[cfg(feature = "hw")]
    {
        let cancel_clone = cancel.clone();
        let handle = tokio::task::spawn_blocking(move || {
            run_blocking(tx_rx, state_tx, frame_tx, cancel_clone);
        });

        cancel.cancelled().await;
        let _ = handle.await;
    }

    #[cfg(not(feature = "hw"))]
    {
        drop(tx_rx);
        drop(frame_tx);
        tracing::info!("CAN task disabled (sim mode)");
        let _ = state_tx.send(CanState {
            connected: false,
            ..Default::default()
        });
        cancel.cancelled().await;
    }

    tracing::info!("CAN task stopped");
}

#[cfg(feature = "hw")]
fn run_blocking(
    mut tx_rx: mpsc::Receiver<CanTxRequest>,
    state_tx: watch::Sender<CanState>,
    frame_tx: mpsc::Sender<CanFrame>,
    cancel: CancellationToken,
) {
    use crate::drivers::mcp2515::Mcp2515;

    // Retry open + init — SPI device may not be ready on boot
    let mut can = loop {
        if cancel.is_cancelled() {
            return;
        }
        match Mcp2515::open(CAN_SPI_DEV, CAN_SPI_SPEED_HZ) {
            Ok(mut c) => match c.init_500k() {
                Ok(()) => {
                    tracing::info!("MCP2515 CAN initialized (500kbps, normal mode)");
                    break c;
                }
                Err(e) => {
                    tracing::warn!("MCP2515 init failed: {e}, retrying in 5s");
                    let _ = state_tx.send(CanState {
                        connected: false,
                        last_error: Some(e.to_string()),
                        ..Default::default()
                    });
                }
            },
            Err(e) => {
                tracing::warn!("MCP2515 SPI open failed: {e}, retrying in 5s");
                let _ = state_tx.send(CanState {
                    connected: false,
                    last_error: Some(e.to_string()),
                    ..Default::default()
                });
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(5));
    };

    let mut state = CanState {
        connected: true,
        ..Default::default()
    };
    let _ = state_tx.send(state.clone());

    let poll_dur = CAN_POLL_INTERVAL;

    while !cancel.is_cancelled() {
        // Process any pending TX requests (non-blocking check)
        while let Ok(req) = tx_rx.try_recv() {
            match can.send(req.id, &req.data) {
                Ok(()) => {
                    state.tx_count += 1;
                }
                Err(e) => {
                    tracing::warn!("CAN TX error: {e}");
                    state.last_error = Some(e.to_string());
                }
            }
        }

        // Poll for received frames
        match can.poll_rx() {
            Ok(frames) => {
                for frame in frames {
                    state.rx_count += 1;
                    tracing::debug!(
                        "CAN RX: id=0x{:03X} dlc={} data={:02X?}",
                        frame.id,
                        frame.dlc,
                        frame.data
                    );
                    // Send to anyone listening (best-effort)
                    let _ = frame_tx.try_send(frame);
                }
            }
            Err(e) => {
                tracing::warn!("CAN RX poll error: {e}");
                state.last_error = Some(e.to_string());
            }
        }

        let _ = state_tx.send(state.clone());
        std::thread::sleep(poll_dur);
    }
}
