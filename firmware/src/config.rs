use std::time::Duration;

// I2C bus
pub const I2C_BUS: &str = "/dev/i2c-1";

// I2C addresses
pub const BNO055_ADDR: u16 = 0x28;
pub const SSD1306_ADDR: u16 = 0x3C;

// INA228 addresses and labels
pub const INA228_CHANNELS: &[(u16, &str)] = &[
    (0x40, "left_motor"),
    (0x41, "right_motor"),
    (0x42, "payload"),
    (0x43, "reel"),
    (0x44, "left_battery"),
    (0x45, "right_battery"),
    (0x46, "solar"),
    (0x47, "dock_charger"),
    (0x48, "core_digital"),
];

// TMP1075 addresses and labels
pub const TMP1075_CHANNELS: &[(u16, &str)] = &[
    (0x4A, "board_temp_1"),
    (0x4B, "board_temp_2"),
];

// INA228 calibration
pub const R_SHUNT: f64 = 0.001; // 1 mΩ
pub const MAX_CURRENT: f64 = 35.0; // 35A
pub const CURRENT_LSB: f64 = MAX_CURRENT / (1 << 19) as f64; // ~76.29 µA/LSB

// Poll intervals
pub const IMU_INTERVAL: Duration = Duration::from_millis(50); // 20Hz
pub const POWER_INTERVAL: Duration = Duration::from_secs(1); // 1Hz
pub const THERMAL_INTERVAL: Duration = Duration::from_secs(2); // 0.5Hz
pub const MQTT_IMU_INTERVAL: Duration = Duration::from_secs(1); // 1Hz (dashboard interpolates)
pub const MQTT_STATUS_INTERVAL: Duration = Duration::from_secs(10);

// Fan control (GPIO18)
pub const FAN_GPIO: u8 = 18;
pub const FAN_TEMP_MIN: f64 = 40.0; // 0% duty below this
pub const FAN_TEMP_MAX: f64 = 70.0; // 100% duty above this

// MQTT topics (publish)
pub const TOPIC_POWER: &str = "boat/power";
pub const TOPIC_IMU: &str = "boat/imu";
pub const TOPIC_THERMAL: &str = "boat/thermal";
pub const TOPIC_STATUS: &str = "boat/status";
pub const TOPIC_GPS: &str = "boat/gps";
pub const TOPIC_NAV: &str = "boat/nav";

// MQTT topics (subscribe)
pub const TOPIC_MISSION_SET: &str = "boat/mission/set";
pub const TOPIC_MOTOR_SET: &str = "boat/motor/set";

// Navigation
pub const NAV_INTERVAL: Duration = Duration::from_millis(200); // 5Hz
pub const GPS_INTERVAL: Duration = Duration::from_secs(1);     // 1Hz publish
pub const WAYPOINT_REACHED_M: f64 = 3.0;                       // meters
pub const MAX_SPEED_MPS: f64 = 2.0;
