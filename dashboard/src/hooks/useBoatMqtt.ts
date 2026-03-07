import { useEffect, useRef, useState, useCallback } from 'react';
import mqtt from 'mqtt';
import type { ImuData, GpsData, PowerData, ThermalData, NavData, BoatState } from '../types/index';

const HEARTBEAT_TIMEOUT = 20_000;

const DEFAULT_BOAT_STATE: BoatState = {
  position: { lat: 47.6062, lng: -122.3321 },
  heading: 0,
  roll: 0,
  pitch: 0,
  speed: 0,
  power: null,
  thermal: null,
  nav: null,
  uptime: 0,
  mqttConnected: false,
  boatOnline: false,
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

export function useBoatMqtt() {
  const [boat, setBoat] = useState<BoatState>(DEFAULT_BOAT_STATE);
  const clientRef = useRef<mqtt.MqttClient | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Interpolation channels for each data stream
  const imuChannel = useRef(createChannel<ImuData>());
  const gpsChannel = useRef(createChannel<GpsData>());
  const powerChannel = useRef(createChannel<PowerData>());
  const thermalChannel = useRef(createChannel<ThermalData>());
  const navChannel = useRef(createChannel<NavData>());
  const uptimeChannel = useRef(createChannel<number>());

  // Connection state doesn't need interpolation — store in refs updated immediately
  const connState = useRef({ mqttConnected: false, boatOnline: false });

  const publish = useCallback((topic: string, payload: unknown) => {
    const client = clientRef.current;
    if (client?.connected) {
      client.publish(topic, JSON.stringify(payload));
    }
  }, []);

  // MQTT connection: pushes raw data into channels
  useEffect(() => {
    const host = import.meta.env.VITE_MQTT_HOST;
    const port = import.meta.env.VITE_MQTT_WS_PORT;
    const username = import.meta.env.VITE_MQTT_USER || '';
    const password = import.meta.env.VITE_MQTT_PASS || '';

    if (!host || !port) return;

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

    client.on('connect', () => {
      connState.current.mqttConnected = true;
      client.subscribe('boat/#');
    });

    client.on('close', () => {
      connState.current.mqttConnected = false;
      connState.current.boatOnline = false;
      if (heartbeatTimer.current) clearTimeout(heartbeatTimer.current);
    });

    client.on('message', (topic: string, payload: Buffer) => {
      try {
        const data = JSON.parse(payload.toString());
        resetHeartbeat();

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
          case 'boat/status':
            uptimeChannel.current.push(data.uptime_secs ?? 0);
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
    };
  }, []);

  // Smooth interpolation via requestAnimationFrame
  useEffect(() => {
    let rafId = 0;

    function tick() {
      const imu = imuChannel.current.sample();
      const gps = gpsChannel.current.sample();
      const power = powerChannel.current.sample();
      const thermal = thermalChannel.current.sample();
      const nav = navChannel.current.sample();
      const uptime = uptimeChannel.current.sample();

      // Interpolate IMU
      let heading = 0, roll = 0, pitch = 0;
      if (imu) {
        if ('t' in imu) {
          heading = lerpAngle(imu.prev.heading, imu.curr.heading, imu.t);
          roll = lerp(imu.prev.roll, imu.curr.roll, imu.t);
          pitch = lerp(imu.prev.pitch, imu.curr.pitch, imu.t);
        } else {
          heading = imu.latest.heading;
          roll = imu.latest.roll;
          pitch = imu.latest.pitch;
        }
      }

      // Interpolate GPS
      let position = DEFAULT_BOAT_STATE.position;
      let speed = 0;
      if (gps) {
        if ('t' in gps) {
          position = {
            lat: lerp(gps.prev.lat, gps.curr.lat, gps.t),
            lng: lerp(gps.prev.lon, gps.curr.lon, gps.t),
          };
          speed = lerp(gps.prev.speed_mps, gps.curr.speed_mps, gps.t);
        } else {
          position = { lat: gps.latest.lat, lng: gps.latest.lon };
          speed = gps.latest.speed_mps;
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

      // Uptime: just use latest
      let uptimeVal = 0;
      if (uptime) {
        uptimeVal = 't' in uptime ? uptime.curr : uptime.latest;
      }

      setBoat({
        position,
        heading,
        roll,
        pitch,
        speed,
        power: powerVal,
        thermal: thermalVal,
        nav: navVal,
        uptime: uptimeVal,
        mqttConnected: connState.current.mqttConnected,
        boatOnline: connState.current.boatOnline,
      });

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return { boat, publish };
}
