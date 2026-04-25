import { useReplayContext } from '../context/ReplayContext';
import type { PlaybackSpeed } from '../hooks/useReplay';

const SPEEDS: PlaybackSpeed[] = [1, 4, 16, 64];

function fmtTime(ts: number): string {
  if (!ts) return '--:--:--';
  return new Date(ts).toLocaleTimeString();
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDuration(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h${m.toString().padStart(2, '0')}`;
  return `${m}m${s.toString().padStart(2, '0')}`;
}

export default function ReplayBar() {
  const ctx = useReplayContext();

  // Hide entirely when the recorder Worker isn't configured — there's
  // no history to replay or trail to draw, so the button would be a lie.
  if (!ctx.historyEnabled) return null;

  if (ctx.mode === 'live') {
    return (
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1100] pointer-events-auto">
        <button
          type="button"
          onClick={() => {
            ctx.enterReplay();
            ctx.refreshSessions();
          }}
          className="bg-panel/80 backdrop-blur-xl rounded-full px-4 py-1.5 border border-panel-border/60 text-xs font-medium tracking-wide text-white/55 hover:text-white/85 hover:bg-panel/90 transition-colors"
          title="Replay past sessions"
        >
          <span className="inline-flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" role="img" aria-label="Replay">
              <title>Replay past sessions</title>
              <path d="M3 12a9 9 0 1 0 9-9" strokeLinecap="round" />
              <polyline points="3 4 3 9 8 9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Replay
          </span>
        </button>
      </div>
    );
  }

  // Replay mode — bottom bar with picker + scrubber.
  const { session, sessions, sessionsLoading, cursor, playing, speed, loading } = ctx;
  const sessionDuration = session ? session.end_ts - session.start_ts : 0;
  const elapsed = session ? cursor - session.start_ts : 0;

  return (
    <div className="absolute bottom-2.5 z-[1100] pointer-events-auto" style={{ left: '16.75rem', right: '16.75rem' }}>
      <div className="bg-panel/85 backdrop-blur-xl rounded-2xl border border-panel-border/60 shadow-2xl shadow-black/40 px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={ctx.exitReplay}
            className="px-2.5 py-1 rounded-md text-[10px] font-medium tracking-wide text-white/55 hover:text-white/85 hover:bg-white/5 transition-colors"
            title="Exit replay (back to live)"
          >
            ← Live
          </button>

          <select
            value={session?.id ?? ''}
            onChange={(e) => {
              const s = sessions.find((x) => String(x.id) === e.target.value);
              if (s) ctx.selectSession(s);
            }}
            className="flex-1 max-w-xs bg-black/40 border border-white/10 rounded-md px-2 py-1 text-[11px] font-mono text-white/80 focus:outline-none focus:border-white/30"
          >
            <option value="" disabled>
              {sessionsLoading ? 'Loading sessions…' : sessions.length ? 'Pick a session' : 'No sessions recorded yet'}
            </option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {fmtDate(s.start_ts)} · {fmtDuration(s.end_ts - s.start_ts)} · {s.gps_points} pts
              </option>
            ))}
          </select>

          {session && (
            <>
              <button
                type="button"
                onClick={ctx.togglePlay}
                disabled={loading}
                className="w-7 h-7 flex items-center justify-center rounded-md bg-white/8 hover:bg-white/15 text-white/85 transition-colors disabled:opacity-40"
                title={playing ? 'Pause' : 'Play'}
              >
                {playing ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="Pause"><title>Pause</title><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="Play"><title>Play</title><path d="M7 5l12 7-12 7z" /></svg>
                )}
              </button>

              <div className="flex bg-black/40 border border-white/10 rounded-md overflow-hidden">
                {SPEEDS.map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => ctx.setSpeed(sp)}
                    className={`px-2 py-1 text-[10px] font-mono transition-colors ${
                      sp === speed ? 'bg-white/12 text-white/90' : 'text-white/45 hover:text-white/75'
                    }`}
                  >
                    {sp}×
                  </button>
                ))}
              </div>

              <div className="flex-1 flex items-center gap-2 min-w-0">
                <span className="font-mono text-[10px] text-white/50 tabular-nums shrink-0">
                  {fmtTime(cursor)}
                </span>
                <input
                  type="range"
                  min={session.start_ts}
                  max={session.end_ts}
                  step={Math.max(100, Math.floor(sessionDuration / 1000))}
                  value={cursor}
                  onChange={(e) => ctx.setCursor(Number(e.target.value))}
                  className="flex-1 accent-amber-400"
                  disabled={loading}
                />
                <span className="font-mono text-[10px] text-white/50 tabular-nums shrink-0">
                  {fmtDuration(elapsed)} / {fmtDuration(sessionDuration)}
                </span>
              </div>
            </>
          )}
        </div>

        {loading && (
          <div className="mt-1.5 text-[10px] font-mono text-white/40">Loading session data…</div>
        )}
      </div>
    </div>
  );
}
