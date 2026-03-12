mod bus;
#[cfg(feature = "sim")]
mod bus_sim;
mod config;
mod drivers;
mod mqtt;
#[cfg(feature = "sim")]
mod sim_world;
mod tasks;
mod types;

use bus::I2cBus;
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use tokio_util::sync::CancellationToken;
use types::*;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("boat_firmware=info".parse().unwrap()),
        )
        .compact()
        .init();

    tracing::info!("BoatCore firmware starting");

    let cancel = CancellationToken::new();

    // --- Sim world (sim mode only) ---
    #[cfg(feature = "sim")]
    let world = sim_world::SimWorld::new();

    // --- I2C bus owner ---
    let (bus_tx, mut bus_rx) = mpsc::channel(32);
    let i2c_bus = I2cBus::new(bus_tx);

    #[cfg(feature = "sim")]
    let world_for_bus = world.clone();
    let bus_handle = tokio::task::spawn_blocking(move || {
        #[cfg(feature = "hw")]
        bus::run_bus_owner(config::I2C_BUS, &mut bus_rx);

        #[cfg(feature = "sim")]
        bus_sim::run_bus_owner_sim(&mut bus_rx, &world_for_bus);
    });

    // --- Watch channels for sensor state ---
    let (imu_tx, imu_rx) = watch::channel(None::<EulerAngles>);
    let (power_tx, power_rx) = watch::channel(PowerState::default());
    let (thermal_tx, thermal_rx) = watch::channel(ThermalState::default());
    let (gps_tx, gps_rx) = watch::channel(GpsPosition::default());
    let (nav_tx, nav_rx) = watch::channel(NavState::default());
    let (mission_tx, mission_rx) = watch::channel(Mission::default());
    let (motor_tx, motor_rx) = watch::channel(MotorCommand::default());
    let (teleop_tx, teleop_rx) = watch::channel(MotorCommand::default());
    let (can_state_tx, _can_state_rx) = watch::channel(CanState::default());

    // CAN TX request channel (other tasks can send CAN frames)
    let (can_tx, can_tx_rx) = mpsc::channel::<tasks::can::CanTxRequest>(32);
    // CAN RX frame channel (received frames forwarded here)
    let (can_frame_tx, _can_frame_rx) = mpsc::channel::<CanFrame>(64);

    // --- Fan GPIO (hw only) ---
    #[cfg(feature = "hw")]
    let fan = match rppal::gpio::Gpio::new()
        .and_then(|gpio| gpio.get(config::FAN_GPIO))
        .map(|pin| pin.into_output())
    {
        Ok(pin) => {
            tracing::info!("Fan PWM on GPIO{}", config::FAN_GPIO);
            Some(tasks::thermal::FanControl::new(pin))
        }
        Err(e) => {
            tracing::warn!("Fan GPIO not available: {e}");
            None
        }
    };

    #[cfg(not(feature = "hw"))]
    let fan: Option<tasks::thermal::FanControl> = None;

    // --- Spawn sensor tasks ---
    let imu_handle = tokio::spawn(tasks::imu::run(
        i2c_bus.clone(),
        imu_tx,
        cancel.clone(),
    ));

    let power_handle = tokio::spawn(tasks::power::run(
        i2c_bus.clone(),
        power_tx,
        cancel.clone(),
    ));

    let thermal_handle = tokio::spawn(tasks::thermal::run(
        i2c_bus.clone(),
        fan,
        thermal_tx,
        cancel.clone(),
    ));

    // Display is handled by Python ssd1306-dashboard.service
    let display_handle = tokio::spawn(tasks::display::run(cancel.clone()));

    // --- CAN bus (MCP2515 over SPI) ---
    let can_handle = tokio::spawn(tasks::can::run(
        can_tx_rx,
        can_state_tx,
        can_frame_tx,
        cancel.clone(),
    ));

    // --- Navigation autopilot ---
    let nav_handle = tokio::spawn(tasks::nav::run(
        gps_rx.clone(),
        imu_rx.clone(),
        mission_rx,
        nav_tx,
        motor_tx,
        cancel.clone(),
    ));

    // --- Sim: GPS from sim_world, motor commands drive sim_world ---
    #[cfg(feature = "sim")]
    let sim_gps_handle = {
        let world = world.clone();
        let cancel = cancel.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(50)); // 20Hz step
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = interval.tick() => {}
                }

                // Teleop takes priority over nav autopilot
                let teleop = teleop_rx.borrow().clone();
                let cmd = if teleop.left != 0.0 || teleop.right != 0.0 {
                    teleop
                } else {
                    motor_rx.borrow().clone()
                };
                world.set_thrust(cmd.left, cmd.right);
                world.step();

                // Publish GPS position
                let (lat, lon, speed) = world.gps();
                let _ = gps_tx.send(GpsPosition {
                    lat,
                    lon,
                    speed_mps: speed,
                });
            }
        })
    };

    // --- MQTT ---
    let mqtt_handle = match mqtt::MqttConfig::from_env() {
        Some(mqtt_config) => {
            tracing::info!("MQTT configured -> {}", mqtt_config.host);
            Some(tokio::spawn(mqtt::run(
                mqtt_config,
                imu_rx,
                power_rx,
                thermal_rx,
                gps_rx,
                nav_rx,
                mission_tx,
                teleop_tx,
                cancel.clone(),
            )))
        }
        None => {
            tracing::warn!("MQTT not configured (set MQTT_HOST, MQTT_PORT, MQTT_USER, MQTT_PASS)");
            None
        }
    };

    // Suppress unused warnings for CAN channel handles
    let _ = can_tx;
    let _ = _can_state_rx;
    let _ = _can_frame_rx;

    // --- Wait for shutdown signal ---
    tokio::signal::ctrl_c().await?;
    tracing::info!("Shutdown signal received");
    cancel.cancel();

    // --- Join all tasks with timeout ---
    let _ = tokio::time::timeout(Duration::from_secs(5), async {
        let _ = imu_handle.await;
        let _ = power_handle.await;
        let _ = thermal_handle.await;
        let _ = display_handle.await;
        let _ = can_handle.await;
        let _ = nav_handle.await;
        #[cfg(feature = "sim")]
        let _ = sim_gps_handle.await;
        if let Some(h) = mqtt_handle {
            let _ = h.await;
        }
    })
    .await;

    // Bus owner exits when all I2cBus handles are dropped
    drop(i2c_bus);
    let _ = bus_handle.await;

    tracing::info!("Clean shutdown complete");
    Ok(())
}
