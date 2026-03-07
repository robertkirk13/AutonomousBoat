import { useNavigation } from '../context/NavigationContext';

function GaugeBar({ value, max, label, unit, color = 'white' }: {
  value: number;
  max: number;
  label: string;
  unit: string;
  color?: 'white' | 'emerald' | 'amber' | 'red';
}) {
  const percentage = Math.min((value / max) * 100, 100);
  const colorClasses = {
    white: 'bg-white/80',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[10px] text-white/40 uppercase tracking-wide">{label}</span>
        <span className="text-xs text-white/80 font-mono">
          {value.toFixed(1)}<span className="text-white/40 ml-0.5">{unit}</span>
        </span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full ${colorClasses[color]} transition-all duration-300 rounded-full`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function MotorGauge({ value, label }: { value: number; label: string }) {
  const percent = Math.round(value * 100);

  return (
    <div className="flex-1">
      <div className="text-[10px] text-white/40 uppercase tracking-wide text-center mb-1">{label}</div>
      <div className="relative h-16 bg-white/5 rounded-xl flex items-center justify-center">
        <div
          className="absolute bottom-0 left-0 right-0 transition-all duration-300 rounded-xl bg-emerald-500/30"
          style={{ height: `${percent}%` }}
        />
        <span className="relative text-lg font-semibold text-white/90">
          {percent}
          <span className="text-xs text-white/40 ml-0.5">%</span>
        </span>
      </div>
    </div>
  );
}

export default function BoatStatePanel() {
  const { boat, mission } = useNavigation();

  const getTempColor = (temp: number, maxSafe: number): 'emerald' | 'amber' | 'red' => {
    const ratio = temp / maxSafe;
    if (ratio < 0.6) return 'emerald';
    if (ratio < 0.85) return 'amber';
    return 'red';
  };

  const leftThrust = boat.nav?.left_thrust ?? 0;
  const rightThrust = boat.nav?.right_thrust ?? 0;

  const findChannel = (label: string) =>
    boat.power?.channels.find((ch) => ch.label === label);
  const leftBattery = findChannel('left_battery');
  const rightBattery = findChannel('right_battery');
  const avgVoltage = leftBattery && rightBattery
    ? (leftBattery.voltage_v + rightBattery.voltage_v) / 2
    : leftBattery?.voltage_v ?? rightBattery?.voltage_v ?? 0;

  const totalCurrent = boat.power?.channels
    .filter(ch => ch.label.includes('motor'))
    .reduce((sum, ch) => sum + ch.current_a, 0) ?? 0;

  return (
    <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider">Boat State</h3>
        <div className={`flex items-center gap-1.5 text-xs ${boat.boatOnline ? 'text-emerald-400' : 'text-red-400'}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${boat.boatOnline ? 'bg-emerald-400' : 'bg-red-400'}`} />
          {boat.boatOnline ? 'Online' : 'Offline'}
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-4 h-4 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
          <span className="text-xs text-white/60 font-medium">Power System</span>
        </div>
        <div className="space-y-2 pl-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/5 rounded-lg p-2">
              <div className="text-[10px] text-white/40 uppercase">Voltage</div>
              <div className="text-sm font-semibold text-white/90">
                {avgVoltage.toFixed(1)}<span className="text-white/40 text-xs ml-0.5">V</span>
              </div>
            </div>
            <div className="bg-white/5 rounded-lg p-2">
              <div className="text-[10px] text-white/40 uppercase">Motor Current</div>
              <div className="text-sm font-semibold text-white/90">
                {totalCurrent.toFixed(1)}<span className="text-white/40 text-xs ml-0.5">A</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-4 h-4 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-xs text-white/60 font-medium">Motor Drives</span>
        </div>
        <div className="flex gap-3 pl-6">
          <MotorGauge value={leftThrust} label="Left" />
          <MotorGauge value={rightThrust} label="Right" />
        </div>
      </div>

      {boat.thermal && boat.thermal.temps.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span className="text-xs text-white/60 font-medium">Temperatures</span>
          </div>
          <div className="space-y-2 pl-6">
            {boat.thermal.temps.map((t) => (
              <GaugeBar
                key={t.label}
                value={t.temp_c}
                max={70}
                label={t.label.replace('_', ' ')}
                unit="&deg;C"
                color={getTempColor(t.temp_c, 65)}
              />
            ))}
          </div>
        </div>
      )}

      {mission.status === 'running' && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="flex items-center justify-center gap-2 text-xs text-emerald-400">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Systems Active
          </div>
        </div>
      )}
    </div>
  );
}
