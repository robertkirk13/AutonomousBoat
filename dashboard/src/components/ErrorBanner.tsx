import { useNavigation } from '../context/NavigationContext';

/**
 * Top-center alert banner for connection/GPS issues. Renders nothing when
 * everything is healthy. Stack of pill alerts so multiple problems can
 * surface at once (e.g. boat offline AND GPS fix lost while reconnecting).
 */
export default function ErrorBanner() {
  const { boat } = useNavigation();

  const alerts: Alert[] = [];

  // Broker-disconnected alert removed: it false-positived too often during
  // normal mqtt.js reconnects. Surface only the GPS-fix issue, and only once
  // the boat is otherwise alive (pre-fix while booting is normal).
  if (boat.boatOnline && boat.satellites === 0) {
    alerts.push({
      id: 'gps',
      level: 'warn',
      title: 'No GPS fix',
    });
  }

  if (alerts.length === 0) return null;

  return (
    <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-[1100] flex flex-col gap-1.5 items-center pointer-events-none">
      {alerts.map((a) => (
        <AlertPill key={a.id} alert={a} />
      ))}
    </div>
  );
}

interface Alert {
  id: string;
  level: 'error' | 'warn';
  title: string;
  detail?: string;
}

function AlertPill({ alert }: { alert: Alert }) {
  const isError = alert.level === 'error';
  const tone = isError
    ? 'border-red-500/40 bg-red-500/15 text-red-100'
    : 'border-amber-400/40 bg-amber-500/15 text-amber-100';
  const dot = isError ? 'bg-red-400' : 'bg-amber-400';

  return (
    <div
      role="alert"
      className={`pointer-events-auto flex items-center gap-2.5 rounded-2xl border px-4 py-2 backdrop-blur-xl shadow-2xl shadow-black/40 ${tone}`}
    >
      <span className={`w-2 h-2 rounded-full ${dot} animate-pulse`} />
      <div className="flex flex-col leading-tight">
        <span className="text-[12px] font-semibold tracking-tight">{alert.title}</span>
        {alert.detail && <span className="text-[10px] opacity-75">{alert.detail}</span>}
      </div>
    </div>
  );
}
