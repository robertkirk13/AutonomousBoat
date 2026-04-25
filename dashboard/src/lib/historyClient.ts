// Thin client for the boat-recorder Cloudflare Worker. The base URL is
// set at build time via VITE_HISTORY_URL — leave it unset to disable
// the entire replay/trail feature (the dashboard falls back to live
// MQTT only).

const BASE = (import.meta.env.VITE_HISTORY_URL || '').replace(/\/$/, '');
const TOKEN = import.meta.env.VITE_HISTORY_TOKEN;

export const HISTORY_ENABLED = !!BASE;

export interface Session {
  id: number;
  start_ts: number;
  end_ts: number;
  gps_points: number;
}

export interface GpsPoint {
  ts: number;
  lat: number;
  lon: number;
  speed_mps: number;
}

export interface HistoryPoint<T = unknown> {
  ts: number;
  payload: T;
}

function authHeaders(): HeadersInit {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
}

async function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!BASE) throw new Error('history client disabled (VITE_HISTORY_URL not set)');
  const resp = await fetch(`${BASE}${path}`, { headers: authHeaders(), signal });
  if (!resp.ok) throw new Error(`history ${path} -> ${resp.status}`);
  return (await resp.json()) as T;
}

export async function fetchSessions(
  fromTs: number,
  toTs: number,
  signal?: AbortSignal,
): Promise<Session[]> {
  const r = await getJSON<{ sessions: Session[] }>(
    `/sessions?from=${fromTs}&to=${toTs}`,
    signal,
  );
  return r.sessions;
}

export async function fetchGpsHistory(
  fromTs: number,
  toTs: number,
  decimate = 1,
  signal?: AbortSignal,
): Promise<GpsPoint[]> {
  const r = await getJSON<{ points: GpsPoint[] }>(
    `/history/gps?from=${fromTs}&to=${toTs}&decimate=${decimate}`,
    signal,
  );
  return r.points;
}

export async function fetchHistory<T = unknown>(
  topic: string,
  fromTs: number,
  toTs: number,
  signal?: AbortSignal,
): Promise<HistoryPoint<T>[]> {
  const r = await getJSON<{ points: HistoryPoint<T>[] }>(
    `/history?topic=${encodeURIComponent(topic)}&from=${fromTs}&to=${toTs}`,
    signal,
  );
  return r.points;
}
