import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Ina228Reading, PowerData as PowerState } from "../types/index";

type Sample = { t: number; w: number; v: number };
const HISTORY_MS = 5 * 60 * 1000;
const SAMPLE_INTERVAL_MS = 100;

type WindowOption = { label: string; ms: number };
const WINDOW_OPTIONS: WindowOption[] = [
  { label: '30s', ms: 30_000 },
  { label: '1m', ms: 60_000 },
  { label: '2m', ms: 120_000 },
  { label: '5m', ms: HISTORY_MS },
];

const DISPLAY_NAMES: Record<string, string> = {
  solar: "Solar",
  dock_charger: "Dock Charger",
  left_battery: "Port Battery",
  right_battery: "Stbd Battery",
  left_motor: "Port Motor",
  right_motor: "Stbd Motor",
  core_digital: "Core",
  payload: "Payload",
  reel: "Reel",
};

const BATTERY_KEYS = new Set(["left_battery", "right_battery"]);

// --- Battery calibration persisted in localStorage ---

interface BatteryCalibration {
  capacityAh: number;
  baselineChargeAh: number;
  baselineAt: number; // ms epoch of "mark full"
  invert: boolean;    // flip sign if INA228 wiring polarity is opposite
}

const CAL_KEY = (ch: string) => `boat.battery.cal.${ch}`;

function loadCal(ch: string): BatteryCalibration | null {
  try {
    const raw = localStorage.getItem(CAL_KEY(ch));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.capacityAh !== "number" || typeof parsed.baselineChargeAh !== "number") return null;
    return {
      capacityAh: parsed.capacityAh,
      baselineChargeAh: parsed.baselineChargeAh,
      baselineAt: parsed.baselineAt ?? Date.now(),
      invert: !!parsed.invert,
    };
  } catch {
    return null;
  }
}

function saveCal(ch: string, cal: BatteryCalibration | null): void {
  if (!cal) localStorage.removeItem(CAL_KEY(ch));
  else localStorage.setItem(CAL_KEY(ch), JSON.stringify(cal));
}

/** Compute SOC% from INA228 integrated charge. Returns null if not calibrated. */
export function computeSoc(ch: Ina228Reading | undefined, cal: BatteryCalibration | null): number | null {
  if (!ch || !cal || cal.capacityAh <= 0) return null;
  const delta = ch.charge_ah - cal.baselineChargeAh;
  // Positive delta normally means discharge pulled out of the pack;
  // user can flip sign if wiring polarity is reversed.
  const consumedAh = cal.invert ? -delta : delta;
  const soc = 100 - (consumedAh / cal.capacityAh) * 100;
  return Math.max(0, Math.min(100, soc));
}

/** Rough voltage-based SOC estimate for LiFePO4 12.6V packs — fallback when uncalibrated. */
function estimateSocFromVoltage(voltage: number): number {
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

function BatteryGauge({ ch, label, onClick }: { ch: Ina228Reading | undefined; label: string; onClick?: () => void }) {
  // Re-read calibration on every render — batteries change rarely but the
  // gauge needs to pick up new calibration after the modal saves.
  const cal = ch ? loadCal(ch.label) : null;
  const socCal = computeSoc(ch, cal);
  const soc = socCal ?? (ch ? estimateSocFromVoltage(ch.voltage_v) : 0);
  const calibrated = socCal !== null;
  const v = ch?.voltage_v ?? 0;
  const power = ch?.power_w ?? 0;
  const clickable = !!ch && !!onClick;

  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      className={`flex-1 min-w-0 text-left ${clickable ? 'cursor-pointer hover:opacity-90 transition-opacity' : 'cursor-default'}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] text-white/30 uppercase tracking-wider">{label}</span>
        {calibrated && (
          <span className="text-[8px] font-mono text-emerald-400/50 uppercase tracking-wide">cal</span>
        )}
      </div>
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
    </button>
  );
}

function SourceCard({ ch, label, icon, onClick }: { ch: Ina228Reading | undefined; label: string; icon: React.ReactNode; onClick?: () => void }) {
  const active = ch && Math.abs(ch.power_w) > 0.1;
  const clickable = !!ch && !!onClick;

  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      className={`flex-1 min-w-0 rounded-lg px-2 py-1.5 border text-left ${
        active ? 'bg-emerald-400/[0.04] border-emerald-400/15' : 'bg-white/[0.02] border-white/[0.04]'
      } ${clickable ? 'cursor-pointer hover:border-white/20 transition-colors' : 'cursor-default'}`}
    >
      <div className="flex items-center gap-1 mb-0.5">
        <span className={`${active ? 'text-emerald-400/60' : 'text-white/20'}`}>{icon}</span>
        <span className="text-[9px] text-white/35 uppercase tracking-wider">{label}</span>
      </div>
      <PowerValue watts={ch?.power_w ?? 0} />
    </button>
  );
}

function ConsumerCard({ ch, label, onClick }: { ch: Ina228Reading | undefined; label: string; onClick?: () => void }) {
  const active = ch && Math.abs(ch.power_w) > 0.1;
  const clickable = !!ch && !!onClick;

  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      className={`flex-1 min-w-0 text-center ${clickable ? 'cursor-pointer hover:opacity-80 transition-opacity' : 'cursor-default'}`}
    >
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
    </button>
  );
}

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

function Stat({ label, value, unit = 'W', color = 'text-white/80' }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] text-white/35 uppercase tracking-wider">{label}</span>
      <span className={`font-mono text-sm ${color}`}>
        {value}
        <span className="text-white/30 text-[10px] ml-0.5">{unit}</span>
      </span>
    </div>
  );
}

function ChannelModal({
  channelKey,
  latest,
  getSamples,
  onClose,
  onCalibrationChange,
}: {
  channelKey: string;
  latest: Ina228Reading | undefined;
  getSamples: (key: string) => Sample[];
  onClose: () => void;
  onCalibrationChange: () => void;
}) {
  const [samples, setSamples] = useState<Sample[]>(() => [...getSamples(channelKey)]);
  const [windowMs, setWindowMs] = useState<number>(60_000);
  const isBattery = BATTERY_KEYS.has(channelKey);
  const [cal, setCal] = useState<BatteryCalibration | null>(() => (isBattery ? loadCal(channelKey) : null));
  const [capacityInput, setCapacityInput] = useState<string>(() => (cal ? String(cal.capacityAh) : "100"));

  useEffect(() => {
    let rafId = 0;
    let lastLen = -1;
    let lastT = -1;
    const tick = () => {
      const s = getSamples(channelKey);
      const len = s.length;
      const last = len > 0 ? s[len - 1].t : -1;
      if (len !== lastLen || last !== lastT) {
        lastLen = len;
        lastT = last;
        setSamples(s.slice());
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(rafId); window.removeEventListener('keydown', onKey); };
  }, [channelKey, getSamples, onClose]);

  const title = DISPLAY_NAMES[channelKey] ?? channelKey;

  const { data, stats } = useMemo(() => {
    if (samples.length === 0) {
      return { data: [] as Array<{ relSec: number; w: number; v: number }>, stats: null };
    }
    const latestT = samples[samples.length - 1].t;
    const cutoff = latestT - windowMs;
    const windowed = samples.filter(s => s.t >= cutoff);
    if (windowed.length === 0) {
      return { data: [], stats: null };
    }
    const data = windowed.map(s => ({
      relSec: (s.t - latestT) / 1000,
      w: s.w,
      v: s.v,
    }));
    let sumW = 0, minW = Infinity, maxW = -Infinity;
    let sumV = 0, minV = Infinity, maxV = -Infinity;
    for (const s of windowed) {
      sumW += s.w; if (s.w < minW) minW = s.w; if (s.w > maxW) maxW = s.w;
      sumV += s.v; if (s.v < minV) minV = s.v; if (s.v > maxV) maxV = s.v;
    }
    const avgW = sumW / windowed.length;
    const avgV = sumV / windowed.length;
    const currentW = windowed[windowed.length - 1].w;
    const currentV = windowed[windowed.length - 1].v;
    const windowSecs = Math.round((latestT - windowed[0].t) / 1000);
    return {
      data,
      stats: { avgW, minW, maxW, currentW, avgV, minV, maxV, currentV, count: windowed.length, windowSecs },
    };
  }, [samples, windowMs]);

  const fmt = (w: number) => `${w >= 0 ? '+' : ''}${w.toFixed(2)}`;
  const fmtV = (v: number) => v.toFixed(2);
  const axisFmt = (w: number) => w.toFixed(1);

  const markFull = () => {
    if (!latest) return;
    const cap = Math.max(1, Number(capacityInput) || 100);
    const next: BatteryCalibration = {
      capacityAh: cap,
      baselineChargeAh: latest.charge_ah,
      baselineAt: Date.now(),
      invert: cal?.invert ?? false,
    };
    saveCal(channelKey, next);
    setCal(next);
    onCalibrationChange();
  };

  const clearCal = () => {
    saveCal(channelKey, null);
    setCal(null);
    onCalibrationChange();
  };

  const toggleInvert = () => {
    if (!cal) return;
    const next = { ...cal, invert: !cal.invert };
    saveCal(channelKey, next);
    setCal(next);
    onCalibrationChange();
  };

  const socNow = computeSoc(latest, cal);
  const consumedAh = latest && cal
    ? (cal.invert ? cal.baselineChargeAh - latest.charge_ah : latest.charge_ah - cal.baselineChargeAh)
    : null;
  const remainingAh = cal && consumedAh !== null ? Math.max(0, cal.capacityAh - consumedAh) : null;
  const hoursSinceFull = cal ? (Date.now() - cal.baselineAt) / 3_600_000 : null;

  return createPortal(
    <div className="fixed inset-0 z-[1999] pointer-events-auto bg-black/40" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(60vw,calc(100vw-34rem))] aspect-[4/3] max-h-[85vh] z-[2000] pointer-events-auto rounded-2xl bg-panel/95 backdrop-blur-xl border border-panel-border/60 shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] gap-3">
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-medium text-white/35 uppercase tracking-[0.1em]">
              {isBattery ? 'Battery' : 'Power history'}
            </span>
            <span className="text-sm text-white/85 font-medium truncate">{title}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-black/30 rounded-md overflow-hidden border border-white/[0.06]">
              {WINDOW_OPTIONS.map(opt => (
                <button
                  key={opt.ms}
                  type="button"
                  onClick={() => setWindowMs(opt.ms)}
                  className={`px-2 py-1 text-[10px] font-mono transition-colors ${
                    windowMs === opt.ms
                      ? 'bg-white/10 text-white/90'
                      : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded-md bg-black/40 hover:bg-black/60 text-white/50 hover:text-white/80 transition-colors"
              title="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} role="img">
                <title>Close</title>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 px-3 pt-2">
          {data.length < 2 ? (
            <div className="w-full h-full flex items-center justify-center text-white/30 text-xs">
              Collecting samples…
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 40, left: 0, bottom: 8 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis
                  dataKey="relSec"
                  type="number"
                  domain={[-windowMs / 1000, 0]}
                  tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10, fontFamily: 'monospace' }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  tickLine={false}
                  tickFormatter={(v: number) => `${Math.round(v)}s`}
                  minTickGap={40}
                  allowDataOverflow
                />
                <YAxis
                  yAxisId="w"
                  tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10, fontFamily: 'monospace' }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  tickLine={false}
                  tickFormatter={axisFmt}
                  width={40}
                  unit="W"
                />
                <YAxis
                  yAxisId="v"
                  orientation="right"
                  tick={{ fill: 'rgba(168,230,207,0.5)', fontSize: 10, fontFamily: 'monospace' }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  tickLine={false}
                  tickFormatter={(v: number) => v.toFixed(1)}
                  width={36}
                  unit="V"
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(10,12,20,0.92)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    fontSize: 11,
                    fontFamily: 'monospace',
                  }}
                  labelStyle={{ color: 'rgba(255,255,255,0.5)' }}
                  labelFormatter={(v) => `${Math.round(Number(v))}s`}
                  itemStyle={{ color: 'rgba(255,255,255,0.9)' }}
                  formatter={(value, name) => {
                    const n = Number(value);
                    if (name === 'voltage') return [`${fmtV(n)} V`, 'Voltage'];
                    if (name === 'avg') return [`${fmt(n)} W`, 'Avg'];
                    return [`${fmt(n)} W`, 'Power'];
                  }}
                />
                {stats && (
                  <Line
                    yAxisId="w"
                    type="monotone"
                    dataKey={() => stats.avgW}
                    stroke="rgba(255,255,255,0.25)"
                    strokeDasharray="3 3"
                    dot={false}
                    isAnimationActive={false}
                    name="avg"
                    legendType="none"
                  />
                )}
                <Line
                  yAxisId="w"
                  type="monotone"
                  dataKey="w"
                  stroke="#34d399"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  name="power"
                />
                <Line
                  yAxisId="v"
                  type="monotone"
                  dataKey="v"
                  stroke="#60a5fa"
                  strokeWidth={1.25}
                  strokeOpacity={0.75}
                  dot={false}
                  isAnimationActive={false}
                  name="voltage"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Power stats */}
        <div className="px-4 py-2.5 border-t border-white/[0.06] grid grid-cols-5 gap-3">
          {stats ? (
            <>
              <Stat label="Avg W" value={fmt(stats.avgW)} color="text-emerald-400" />
              <Stat label="Now W" value={fmt(stats.currentW)} />
              <Stat label="Min W" value={fmt(stats.minW)} color="text-amber-400/80" />
              <Stat label="Max W" value={fmt(stats.maxW)} color="text-emerald-400/80" />
              <Stat label="Window" value={`${stats.windowSecs}`} unit="s" color="text-white/50" />
            </>
          ) : (
            <div className="col-span-5 text-white/30 text-xs">No samples yet.</div>
          )}
        </div>

        {/* Voltage stats */}
        <div className="px-4 py-2.5 border-t border-white/[0.06] grid grid-cols-5 gap-3">
          {stats ? (
            <>
              <Stat label="Avg V" value={fmtV(stats.avgV)} unit="V" color="text-sky-300" />
              <Stat label="Now V" value={fmtV(stats.currentV)} unit="V" color={latest ? voltageColor(stats.currentV).replace('text-', 'text-') : 'text-white/50'} />
              <Stat label="Min V" value={fmtV(stats.minV)} unit="V" color="text-amber-400/80" />
              <Stat label="Max V" value={fmtV(stats.maxV)} unit="V" color="text-emerald-400/80" />
              {latest && (
                <Stat label="Current" value={latest.current_a.toFixed(2)} unit="A" color="text-white/60" />
              )}
            </>
          ) : (
            <div className="col-span-5 text-white/30 text-xs">No samples yet.</div>
          )}
        </div>

        {/* Battery calibration */}
        {isBattery && (
          <div className="px-4 py-3 border-t border-white/[0.06] bg-black/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium text-white/55 uppercase tracking-[0.1em]">
                SOC Calibration
              </span>
              {cal && (
                <button
                  type="button"
                  onClick={clearCal}
                  className="text-[10px] font-mono text-red-400/60 hover:text-red-400 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>

            {cal ? (
              <>
                <div className="grid grid-cols-4 gap-3 mb-3">
                  <Stat label="SOC" value={socNow !== null ? `${socNow.toFixed(1)}` : '--'} unit="%" color="text-emerald-400" />
                  <Stat label="Remaining" value={remainingAh !== null ? remainingAh.toFixed(2) : '--'} unit="Ah" color="text-white/70" />
                  <Stat label="Consumed" value={consumedAh !== null ? consumedAh.toFixed(2) : '--'} unit="Ah" color="text-amber-400/80" />
                  <Stat label="Since full" value={hoursSinceFull !== null ? hoursSinceFull.toFixed(1) : '--'} unit="h" color="text-white/50" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-white/45 uppercase tracking-wider">Capacity</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={capacityInput}
                    onChange={e => setCapacityInput(e.target.value)}
                    className="w-20 px-2 py-1 text-[11px] font-mono bg-white/[0.04] border border-white/[0.08] rounded text-white/85 focus:outline-none focus:border-white/20"
                  />
                  <span className="text-[10px] font-mono text-white/30">Ah</span>
                  <button
                    type="button"
                    onClick={markFull}
                    className="ml-auto px-3 py-1 text-[10px] font-medium uppercase tracking-wider rounded bg-emerald-400/15 border border-emerald-400/30 text-emerald-300 hover:bg-emerald-400/20 transition-colors"
                    disabled={!latest}
                  >
                    Re-mark Full
                  </button>
                  <button
                    type="button"
                    onClick={toggleInvert}
                    className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                      cal.invert
                        ? 'bg-amber-400/15 border-amber-400/30 text-amber-300'
                        : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:text-white/80'
                    }`}
                    title="Flip sign if SOC moves the wrong way"
                  >
                    {cal.invert ? 'Inverted' : 'Invert'}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-white/45 uppercase tracking-wider">Capacity</label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={capacityInput}
                  onChange={e => setCapacityInput(e.target.value)}
                  className="w-20 px-2 py-1 text-[11px] font-mono bg-white/[0.04] border border-white/[0.08] rounded text-white/85 focus:outline-none focus:border-white/20"
                />
                <span className="text-[10px] font-mono text-white/30">Ah</span>
                <button
                  type="button"
                  onClick={markFull}
                  className="ml-auto px-3 py-1 text-[10px] font-medium uppercase tracking-wider rounded bg-emerald-400/15 border border-emerald-400/30 text-emerald-300 hover:bg-emerald-400/20 transition-colors disabled:opacity-40"
                  disabled={!latest}
                  title="Charge the pack to 100%, then click this to snapshot the current INA228 charge counter as the full-charge baseline"
                >
                  Mark as Full
                </button>
              </div>
            )}

            <div className="mt-2 text-[9px] text-white/25 leading-relaxed">
              Fully charge the pack, enter capacity, then <span className="text-white/45">Mark as Full</span>.
              SOC is computed from INA228 integrated charge minus baseline. If SOC moves the wrong direction, flip <span className="text-white/45">Invert</span>.
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
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

  const historyRef = useRef<Map<string, Sample[]>>(new Map());
  const dataRef = useRef<PowerState | null>(data);

  const [selected, setSelected] = useState<string | null>(null);
  // Bump to force the sidebar gauge to re-read calibration after the modal saves
  const [, setCalRev] = useState(0);
  const bumpCal = useCallback(() => setCalRev(n => n + 1), []);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    const id = setInterval(() => {
      const d = dataRef.current;
      if (!d) return;
      const now = Date.now();
      const cutoff = now - HISTORY_MS;
      for (const ch of d.channels) {
        let hist = historyRef.current.get(ch.label);
        if (!hist) {
          hist = [];
          historyRef.current.set(ch.label, hist);
        }
        hist.push({ t: now, w: ch.power_w, v: ch.voltage_v });
        while (hist.length && hist[0].t < cutoff) hist.shift();
      }
    }, SAMPLE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const getSamples = useCallback((key: string): Sample[] => {
    return historyRef.current.get(key) ?? [];
  }, []);

  const closeModal = useCallback(() => setSelected(null), []);

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

  const open = (key: string | undefined) => {
    if (!key) return;
    setSelected(key);
  };

  const selectedReading = selected ? data.channels.find(c => c.label === selected) : undefined;

  return (
    <div className="px-3.5 py-2.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-medium text-white/25 uppercase tracking-[0.1em]">Power</span>
        <span className={`text-[10px] font-mono ${netPower >= 0 ? 'text-emerald-400/60' : 'text-amber-400/60'}`}>
          {netPower >= 0 ? '+' : ''}{netPower.toFixed(1)}W net
        </span>
      </div>

      <div className="flex gap-2 mb-1">
        <SourceCard
          ch={solar}
          label="Solar"
          onClick={() => open(solar?.label)}
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
          onClick={() => open(dock?.label)}
          icon={
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
          }
        />
      </div>

      <div className="flex justify-around py-0.5">
        <FlowArrow direction="down" active={(solar?.power_w ?? 0) > 0.1 || (dock?.power_w ?? 0) > 0.1} />
        <FlowArrow direction="down" active={(solar?.power_w ?? 0) > 0.1 || (dock?.power_w ?? 0) > 0.1} />
      </div>

      <div className="flex gap-3 mb-1">
        <BatteryGauge ch={leftBat} label="Port Batt" onClick={() => open(leftBat?.label)} />
        <BatteryGauge ch={rightBat} label="Stbd Batt" onClick={() => open(rightBat?.label)} />
      </div>

      <div className="flex justify-around py-0.5">
        <FlowArrow direction="down" active={totalOut > 0.1} />
        <FlowArrow direction="down" active={totalOut > 0.1} />
      </div>

      <div className="flex gap-1 bg-white/[0.02] rounded-lg py-1.5 px-1 border border-white/[0.04]">
        <ConsumerCard ch={leftMotor} label="L Mot" onClick={() => open(leftMotor?.label)} />
        <div className="w-px bg-white/[0.06]" />
        <ConsumerCard ch={core} label="Core" onClick={() => open(core?.label)} />
        <div className="w-px bg-white/[0.06]" />
        <ConsumerCard ch={rightMotor} label="R Mot" onClick={() => open(rightMotor?.label)} />
      </div>

      {(payload || reel) && (
        <div className="flex gap-1 mt-1 bg-white/[0.02] rounded-lg py-1.5 px-1 border border-white/[0.04]">
          {payload && <ConsumerCard ch={payload} label="Payload" onClick={() => open(payload?.label)} />}
          {payload && reel && <div className="w-px bg-white/[0.06]" />}
          {reel && <ConsumerCard ch={reel} label="Reel" onClick={() => open(reel?.label)} />}
        </div>
      )}

      {selected && (
        <ChannelModal
          channelKey={selected}
          latest={selectedReading}
          getSamples={getSamples}
          onClose={closeModal}
          onCalibrationChange={bumpCal}
        />
      )}
    </div>
  );
}
