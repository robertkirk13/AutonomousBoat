import { useEffect, useState } from 'react';
import { fetchGpsHistory, HISTORY_ENABLED, type GpsPoint } from '../lib/historyClient';

// How far back the rolling live trail extends.
const TRAIL_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
// Refresh cadence — the boat publishes GPS at 1 Hz so a 30-second
// poll keeps the line within ~30 points of "now" without hammering D1.
const POLL_INTERVAL_MS = 30_000;

/**
 * Polls the recorder Worker for the boat's recent GPS track. Returns an
 * empty array when the worker isn't configured or the request errors —
 * the map still renders without it.
 */
export function useLiveTrail(enabled: boolean): GpsPoint[] {
  const [trail, setTrail] = useState<GpsPoint[]>([]);

  useEffect(() => {
    if (!enabled || !HISTORY_ENABLED) {
      setTrail([]);
      return;
    }

    let cancelled = false;
    const ctrl = new AbortController();

    const refresh = async () => {
      try {
        const now = Date.now();
        const points = await fetchGpsHistory(now - TRAIL_WINDOW_MS, now, 1, ctrl.signal);
        if (!cancelled) setTrail(points);
      } catch (e) {
        if (!cancelled && (e as Error).name !== 'AbortError') {
          // Quiet failure — the trail is a nice-to-have on top of live MQTT.
          console.warn('live trail fetch failed:', e);
        }
      }
    };

    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      ctrl.abort();
      clearInterval(id);
    };
  }, [enabled]);

  return trail;
}
