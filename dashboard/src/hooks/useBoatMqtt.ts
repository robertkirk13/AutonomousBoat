import { useEffect, useRef, useState, useCallback } from 'react';
import mqtt from 'mqtt';
import type {
  ImuData,
  GpsData,
  PowerData,
  ThermalData,
  NavData,
  PayloadData,
  NetworkData,
  BoatState,
  CameraSettings,
  MotorConfig,
  NavParams,
} from '../types/index';
import {
  DEFAULT_CAMERA_SETTINGS,
  DEFAULT_MOTOR_CONFIG,
  DEFAULT_NAV_PARAMS,
} from '../types/index';

const HEARTBEAT_TIMEOUT = 5_000;
const PING_INTERVAL = 3_000;
// Grace period before declaring the broker disconnected. mqtt.js emits 'close'
// on every transient WebSocket hiccup before attempting to reconnect; without
// this delay the error banner flashes up briefly even on healthy connections.
const MQTT_DISCONNECT_GRACE = 3_000;
// Topic the dashboard publishes to (and subscribes to via boat/#) to measure
// broker round-trip latency. The boat firmware ignores this prefix.
const PING_TOPIC = 'boat/dashboard/ping';
// Fresh, non-retained topics that prove the boat is alive. Receiving any of
// these resets the heartbeat timer. Excludes PING_TOPIC (broker echo only),
// retained settings/snapshots, and command topics the dashboard publishes.
const BOAT_TOPICS = new Set([
  'boat/imu',
  'boat/gps',
  'boat/power',
  'boat/thermal',
  'boat/nav',
  'boat/payload',
  'boat/status',
  'boat/can',
]);

const DEFAULT_BOAT_STATE: BoatState = {
  position: { lat: 30.2672, lng: -97.7431 },
  heading: 0,
  roll: 0,
  pitch: 0,
  quaternion: { w: 1, x: 0, y: 0, z: 0 },
  speed: 0,
  satellites: 0,
  power: null,
  thermal: null,
  nav: null,
  payload: null,
  network: null,
  uptime: 0,
  mqttConnected: false,
  boatOnline: false,
  latencyMs: null,
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Lerp heading the short way around 360 degrees. */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return ((a + diff * t) % 360 + 360) % 360;
}

type Quat = { w: number; x: number; y: number; z: number };

/** Convert BNO055 euler angles (degrees) to quaternion. Fallback when firmware doesn't send qw/qx/qy/qz. */
function eulerToQuat(heading: number, roll: number, pitch: number): Quat {
  const h = (heading * Math.PI) / 360; // half-angle
  const r = (roll * Math.PI) / 360;
  const p = (pitch * Math.PI) / 360;
  const sh = Math.sin(h), ch = Math.cos(h);
  const sr = Math.sin(r), cr = Math.cos(r);
  const sp = Math.sin(p), cp = Math.cos(p);
  return {
    w: ch * cr * cp + sh * sr * sp,
    x: ch * cr * sp - sh * sr * cp,
    y: ch * sr * cp + sh * cr * sp,
    z: sh * cr * cp - ch * sr * sp,
  };
}

/** Extract quaternion from ImuData, falling back to euler conversion if qw is missing. */
function imuToQuat(d: ImuData): Quat {
  if (d.qw != null && Number.isFinite(d.qw)) return { w: d.qw, x: d.qx, y: d.qy, z: d.qz };
  return eulerToQuat(d.heading, d.roll, d.pitch);
}

/** Spherical linear interpolation for quaternions. */
function slerpQuat(a: Quat, b: Quat, t: number): Quat {
  // Ensure shortest path
  let dot = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
  let bw = b.w, bx = b.x, by = b.y, bz = b.z;
  if (dot < 0) {
    dot = -dot;
    bw = -bw; bx = -bx; by = -by; bz = -bz;
  }
  if (dot > 0.9995) {
    // Close enough — linear interpolation + normalize
    const w = a.w + (bw - a.w) * t;
    const x = a.x + (bx - a.x) * t;
    const y = a.y + (by - a.y) * t;
    const z = a.z + (bz - a.z) * t;
    const len = Math.sqrt(w * w + x * x + y * y + z * z);
    return { w: w / len, x: x / len, y: y / len, z: z / len };
  }
  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const sa = Math.sin((1 - t) * theta) / sinTheta;
  const sb = Math.sin(t * theta) / sinTheta;
  return {
    w: a.w * sa + bw * sb,
    x: a.x * sa + bx * sb,
    y: a.y * sa + by * sb,
    z: a.z * sa + bz * sb,
  };
}

function lerpPower(a: PowerData, b: PowerData, t: number): PowerData {
  return {
    channels: b.channels.map((ch, i) => {
      const prev = a.channels[i];
      if (!prev || prev.label !== ch.label) return ch;
      return {
        label: ch.label,
        voltage_v: lerp(prev.voltage_v, ch.voltage_v, t),
        current_a: lerp(prev.current_a, ch.current_a, t),
        power_w: lerp(prev.power_w, ch.power_w, t),
        energy_wh: lerp(prev.energy_wh, ch.energy_wh, t),
        charge_ah: lerp(prev.charge_ah, ch.charge_ah, t),
      };
    }),
  };
}

function lerpThermal(a: ThermalData, b: ThermalData, t: number): ThermalData {
  return {
    temps: b.temps.map((tmp, i) => {
      const prev = a.temps[i];
      if (!prev || prev.label !== tmp.label) return tmp;
      return {
        label: tmp.label,
        temp_c: lerp(prev.temp_c, tmp.temp_c, t),
      };
    }),
    fan_duty: lerp(a.fan_duty, b.fan_duty, t),
  };
}

function lerpNullable(a: number | null, b: number | null, t: number): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return lerp(a, b, t);
}

function lerpPayload(a: PayloadData, b: PayloadData, t: number): PayloadData {
  return {
    connected: b.connected,
    rx_count: Math.round(lerp(a.rx_count, b.rx_count, t)),
    last_frame_id: b.last_frame_id,
    temperature_f: lerpNullable(a.temperature_f, b.temperature_f, t),
    ph: lerpNullable(a.ph, b.ph, t),
    ec_ms_cm: lerpNullable(a.ec_ms_cm, b.ec_ms_cm, t),
    turbidity_ntu: lerpNullable(a.turbidity_ntu, b.turbidity_ntu, t),
    sonar_in: lerpNullable(a.sonar_in, b.sonar_in, t),
  };
}

interface Snapshot<T> {
  data: T;
  time: number;
}

/** Tracks the last two snapshots for a given topic so we can interpolate between them. */
function createChannel<T>() {
  let prev: Snapshot<T> | null = null;
  let curr: Snapshot<T> | null = null;

  return {
    push(data: T) {
      prev = curr;
      curr = { data, time: performance.now() };
    },
    /** Returns interpolation progress t in [0,1] and the two snapshots, or just the latest. */
    sample(): { prev: T; curr: T; t: number } | { latest: T } | null {
      if (!curr) return null;
      if (!prev) return { latest: curr.data };
      const elapsed = performance.now() - curr.time;
      const interval = curr.time - prev.time;
      const t = interval > 0 ? Math.min(1, elapsed / interval) : 1;
      return { prev: prev.data, curr: curr.data, t };
    },
  };
}

export function useBoatMqtt(boatKey: string | null) {
  const [boat, setBoat] = useState<BoatState>(DEFAULT_BOAT_STATE);
  const [camera, setCamera] = useState<CameraSettings>(DEFAULT_CAMERA_SETTINGS);
  // Motor + nav configs are owned by the firmware (it persists them to disk).
  // The dashboard mirrors the latest retained values for the UI.
  const [motorConfig, setMotorConfigState] = useState<MotorConfig>(DEFAULT_MOTOR_CONFIG);
  const [navParams, setNavParamsState] = useState<NavParams>(DEFAULT_NAV_PARAMS);
  const clientRef = useRef<mqtt.MqttClient | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mqttDisconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusClockRef = useRef<{ uptimeSecs: number; receivedAt: number } | null>(null);

  // Interpolation channels for each data stream
  const imuChannel = useRef(createChannel<ImuData>());
  const gpsChannel = useRef(createChannel<GpsData>());
  const powerChannel = useRef(createChannel<PowerData>());
  const thermalChannel = useRef(createChannel<ThermalData>());
  const navChannel = useRef(createChannel<NavData>());
  const payloadChannel = useRef(createChannel<PayloadData>());

  // Connection state doesn't need interpolation — store in refs updated immediately
  const connState = useRef({ mqttConnected: false, boatOnline: false });

  // Network telemetry updates much slower than IMU/GPS (every 5s) and has
  // discrete fields (SSID, kind), so don't interpolate it — pass through.
  const networkRef = useRef<NetworkData | null>(null);
  // Round-trip latency (dashboard → broker → dashboard), measured by echoing
  // a self-published ping. Reset to null whenever the broker disconnects.
  const latencyRef = useRef<number | null>(null);
  // Per-ping send timestamps keyed by nonce so out-of-order replies are sane.
  const pingSentRef = useRef<Map<string, number>>(new Map());

  const publish = useCallback((topic: string, payload: unknown) => {
    const client = clientRef.current;
    if (client?.connected) {
      const qos = topic === 'boat/motor/set' || topic === 'boat/mission/set' || topic === 'boat/command' ? 1 : 0;
      client.publish(topic, JSON.stringify(payload), { qos });
    }
  }, []);

  const publishRetained = useCallback((topic: string, payload: unknown) => {
    const client = clientRef.current;
    if (client?.connected) {
      client.publish(topic, JSON.stringify(payload), { qos: 1, retain: true });
    }
  }, []);

  // Calibration is owned by the firmware: it captures the snapshot from its
  // own current IMU reading, applies it before publishing, and writes the
  // values to its on-disk state file.
  const calibrateUpright = useCallback(() => {
    publish('boat/command', { action: 'calibrate_upright' });
  }, [publish]);

  const calibrateCompass = useCallback(() => {
    publish('boat/command', { action: 'calibrate_compass' });
  }, [publish]);

  const setMotorConfig = useCallback(
    (next: MotorConfig) => {
      setMotorConfigState(next);
      publishRetained('boat/motor/config', next);
    },
    [publishRetained],
  );

  const setNavParams = useCallback(
    (next: NavParams) => {
      setNavParamsState(next);
      publishRetained('boat/control/params', next);
    },
    [publishRetained],
  );

  // MQTT connection: pushes raw data into channels
  useEffect(() => {
    const host = import.meta.env.VITE_MQTT_HOST;
    const port = import.meta.env.VITE_MQTT_WS_PORT;
    const username = import.meta.env.VITE_MQTT_USER || '';
    const password = boatKey || import.meta.env.VITE_MQTT_PASS || '';

    if (!host || !port || !password) return;

    const resetHeartbeat = () => {
      if (heartbeatTimer.current) clearTimeout(heartbeatTimer.current);
      connState.current.boatOnline = true;
      heartbeatTimer.current = setTimeout(() => {
        connState.current.boatOnline = false;
      }, HEARTBEAT_TIMEOUT);
    };

    const url = `wss://${host}:${port}/mqtt`;
    const client = mqtt.connect(url, {
      username,
      password,
      protocolVersion: 5,
      reconnectPeriod: 5000,
    });
    clientRef.current = client;

    let pingTimer: ReturnType<typeof setInterval> | null = null;
    const sendPing = () => {
      if (!client.connected) return;
      const nonce = Math.random().toString(36).slice(2, 10);
      pingSentRef.current.set(nonce, performance.now());
      // Drop the oldest pending pings so the map can't grow unbounded if the
      // broker stops echoing (e.g. while disconnected).
      if (pingSentRef.current.size > 8) {
        const oldest = pingSentRef.current.keys().next().value;
        if (oldest) pingSentRef.current.delete(oldest);
      }
      client.publish(PING_TOPIC, JSON.stringify({ nonce }), { qos: 0 });
    };

    client.on('connect', () => {
      // Cancel any pending "declare disconnected" timer from a recent close.
      if (mqttDisconnectTimer.current) {
        clearTimeout(mqttDisconnectTimer.current);
        mqttDisconnectTimer.current = null;
      }
      connState.current.mqttConnected = true;
      client.subscribe('boat/#');
      // Kick off ping loop. The broker echoes our publish back via the
      // boat/# subscription; dt = receive_time - send_time.
      sendPing();
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(sendPing, PING_INTERVAL);
    });

    client.on('close', () => {
      latencyRef.current = null;
      pingSentRef.current.clear();
      if (heartbeatTimer.current) clearTimeout(heartbeatTimer.current);
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      // Don't immediately flip the broker-down flag. mqtt.js fires 'close' on
      // every reconnect attempt; if 'connect' arrives within the grace window
      // the user never sees the error banner.
      if (mqttDisconnectTimer.current) clearTimeout(mqttDisconnectTimer.current);
      mqttDisconnectTimer.current = setTimeout(() => {
        connState.current.mqttConnected = false;
        connState.current.boatOnline = false;
        mqttDisconnectTimer.current = null;
      }, MQTT_DISCONNECT_GRACE);
    });

    client.on('message', (topic: string, payload: Buffer) => {
      try {
        const data = JSON.parse(payload.toString());

        if (topic === PING_TOPIC) {
          const nonce: string | undefined = data?.nonce;
          if (nonce) {
            const sent = pingSentRef.current.get(nonce);
            if (sent != null) {
              latencyRef.current = performance.now() - sent;
              pingSentRef.current.delete(nonce);
            }
          }
          return;
        }

        // Any message on a boat-originated topic proves the firmware is alive.
        // Status alone fires every 10s while the heartbeat timeout is 5s, so
        // relying solely on status would flicker offline between heartbeats.
        if (BOAT_TOPICS.has(topic)) {
          resetHeartbeat();
        }

        switch (topic) {
          case 'boat/imu':
            imuChannel.current.push(data as ImuData);
            break;
          case 'boat/gps':
            gpsChannel.current.push(data as GpsData);
            break;
          case 'boat/power':
            powerChannel.current.push(data as PowerData);
            break;
          case 'boat/thermal':
            thermalChannel.current.push(data as ThermalData);
            break;
          case 'boat/nav':
            navChannel.current.push(data as NavData);
            break;
          case 'boat/payload':
            payloadChannel.current.push(data as PayloadData);
            break;
          case 'boat/network':
            networkRef.current = data as NetworkData;
            break;
          case 'boat/status':
            statusClockRef.current = {
              uptimeSecs: data.uptime_secs ?? 0,
              receivedAt: performance.now(),
            };
            break;
          case 'boat/camera':
            setCamera({
              enabled: !!data.enabled,
              width: Number(data.width) || DEFAULT_CAMERA_SETTINGS.width,
              height: Number(data.height) || DEFAULT_CAMERA_SETTINGS.height,
              fps: Number(data.fps) || DEFAULT_CAMERA_SETTINGS.fps,
            });
            break;
          case 'boat/motor/config':
            setMotorConfigState({
              left_invert: !!data.left_invert,
              right_invert: !!data.right_invert,
              left_trim: Number.isFinite(data.left_trim) ? data.left_trim : DEFAULT_MOTOR_CONFIG.left_trim,
              right_trim: Number.isFinite(data.right_trim) ? data.right_trim : DEFAULT_MOTOR_CONFIG.right_trim,
            });
            break;
          case 'boat/control/params':
            setNavParamsState({ ...DEFAULT_NAV_PARAMS, ...data });
            break;
        }
      } catch {
        // ignore parse errors
      }
    });

    return () => {
      client.end();
      clientRef.current = null;
      if (heartbeatTimer.current) clearTimeout(heartbeatTimer.current);
      if (mqttDisconnectTimer.current) clearTimeout(mqttDisconnectTimer.current);
      if (pingTimer) clearInterval(pingTimer);
    };
  }, [boatKey]);

  // Smooth interpolation via requestAnimationFrame
  useEffect(() => {
    let rafId = 0;

    function tick() {
      const imu = imuChannel.current.sample();
      const gps = gpsChannel.current.sample();
      const power = powerChannel.current.sample();
      const thermal = thermalChannel.current.sample();
      const nav = navChannel.current.sample();
      const payload = payloadChannel.current.sample();

      // Interpolate IMU (euler for display, quaternion for 3D — no gimbal lock)
      let heading = 0, roll = 0, pitch = 0;
      let quaternion = DEFAULT_BOAT_STATE.quaternion;
      if (imu) {
        if ('t' in imu) {
          heading = lerpAngle(imu.prev.heading, imu.curr.heading, imu.t);
          roll = lerp(imu.prev.roll, imu.curr.roll, imu.t);
          pitch = lerp(imu.prev.pitch, imu.curr.pitch, imu.t);
          quaternion = slerpQuat(imuToQuat(imu.prev), imuToQuat(imu.curr), imu.t);
        } else {
          heading = imu.latest.heading;
          roll = imu.latest.roll;
          pitch = imu.latest.pitch;
          quaternion = imuToQuat(imu.latest);
        }
      }

      // Interpolate GPS (sats is an integer count — take latest, no interp)
      let position = DEFAULT_BOAT_STATE.position;
      let speed = 0;
      let satellites = 0;
      if (gps) {
        if ('t' in gps) {
          position = {
            lat: lerp(gps.prev.lat, gps.curr.lat, gps.t),
            lng: lerp(gps.prev.lon, gps.curr.lon, gps.t),
          };
          speed = lerp(gps.prev.speed_mps, gps.curr.speed_mps, gps.t);
          satellites = gps.curr.satellites ?? 0;
        } else {
          position = { lat: gps.latest.lat, lng: gps.latest.lon };
          speed = gps.latest.speed_mps;
          satellites = gps.latest.satellites ?? 0;
        }
      }

      // Interpolate power
      let powerVal: PowerData | null = null;
      if (power) {
        if ('t' in power) {
          powerVal = lerpPower(power.prev, power.curr, power.t);
        } else {
          powerVal = power.latest;
        }
      }

      // Interpolate thermal
      let thermalVal: ThermalData | null = null;
      if (thermal) {
        if ('t' in thermal) {
          thermalVal = lerpThermal(thermal.prev, thermal.curr, thermal.t);
        } else {
          thermalVal = thermal.latest;
        }
      }

      // Nav: interpolate continuous fields, keep discrete fields from latest
      let navVal: NavData | null = null;
      if (nav) {
        if ('t' in nav) {
          navVal = {
            ...nav.curr,
            distance_m: lerp(nav.prev.distance_m, nav.curr.distance_m, nav.t),
            bearing_deg: lerpAngle(nav.prev.bearing_deg, nav.curr.bearing_deg, nav.t),
            left_thrust: lerp(nav.prev.left_thrust, nav.curr.left_thrust, nav.t),
            right_thrust: lerp(nav.prev.right_thrust, nav.curr.right_thrust, nav.t),
          };
        } else {
          navVal = nav.latest;
        }
      }

      let payloadVal: PayloadData | null = null;
      if (payload) {
        if ('t' in payload) {
          payloadVal = lerpPayload(payload.prev, payload.curr, payload.t);
        } else {
          payloadVal = payload.latest;
        }
      }

      // Advance uptime locally between status packets so the UI keeps ticking.
      let uptimeVal = 0;
      if (statusClockRef.current) {
        const elapsedSecs = connState.current.boatOnline
          ? (performance.now() - statusClockRef.current.receivedAt) / 1000
          : 0;
        uptimeVal = statusClockRef.current.uptimeSecs + elapsedSecs;
      }

      setBoat({
        position,
        heading,
        roll,
        pitch,
        quaternion,
        speed,
        satellites,
        power: powerVal,
        thermal: thermalVal,
        nav: navVal,
        payload: payloadVal,
        network: networkRef.current,
        uptime: uptimeVal,
        mqttConnected: connState.current.mqttConnected,
        boatOnline: connState.current.boatOnline,
        latencyMs: latencyRef.current,
      });

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const rebootPi = useCallback(() => {
    publish('boat/command', { action: 'reboot' });
  }, [publish]);

  const powerOffPi = useCallback(() => {
    publish('boat/command', { action: 'shutdown' });
  }, [publish]);

  const setCameraSettings = useCallback(
    (next: CameraSettings) => {
      publish('boat/command', { action: 'camera_set', ...next });
    },
    [publish],
  );

  return {
    boat,
    camera,
    motorConfig,
    navParams,
    publish,
    calibrateUpright,
    calibrateCompass,
    rebootPi,
    powerOffPi,
    setCameraSettings,
    setMotorConfig,
    setNavParams,
  };
}
