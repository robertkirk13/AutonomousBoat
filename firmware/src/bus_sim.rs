//! Simulated I2C bus owner for SIL testing.
//! Returns realistic sensor data without real hardware.

use crate::bus::I2cRequest;
use crate::config::{CURRENT_LSB, R_SHUNT};
use crate::sim_world::SimWorld;
use tokio::sync::mpsc;

/// Simulated sensor state that evolves over time, backed by SimWorld for
/// heading and motor thrust, with time-based fallbacks for other sensors.
struct SimState {
    start: std::time::Instant,
    world: SimWorld,
}

impl SimState {
    fn new(world: SimWorld) -> Self {
        Self {
            start: std::time::Instant::now(),
            world,
        }
    }

    fn elapsed_secs(&self) -> f64 {
        self.start.elapsed().as_secs_f64()
    }

    /// Simulate bus voltage for a given INA228 address.
    fn voltage_v(&self, addr: u16) -> f64 {
        let t = self.elapsed_secs();
        match addr {
            // Batteries: slow discharge from 12.6V
            0x44 | 0x45 => 12.6 - t * 0.001 + (t * 0.1).sin() * 0.05,
            // Solar: ~18V with slight variation
            0x46 => 18.5 + (t * 0.3).sin() * 0.3,
            // Motors: follow battery voltage
            0x40 | 0x41 => 12.4 - t * 0.001,
            // Core digital: steady 3.3V
            0x48 => 3.3 + (t * 0.5).sin() * 0.01,
            // Others
            _ => 12.0,
        }
    }

    /// Simulate current for a given INA228 address.
    /// Motor currents are driven by SimWorld thrust values.
    fn current_a(&self, addr: u16) -> f64 {
        let t = self.elapsed_secs();
        let (left_thrust, right_thrust) = self.world.thrust();
        match addr {
            // Motors: current proportional to thrust (0-7A range)
            0x40 => left_thrust * 7.0,
            0x41 => right_thrust * 7.0,
            // Batteries: sum of loads
            0x44 | 0x45 => 1.0 + (left_thrust + right_thrust) * 3.5,
            // Core digital: steady ~0.45A
            0x48 => 0.45 + (t * 0.7).sin() * 0.02,
            // Solar: charging
            0x46 => 0.3 + (t * 0.1).sin().abs() * 0.2,
            // Payload, reel, dock: low
            0x42 => 0.1,
            0x43 => 0.0,
            0x47 => 0.0,
            _ => 0.0,
        }
    }

    /// Board temperature.
    fn temp_c(&self, addr: u16) -> f64 {
        let t = self.elapsed_secs();
        let base = 28.0 + t * 0.01; // slowly rises
        match addr {
            0x4A => base + (t * 0.05).sin() * 0.5,
            0x4B => base + 1.5 + (t * 0.07).sin() * 0.3,
            _ => base,
        }
    }

    /// BNO055 heading from SimWorld physics.
    fn heading(&self) -> f64 {
        self.world.heading()
    }

    fn roll(&self) -> f64 {
        let t = self.elapsed_secs();
        3.0 * (t * std::f64::consts::TAU / 4.0).sin()
    }

    fn pitch(&self) -> f64 {
        let t = self.elapsed_secs();
        2.0 * (t * std::f64::consts::TAU / 5.2 + 1.0).sin()
    }
}

/// Encode voltage as INA228 VBUS register (3 bytes, >>4, *195.3125e-6).
fn encode_vbus(voltage_v: f64) -> [u8; 3] {
    let raw = ((voltage_v / 195.3125e-6) as u32) << 4;
    [
        ((raw >> 16) & 0xFF) as u8,
        ((raw >> 8) & 0xFF) as u8,
        (raw & 0xFF) as u8,
    ]
}

/// Encode current as INA228 CURRENT register (3 bytes, >>4, signed 20-bit).
fn encode_current(current_a: f64) -> [u8; 3] {
    let raw = (current_a / CURRENT_LSB) as i32;
    let raw20 = (raw & 0xFFFFF) << 4;
    [
        ((raw20 >> 16) & 0xFF) as u8,
        ((raw20 >> 8) & 0xFF) as u8,
        (raw20 & 0xFF) as u8,
    ]
}

/// Encode power as INA228 POWER register (3 bytes, unsigned).
fn encode_power(voltage_v: f64, current_a: f64) -> [u8; 3] {
    let power_w = voltage_v * current_a.abs();
    let raw = (power_w / (3.2 * CURRENT_LSB)) as u32;
    [
        ((raw >> 16) & 0xFF) as u8,
        ((raw >> 8) & 0xFF) as u8,
        (raw & 0xFF) as u8,
    ]
}

/// Encode energy as INA228 ENERGY register (5 bytes, unsigned).
fn encode_energy(_wh: f64) -> [u8; 5] {
    // Simplified: just return small value
    [0, 0, 0, 0, 0]
}

/// Encode charge as INA228 CHARGE register (5 bytes, signed).
fn encode_charge(_ah: f64) -> [u8; 5] {
    [0, 0, 0, 0, 0]
}

/// Encode TMP1075 temperature (2 bytes big-endian, upper 12 bits, 0.0625°C/LSB).
fn encode_tmp1075(temp_c: f64) -> u16 {
    let raw12 = (temp_c / 0.0625) as i16;
    (raw12 << 4) as u16
}

/// Encode BNO055 euler angles (6 bytes LE, 1/16 degree per LSB).
fn encode_euler(heading: f64, roll: f64, pitch: f64) -> [u8; 6] {
    let h = (heading * 16.0) as i16;
    let r = (roll * 16.0) as i16;
    let p = (pitch * 16.0) as i16;
    [
        (h & 0xFF) as u8,
        ((h >> 8) & 0xFF) as u8,
        (r & 0xFF) as u8,
        ((r >> 8) & 0xFF) as u8,
        (p & 0xFF) as u8,
        ((p >> 8) & 0xFF) as u8,
    ]
}

/// Runs the simulated I2C bus owner. Replaces `bus::run_bus_owner` in sim mode.
pub fn run_bus_owner_sim(rx: &mut mpsc::Receiver<I2cRequest>, world: &SimWorld) {
    let state = SimState::new(world.clone());
    let shunt_cal = (13107.2e6 * CURRENT_LSB * R_SHUNT) as u16;

    tracing::info!("Simulated I2C bus owner started");

    while let Some(request) = rx.blocking_recv() {
        match request {
            I2cRequest::WriteByteData { reply, .. } => {
                // Accept all writes (config, mode changes)
                let _ = reply.send(Ok(()));
            }
            I2cRequest::WriteWordData { reply, .. } => {
                let _ = reply.send(Ok(()));
            }
            I2cRequest::ReadWordData { addr, reg, reply } => {
                let value = match (addr, reg) {
                    // INA228 manufacturer ID
                    (0x40..=0x48, 0x3E) => 0x5449,
                    // INA228 device ID
                    (0x40..=0x48, 0x3F) => 0x2280,
                    // INA228 config register
                    (0x40..=0x48, 0x00) => 0x0000,
                    // INA228 shunt cal
                    (0x40..=0x48, 0x02) => shunt_cal,
                    // TMP1075 temperature
                    (0x4A | 0x4B, 0x00) => encode_tmp1075(state.temp_c(addr)),
                    _ => 0x0000,
                };
                let _ = reply.send(Ok(value));
            }
            I2cRequest::ReadBlock {
                addr,
                reg,
                len,
                reply,
            } => {
                let data = match (addr, reg) {
                    // INA228 VBUS (3 bytes)
                    (0x40..=0x48, 0x05) => {
                        encode_vbus(state.voltage_v(addr)).to_vec()
                    }
                    // INA228 CURRENT (3 bytes)
                    (0x40..=0x48, 0x07) => {
                        encode_current(state.current_a(addr)).to_vec()
                    }
                    // INA228 POWER (3 bytes)
                    (0x40..=0x48, 0x08) => {
                        let v = state.voltage_v(addr);
                        let i = state.current_a(addr);
                        encode_power(v, i).to_vec()
                    }
                    // INA228 ENERGY (5 bytes)
                    (0x40..=0x48, 0x09) => encode_energy(0.0).to_vec(),
                    // INA228 CHARGE (5 bytes)
                    (0x40..=0x48, 0x0A) => encode_charge(0.0).to_vec(),
                    // BNO055 euler angles (6 bytes from 0x1A)
                    (0x28, 0x1A) => {
                        encode_euler(state.heading(), state.roll(), state.pitch()).to_vec()
                    }
                    // Default: zeros
                    _ => vec![0u8; len],
                };
                let _ = reply.send(Ok(data));
            }
        }
    }

    tracing::info!("Simulated I2C bus owner shutting down");
}
