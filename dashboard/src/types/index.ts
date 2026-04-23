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
  uptime: number;
  mqttConnected: boolean;
  boatOnline: boolean;
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
export type WaypointMode = 'manual' | 'area';

export interface AreaCoverageConfig {
  lineSpacing: number;
  angle: number;
  polygon: { lat: number; lng: number }[];
}
