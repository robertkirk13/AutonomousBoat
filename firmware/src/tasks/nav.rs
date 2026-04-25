//! Autopilot: navigates between mission waypoints using GPS + IMU.

use crate::config::{GPS_STALE_TIMEOUT, IMU_STALE_TIMEOUT, NAV_INTERVAL, WAYPOINT_REACHED_M};
use crate::types::*;
use std::time::{Duration, Instant};
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
    if d > 180.0 {
        d -= 360.0;
    }
    if d < -180.0 {
        d += 360.0;
    }
    d
}

fn is_recent(timestamp: Option<Instant>, timeout: Duration, now: Instant) -> bool {
    timestamp
        .map(|timestamp| now.duration_since(timestamp) <= timeout)
        .unwrap_or(false)
}

fn gps_is_valid(gps: &GpsPosition, now: Instant) -> bool {
    gps.lat.is_finite()
        && gps.lon.is_finite()
        && !(gps.lat == 0.0 && gps.lon == 0.0)
        && is_recent(gps.timestamp, GPS_STALE_TIMEOUT, now)
}

fn heading_is_valid(imu: Option<&ImuData>, now: Instant) -> bool {
    imu.map(|imu| imu.heading.is_finite() && is_recent(imu.timestamp, IMU_STALE_TIMEOUT, now))
        .unwrap_or(false)
}

fn cruise_thrust(distance_m: f64, params: &NavParams) -> f64 {
    if distance_m < params.close_approach_m {
        params.approach_thrust
    } else {
        params.cruise_thrust
    }
}

fn compute_target_thrust(error_deg: f64, distance_m: f64, params: &NavParams) -> MotorCommand {
    let abs_error = error_deg.abs();
    let outer = cruise_thrust(distance_m, params);

    if abs_error <= params.straight_error_deg {
        return MotorCommand {
            left: outer,
            right: outer,
        };
    }

    if abs_error >= params.hard_turn_error_deg {
        let turn = MotorCommand {
            left: params.hard_turn_thrust,
            right: 0.0,
        };
        return if error_deg.is_sign_positive() {
            turn
        } else {
            MotorCommand {
                left: turn.right,
                right: turn.left,
            }
        };
    }

    let turn_ratio = (abs_error - params.straight_error_deg)
        / (params.hard_turn_error_deg - params.straight_error_deg);
    let inner = (outer * (1.0 - turn_ratio)).max(params.min_inner_thrust);
    if error_deg.is_sign_positive() {
        MotorCommand {
            left: outer,
            right: inner,
        }
    } else {
        MotorCommand {
            left: inner,
            right: outer,
        }
    }
}

fn slew_limit(previous: f64, target: f64, max_slew: f64) -> f64 {
    previous + (target - previous).clamp(-max_slew, max_slew)
}

fn build_nav_state(
    mode: NavMode,
    target_wp: usize,
    total_wps: usize,
    distance_m: f64,
    bearing_deg: f64,
    cmd: &MotorCommand,
) -> NavState {
    NavState {
        mode,
        target_wp,
        total_wps,
        distance_m,
        bearing_deg,
        left_thrust: cmd.left,
        right_thrust: cmd.right,
    }
}

pub async fn run(
    gps_rx: watch::Receiver<GpsPosition>,
    imu_rx: watch::Receiver<Option<ImuData>>,
    mission_rx: watch::Receiver<Mission>,
    nav_params_rx: watch::Receiver<NavParams>,
    nav_tx: watch::Sender<NavState>,
    motor_tx: watch::Sender<MotorCommand>,
    cancel: CancellationToken,
) {
    tracing::info!("Navigation task started");

    let mut mission_rx = mission_rx;
    let mut mission = mission_rx.borrow().clone();
    let mut current_wp: usize = 0;
    let mut previous_cmd = MotorCommand::default();
    let mut waiting_for_fix = false;

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = tokio::time::sleep(NAV_INTERVAL) => {}
        }

        if matches!(mission_rx.has_changed(), Ok(true)) {
            mission = mission_rx.borrow_and_update().clone();
            current_wp = 0;
            previous_cmd = MotorCommand::default();
            waiting_for_fix = false;
            let stop = MotorCommand::default();
            let _ = motor_tx.send(stop.clone());

            if mission.waypoints.is_empty() {
                let _ = nav_tx.send(NavState::default());
                tracing::info!("Mission cleared");
                continue;
            }

            let _ = nav_tx.send(build_nav_state(
                NavMode::Holding,
                current_wp,
                mission.waypoints.len(),
                0.0,
                0.0,
                &stop,
            ));
            tracing::info!("Mission updated: {} waypoints", mission.waypoints.len());
        }

        if mission.waypoints.is_empty() {
            continue;
        }

        if current_wp >= mission.waypoints.len() {
            let stop = MotorCommand::default();
            let _ = motor_tx.send(stop.clone());
            let _ = nav_tx.send(build_nav_state(
                NavMode::Completed,
                current_wp,
                mission.waypoints.len(),
                0.0,
                0.0,
                &stop,
            ));
            continue;
        }

        let now = Instant::now();
        let gps = gps_rx.borrow().clone();
        let imu = imu_rx.borrow().clone();

        if !gps_is_valid(&gps, now) || !heading_is_valid(imu.as_ref(), now) {
            previous_cmd = MotorCommand::default();
            let stop = MotorCommand::default();
            let _ = motor_tx.send(stop.clone());
            let _ = nav_tx.send(build_nav_state(
                NavMode::Holding,
                current_wp,
                mission.waypoints.len(),
                0.0,
                0.0,
                &stop,
            ));
            if !waiting_for_fix {
                tracing::warn!("Nav hold: waiting for fresh GPS and IMU data");
                waiting_for_fix = true;
            }
            continue;
        }

        if waiting_for_fix {
            tracing::info!("Navigation resumed after fresh sensor data");
            waiting_for_fix = false;
        }

        let heading = imu
            .as_ref()
            .map(|imu| imu.heading.rem_euclid(360.0))
            .unwrap_or(0.0);
        let wp = &mission.waypoints[current_wp];
        let distance = distance_m(gps.lat, gps.lon, wp.lat, wp.lon);
        let target_bearing = bearing_deg(gps.lat, gps.lon, wp.lat, wp.lon);

        if distance < WAYPOINT_REACHED_M {
            tracing::info!("Reached waypoint {} (dist={distance:.1}m)", current_wp + 1);
            current_wp += 1;
            previous_cmd = MotorCommand::default();
            let stop = MotorCommand::default();
            let _ = motor_tx.send(stop.clone());
            let mode = if current_wp >= mission.waypoints.len() {
                NavMode::Completed
            } else {
                NavMode::Holding
            };
            let _ = nav_tx.send(build_nav_state(
                mode,
                current_wp,
                mission.waypoints.len(),
                0.0,
                0.0,
                &stop,
            ));
            continue;
        }

        let params = nav_params_rx.borrow().clone();
        let error = angle_diff(heading, target_bearing);
        let target_cmd = compute_target_thrust(error, distance, &params);
        let cmd = MotorCommand {
            left: slew_limit(previous_cmd.left, target_cmd.left, params.max_slew_per_tick),
            right: slew_limit(previous_cmd.right, target_cmd.right, params.max_slew_per_tick),
        };
        previous_cmd = cmd.clone();

        let _ = motor_tx.send(cmd.clone());
        let _ = nav_tx.send(build_nav_state(
            NavMode::Running,
            current_wp,
            mission.waypoints.len(),
            distance,
            target_bearing,
            &cmd,
        ));
    }

    let stop = MotorCommand::default();
    let _ = motor_tx.send(stop);
    tracing::info!("Navigation task stopped");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn imu_with_timestamp(timestamp: Instant) -> ImuData {
        ImuData {
            heading: 90.0,
            roll: 0.0,
            pitch: 0.0,
            qw: 1.0,
            qx: 0.0,
            qy: 0.0,
            qz: 0.0,
            timestamp: Some(timestamp),
        }
    }

    #[test]
    fn angle_diff_wraps_the_short_way() {
        assert_eq!(angle_diff(350.0, 10.0), 20.0);
        assert_eq!(angle_diff(10.0, 350.0), -20.0);
    }

    #[test]
    fn stale_gps_forces_hold() {
        let now = Instant::now();
        let gps = GpsPosition {
            lat: 47.6,
            lon: -122.3,
            speed_mps: 0.0,
            satellites: 0,
            timestamp: Some(now - GPS_STALE_TIMEOUT - Duration::from_millis(1)),
        };

        assert!(!gps_is_valid(&gps, now));
    }

    #[test]
    fn stale_imu_forces_hold() {
        let now = Instant::now();
        let imu = imu_with_timestamp(now - IMU_STALE_TIMEOUT - Duration::from_millis(1));

        assert!(!heading_is_valid(Some(&imu), now));
    }

    #[test]
    fn small_heading_error_cruises_straight() {
        let params = NavParams::default();
        let cmd = compute_target_thrust(4.0, 20.0, &params);

        assert_eq!(
            cmd,
            MotorCommand {
                left: params.cruise_thrust,
                right: params.cruise_thrust,
            }
        );
    }

    #[test]
    fn moderate_right_turn_keeps_outer_motor_faster() {
        let params = NavParams::default();
        let cmd = compute_target_thrust(30.0, 20.0, &params);

        assert!(cmd.left > cmd.right);
        assert!(cmd.right >= params.min_inner_thrust);
    }

    #[test]
    fn hard_left_turn_stops_inner_motor() {
        let params = NavParams::default();
        let cmd = compute_target_thrust(-80.0, 20.0, &params);

        assert_eq!(
            cmd,
            MotorCommand {
                left: 0.0,
                right: params.hard_turn_thrust,
            }
        );
    }
}
