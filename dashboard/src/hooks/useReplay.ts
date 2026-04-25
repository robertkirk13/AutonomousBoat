import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchGpsHistory,
  fetchHistory,
  type GpsPoint,
  type Session,
} from '../lib/historyClient';
import type {
  BoatState,
  GpsData,
  ImuData,
  NavData,
  PayloadData,
  PowerData,
  ThermalData,
} from '../types/index';

export type ReplayMode = 'live' | 'replay';
export type PlaybackSpeed = 1 | 4 | 16 | 64;

// Topics we replay on the panels. boat/network and boat/camera are
// excluded — network is uplink-state-only and camera is a settings echo.
const REPLAY_TOPICS = [
  'boat/imu',
  'boat/gps',
  'boat/power',
  'boat/thermal',
  'boat/nav',
  'boat/payload',
  'boat/status',
] as const;

interface Series<T> {
  ts: number;
  payload: T;
}

/** Last entry with ts <= t. Series is assumed sorted ascending by ts. */
function sampleAt<T>(series: Series<T>[], t: number): T | null {
  if (!series.length) return null;
  let lo = 0;
  let hi = series.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (series[mid]!.ts <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans < 0 ? null : series[ans]!.payload;
}

const FALLBACK_POSITION = { lat: 47.6062, lng: -122.3321 };

function buildBoatStateAt(series: Map<string, Series<unknown>[]>, t: number): BoatState {
  const imu = sampleAt(series.get('boat/imu') as Series<ImuData>[] ?? [], t);
  const gps = sampleAt(series.get('boat/gps') as Series<GpsData>[] ?? [], t);
  const power = sampleAt(series.get('boat/power') as Series<PowerData>[] ?? [], t);
  const thermal = sampleAt(series.get('boat/thermal') as Series<ThermalData>[] ?? [], t);
  const nav = sampleAt(series.get('boat/nav') as Series<NavData>[] ?? [], t);
  const payload = sampleAt(series.get('boat/payload') as Series<PayloadData>[] ?? [], t);
  const status = sampleAt(
    (series.get('boat/status') as Series<{ uptime_secs?: number }>[]) ?? [],
    t,
  );

  const quaternion =
    imu && Number.isFinite(imu.qw)
      ? { w: imu.qw, x: imu.qx, y: imu.qy, z: imu.qz }
      : { w: 1, x: 0, y: 0, z: 0 };

  return {
    position: gps ? { lat: gps.lat, lng: gps.lon } : FALLBACK_POSITION,
    heading: imu?.heading ?? 0,
    roll: imu?.roll ?? 0,
    pitch: imu?.pitch ?? 0,
    quaternion,
    speed: gps?.speed_mps ?? 0,
    satellites: gps?.satellites ?? 0,
    power,
    thermal,
    nav,
    payload,
    // Network telemetry isn't archived (uplink-state-only); replays
    // run as if on a stable connection.
    network: null,
    uptime: status?.uptime_secs ?? 0,
    // Forge "online" so the dashboard's offline banners don't fire
    // during replay — the boat was online when this was recorded.
    mqttConnected: true,
    boatOnline: true,
    latencyMs: null,
  };
}

export interface ReplayController {
  mode: ReplayMode;
  enterReplay: () => void;
  exitReplay: () => void;

  session: Session | null;
  selectSession: (s: Session) => Promise<void>;
  loading: boolean;

  cursor: number;
  setCursor: (ts: number) => void;

  playing: boolean;
  togglePlay: () => void;
  setPlaying: (p: boolean) => void;

  speed: PlaybackSpeed;
  setSpeed: (s: PlaybackSpeed) => void;

  /** Full GPS track for the loaded session (replay mode only). */
  trail: GpsPoint[];
  /** Synthesized boat state at the current cursor. Null when no session loaded. */
  replayBoat: BoatState | null;
}

export function useReplay(): ReplayController {
  const [mode, setMode] = useState<ReplayMode>('live');
  const [session, setSession] = useState<Session | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [series, setSeries] = useState<Map<string, Series<unknown>[]>>(new Map());
  const [trail, setTrail] = useState<GpsPoint[]>([]);
  const [loading, setLoading] = useState(false);

  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  const selectSession = useCallback(async (s: Session) => {
    setSession(s);
    setCursor(s.start_ts);
    setPlaying(true);
    setLoading(true);
    try {
      const [trailPoints, ...topicArrs] = await Promise.all([
        fetchGpsHistory(s.start_ts, s.end_ts, 1),
        ...REPLAY_TOPICS.map((t) => fetchHistory(t, s.start_ts, s.end_ts)),
      ]);
      const m = new Map<string, Series<unknown>[]>();
      REPLAY_TOPICS.forEach((topic, i) => {
        m.set(topic, topicArrs[i] ?? []);
      });
      setSeries(m);
      setTrail(trailPoints);
    } catch (e) {
      console.warn('selectSession failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Cursor advance loop. Wall-clock `dt` × speed = cursor advance.
  useEffect(() => {
    if (mode !== 'replay' || !session || !playing) return;
    let lastT = performance.now();
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const dt = now - lastT;
      lastT = now;
      const next = cursorRef.current + dt * speed;
      if (next >= session.end_ts) {
        setCursor(session.end_ts);
        setPlaying(false);
        return;
      }
      setCursor(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, session, playing, speed]);

  const replayBoat = useMemo<BoatState | null>(() => {
    if (mode !== 'replay' || !session) return null;
    return buildBoatStateAt(series, cursor);
  }, [mode, session, series, cursor]);

  const enterReplay = useCallback(() => setMode('replay'), []);
  const exitReplay = useCallback(() => {
    setMode('live');
    setSession(null);
    setSeries(new Map());
    setTrail([]);
  }, []);

  const togglePlay = useCallback(() => setPlaying((p) => !p), []);

  return {
    mode,
    enterReplay,
    exitReplay,
    session,
    selectSession,
    loading,
    cursor,
    setCursor,
    playing,
    togglePlay,
    setPlaying,
    speed,
    setSpeed,
    trail,
    replayBoat,
  };
}
