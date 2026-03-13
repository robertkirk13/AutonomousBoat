use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Clone, Debug, Serialize)]
pub struct EulerAngles {
    pub heading: f64,
    pub roll: f64,
    pub pitch: f64,
}

/// Full IMU reading with both Euler angles (for nav) and quaternion (for 3D viz).
#[derive(Clone, Debug, Serialize)]
pub struct ImuData {
    pub heading: f64,
    pub roll: f64,
    pub pitch: f64,
    pub qw: f64,
    pub qx: f64,
    pub qy: f64,
    pub qz: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct Ina228Reading {
    pub label: String,
    pub voltage_v: f64,
    pub current_a: f64,
    pub power_w: f64,
    pub energy_wh: f64,
    pub charge_ah: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct PowerState {
    pub channels: Vec<Ina228Reading>,
    #[serde(skip)]
    pub timestamp: Option<Instant>,
}

impl Default for PowerState {
    fn default() -> Self {
        Self {
            channels: Vec::new(),
            timestamp: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ThermalState {
    pub temps: Vec<TempReading>,
    pub fan_duty: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct TempReading {
    pub label: String,
    pub temp_c: f64,
}

impl Default for ThermalState {
    fn default() -> Self {
        Self {
            temps: Vec::new(),
            fan_duty: 0.0,
        }
    }
}

// --- GPS / Navigation ---

#[derive(Clone, Debug, Serialize, Default)]
pub struct GpsPosition {
    pub lat: f64,
    pub lon: f64,
    pub speed_mps: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Waypoint {
    pub lat: f64,
    pub lon: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct Mission {
    pub waypoints: Vec<Waypoint>,
}

#[derive(Clone, Debug, Serialize)]
pub struct NavState {
    pub mode: NavMode,
    pub target_wp: usize,
    pub total_wps: usize,
    pub distance_m: f64,
    pub bearing_deg: f64,
    pub left_thrust: f64,
    pub right_thrust: f64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NavMode {
    Idle,
    Running,
    Completed,
}

impl Default for NavState {
    fn default() -> Self {
        Self {
            mode: NavMode::Idle,
            target_wp: 0,
            total_wps: 0,
            distance_m: 0.0,
            bearing_deg: 0.0,
            left_thrust: 0.0,
            right_thrust: 0.0,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct MotorCommand {
    pub left: f64,
    pub right: f64,
}

// --- CAN bus ---

#[derive(Clone, Debug, Serialize)]
pub struct CanFrame {
    pub id: u16,
    pub rtr: bool,
    pub dlc: u8,
    pub data: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct CanState {
    pub connected: bool,
    pub rx_count: u64,
    pub tx_count: u64,
    pub last_error: Option<String>,
}
