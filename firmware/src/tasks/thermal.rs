use crate::bus::I2cBus;
use crate::config::{FAN_TEMP_MAX, FAN_TEMP_MIN, TMP1075_CHANNELS, THERMAL_INTERVAL};
use crate::drivers::tmp1075::Tmp1075;
use crate::types::{TempReading, ThermalState};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

pub async fn run(
    bus: I2cBus,
    mut fan: Option<FanControl>,
    tx: watch::Sender<ThermalState>,
    cancel: CancellationToken,
) {
    let sensors: Vec<(&str, Tmp1075)> = TMP1075_CHANNELS
        .iter()
        .map(|(addr, label)| (*label, Tmp1075::new(bus.clone(), *addr)))
        .collect();

    tracing::info!("Thermal monitoring started ({} sensors)", sensors.len());

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = tokio::time::sleep(THERMAL_INTERVAL) => {}
        }

        let mut temps = Vec::with_capacity(sensors.len());
        let mut max_temp = f64::NEG_INFINITY;

        for (label, sensor) in &sensors {
            match sensor.read_temp_c().await {
                Ok(temp_c) => {
                    if temp_c > max_temp {
                        max_temp = temp_c;
                    }
                    temps.push(TempReading {
                        label: label.to_string(),
                        temp_c,
                    });
                }
                Err(e) => {
                    tracing::warn!("TMP1075 read error ({label}): {e}");
                }
            }
        }

        // Compute fan duty cycle: linear ramp between FAN_TEMP_MIN and FAN_TEMP_MAX
        let duty = if max_temp <= FAN_TEMP_MIN {
            0.0
        } else if max_temp >= FAN_TEMP_MAX {
            1.0
        } else {
            (max_temp - FAN_TEMP_MIN) / (FAN_TEMP_MAX - FAN_TEMP_MIN)
        };

        if let Some(ref mut fan) = fan {
            fan.set_duty(duty);
        }

        let _ = tx.send(ThermalState {
            temps,
            fan_duty: duty,
        });
    }

    tracing::info!("Thermal task stopped");
}

/// Wrapper around rppal PWM for the cooling fan.
#[cfg(feature = "hw")]
pub struct FanControl {
    pin: rppal::gpio::OutputPin,
}

#[cfg(feature = "hw")]
impl FanControl {
    pub fn new(pin: rppal::gpio::OutputPin) -> Self {
        Self { pin }
    }

    pub fn set_duty(&mut self, duty: f64) {
        let duty = duty.clamp(0.0, 1.0);
        if let Err(e) = self.pin.set_pwm_frequency(25_000.0, duty) {
            tracing::warn!("Fan PWM error: {e}");
        }
    }
}

/// No-op fan control for sim mode.
#[cfg(not(feature = "hw"))]
pub struct FanControl;

#[cfg(not(feature = "hw"))]
impl FanControl {
    pub fn set_duty(&mut self, _duty: f64) {}
}
