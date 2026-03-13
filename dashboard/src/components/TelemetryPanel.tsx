import { useNavigation } from '../context/NavigationContext';
import { PowerPanel } from './PowerPanel';

function Section({ title, children, accent }: {
  title: string;
  children: React.ReactNode;
  accent?: React.ReactNode;
}) {
  return (
    <div className="px-3.5 py-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-medium text-white/25 uppercase tracking-[0.1em]">{title}</span>
        {accent}
      </div>
      {children}
    </div>
  );
}

const mpsToKnots = (mps: number) => (mps * 1.94384).toFixed(1);

/** Cardinal label for a heading in degrees. */
function cardinalDir(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

/** Compact SVG compass ring with tick marks and heading needle. */
function CompassRing({ heading }: { heading: number }) {
  const r = 32;
  const cx = 40;
  const cy = 40;
  const ticks = [];

  // 36 tick marks (every 10°), longer at cardinals
  for (let i = 0; i < 36; i++) {
    const deg = i * 10;
    const rad = ((deg - 90) * Math.PI) / 180;
    const isCardinal = deg % 90 === 0;
    const inner = isCardinal ? r - 7 : r - 4;
    ticks.push(
      <line
        key={i}
        x1={cx + inner * Math.cos(rad)}
        y1={cy + inner * Math.sin(rad)}
        x2={cx + r * Math.cos(rad)}
        y2={cy + r * Math.sin(rad)}
        stroke={isCardinal ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.1)'}
        strokeWidth={isCardinal ? 1.5 : 0.75}
      />
    );
  }

  // Heading needle
  const needleRad = ((heading - 90) * Math.PI) / 180;
  const needleLen = r - 2;

  return (
    <svg width={80} height={80} viewBox="0 0 80 80" className="shrink-0" role="img" aria-label={`Compass heading ${Math.round(heading)} degrees`}>
      <title>{`Heading ${Math.round(heading)}°`}</title>
      {/* Outer ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
      {ticks}
      {/* Cardinal labels */}
      {(['N', 'E', 'S', 'W'] as const).map((dir, i) => {
        const deg = i * 90;
        const rad = ((deg - 90) * Math.PI) / 180;
        const lr = r + 6;
        return (
          <text
            key={dir}
            x={cx + lr * Math.cos(rad)}
            y={cy + lr * Math.sin(rad)}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-white/20 text-[7px] font-medium"
          >
            {dir}
          </text>
        );
      })}
      {/* Needle */}
      <line
        x1={cx}
        y1={cy}
        x2={cx + needleLen * Math.cos(needleRad)}
        y2={cy + needleLen * Math.sin(needleRad)}
        stroke="oklch(0.72 0.14 185)"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {/* Center dot */}
      <circle cx={cx} cy={cy} r={2} fill="oklch(0.72 0.14 185)" opacity={0.6} />
    </svg>
  );
}

export default function TelemetryPanel() {
  const { boat, calibrateUpright, calibrateCompass } = useNavigation();

  const findChannel = (label: string) =>
    boat.power?.channels.find((ch) => ch.label === label);

  const leftMotor = findChannel('left_motor');
  const rightMotor = findChannel('right_motor');

  const leftThrust = boat.nav?.left_thrust ?? 0;
  const rightThrust = boat.nav?.right_thrust ?? 0;

  // Extract thermal readings by label
  const temp1 = boat.thermal?.temps.find((t) => t.label === 'board_temp_1');
  const temp2 = boat.thermal?.temps.find((t) => t.label === 'board_temp_2');
  const coreTemp = temp1 && temp2 ? (temp1.temp_c + temp2.temp_c) / 2 : temp1?.temp_c ?? temp2?.temp_c ?? null;

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      {/* Connection badge */}
      <div className="px-3.5 pt-3 pb-1.5 flex items-center gap-2">
        <div className={`w-1.5 h-1.5 rounded-full ${
          boat.boatOnline ? 'bg-teal animate-pulse' : boat.mqttConnected ? 'bg-amber-400' : 'bg-white/15'
        }`} />
        <span className="text-[10px] font-medium tracking-wide text-white/40">
          {boat.boatOnline ? 'LIVE' : boat.mqttConnected ? 'MQTT OK' : 'OFFLINE'}
        </span>
        {boat.uptime > 0 && (
          <span className="text-[10px] font-mono text-white/20 ml-auto">
            {Math.floor(boat.uptime / 60)}:{String(Math.round(boat.uptime) % 60).padStart(2, '0')}
          </span>
        )}
      </div>

      {/* Speed — hero display */}
      <div className="px-3.5 pt-2 pb-1 text-center">
        <span className="text-[9px] font-medium text-white/25 uppercase tracking-[0.1em]">Speed</span>
        <div className="flex items-baseline justify-center gap-1.5 mt-1">
          <span className="text-4xl font-mono font-extralight text-white/90 tabular-nums leading-none">
            {mpsToKnots(boat.speed)}
          </span>
          <span className="text-xs text-white/25 font-light">kn</span>
        </div>
      </div>

      <div className="h-px bg-white/[0.04] mx-3" />

      {/* Heading — compass + readout */}
      <div className="px-3.5 py-2.5 flex flex-col items-center">
        <CompassRing heading={boat.heading} />
        <div className="flex items-baseline gap-1 mt-1.5">
          <span className="text-xl font-mono font-light text-white/85 tabular-nums leading-none">
            {boat.heading.toFixed(0)}
          </span>
          <span className="text-[10px] text-white/30">&deg;</span>
          <span className="text-[10px] font-medium text-teal/60 ml-0.5">
            {cardinalDir(boat.heading)}
          </span>
        </div>
        {/* Position */}
        <div className="mt-1.5 text-[10px] font-mono text-white/40 tabular-nums text-center leading-relaxed">
          {boat.position.lat.toFixed(5)}, {boat.position.lng.toFixed(5)}
        </div>
        {boat.nav && boat.nav.mode === 'running' && (
          <div className="flex items-baseline gap-1.5 mt-1.5 pt-1.5 border-t border-white/[0.04] w-full justify-center">
            <span className="text-[9px] text-white/25 uppercase tracking-wider">To WP</span>
            <span className="text-[10px] font-mono text-teal/60 tabular-nums">
              {boat.nav.distance_m.toFixed(0)}
              <span className="text-white/25 ml-0.5">m</span>
            </span>
          </div>
        )}
      </div>

      <div className="h-px bg-white/[0.04] mx-3" />

      {/* Motors — with embedded temperature */}
      <Section title="Motors">
        <div className="flex gap-2 mt-1">
          <MotorBar label="Port" thrust={leftThrust} current={leftMotor?.current_a ?? 0} temp={temp1?.temp_c ?? null} />
          <MotorBar label="Stbd" thrust={rightThrust} current={rightMotor?.current_a ?? 0} temp={temp2?.temp_c ?? null} />
        </div>
      </Section>

      <div className="h-px bg-white/[0.04] mx-3" />

      {/* Power */}
      <PowerPanel data={boat.power} />

      {/* Core temp + fan */}
      {(coreTemp !== null || (boat.thermal && boat.thermal.fan_duty > 0)) && (
        <>
          <div className="h-px bg-white/[0.04] mx-3" />
          <Section title="Thermal">
            {coreTemp !== null && (
              <div className="flex items-baseline justify-between py-1.5 border-b border-white/[0.04] last:border-0">
                <span className="text-[10px] text-white/35 uppercase tracking-wider">Core</span>
                <span className="text-sm font-mono text-white/85 tabular-nums">
                  {coreTemp.toFixed(1)}
                  <span className="text-white/30 text-[10px] ml-0.5">&deg;C</span>
                </span>
              </div>
            )}
            {boat.thermal && boat.thermal.fan_duty > 0 && (
              <div className="flex items-baseline justify-between py-1.5 last:border-0">
                <span className="text-[10px] text-white/35 uppercase tracking-wider">Fan</span>
                <span className="text-sm font-mono text-white/85 tabular-nums">
                  {(boat.thermal.fan_duty * 100).toFixed(0)}
                  <span className="text-white/30 text-[10px] ml-0.5">%</span>
                </span>
              </div>
            )}
          </Section>
        </>
      )}

      {/* Calibration actions */}
      <div className="mt-auto">
        <div className="h-px bg-white/[0.04] mx-3" />
        <Section title="Calibration">
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={calibrateUpright}
              className="w-full px-2.5 py-1.5 text-[10px] font-medium tracking-wide rounded bg-white/[0.04] border border-white/[0.06] text-white/50 hover:text-white/80 hover:bg-white/[0.08] transition-colors text-left"
            >
              Set Upright
            </button>
            <button
              type="button"
              onClick={calibrateCompass}
              className="w-full px-2.5 py-1.5 text-[10px] font-medium tracking-wide rounded bg-white/[0.04] border border-white/[0.06] text-white/50 hover:text-white/80 hover:bg-white/[0.08] transition-colors text-left"
            >
              Set North
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}

function MotorBar({ label, thrust, current, temp }: {
  label: string;
  thrust: number;
  current: number;
  temp: number | null;
}) {
  const pct = Math.round(thrust * 100);

  return (
    <div className="flex-1">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[9px] text-white/30 uppercase tracking-wide">{label}</span>
        <span className="text-[10px] font-mono text-white/50">{current.toFixed(1)}A</span>
      </div>
      <div className="h-5 bg-white/[0.04] rounded overflow-hidden relative">
        <div
          className="absolute inset-y-0 left-0 bg-teal/25 transition-all duration-300 rounded"
          style={{ width: `${pct}%` }}
        />
        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono font-medium text-white/60">
          {pct}%
        </div>
      </div>
      {temp !== null && (
        <div className="mt-1 text-[9px] font-mono text-white/25 text-right tabular-nums">
          {temp.toFixed(1)}&deg;C
        </div>
      )}
    </div>
  );
}
