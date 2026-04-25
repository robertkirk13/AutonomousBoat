use crate::config::*;
use crate::types::*;
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS, TlsConfiguration, Transport};
use serde::Deserialize;
use serde::Serialize;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::watch;
use tokio_rustls::rustls::{ClientConfig, RootCertStore};
use tokio_util::sync::CancellationToken;

#[derive(Serialize)]
struct StatusMessage {
    uptime_secs: u64,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum CommandMessage {
    Reboot,
    GpsAdjustOffset {
        delta_lat: f64,
        delta_lon: f64,
    },
    GpsClearOffset,
    CameraSet {
        enabled: bool,
        width: u32,
        height: u32,
        fps: u32,
    },
    MotorReinit,
    MotorCalibrate,
}

pub struct MqttConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

impl MqttConfig {
    /// Load MQTT config from environment variables.
    pub fn from_env() -> Option<Self> {
        Some(Self {
            host: std::env::var("MQTT_HOST").ok()?,
            port: std::env::var("MQTT_PORT").ok()?.parse().ok()?,
            username: std::env::var("MQTT_USER").ok()?,
            password: std::env::var("MQTT_PASS").ok()?,
        })
    }
}

pub async fn run(
    config: MqttConfig,
    imu_rx: watch::Receiver<Option<ImuData>>,
    power_rx: watch::Receiver<PowerState>,
    thermal_rx: watch::Receiver<ThermalState>,
    gps_rx: watch::Receiver<GpsPosition>,
    nav_rx: watch::Receiver<NavState>,
    payload_rx: watch::Receiver<PayloadSensorState>,
    camera_rx: watch::Receiver<CameraSettings>,
    network_rx: watch::Receiver<NetworkState>,
    mission_tx: watch::Sender<Mission>,
    teleop_tx: watch::Sender<MotorCommand>,
    gps_offset_tx: watch::Sender<GpsOffset>,
    camera_tx: watch::Sender<CameraSettings>,
    motor_reinit_tx: watch::Sender<u64>,
    motor_cal_tx: watch::Sender<u64>,
    cancel: CancellationToken,
) {
    let mut opts = MqttOptions::new("boat-firmware", &config.host, config.port);
    opts.set_credentials(&config.username, &config.password);
    opts.set_keep_alive(std::time::Duration::from_secs(30));

    // HiveMQ Cloud requires TLS — load system root CAs
    let mut root_store = RootCertStore::empty();
    for cert in rustls_native_certs::load_native_certs().expect("failed to load native certs") {
        let _ = root_store.add(cert);
    }

    let tls_config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();

    opts.set_transport(Transport::tls_with_config(TlsConfiguration::Rustls(
        Arc::new(tls_config),
    )));

    let (client, mut eventloop) = AsyncClient::new(opts, 64);
    let start = Instant::now();

    // Spawn the event loop handler — also processes incoming mission commands
    let cancel_clone = cancel.clone();
    let mission_tx_clone = mission_tx.clone();
    let teleop_tx_clone = teleop_tx.clone();
    let gps_offset_tx_clone = gps_offset_tx.clone();
    let camera_tx_clone = camera_tx.clone();
    let motor_reinit_tx_clone = motor_reinit_tx.clone();
    let motor_cal_tx_clone = motor_cal_tx.clone();
    let client_sub = client.clone();
    let eventloop_handle = tokio::spawn(async move {
        let mut subscribed = false;
        loop {
            tokio::select! {
                _ = cancel_clone.cancelled() => break,
                event = eventloop.poll() => {
                    match event {
                        Ok(Event::Incoming(Packet::ConnAck(_))) => {
                            if !subscribed {
                                let _ = client_sub.subscribe(TOPIC_MISSION_SET, QoS::AtLeastOnce).await;
                                let _ = client_sub.subscribe(TOPIC_MOTOR_SET, QoS::AtMostOnce).await;
                                let _ = client_sub.subscribe(TOPIC_COMMAND, QoS::AtLeastOnce).await;
                                subscribed = true;
                                tracing::info!("Subscribed to {TOPIC_MISSION_SET}, {TOPIC_MOTOR_SET}, {TOPIC_COMMAND}");
                            }
                        }
                        Ok(Event::Incoming(Packet::Publish(publish))) => {
                            if publish.topic == TOPIC_MISSION_SET {
                                match serde_json::from_slice::<Mission>(&publish.payload) {
                                    Ok(mission) => {
                                        tracing::info!("Received mission: {} waypoints", mission.waypoints.len());
                                        let _ = mission_tx_clone.send(mission);
                                    }
                                    Err(e) => {
                                        tracing::warn!("Failed to parse mission: {e}");
                                    }
                                }
                            } else if publish.topic == TOPIC_MOTOR_SET {
                                match serde_json::from_slice::<MotorCommand>(&publish.payload) {
                                    Ok(cmd) => {
                                        let _ = teleop_tx_clone.send(cmd);
                                    }
                                    Err(e) => {
                                        tracing::warn!("Failed to parse motor command: {e}");
                                    }
                                }
                            } else if publish.topic == TOPIC_COMMAND {
                                match serde_json::from_slice::<CommandMessage>(&publish.payload) {
                                    Ok(CommandMessage::Reboot) => {
                                        tracing::warn!("Reboot command received via MQTT — rebooting");
                                        let _ = std::process::Command::new("sudo").args(["reboot"]).spawn();
                                    }
                                    Ok(CommandMessage::GpsAdjustOffset { delta_lat, delta_lon }) => {
                                        if !delta_lat.is_finite() || !delta_lon.is_finite() {
                                            tracing::warn!("Ignoring non-finite GPS offset adjustment");
                                            continue;
                                        }

                                        let current = gps_offset_tx_clone.borrow().clone();
                                        let next = GpsOffset {
                                            lat: current.lat + delta_lat,
                                            lon: current.lon + delta_lon,
                                        };
                                        let _ = gps_offset_tx_clone.send(next.clone());
                                        tracing::info!(
                                            "Applied GPS offset adjustment: dlat={delta_lat:.8}, dlon={delta_lon:.8} -> lat={:.8}, lon={:.8}",
                                            next.lat,
                                            next.lon,
                                        );
                                    }
                                    Ok(CommandMessage::GpsClearOffset) => {
                                        let _ = gps_offset_tx_clone.send(GpsOffset::default());
                                        tracing::info!("Cleared GPS offset calibration");
                                    }
                                    Ok(CommandMessage::CameraSet { enabled, width, height, fps }) => {
                                        let next = CameraSettings { enabled, width, height, fps };
                                        if camera_tx_clone.borrow().clone() == next {
                                            tracing::debug!("Camera settings unchanged; ignoring");
                                        } else {
                                            tracing::info!(
                                                "Camera set: enabled={enabled} {width}x{height}@{fps}"
                                            );
                                            let _ = camera_tx_clone.send(next);
                                        }
                                    }
                                    Ok(CommandMessage::MotorReinit) => {
                                        // Monotonically bump a counter so the motor task's
                                        // watch::Receiver always sees a change, even on
                                        // repeated reinit requests.
                                        let next = motor_reinit_tx_clone.borrow().wrapping_add(1);
                                        let _ = motor_reinit_tx_clone.send(next);
                                        tracing::info!("Motor reinit requested via MQTT (seq {next})");
                                    }
                                    Ok(CommandMessage::MotorCalibrate) => {
                                        let next = motor_cal_tx_clone.borrow().wrapping_add(1);
                                        let _ = motor_cal_tx_clone.send(next);
                                        tracing::warn!("Motor endpoint calibration requested via MQTT (seq {next}) — props MUST be off");
                                    }
                                    Err(e) => {
                                        tracing::warn!("Failed to parse command: {e}");
                                    }
                                }
                            }
                        }
                        Ok(_) => {}
                        Err(e) => {
                            tracing::warn!("MQTT connection error: {e}");
                            subscribed = false;
                            // Don't sleep here — rumqttc reconnects automatically on next poll()
                        }
                    }
                }
            }
        }
    });

    tracing::info!("MQTT started -> {}:{}", config.host, config.port);

    // Publish loop
    let mut imu_rx = imu_rx;
    let mut power_rx = power_rx;
    let mut thermal_rx = thermal_rx;
    let mut nav_rx = nav_rx;
    let mut payload_rx = payload_rx;
    let mut camera_rx = camera_rx;
    let mut network_rx = network_rx;
    let mut status_interval = tokio::time::interval(MQTT_STATUS_INTERVAL);
    let mut imu_interval = tokio::time::interval(MQTT_IMU_INTERVAL);
    let mut gps_interval = tokio::time::interval(GPS_INTERVAL);

    // Publish initial camera state so late-connecting dashboards get it
    // without having to wait for the next change.
    let initial_camera = camera_rx.borrow().clone();
    publish_retained_json(&client, TOPIC_CAMERA, &initial_camera).await;

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,

            _ = imu_interval.tick() => {
                let angles = imu_rx.borrow_and_update().clone();
                if let Some(angles) = angles {
                    publish_json(&client, TOPIC_IMU, &angles).await;
                }
            }

            result = power_rx.changed() => {
                if result.is_err() {
                    tracing::warn!("Power channel closed, stopping power publishes");
                    // Continue loop — other channels may still be active
                } else {
                    let state = power_rx.borrow_and_update().clone();
                    publish_json(&client, TOPIC_POWER, &state).await;
                }
            }

            result = thermal_rx.changed() => {
                if result.is_err() {
                    tracing::warn!("Thermal channel closed, stopping thermal publishes");
                } else {
                    let state = thermal_rx.borrow_and_update().clone();
                    publish_json(&client, TOPIC_THERMAL, &state).await;
                }
            }

            _ = gps_interval.tick() => {
                let pos = gps_rx.borrow().clone();
                publish_json(&client, TOPIC_GPS, &pos).await;
            }

            result = nav_rx.changed() => {
                if result.is_err() {
                    tracing::warn!("Nav channel closed, stopping nav publishes");
                } else {
                    let state = nav_rx.borrow_and_update().clone();
                    publish_json(&client, TOPIC_NAV, &state).await;
                }
            }

            result = payload_rx.changed() => {
                if result.is_err() {
                    tracing::warn!("Payload channel closed, stopping payload publishes");
                } else {
                    let state = payload_rx.borrow_and_update().clone();
                    publish_json(&client, TOPIC_PAYLOAD, &state).await;
                }
            }

            result = camera_rx.changed() => {
                if result.is_err() {
                    tracing::warn!("Camera channel closed, stopping camera publishes");
                } else {
                    let state = camera_rx.borrow_and_update().clone();
                    publish_retained_json(&client, TOPIC_CAMERA, &state).await;
                }
            }

            result = network_rx.changed() => {
                if result.is_err() {
                    tracing::warn!("Network channel closed, stopping network publishes");
                } else {
                    let state = network_rx.borrow_and_update().clone();
                    publish_retained_json(&client, TOPIC_NETWORK, &state).await;
                }
            }

            _ = status_interval.tick() => {
                let msg = StatusMessage {
                    uptime_secs: start.elapsed().as_secs(),
                };
                publish_json(&client, TOPIC_STATUS, &msg).await;
            }
        }
    }

    let _ = client.disconnect().await;
    let _ = eventloop_handle.await;
    tracing::info!("MQTT stopped");
}

async fn publish_json<T: Serialize>(client: &AsyncClient, topic: &str, payload: &T) {
    publish_with_retain(client, topic, payload, false).await;
}

async fn publish_retained_json<T: Serialize>(client: &AsyncClient, topic: &str, payload: &T) {
    publish_with_retain(client, topic, payload, true).await;
}

async fn publish_with_retain<T: Serialize>(
    client: &AsyncClient,
    topic: &str,
    payload: &T,
    retain: bool,
) {
    match serde_json::to_vec(payload) {
        Ok(bytes) => {
            let qos = if retain { QoS::AtLeastOnce } else { QoS::AtMostOnce };
            if let Err(e) = client.publish(topic, qos, retain, bytes).await {
                tracing::warn!("MQTT publish error on {topic}: {e}");
            }
        }
        Err(e) => {
            tracing::warn!("JSON serialization error for {topic}: {e}");
        }
    }
}
