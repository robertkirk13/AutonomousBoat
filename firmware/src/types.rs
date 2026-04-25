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
    #[serde(skip)]
    pub timestamp: Option<Instant>,
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
    pub satellites: u8,
    #[serde(skip)]
    pub timestamp: Option<Instant>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct GpsOffset {
    pub lat: f64,
    pub lon: f64,
}

/// Quaternion stored as (w, x, y, z). Uses primitive arrays for serde so the
/// on-disk and on-wire representation is unambiguous.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Quat {
    pub w: f64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

/// IMU calibration applied at the source: the firmware multiplies the raw
/// quaternion by `upright_quat_inv` and subtracts `compass_offset_deg` from
/// the raw heading before publishing. Persisted on disk.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ImuCalibration {
    pub upright_quat_inv: Option<Quat>,
    pub compass_offset_deg: f64,
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
    Holding,
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

/// Per-motor calibration applied at the final PWM/CAN output stage. Trim
/// scales raw thrust (0.5..1.0); invert flips sign so a forward command
/// physically drives the motor in reverse. Defaults are no-op.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct MotorConfig {
    pub left_invert: bool,
    pub right_invert: bool,
    pub left_trim: f64,
    pub right_trim: f64,
}

impl Default for MotorConfig {
    fn default() -> Self {
        Self {
            left_invert: false,
            right_invert: false,
            left_trim: 1.0,
            right_trim: 1.0,
        }
    }
}

/// Tunable autopilot parameters. Defaults match the original hardcoded
/// constants from nav.rs; the dashboard publishes retained updates over MQTT
/// to override these without reflashing.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct NavParams {
    pub cruise_thrust: f64,
    pub approach_thrust: f64,
    pub hard_turn_thrust: f64,
    pub straight_error_deg: f64,
    pub hard_turn_error_deg: f64,
    pub min_inner_thrust: f64,
    pub max_slew_per_tick: f64,
    pub close_approach_m: f64,
}

impl Default for NavParams {
    fn default() -> Self {
        Self {
            cruise_thrust: 0.55,
            approach_thrust: 0.32,
            hard_turn_thrust: 0.32,
            straight_error_deg: 10.0,
            hard_turn_error_deg: 60.0,
            min_inner_thrust: 0.10,
            max_slew_per_tick: 0.12,
            close_approach_m: 8.0,
        }
    }
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CameraSettings {
    pub enabled: bool,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

impl Default for CameraSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            width: 640,
            height: 480,
            fps: 15,
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NetworkKind {
    None,
    Wifi,
    Cellular,
    Ethernet,
}

impl Default for NetworkKind {
    fn default() -> Self {
        Self::None
    }
}

/// Snapshot of the active internet uplink. The kind reflects whichever
/// interface owns the default route; `signal_pct` is normalized 0..100 so
/// the dashboard doesn't have to know dBm vs CSQ scales.
#[derive(Clone, Debug, Serialize, Default)]
pub struct NetworkState {
    pub kind: NetworkKind,
    pub interface: Option<String>,
    pub ssid: Option<String>,
    pub signal_dbm: Option<i32>,
    pub signal_pct: Option<u8>,
    pub link_speed_mbps: Option<f64>,
    pub ip_addr: Option<String>,
    pub operator: Option<String>,
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct PayloadSensorState {
    pub connected: bool,
    pub rx_count: u64,
    pub last_frame_id: Option<u16>,
    pub temperature_f: Option<f64>,
    pub ph: Option<f64>,
    pub ec_ms_cm: Option<f64>,
    pub turbidity_ntu: Option<f64>,
    pub sonar_in: Option<f64>,
    #[serde(skip)]
    pub timestamp: Option<Instant>,
}
