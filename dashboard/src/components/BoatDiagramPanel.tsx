import { useNavigation } from '../context/NavigationContext';
import Boat3DView from './Boat3DView';

function PowerFlowArrow({
  direction,
  power,
  color
}: {
  direction: 'up' | 'down' | 'left' | 'right';
  power: number;
  color: string;
}) {
  const isActive = power > 0;
  const opacity = isActive ? Math.min(0.3 + (power / 100) * 0.7, 1) : 0.1;

  const rotations = {
    up: 'rotate-0',
    down: 'rotate-180',
    left: '-rotate-90',
    right: 'rotate-90',
  };

  return (
    <div className={`flex items-center justify-center ${rotations[direction]}`}>
      <svg
        className="w-4 h-4 transition-all duration-300"
        style={{ opacity, color }}
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <path d="M12 4l-8 8h5v8h6v-8h5z" />
      </svg>
      {isActive && (
        <div
          className="absolute w-1 h-3 rounded-full animate-pulse"
          style={{ backgroundColor: color, opacity: opacity * 0.8 }}
        />
      )}
    </div>
  );
}

function MotorIcon({ power, label }: { power: number; label: string }) {
  const isActive = power > 0;
  const rotation = isActive ? 'animate-spin' : '';
  const percent = Math.round(power * 100);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative">
        <svg className="w-10 h-10" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="16" fill="white" fillOpacity="0.1" stroke="white" strokeOpacity="0.3" strokeWidth="1.5" />
          <g className={`origin-center ${rotation}`} style={{ transformOrigin: '20px 20px', animationDuration: `${Math.max(0.2, 1 - power)}s` }}>
            <ellipse cx="20" cy="10" rx="3" ry="8" fill={isActive ? '#22c55e' : 'white'} fillOpacity={isActive ? 0.8 : 0.3} />
            <ellipse cx="20" cy="30" rx="3" ry="8" fill={isActive ? '#22c55e' : 'white'} fillOpacity={isActive ? 0.8 : 0.3} />
            <ellipse cx="10" cy="20" rx="8" ry="3" fill={isActive ? '#22c55e' : 'white'} fillOpacity={isActive ? 0.8 : 0.3} />
            <ellipse cx="30" cy="20" rx="8" ry="3" fill={isActive ? '#22c55e' : 'white'} fillOpacity={isActive ? 0.8 : 0.3} />
          </g>
          <circle cx="20" cy="20" r="4" fill="white" fillOpacity="0.4" />
        </svg>
        {isActive && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-bold text-emerald-400">
            {percent}%
          </div>
        )}
      </div>
      <span className="text-[10px] text-white/40 uppercase tracking-wide">{label}</span>
    </div>
  );
}

function SolarPanel({ powerW, isCharging }: { powerW: number; isCharging: boolean }) {
  return (
    <div className="relative">
      <svg className="w-full h-8" viewBox="0 0 120 32">
        <rect x="4" y="4" width="112" height="24" rx="2" fill="white" fillOpacity="0.05" stroke="white" strokeOpacity="0.2" strokeWidth="1" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect
            key={i}
            x={8 + i * 18}
            y="8"
            width="14"
            height="16"
            rx="1"
            fill={isCharging ? '#3b82f6' : 'white'}
            fillOpacity={isCharging ? 0.4 + Math.min(powerW / 50, 0.4) : 0.1}
            className="transition-all duration-300"
          />
        ))}
        {isCharging && (
          <g className="animate-pulse">
            <circle cx="110" cy="8" r="4" fill="#fbbf24" />
          </g>
        )}
      </svg>
      {isCharging && (
        <div className="absolute -right-1 top-1/2 -translate-y-1/2 text-[9px] font-bold text-blue-400">
          +{powerW.toFixed(0)}W
        </div>
      )}
    </div>
  );
}

function Pontoon({
  side,
  voltage,
  current,
  motorThrust,
}: {
  side: 'left' | 'right';
  voltage: number;
  current: number;
  motorThrust: number;
}) {
  const isMotorActive = motorThrust > 0;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-[10px] text-white/40 uppercase tracking-wider">
        {side === 'left' ? 'Port' : 'Starboard'}
      </div>

      <div className="relative">
        <svg className="w-16 h-32" viewBox="0 0 64 128">
          <path
            d="M8 20 Q8 8 32 8 Q56 8 56 20 L56 108 Q56 120 32 120 Q8 120 8 108 Z"
            fill="white"
            fillOpacity="0.05"
            stroke="white"
            strokeOpacity="0.2"
            strokeWidth="1.5"
          />
          <path
            d="M8 90 Q20 85 32 90 Q44 95 56 90"
            fill="none"
            stroke="#3b82f6"
            strokeOpacity="0.3"
            strokeWidth="1"
          />
        </svg>

        <div className="absolute top-6 left-1/2 -translate-x-1/2">
          <div className="flex flex-col items-center">
            <div className="text-[10px] text-white/50 font-mono">{voltage.toFixed(1)}V</div>
          </div>
        </div>

        <div className="absolute top-[4.5rem] left-1/2 -translate-x-1/2">
          <PowerFlowArrow direction="down" power={isMotorActive ? current * 10 : 0} color="#22c55e" />
        </div>

        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-4">
          <MotorIcon power={motorThrust} label="" />
        </div>
      </div>

      <div className="text-xs text-white/60 font-mono mt-6">
        {current.toFixed(1)}A
      </div>
    </div>
  );
}

export default function BoatDiagramPanel() {
  const { boat, mission } = useNavigation();

  // Extract power data from MQTT channels
  const findChannel = (label: string) =>
    boat.power?.channels.find((ch) => ch.label === label);

  const leftMotor = findChannel('left_motor');
  const rightMotor = findChannel('right_motor');
  const solar = findChannel('solar');
  const leftBattery = findChannel('left_battery');
  const rightBattery = findChannel('right_battery');

  const leftThrust = boat.nav?.left_thrust ?? 0;
  const rightThrust = boat.nav?.right_thrust ?? 0;

  const solarPowerW = solar?.power_w ?? 0;
  const isSolarCharging = solarPowerW > 0.5;

  const totalPowerW = boat.power?.channels.reduce((sum, ch) => sum + ch.power_w, 0) ?? 0;
  const mpsToKnots = (mps: number) => mps * 1.94384;

  return (
    <div className="p-4">
      {/* 3D Boat Visualization */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider">Orientation</h3>
          <div className={`flex items-center gap-1.5 text-[10px] ${boat.boatOnline ? 'text-emerald-400' : 'text-white/30'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${boat.boatOnline ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'}`} />
            {boat.boatOnline ? 'Live' : 'Offline'}
          </div>
        </div>
        <Boat3DView quaternion={boat.quaternion} />
        <div className="flex justify-between mt-1.5 text-[10px] text-white/40 font-mono">
          <span>H: {boat.heading.toFixed(0)}&deg;</span>
          <span>R: {boat.roll.toFixed(1)}&deg;</span>
          <span>P: {boat.pitch.toFixed(1)}&deg;</span>
        </div>
      </div>

      <div className="border-t border-white/5 pt-3" />

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider">Power System</h3>
        <div className={`flex items-center gap-1.5 text-xs ${boat.boatOnline ? 'text-emerald-400' : 'text-red-400'}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${boat.boatOnline ? 'bg-emerald-400' : 'bg-red-400'} ${mission.status === 'running' ? 'animate-pulse' : ''}`} />
          {boat.boatOnline ? 'Online' : 'Offline'}
        </div>
      </div>

      <div className="mb-2">
        <SolarPanel powerW={solarPowerW} isCharging={isSolarCharging} />
        <div className="flex justify-center">
          <PowerFlowArrow direction="down" power={isSolarCharging ? solarPowerW : 0} color="#3b82f6" />
        </div>
      </div>

      <div className="flex justify-center items-start gap-4">
        <Pontoon
          side="left"
          voltage={leftBattery?.voltage_v ?? 0}
          current={leftMotor?.current_a ?? 0}
          motorThrust={leftThrust}
        />

        <div className="flex flex-col items-center pt-8">
          <div className="w-12 h-20 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
            <svg className="w-6 h-6 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          </div>
          <div className="text-[9px] text-white/30 mt-1">CTRL</div>
        </div>

        <Pontoon
          side="right"
          voltage={rightBattery?.voltage_v ?? 0}
          current={rightMotor?.current_a ?? 0}
          motorThrust={rightThrust}
        />
      </div>

      <div className="mt-4 pt-3 border-t border-white/5 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-[10px] text-white/40 uppercase">Total Power</div>
          <div className="text-sm font-semibold text-white/90">
            {totalPowerW.toFixed(0)}<span className="text-white/40 text-xs ml-0.5">W</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] text-white/40 uppercase">Heading</div>
          <div className="text-sm font-semibold text-white/90">
            {boat.heading.toFixed(0)}<span className="text-white/40 text-xs ml-0.5">&deg;</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] text-white/40 uppercase">Speed</div>
          <div className="text-sm font-semibold text-white/90">
            {mpsToKnots(boat.speed).toFixed(1)}<span className="text-white/40 text-xs ml-0.5">kn</span>
          </div>
        </div>
      </div>

      {/* Thermal info */}
      {boat.thermal && boat.thermal.temps.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-2 gap-2">
          {boat.thermal.temps.map((t) => (
            <div key={t.label} className="text-center">
              <div className="text-[10px] text-white/40 uppercase">{t.label.replace('_', ' ')}</div>
              <div className="text-sm font-semibold text-white/90">
                {t.temp_c.toFixed(1)}<span className="text-white/40 text-xs ml-0.5">&deg;C</span>
              </div>
            </div>
          ))}
          {boat.thermal.fan_duty > 0 && (
            <div className="text-center col-span-2">
              <div className="text-[10px] text-white/40 uppercase">Fan</div>
              <div className="text-sm font-semibold text-white/90">
                {(boat.thermal.fan_duty * 100).toFixed(0)}<span className="text-white/40 text-xs ml-0.5">%</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Connection Status */}
      <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
          </svg>
          <span className="text-[10px] text-white/40 uppercase tracking-wider">Boat &rarr; HiveMQ</span>
        </div>
        <div className={`flex items-center gap-1.5 text-[10px] font-medium ${boat.boatOnline ? 'text-emerald-400' : 'text-red-400/70'}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${boat.boatOnline ? 'bg-emerald-400 animate-pulse' : 'bg-red-400/50'}`} />
          {boat.boatOnline ? 'Online' : 'Offline'}
        </div>
      </div>
    </div>
  );
}
