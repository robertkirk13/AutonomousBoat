/** State derived from MQTT telemetry, with dead-reckoned position. */
export interface BoatState {
  // Dead-reckoned position (meters from origin)
  x: number;
  y: number;

  // From boat/imu
  heading: number;
  roll: number;
  pitch: number;

  // Inferred from motor currents
  speed: number;
  leftThrust: number;
  rightThrust: number;

  // From boat/power (first two battery channels)
  leftBatteryV: number;
  rightBatteryV: number;
  leftBatteryAh: number;
  rightBatteryAh: number;

  // From boat/thermal
  boardTemp1: number;
  boardTemp2: number;
  fanDuty: number;

  // From boat/status
  uptime: number;
}

export function defaultState(): BoatState {
  return {
    x: 0,
    y: 0,
    heading: 0,
    roll: 0,
    pitch: 0,
    speed: 0,
    leftThrust: 0,
    rightThrust: 0,
    leftBatteryV: 12.6,
    rightBatteryV: 12.6,
    leftBatteryAh: 0,
    rightBatteryAh: 0,
    boardTemp1: 25,
    boardTemp2: 25,
    fanDuty: 0,
    uptime: 0,
  };
}

/** INA228 channel from firmware */
export interface PowerChannel {
  label: string;
  voltage_v: number;
  current_a: number;
  power_w: number;
  energy_wh: number;
  charge_ah: number;
}
