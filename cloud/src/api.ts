import type { Env } from "./index";

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

export interface HistoryPoint {
  ts: number;
  payload: unknown;
}

/**
 * Auto-detect "sessions" as runs of GPS fixes separated by gaps larger
 * than `gapMs`. The dashboard surfaces these in the replay picker —
 * users think in trips, not raw timestamp ranges.
 */
export async function listSessions(
  env: Env,
  fromTs: number,
  toTs: number,
  gapMs: number,
): Promise<Session[]> {
  const result = await env.DB.prepare(
    `WITH gaps AS (
       SELECT ts, lag(ts) OVER (ORDER BY ts) AS prev_ts
       FROM gps_track
       WHERE boat_id = ?1 AND ts BETWEEN ?2 AND ?3
     ),
     breaks AS (
       SELECT ts,
              CASE WHEN ts - prev_ts > ?4 OR prev_ts IS NULL THEN 1 ELSE 0 END AS is_start
       FROM gaps
     ),
     session_ids AS (
       SELECT ts, sum(is_start) OVER (ORDER BY ts) AS session_id FROM breaks
     )
     SELECT session_id AS id,
            min(ts)    AS start_ts,
            max(ts)    AS end_ts,
            count(*)   AS gps_points
     FROM session_ids
     GROUP BY session_id
     ORDER BY start_ts DESC
     LIMIT 200`,
  )
    .bind(env.BOAT_ID, fromTs, toTs, gapMs)
    .all<Session>();
  return result.results;
}

export async function getGpsHistory(
  env: Env,
  fromTs: number,
  toTs: number,
  decimate: number,
): Promise<GpsPoint[]> {
  const result = await env.DB.prepare(
    "SELECT ts, lat, lon, speed_mps FROM gps_track WHERE boat_id = ?1 AND ts BETWEEN ?2 AND ?3 ORDER BY ts",
  )
    .bind(env.BOAT_ID, fromTs, toTs)
    .all<GpsPoint>();
  const all = result.results;
  if (decimate <= 1 || all.length <= 1) return all;
  const out: GpsPoint[] = [];
  for (let i = 0; i < all.length; i += decimate) out.push(all[i]!);
  // Always include the last point so the rendered polyline ends at the
  // most recent fix instead of dropping the boat's current position.
  if ((all.length - 1) % decimate !== 0) out.push(all[all.length - 1]!);
  return out;
}

export async function getHistory(
  env: Env,
  topic: string,
  fromTs: number,
  toTs: number,
  limit: number,
): Promise<HistoryPoint[]> {
  const result = await env.DB.prepare(
    "SELECT ts, payload FROM telemetry WHERE boat_id = ?1 AND topic = ?2 AND ts BETWEEN ?3 AND ?4 ORDER BY ts LIMIT ?5",
  )
    .bind(env.BOAT_ID, topic, fromTs, toTs, limit)
    .all<{ ts: number; payload: string }>();
  return result.results.map((r) => {
    let parsed: unknown;
    try { parsed = JSON.parse(r.payload); } catch { parsed = null; }
    return { ts: r.ts, payload: parsed };
  });
}
