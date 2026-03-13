import type { Ina228Reading, PowerData as PowerState } from "../types/index";

function estimateSoc(voltage: number): number {
  return Math.max(0, Math.min(100, ((voltage - 10.0) / (12.6 - 10.0)) * 100));
}

function voltageColor(v: number): string {
  if (v > 12.0) return "text-emerald-400";
  if (v > 11.0) return "text-amber-400";
  return "text-red-400";
}

function socColor(soc: number): string {
  if (soc > 50) return "bg-emerald-400";
  if (soc > 20) return "bg-amber-400";
  return "bg-red-400";
}

function socBgColor(soc: number): string {
  if (soc > 50) return "bg-emerald-400/10";
  if (soc > 20) return "bg-amber-400/10";
  return "bg-red-400/10";
}

function PowerValue({ watts, signed = false }: { watts: number; signed?: boolean }) {
  const abs = Math.abs(watts);
  const prefix = signed ? (watts >= 0 ? "+" : "-") : "";
  const color = Math.abs(watts) < 0.1
    ? "text-white/25"
    : watts > 0 && signed
      ? "text-emerald-400"
      : watts < 0 && signed
        ? "text-amber-400"
        : "text-white/70";

  return (
    <span className={`font-mono text-[11px] ${color}`}>
      {prefix}{abs.toFixed(1)}
      <span className="text-white/30 text-[9px] ml-0.5">W</span>
    </span>
  );
}

function BatteryGauge({ ch, label }: { ch: Ina228Reading | undefined; label: string }) {
  const soc = ch ? estimateSoc(ch.voltage_v) : 0;
  const v = ch?.voltage_v ?? 0;
  const power = ch?.power_w ?? 0;

  return (
    <div className="flex-1 min-w-0">
      <div className="text-[9px] text-white/30 uppercase tracking-wider mb-1">{label}</div>
      {/* SOC bar */}
      <div className={`h-5 rounded ${ch ? socBgColor(soc) : 'bg-white/[0.03]'} overflow-hidden relative`}>
        <div
          className={`absolute inset-y-0 left-0 ${ch ? socColor(soc) : 'bg-white/10'} rounded transition-all duration-500`}
          style={{ width: `${ch ? soc : 0}%`, opacity: 0.35 }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] font-mono font-medium text-white/70">
            {ch ? `${soc.toFixed(0)}%` : '--'}
          </span>
        </div>
      </div>
      {/* Voltage + power */}
      <div className="flex items-baseline justify-between mt-1">
        <span className={`font-mono text-[11px] ${ch ? voltageColor(v) : 'text-white/20'}`}>
          {ch ? v.toFixed(1) : '--'}
          <span className="text-white/30 text-[9px] ml-0.5">V</span>
        </span>
        <PowerValue watts={power} signed />
      </div>
    </div>
  );
}

function SourceCard({ ch, label, icon }: { ch: Ina228Reading | undefined; label: string; icon: React.ReactNode }) {
  const active = ch && Math.abs(ch.power_w) > 0.1;

  return (
    <div className={`flex-1 min-w-0 rounded-lg px-2 py-1.5 border ${
      active ? 'bg-emerald-400/[0.04] border-emerald-400/15' : 'bg-white/[0.02] border-white/[0.04]'
    }`}>
      <div className="flex items-center gap-1 mb-0.5">
        <span className={`${active ? 'text-emerald-400/60' : 'text-white/20'}`}>{icon}</span>
        <span className="text-[9px] text-white/35 uppercase tracking-wider">{label}</span>
      </div>
      <PowerValue watts={ch?.power_w ?? 0} />
    </div>
  );
}

function ConsumerCard({ ch, label }: { ch: Ina228Reading | undefined; label: string }) {
  const active = ch && Math.abs(ch.power_w) > 0.1;

  return (
    <div className="flex-1 min-w-0 text-center">
      <div className="text-[9px] text-white/30 uppercase tracking-wider mb-0.5">{label}</div>
      <div className={`font-mono text-[11px] ${active ? 'text-white/70' : 'text-white/20'}`}>
        {ch ? Math.abs(ch.power_w).toFixed(1) : '--'}
        <span className="text-white/30 text-[9px] ml-0.5">W</span>
      </div>
      {ch && (
        <div className="text-[9px] text-white/25 font-mono">
          {Math.abs(ch.current_a).toFixed(2)}A
        </div>
      )}
    </div>
  );
}

// Flow arrow SVG
function FlowArrow({ direction, active }: { direction: 'down' | 'up'; active: boolean }) {
  const color = active ? 'stroke-teal/40' : 'stroke-white/[0.06]';
  const y1 = direction === 'down' ? 0 : 8;
  const y2 = direction === 'down' ? 8 : 0;
  return (
    <svg width="2" height="8" className="mx-auto" aria-hidden="true">
      <line x1="1" y1={y1} x2="1" y2={y2} className={color} strokeWidth="1.5" strokeDasharray="2 2" />
    </svg>
  );
}

export function PowerPanel({ data }: { data: PowerState | null }) {
  const find = (label: string) => data?.channels.find((ch) => ch.label === label);

  const solar = find('solar');
  const dock = find('dock_charger');
  const leftBat = find('left_battery');
  const rightBat = find('right_battery');
  const leftMotor = find('left_motor');
  const rightMotor = find('right_motor');
  const core = find('core_digital');
  const payload = find('payload');
  const reel = find('reel');

  const totalIn = (solar?.power_w ?? 0) + (dock?.power_w ?? 0);
  const totalOut = (leftMotor?.power_w ?? 0) + (rightMotor?.power_w ?? 0) +
    (core?.power_w ?? 0) + (payload?.power_w ?? 0) + (reel?.power_w ?? 0);
  const netPower = totalIn - totalOut;

  if (!data || data.channels.length === 0) {
    return (
      <div className="px-3.5 py-2.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] font-medium text-white/25 uppercase tracking-[0.1em]">Power</span>
        </div>
        <div className="text-center py-4 text-white/15 text-xs">Waiting for INA228</div>
      </div>
    );
  }

  return (
    <div className="px-3.5 py-2.5">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-medium text-white/25 uppercase tracking-[0.1em]">Power</span>
        <span className={`text-[10px] font-mono ${netPower >= 0 ? 'text-emerald-400/60' : 'text-amber-400/60'}`}>
          {netPower >= 0 ? '+' : ''}{netPower.toFixed(1)}W net
        </span>
      </div>

      {/* Sources row */}
      <div className="flex gap-2 mb-1">
        <SourceCard
          ch={solar}
          label="Solar"
          icon={
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="4"/>
              <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41"/>
            </svg>
          }
        />
        <SourceCard
          ch={dock}
          label="Dock"
          icon={
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
          }
        />
      </div>

      {/* Flow arrows */}
      <div className="flex justify-around py-0.5">
        <FlowArrow direction="down" active={(solar?.power_w ?? 0) > 0.1 || (dock?.power_w ?? 0) > 0.1} />
        <FlowArrow direction="down" active={(solar?.power_w ?? 0) > 0.1 || (dock?.power_w ?? 0) > 0.1} />
      </div>

      {/* Batteries */}
      <div className="flex gap-3 mb-1">
        <BatteryGauge ch={leftBat} label="Port Batt" />
        <BatteryGauge ch={rightBat} label="Stbd Batt" />
      </div>

      {/* Flow arrows */}
      <div className="flex justify-around py-0.5">
        <FlowArrow direction="down" active={totalOut > 0.1} />
        <FlowArrow direction="down" active={totalOut > 0.1} />
      </div>

      {/* Consumers */}
      <div className="flex gap-1 bg-white/[0.02] rounded-lg py-1.5 px-1 border border-white/[0.04]">
        <ConsumerCard ch={leftMotor} label="L Mot" />
        <div className="w-px bg-white/[0.06]" />
        <ConsumerCard ch={core} label="Core" />
        <div className="w-px bg-white/[0.06]" />
        <ConsumerCard ch={rightMotor} label="R Mot" />
      </div>

      {/* Extra consumers if present */}
      {(payload || reel) && (
        <div className="flex gap-1 mt-1 bg-white/[0.02] rounded-lg py-1.5 px-1 border border-white/[0.04]">
          {payload && <ConsumerCard ch={payload} label="Payload" />}
          {payload && reel && <div className="w-px bg-white/[0.06]" />}
          {reel && <ConsumerCard ch={reel} label="Reel" />}
        </div>
      )}
    </div>
  );
}
