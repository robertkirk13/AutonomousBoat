export interface Waypoint {
  id: string;
  lat: number;
  lng: number;
  name: string;
  takeMeasurement: boolean;
  measurementTypes: MeasurementType[];
  completed?: boolean;
}

export type MeasurementType =
  | 'temperature'
  | 'depth'
  | 'ph'
  | 'dissolved_oxygen'
  | 'turbidity'
  | 'conductivity';

export interface MeasurementConfig {
  type: MeasurementType;
  label: string;
  unit: string;
  icon: string;
}

export const MEASUREMENT_CONFIGS: MeasurementConfig[] = [
  { type: 'temperature', label: 'Temperature', unit: '\u00B0C', icon: '\uD83C\uDF21\uFE0F' },
  { type: 'depth', label: 'Depth', unit: 'm', icon: '\uD83D\uDCCF' },
  { type: 'ph', label: 'pH Level', unit: 'pH', icon: '\uD83E\uDDEA' },
  { type: 'dissolved_oxygen', label: 'Dissolved Oxygen', unit: 'mg/L', icon: '\uD83D\uDCA8' },
  { type: 'turbidity', label: 'Turbidity', unit: 'NTU', icon: '\uD83C\uDF0A' },
  { type: 'conductivity', label: 'Conductivity', unit: '\u03BCS/cm', icon: '\u26A1' },
];

// --- MQTT telemetry types (match firmware JSON) ---

export interface ImuData {
  heading: number;
  roll: number;
  pitch: number;
  qw: number;
  qx: number;
  qy: number;
  qz: number;
}

export interface GpsData {
  lat: number;
  lon: number;
  speed_mps: number;
  satellites: number;
}

export interface Ina228Reading {
  label: string;
  voltage_v: number;
  current_a: number;
  power_w: number;
  energy_wh: number;
  charge_ah: number;
}

export interface PowerData {
  channels: Ina228Reading[];
}

export interface TempReading {
  label: string;
  temp_c: number;
}

export interface ThermalData {
  temps: TempReading[];
  fan_duty: number;
}

export interface NavData {
  mode: 'idle' | 'holding' | 'running' | 'completed';
  target_wp: number;
  total_wps: number;
  distance_m: number;
  bearing_deg: number;
  left_thrust: number;
  right_thrust: number;
}

export interface PayloadData {
  connected: boolean;
  rx_count: number;
  last_frame_id: number | null;
  temperature_f: number | null;
  ph: number | null;
  ec_ms_cm: number | null;
  turbidity_ntu: number | null;
  sonar_in: number | null;
}

export interface StatusData {
  uptime_secs: number;
}

export type NetworkKind = 'none' | 'wifi' | 'cellular' | 'ethernet';

export interface NetworkData {
  kind: NetworkKind;
  interface: string | null;
  ssid: string | null;
  signal_dbm: number | null;
  signal_pct: number | null;
  link_speed_mbps: number | null;
  ip_addr: string | null;
  operator: string | null;
}

export interface CameraSettings {
  enabled: boolean;
  width: number;
  height: number;
  fps: number;
}

export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  enabled: true,
  width: 640,
  height: 480,
  fps: 15,
};

export const CAMERA_RESOLUTIONS: { label: string; width: number; height: number }[] = [
  { label: '320\u00D7240', width: 320, height: 240 },
  { label: '640\u00D7480', width: 640, height: 480 },
  { label: '1280\u00D7720', width: 1280, height: 720 },
  { label: '1920\u00D71080', width: 1920, height: 1080 },
];

export const CAMERA_FPS_OPTIONS: number[] = [5, 10, 15, 30];

// Per-motor calibration sent to firmware via retained MQTT.
// `*_trim` is a multiplicative scale (0.5..1.0) applied to thrust before PWM;
// `*_invert` flips the sign so a forward command physically drives reverse.
export interface MotorConfig {
  left_invert: boolean;
  right_invert: boolean;
  left_trim: number;
  right_trim: number;
}

export const DEFAULT_MOTOR_CONFIG: MotorConfig = {
  left_invert: false,
  right_invert: false,
  left_trim: 1.0,
  right_trim: 1.0,
};

// Tunable autopilot parameters; defaults match the firmware fallbacks in
// types.rs / nav.rs so the boat behaves identically before any tuning.
export interface NavParams {
  cruise_thrust: number;
  approach_thrust: number;
  hard_turn_thrust: number;
  straight_error_deg: number;
  hard_turn_error_deg: number;
  min_inner_thrust: number;
  max_slew_per_tick: number;
  close_approach_m: number;
}

export const DEFAULT_NAV_PARAMS: NavParams = {
  cruise_thrust: 0.55,
  approach_thrust: 0.32,
  hard_turn_thrust: 0.32,
  straight_error_deg: 10.0,
  hard_turn_error_deg: 60.0,
  min_inner_thrust: 0.10,
  max_slew_per_tick: 0.12,
  close_approach_m: 8.0,
};

// --- Composite boat state built from MQTT ---

export interface BoatState {
  position: { lat: number; lng: number };
  heading: number;
  roll: number;
  pitch: number;
  quaternion: { w: number; x: number; y: number; z: number };
  speed: number;
  satellites: number;
  power: PowerData | null;
  thermal: ThermalData | null;
  nav: NavData | null;
  payload: PayloadData | null;
  network: NetworkData | null;
  uptime: number;
  mqttConnected: boolean;
  boatOnline: boolean;
  latencyMs: number | null;
}

export interface DataCollectionConfig {
  enabled: boolean;
  intervalMeters: number;
  measurementTypes: MeasurementType[];
}

export interface MissionState {
  status: 'idle' | 'planning' | 'running' | 'paused' | 'completed';
  waypoints: Waypoint[];
  currentWaypointIndex: number;
  measurements: MeasurementData[];
  dataCollection: DataCollectionConfig;
}

export interface MeasurementData {
  waypointId: string;
  timestamp: Date;
  values: Partial<Record<MeasurementType, number>>;
}

export type ControlMode = 'autonomous' | 'teleop';

// Active map-click tool. 'none' means clicks do nothing on the map — the user
// must explicitly pick a drawing tool. 'waypoint' adds waypoints, 'area'
// builds a polygon for coverage-path generation, 'zone-allow' / 'zone-exclude'
// build a polygon for an allow/exclusion zone.
export type ClickMode = 'none' | 'waypoint' | 'area' | 'zone-allow' | 'zone-exclude';

export interface AreaCoverageConfig {
  lineSpacing: number;
  angle: number;
  polygon: { lat: number; lng: number }[];
}

export type ZoneKind = 'allow' | 'exclude';

export interface Zone {
  id: string;
  kind: ZoneKind;
  name: string;
  vertices: { lat: number; lng: number }[];
}

export interface SavedMissionWaypoint {
  lat: number;
  lng: number;
  name: string;
  takeMeasurement: boolean;
  measurementTypes: MeasurementType[];
}

export interface SavedMission {
  id: string;
  name: string;
  waypoints: SavedMissionWaypoint[];
  dataCollection: DataCollectionConfig;
  createdAt: number;
  updatedAt: number;
}

export type ScheduleRepeat = 'none' | 'hourly' | 'daily';

export interface MissionSchedule {
  id: string;
  missionId: string;
  startAt: number;
  repeat: ScheduleRepeat;
  enabled: boolean;
  lastFiredAt: number | null;
}
