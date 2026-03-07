import { useNavigation } from '../context/NavigationContext';
import Boat3DView from './Boat3DView';

function Datum({ label, value, unit, mono = true }: {
  label: string;
  value: string;
  unit?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-1.5 border-b border-white/[0.04] last:border-0">
      <span className="text-[10px] text-white/35 uppercase tracking-wider">{label}</span>
      <span className={`text-sm text-white/85 ${mono ? 'font-mono' : ''}`}>
        {value}
        {unit && <span className="text-white/30 text-[10px] ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

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

export default function TelemetryPanel() {
  const { boat } = useNavigation();

  const findChannel = (label: string) =>
    boat.power?.channels.find((ch) => ch.label === label);

  const leftBat = findChannel('left_battery');
  const rightBat = findChannel('right_battery');
  const leftMotor = findChannel('left_motor');
  const rightMotor = findChannel('right_motor');
  const solar = findChannel('solar');

  const avgV = leftBat && rightBat
    ? ((leftBat.voltage_v + rightBat.voltage_v) / 2).toFixed(1)
    : (leftBat?.voltage_v ?? rightBat?.voltage_v ?? 0).toFixed(1);

  const totalPower = (boat.power?.channels.reduce((s, c) => s + c.power_w, 0) ?? 0).toFixed(0);

  const leftThrust = boat.nav?.left_thrust ?? 0;
  const rightThrust = boat.nav?.right_thrust ?? 0;

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
            {Math.floor(boat.uptime / 60)}:{String(boat.uptime % 60).padStart(2, '0')}
          </span>
        )}
      </div>

      {/* 3D boat — compact */}
      <div className="px-2.5 pb-1">
        <Boat3DView heading={boat.heading} roll={boat.roll} pitch={boat.pitch} />
        <div className="flex justify-between px-1 mt-1 text-[9px] font-mono text-white/30">
          <span>H {boat.heading.toFixed(0)}&deg;</span>
          <span>R {boat.roll.toFixed(1)}&deg;</span>
          <span>P {boat.pitch.toFixed(1)}&deg;</span>
        </div>
      </div>

      <div className="h-px bg-white/[0.04] mx-3" />

      {/* Navigation */}
      <Section title="Navigation">
        <Datum label="Heading" value={boat.heading.toFixed(0)} unit="&deg;" />
        <Datum label="Speed" value={mpsToKnots(boat.speed)} unit="kn" />
        <Datum label="Position" value={`${boat.position.lat.toFixed(5)}, ${boat.position.lng.toFixed(5)}`} />
        {boat.nav && boat.nav.mode === 'running' && (
          <Datum label="To waypoint" value={boat.nav.distance_m.toFixed(0)} unit="m" />
        )}
      </Section>

      <div className="h-px bg-white/[0.04] mx-3" />

      {/* Motors */}
      <Section title="Motors">
        <div className="flex gap-2 mt-1">
          <MotorBar label="Port" thrust={leftThrust} current={leftMotor?.current_a ?? 0} />
          <MotorBar label="Stbd" thrust={rightThrust} current={rightMotor?.current_a ?? 0} />
        </div>
      </Section>

      <div className="h-px bg-white/[0.04] mx-3" />

      {/* Power */}
      <Section title="Power">
        <Datum label="Battery" value={avgV} unit="V" />
        <Datum label="Total" value={totalPower} unit="W" />
        {solar && solar.power_w > 0.5 && (
          <Datum label="Solar" value={`+${solar.power_w.toFixed(1)}`} unit="W" />
        )}
      </Section>

      {/* Thermal */}
      {boat.thermal && boat.thermal.temps.length > 0 && (
        <>
          <div className="h-px bg-white/[0.04] mx-3" />
          <Section title="Thermal">
            {boat.thermal.temps.map((t) => (
              <Datum key={t.label} label={t.label.replace(/_/g, ' ')} value={t.temp_c.toFixed(1)} unit="&deg;C" />
            ))}
            {boat.thermal.fan_duty > 0 && (
              <Datum label="Fan" value={(boat.thermal.fan_duty * 100).toFixed(0)} unit="%" />
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function MotorBar({ label, thrust, current }: { label: string; thrust: number; current: number }) {
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
    </div>
  );
}
