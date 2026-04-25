//! Motor output task: resolves nav/teleop motor commands and sends them to
//! the hardware PWM ESC outputs. CAN motor frames are still mirrored when the
//! bus is available, but they are no longer the only motor path.

use crate::config::{
    AUTOPILOT_COMMAND_TIMEOUT, CAN_MOTOR_TX_ID, ESC_PWM_MAX_US, ESC_PWM_MIN_US, ESC_PWM_NEUTRAL_US,
    MOTOR_OUTPUT_INTERVAL, TELEOP_COMMAND_TIMEOUT,
};
use crate::tasks::can::CanTxRequest;
use crate::types::{CanState, MotorCommand, MotorConfig};
use std::time::Instant;
use tokio::sync::{mpsc, watch};
use tokio_util::sync::CancellationToken;

/// Apply per-motor trim (scale) and invert (sign flip) to a raw command. Used
/// only on the resolved nav/teleop output — ESC arming/calibration writes
/// raw values directly so the endpoints aren't shifted.
fn apply_motor_config(cmd: &MotorCommand, config: &MotorConfig) -> MotorCommand {
    let left_sign = if config.left_invert { -1.0 } else { 1.0 };
    let right_sign = if config.right_invert { -1.0 } else { 1.0 };
    MotorCommand {
        left: cmd.left * config.left_trim * left_sign,
        right: cmd.right * config.right_trim * right_sign,
    }
}

#[cfg(feature = "hw")]
use crate::config::{
    ESC_BRINGUP_NEUTRAL_TIME, ESC_PWM_FREQUENCY_HZ, LEFT_ESC_GPIO, RIGHT_ESC_GPIO,
};
#[cfg(feature = "hw")]
use rppal::pwm::{Channel, Polarity, Pwm};
#[cfg(feature = "hw")]
use std::time::Duration;

/// Encode motor command as a 4-byte CAN payload: [left_hi, left_lo, right_hi, right_lo]
/// where each value is a signed i16 in range -10000..10000 representing -1.0..1.0 thrust.
fn encode_motor(cmd: &MotorCommand) -> Vec<u8> {
    let left = (cmd.left.clamp(-1.0, 1.0) * 10000.0).round() as i16;
    let right = (cmd.right.clamp(-1.0, 1.0) * 10000.0).round() as i16;
    let left = left.to_be_bytes();
    let right = right.to_be_bytes();
    vec![left[0], left[1], right[0], right[1]]
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

fn thrust_to_pulse_width_us(thrust: f64) -> u64 {
    let half_range = (ESC_PWM_MAX_US - ESC_PWM_MIN_US) as f64 / 2.0;
    (ESC_PWM_NEUTRAL_US as f64 + thrust.clamp(-1.0, 1.0) * half_range).round() as u64
}

#[cfg(feature = "hw")]
struct EscOutput {
    label: &'static str,
    gpio: u8,
    pwm: Pwm,
}

#[cfg(feature = "hw")]
impl EscOutput {
    fn new(channel: Channel, label: &'static str, gpio: u8) -> Result<Self, rppal::pwm::Error> {
        let pwm = Pwm::with_period(
            channel,
            Duration::from_secs_f64(1.0 / ESC_PWM_FREQUENCY_HZ),
            Duration::from_micros(ESC_PWM_NEUTRAL_US),
            Polarity::Normal,
            true,
        )?;

        Ok(Self { label, gpio, pwm })
    }

    fn set_thrust(&mut self, thrust: f64) -> Result<(), rppal::pwm::Error> {
        self.pwm
            .set_pulse_width(Duration::from_micros(thrust_to_pulse_width_us(thrust)))
    }
}

#[cfg(feature = "hw")]
struct PwmEscOutputs {
    left: EscOutput,
    right: EscOutput,
}

#[cfg(feature = "hw")]
impl PwmEscOutputs {
    fn new() -> Result<Self, rppal::pwm::Error> {
        Ok(Self {
            left: EscOutput::new(Channel::Pwm1, "left", LEFT_ESC_GPIO)?,
            right: EscOutput::new(Channel::Pwm0, "right", RIGHT_ESC_GPIO)?,
        })
    }

    fn write(&mut self, cmd: &MotorCommand) -> Result<(), rppal::pwm::Error> {
        self.left.set_thrust(cmd.left)?;
        self.right.set_thrust(cmd.right)?;
        Ok(())
    }
}

pub async fn run(
    motor_rx: watch::Receiver<MotorCommand>,
    teleop_rx: watch::Receiver<MotorCommand>,
    motor_config_rx: watch::Receiver<MotorConfig>,
    can_state_rx: watch::Receiver<CanState>,
    can_tx: mpsc::Sender<CanTxRequest>,
    motor_reinit_rx: watch::Receiver<u64>,
    motor_cal_rx: watch::Receiver<u64>,
    cancel: CancellationToken,
) {
    tracing::info!("Motor output task started");

    let mut motor_rx = motor_rx;
    let mut teleop_rx = teleop_rx;
    let mut motor_reinit_rx = motor_reinit_rx;
    let mut motor_cal_rx = motor_cal_rx;
    // Mark the current seq as seen so we don't re-arm or re-calibrate at
    // startup — the initial ESC bringup below already covers arming.
    let _ = motor_reinit_rx.borrow_and_update();
    let _ = motor_cal_rx.borrow_and_update();
    let can_state_rx = can_state_rx;
    let mut interval = tokio::time::interval(MOTOR_OUTPUT_INTERVAL);
    let mut autopilot_cmd = motor_rx.borrow().clone();
    let mut autopilot_updated_at = None;
    let mut teleop_cmd = teleop_rx.borrow().clone();
    let mut teleop_updated_at = None;
    let mut teleop_timeout_reported = false;

    #[cfg(feature = "hw")]
    let mut pwm_outputs = match PwmEscOutputs::new() {
        Ok(mut outputs) => {
            tracing::info!(
                "PWM ESC outputs ready: {} ESC on GPIO{} (PWM1), {} ESC on GPIO{} (PWM0)",
                outputs.left.label,
                outputs.left.gpio,
                outputs.right.label,
                outputs.right.gpio,
            );
            if let Err(e) = outputs.write(&MotorCommand::default()) {
                tracing::warn!("Failed to send neutral PWM during ESC bringup: {e}");
                None
            } else {
                tracing::info!(
                    "Holding 1.5 ms neutral PWM for {:?} to arm bidirectional ESCs",
                    ESC_BRINGUP_NEUTRAL_TIME
                );
                let cancelled = tokio::select! {
                    _ = cancel.cancelled() => true,
                    _ = tokio::time::sleep(ESC_BRINGUP_NEUTRAL_TIME) => false,
                };
                if cancelled {
                    let _ = outputs.write(&MotorCommand::default());
                    tracing::info!("Motor output task stopped during ESC bringup");
                    return;
                }

                if crate::config::ESC_AUTO_CALIBRATE_ON_BOOT {
                    tracing::warn!(
                        "Auto-calibration on boot: MIN {:?} → MAX {:?} → NEUTRAL {:?}. Props must be off.",
                        crate::config::ESC_CAL_MIN_HOLD_TIME,
                        crate::config::ESC_CAL_MAX_HOLD_TIME,
                        crate::config::ESC_BRINGUP_NEUTRAL_TIME,
                    );
                    let min = MotorCommand { left: -1.0, right: -1.0 };
                    let max = MotorCommand { left: 1.0, right: 1.0 };
                    let neutral = MotorCommand::default();
                    let phases: [(&MotorCommand, std::time::Duration, &str); 3] = [
                        (&min, crate::config::ESC_CAL_MIN_HOLD_TIME, "MIN"),
                        (&max, crate::config::ESC_CAL_MAX_HOLD_TIME, "MAX"),
                        (&neutral, crate::config::ESC_BRINGUP_NEUTRAL_TIME, "NEUTRAL"),
                    ];
                    let mut aborted = false;
                    for (cmd, dur, label) in phases {
                        tracing::info!("Auto-calibration: holding {} for {:?}", label, dur);
                        if let Err(e) = outputs.write(cmd) {
                            tracing::warn!("PWM ESC write failed during auto-calibration {}: {e}", label);
                        }
                        let cancelled = tokio::select! {
                            _ = cancel.cancelled() => true,
                            _ = tokio::time::sleep(dur) => false,
                        };
                        if cancelled {
                            aborted = true;
                            break;
                        }
                    }
                    if aborted {
                        let _ = outputs.write(&MotorCommand::default());
                        tracing::info!("Motor output task stopped during auto-calibration");
                        return;
                    }
                    tracing::info!("Auto-calibration complete");
                }

                Some(outputs)
            }
        }
        Err(e) => {
            tracing::warn!(
                "PWM ESC outputs unavailable: {e}. Enable PWM0/PWM1 and route them to GPIO{} / GPIO{}.",
                LEFT_ESC_GPIO,
                RIGHT_ESC_GPIO,
            );
            None
        }
    };

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

        // Handle motor reinit: hold neutral PWM for the bringup duration so
        // the ESCs re-arm. Commands received during this window are cleared
        // and will need to be re-sent fresh after the arming window closes.
        if matches!(motor_reinit_rx.has_changed(), Ok(true)) {
            let _ = motor_reinit_rx.borrow_and_update();
            tracing::warn!(
                "Motor reinit: holding neutral PWM for {:?} to re-arm ESCs",
                crate::config::ESC_BRINGUP_NEUTRAL_TIME
            );

            // Clear cached commands so stale teleop/autopilot values don't
            // snap the motors back on as soon as the arming window ends.
            autopilot_cmd = MotorCommand::default();
            autopilot_updated_at = None;
            teleop_cmd = MotorCommand::default();
            teleop_updated_at = None;
            teleop_timeout_reported = false;

            #[cfg(feature = "hw")]
            if let Some(outputs) = pwm_outputs.as_mut() {
                if let Err(e) = outputs.write(&MotorCommand::default()) {
                    tracing::warn!("PWM ESC write failed during reinit: {e}");
                }
            }
            // Mirror zero on CAN so downstream consumers see the stop.
            if can_state_rx.borrow().connected {
                let data = encode_motor(&MotorCommand::default());
                let _ = can_tx.try_send(CanTxRequest {
                    id: CAN_MOTOR_TX_ID,
                    data,
                });
            }

            let cancelled = tokio::select! {
                _ = cancel.cancelled() => true,
                _ = tokio::time::sleep(crate::config::ESC_BRINGUP_NEUTRAL_TIME) => false,
            };
            if cancelled {
                break;
            }

            // Discard any commands that arrived during the arming window so
            // the boat doesn't jerk forward on the first post-reinit tick.
            let _ = motor_rx.borrow_and_update();
            let _ = teleop_rx.borrow_and_update();
            // Skip the rest of this loop iteration — the next tick will
            // resume normal resolution from the cleared state.
            tracing::info!("Motor reinit complete");
            continue;
        }

        // Handle throttle endpoint calibration. Teach the ESCs the full
        // range by holding max for ESC_CAL_MAX_HOLD_TIME, then min for
        // ESC_CAL_MIN_HOLD_TIME, then return to neutral and re-arm.
        // This is a bench procedure — the MQTT handler logs a warning,
        // and the dashboard button requires a confirmation.
        if matches!(motor_cal_rx.has_changed(), Ok(true)) {
            let _ = motor_cal_rx.borrow_and_update();
            tracing::warn!(
                "Motor throttle calibration starting: min {:?}, max {:?}, neutral {:?}",
                crate::config::ESC_CAL_MIN_HOLD_TIME,
                crate::config::ESC_CAL_MAX_HOLD_TIME,
                crate::config::ESC_BRINGUP_NEUTRAL_TIME,
            );

            autopilot_cmd = MotorCommand::default();
            autopilot_updated_at = None;
            teleop_cmd = MotorCommand::default();
            teleop_updated_at = None;
            teleop_timeout_reported = false;

            let max_cmd = MotorCommand { left: 1.0, right: 1.0 };
            let min_cmd = MotorCommand { left: -1.0, right: -1.0 };
            let neutral_cmd = MotorCommand::default();

            // Helper: write a thrust to both PWM + CAN, then sleep with
            // cancellation honored. Returns true if cancelled.
            macro_rules! hold {
                ($cmd:expr, $dur:expr, $label:literal) => {{
                    tracing::info!("Calibration: holding {} for {:?}", $label, $dur);
                    #[cfg(feature = "hw")]
                    if let Some(outputs) = pwm_outputs.as_mut() {
                        if let Err(e) = outputs.write(&$cmd) {
                            tracing::warn!("PWM ESC write failed during calibration {}: {e}", $label);
                        }
                    }
                    if can_state_rx.borrow().connected {
                        let data = encode_motor(&$cmd);
                        let _ = can_tx.try_send(CanTxRequest {
                            id: CAN_MOTOR_TX_ID,
                            data,
                        });
                    }
                    let cancelled = tokio::select! {
                        _ = cancel.cancelled() => true,
                        _ = tokio::time::sleep($dur) => false,
                    };
                    cancelled
                }};
            }

            let cancelled = hold!(min_cmd, crate::config::ESC_CAL_MIN_HOLD_TIME, "MIN")
                || hold!(max_cmd, crate::config::ESC_CAL_MAX_HOLD_TIME, "MAX")
                || hold!(neutral_cmd, crate::config::ESC_BRINGUP_NEUTRAL_TIME, "NEUTRAL");

            if cancelled {
                // Always end on neutral if we're shutting down mid-calibration.
                #[cfg(feature = "hw")]
                if let Some(outputs) = pwm_outputs.as_mut() {
                    let _ = outputs.write(&MotorCommand::default());
                }
                break;
            }

            // Discard any commands that arrived during calibration.
            let _ = motor_rx.borrow_and_update();
            let _ = teleop_rx.borrow_and_update();
            tracing::info!("Motor throttle calibration complete");
            continue;
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

        let raw_cmd = resolve_command(
            &autopilot_cmd,
            autopilot_updated_at,
            &teleop_cmd,
            teleop_updated_at,
            now,
        );
        let cmd = apply_motor_config(&raw_cmd, &motor_config_rx.borrow());

        #[cfg(feature = "hw")]
        {
            let mut pwm_failed = false;
            if let Some(outputs) = pwm_outputs.as_mut() {
                if let Err(e) = outputs.write(&cmd) {
                    tracing::warn!("PWM ESC write failed: {e}");
                    pwm_failed = true;
                }
            }
            if pwm_failed {
                pwm_outputs = None;
            }
        }

        if can_state_rx.borrow().connected {
            let data = encode_motor(&cmd);
            if let Err(e) = can_tx.try_send(CanTxRequest {
                id: CAN_MOTOR_TX_ID,
                data,
            }) {
                tracing::debug!("Motor CAN TX send failed: {e}");
            }
        }
    }

    #[cfg(feature = "hw")]
    if let Some(outputs) = pwm_outputs.as_mut() {
        let _ = outputs.write(&MotorCommand::default());
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    // Stop CAN mirror on shutdown
    let data = encode_motor(&MotorCommand::default());
    if can_state_rx.borrow().connected {
        let _ = can_tx.try_send(CanTxRequest {
            id: CAN_MOTOR_TX_ID,
            data,
        });
    }

    tracing::info!("Motor output task stopped");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

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
            Some(now - TELEOP_COMMAND_TIMEOUT - Duration::from_millis(1)),
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

    #[test]
    fn thrust_maps_to_standard_bidirectional_pwm() {
        assert_eq!(thrust_to_pulse_width_us(-1.0), 1_000);
        assert_eq!(thrust_to_pulse_width_us(0.0), 1_500);
        assert_eq!(thrust_to_pulse_width_us(0.5), 1_750);
        assert_eq!(thrust_to_pulse_width_us(1.0), 2_000);
    }

    #[test]
    fn motor_config_default_is_identity() {
        let raw = MotorCommand { left: 0.7, right: -0.3 };
        let out = apply_motor_config(&raw, &MotorConfig::default());
        assert_eq!(out, raw);
    }

    #[test]
    fn motor_config_inverts_and_trims() {
        let raw = MotorCommand { left: 0.6, right: 0.8 };
        let cfg = MotorConfig {
            left_invert: true,
            right_invert: false,
            left_trim: 1.0,
            right_trim: 0.5,
        };
        let out = apply_motor_config(&raw, &cfg);
        assert!((out.left - (-0.6)).abs() < 1e-9);
        assert!((out.right - 0.4).abs() < 1e-9);
    }
}
