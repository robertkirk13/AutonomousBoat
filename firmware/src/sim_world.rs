//! Shared physics state for SIL simulation.
//! The navigation task writes motor commands; the GPS task reads position;
//! the bus_sim reads heading for IMU responses.

use std::sync::{Arc, Mutex};

/// Meters per degree of latitude.
const M_PER_DEG_LAT: f64 = 111_320.0;

/// Starting position (Seattle waterfront area).
const START_LAT: f64 = 47.6062;
const START_LON: f64 = -122.3321;

#[derive(Debug)]
struct Inner {
    lat: f64,
    lon: f64,
    heading_deg: f64,
    speed_mps: f64,
    left_thrust: f64,
    right_thrust: f64,
    last_step: std::time::Instant,
}

#[derive(Clone)]
pub struct SimWorld(Arc<Mutex<Inner>>);

impl SimWorld {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(Inner {
            lat: START_LAT,
            lon: START_LON,
            heading_deg: 0.0,
            speed_mps: 0.0,
            left_thrust: 0.0,
            right_thrust: 0.0,
            last_step: std::time::Instant::now(),
        })))
    }

    /// Called by nav task to set motor thrust (0.0 to 1.0 each).
    pub fn set_thrust(&self, left: f64, right: f64) {
        let mut w = self.0.lock().unwrap();
        w.left_thrust = left.clamp(0.0, 1.0);
        w.right_thrust = right.clamp(0.0, 1.0);
    }

    /// Step physics forward. Called periodically (e.g. 20Hz from the IMU poll loop).
    pub fn step(&self) {
        let mut w = self.0.lock().unwrap();
        let now = std::time::Instant::now();
        let dt = (now - w.last_step).as_secs_f64();
        w.last_step = now;

        if dt <= 0.0 || dt > 1.0 {
            return; // skip bad intervals
        }

        let max_speed = crate::config::MAX_SPEED_MPS;
        let turn_rate = 30.0; // deg/s at full differential

        // Differential steering
        let thrust_diff = w.right_thrust - w.left_thrust;
        w.heading_deg += thrust_diff * turn_rate * dt;
        w.heading_deg = ((w.heading_deg % 360.0) + 360.0) % 360.0;

        // Speed from average thrust
        let avg_thrust = (w.left_thrust + w.right_thrust) / 2.0;
        let target_speed = avg_thrust * max_speed;
        // Simple exponential approach
        w.speed_mps += (target_speed - w.speed_mps) * (1.0 - (-3.0 * dt).exp());

        // Position update
        let heading_rad = w.heading_deg.to_radians();
        let dy = w.speed_mps * heading_rad.cos() * dt; // north
        let dx = w.speed_mps * heading_rad.sin() * dt; // east

        let m_per_deg_lon = M_PER_DEG_LAT * w.lat.to_radians().cos();
        w.lat += dy / M_PER_DEG_LAT;
        w.lon += dx / m_per_deg_lon;
    }

    /// Read current GPS position.
    pub fn gps(&self) -> (f64, f64, f64) {
        let w = self.0.lock().unwrap();
        (w.lat, w.lon, w.speed_mps)
    }

    /// Read current heading (for IMU simulation).
    pub fn heading(&self) -> f64 {
        self.0.lock().unwrap().heading_deg
    }

    /// Read motor currents for INA228 simulation.
    pub fn thrust(&self) -> (f64, f64) {
        let w = self.0.lock().unwrap();
        (w.left_thrust, w.right_thrust)
    }
}
