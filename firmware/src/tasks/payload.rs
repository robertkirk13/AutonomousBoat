use crate::config::{
    CAN_ID_PAYLOAD_EC_MS_CM, CAN_ID_PAYLOAD_PH, CAN_ID_PAYLOAD_SONAR_IN,
    CAN_ID_PAYLOAD_TEMPERATURE_F, CAN_ID_PAYLOAD_TURBIDITY_NTU, PAYLOAD_SENSOR_TIMEOUT,
};
use crate::types::{CanFrame, PayloadSensorState};
use std::time::Instant;
use tokio::sync::{mpsc, watch};
use tokio::time::{self, MissedTickBehavior};
use tokio_util::sync::CancellationToken;

pub async fn run(
    mut frame_rx: mpsc::Receiver<CanFrame>,
    state_tx: watch::Sender<PayloadSensorState>,
    cancel: CancellationToken,
) {
    tracing::info!("Payload sensor task started");

    let mut state = PayloadSensorState::default();
    let mut frames_closed = false;
    let mut last_seen = None::<Instant>;
    let mut timeout_tick = time::interval(std::time::Duration::from_millis(250));
    timeout_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = timeout_tick.tick() => {
                if state.connected
                    && last_seen
                        .map(|seen| seen.elapsed() > PAYLOAD_SENSOR_TIMEOUT)
                        .unwrap_or(false)
                {
                    state.connected = false;
                    let _ = state_tx.send(state.clone());
                    tracing::warn!("Payload CAN telemetry timed out");
                }
            }
            maybe_frame = frame_rx.recv(), if !frames_closed => {
                let Some(frame) = maybe_frame else {
                    frames_closed = true;
                    continue;
                };

                if !decode_payload_frame(&frame, &mut state) {
                    continue;
                }

                let now = Instant::now();
                let was_connected = state.connected;
                state.connected = true;
                state.rx_count += 1;
                state.last_frame_id = Some(frame.id);
                state.timestamp = Some(now);
                last_seen = Some(now);
                let _ = state_tx.send(state.clone());

                if !was_connected {
                    tracing::info!("Payload CAN telemetry online");
                }
            }
        }
    }

    if state.connected {
        state.connected = false;
        let _ = state_tx.send(state);
    }

    tracing::info!("Payload sensor task stopped");
}

fn decode_payload_frame(frame: &CanFrame, state: &mut PayloadSensorState) -> bool {
    if frame.rtr || frame.data.len() < 4 {
        return false;
    }

    let value =
        f32::from_le_bytes([frame.data[0], frame.data[1], frame.data[2], frame.data[3]]) as f64;

    match frame.id {
        CAN_ID_PAYLOAD_TEMPERATURE_F => state.temperature_f = Some(value),
        CAN_ID_PAYLOAD_PH => state.ph = Some(value),
        CAN_ID_PAYLOAD_EC_MS_CM => state.ec_ms_cm = Some(value),
        CAN_ID_PAYLOAD_TURBIDITY_NTU => state.turbidity_ntu = Some(value),
        CAN_ID_PAYLOAD_SONAR_IN => state.sonar_in = Some(value),
        _ => return false,
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(id: u16, value: f32) -> CanFrame {
        CanFrame {
            id,
            rtr: false,
            dlc: 4,
            data: value.to_le_bytes().to_vec(),
        }
    }

    fn assert_close(actual: Option<f64>, expected: f64) {
        let value = actual.expect("decoded value should be present");
        assert!(
            (value - expected).abs() < 1e-4,
            "expected {expected}, got {value}"
        );
    }

    #[test]
    fn decodes_known_sensor_ids() {
        let mut state = PayloadSensorState::default();

        assert!(decode_payload_frame(
            &frame(CAN_ID_PAYLOAD_TEMPERATURE_F, 72.5),
            &mut state
        ));
        assert!(decode_payload_frame(
            &frame(CAN_ID_PAYLOAD_PH, 7.14),
            &mut state
        ));
        assert!(decode_payload_frame(
            &frame(CAN_ID_PAYLOAD_EC_MS_CM, 1.82),
            &mut state
        ));
        assert!(decode_payload_frame(
            &frame(CAN_ID_PAYLOAD_TURBIDITY_NTU, 14.0),
            &mut state
        ));
        assert!(decode_payload_frame(
            &frame(CAN_ID_PAYLOAD_SONAR_IN, 22.25),
            &mut state
        ));

        assert_close(state.temperature_f, 72.5);
        assert_close(state.ph, 7.14);
        assert_close(state.ec_ms_cm, 1.82);
        assert_close(state.turbidity_ntu, 14.0);
        assert_close(state.sonar_in, 22.25);
    }

    #[test]
    fn ignores_unknown_or_short_frames() {
        let mut state = PayloadSensorState::default();

        assert!(!decode_payload_frame(
            &CanFrame {
                id: 0x321,
                rtr: false,
                dlc: 4,
                data: vec![0, 0, 0, 0],
            },
            &mut state,
        ));

        assert!(!decode_payload_frame(
            &CanFrame {
                id: CAN_ID_PAYLOAD_PH,
                rtr: false,
                dlc: 2,
                data: vec![0, 0],
            },
            &mut state,
        ));

        assert_eq!(state.ph, None);
    }
}
