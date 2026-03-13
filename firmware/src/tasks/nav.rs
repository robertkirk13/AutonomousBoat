//! Autopilot: navigates between mission waypoints using GPS + IMU.

use crate::config::{NAV_INTERVAL, WAYPOINT_REACHED_M};
use crate::types::*;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

/// Meters per degree of latitude.
const M_PER_DEG_LAT: f64 = 111_320.0;

/// Haversine-like flat-earth distance (good enough at small scales).
fn distance_m(a_lat: f64, a_lon: f64, b_lat: f64, b_lon: f64) -> f64 {
    let dy = (b_lat - a_lat) * M_PER_DEG_LAT;
    let dx = (b_lon - a_lon) * M_PER_DEG_LAT * a_lat.to_radians().cos();
    (dx * dx + dy * dy).sqrt()
}

/// Bearing from a to b in degrees (0=north, clockwise).
fn bearing_deg(a_lat: f64, a_lon: f64, b_lat: f64, b_lon: f64) -> f64 {
    let dy = (b_lat - a_lat) * M_PER_DEG_LAT;
    let dx = (b_lon - a_lon) * M_PER_DEG_LAT * a_lat.to_radians().cos();
    let rad = dx.atan2(dy);
    ((rad.to_degrees() % 360.0) + 360.0) % 360.0
}

/// Shortest signed angle difference (degrees), result in [-180, 180].
fn angle_diff(from: f64, to: f64) -> f64 {
    let mut d = to - from;
    if d > 180.0 { d -= 360.0; }
    if d < -180.0 { d += 360.0; }
    d
}

pub async fn run(
    gps_rx: watch::Receiver<GpsPosition>,
    imu_rx: watch::Receiver<Option<EulerAngles>>,
    mission_rx: watch::Receiver<Mission>,
    nav_tx: watch::Sender<NavState>,
    motor_tx: watch::Sender<MotorCommand>,
    cancel: CancellationToken,
) {
    tracing::info!("Navigation task started");

    let mut current_wp: usize = 0;
    let mut active = false;
    let mut prev_error: f64 = 0.0;
    let mut prev_left: f64 = 0.0;
    let mut prev_right: f64 = 0.0;
    let max_slew = 0.1; // max thrust change per tick (0.1 = 10% per 200ms)

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = tokio::time::sleep(NAV_INTERVAL) => {}
        }

        let mission = mission_rx.borrow().clone();
        let gps = gps_rx.borrow().clone();

        // Wait for valid sensor data before running control loop
        let heading = match imu_rx.borrow().as_ref().map(|a| a.heading) {
            Some(h) => h,
            None => {
                tracing::debug!("Nav: waiting for IMU fix");
                continue;
            }
        };
        if gps.lat == 0.0 && gps.lon == 0.0 {
            tracing::debug!("Nav: waiting for GPS fix");
            continue;
        }

        // Check if mission changed
        if mission.waypoints.is_empty() {
            if active {
                active = false;
                current_wp = 0;
                let _ = motor_tx.send(MotorCommand::default());
                let _ = nav_tx.send(NavState::default());
                tracing::info!("Mission cleared");
            }
            continue;
        }

        // New mission arrived?
        if !active {
            active = true;
            current_wp = 0;
            tracing::info!("Mission started: {} waypoints", mission.waypoints.len());
        }

        // Already completed all waypoints?
        if current_wp >= mission.waypoints.len() {
            let _ = motor_tx.send(MotorCommand::default());
            let _ = nav_tx.send(NavState {
                mode: NavMode::Completed,
                target_wp: current_wp,
                total_wps: mission.waypoints.len(),
                distance_m: 0.0,
                bearing_deg: 0.0,
                left_thrust: 0.0,
                right_thrust: 0.0,
            });
            continue;
        }

        let wp = &mission.waypoints[current_wp];
        let dist = distance_m(gps.lat, gps.lon, wp.lat, wp.lon);
        let target_bearing = bearing_deg(gps.lat, gps.lon, wp.lat, wp.lon);

        // Waypoint reached?
        if dist < WAYPOINT_REACHED_M {
            tracing::info!("Reached waypoint {} (dist={dist:.1}m)", current_wp + 1);
            current_wp += 1;
            continue;
        }

        // PD steering controller
        let error = angle_diff(heading, target_bearing);
        let d_error = error - prev_error;
        prev_error = error;

        let kp = 0.3 / 90.0; // proportional gain
        let kd = 0.15 / 90.0; // derivative gain (dampen oscillation)
        let turn = (kp * error + kd * d_error).clamp(-1.0, 1.0);

        // Base thrust — slow down near waypoint, reduce when turning hard
        let base = if dist < 10.0 { 0.4 } else { 0.7 };
        let steer_penalty = 1.0 - 0.3 * turn.abs();

        let target_left = (base * steer_penalty + turn * 0.3).clamp(0.0, 1.0);
        let target_right = (base * steer_penalty - turn * 0.3).clamp(0.0, 1.0);

        // Slew rate limit — prevent abrupt thrust changes
        let left = prev_left + (target_left - prev_left).clamp(-max_slew, max_slew);
        let right = prev_right + (target_right - prev_right).clamp(-max_slew, max_slew);
        prev_left = left;
        prev_right = right;

        let _ = motor_tx.send(MotorCommand { left, right });
        let _ = nav_tx.send(NavState {
            mode: NavMode::Running,
            target_wp: current_wp,
            total_wps: mission.waypoints.len(),
            distance_m: dist,
            bearing_deg: target_bearing,
            left_thrust: left,
            right_thrust: right,
        });
    }

    let _ = motor_tx.send(MotorCommand::default());
    tracing::info!("Navigation task stopped");
}
