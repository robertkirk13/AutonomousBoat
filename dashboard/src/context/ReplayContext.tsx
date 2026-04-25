import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useReplay, type ReplayController } from '../hooks/useReplay';
import { useLiveTrail } from '../hooks/useLiveTrail';
import { fetchSessions, HISTORY_ENABLED, type GpsPoint, type Session } from '../lib/historyClient';

interface ReplayContextValue extends ReplayController {
  liveTrail: GpsPoint[];
  sessions: Session[];
  refreshSessions: () => Promise<void>;
  sessionsLoading: boolean;
  historyEnabled: boolean;
}

const ReplayContext = createContext<ReplayContextValue | null>(null);

const SESSIONS_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function ReplayProvider({ children }: { children: ReactNode }) {
  const replay = useReplay();
  const liveTrail = useLiveTrail(replay.mode === 'live');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const refreshSessions = useCallback(async () => {
    if (!HISTORY_ENABLED) return;
    setSessionsLoading(true);
    try {
      const now = Date.now();
      const list = await fetchSessions(now - SESSIONS_LOOKBACK_MS, now);
      setSessions(list);
    } catch (e) {
      console.warn('fetchSessions failed:', e);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  // Refresh whenever the user opens replay mode so the picker isn't stale.
  useEffect(() => {
    if (replay.mode === 'replay') refreshSessions();
  }, [replay.mode, refreshSessions]);

  const value: ReplayContextValue = {
    ...replay,
    liveTrail,
    sessions,
    sessionsLoading,
    refreshSessions,
    historyEnabled: HISTORY_ENABLED,
  };

  return <ReplayContext.Provider value={value}>{children}</ReplayContext.Provider>;
}

export function useReplayContext(): ReplayContextValue {
  const ctx = useContext(ReplayContext);
  if (!ctx) {
    throw new Error('useReplayContext must be called inside ReplayProvider');
  }
  return ctx;
}
