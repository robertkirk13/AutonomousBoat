import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useNavigation } from '../context/NavigationContext';
import { PowerPanel } from './PowerPanel';
import type { Ina228Reading, NetworkData } from '../types/index';

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
const mpsToMph = (mps: number) => (mps * 2.23694).toFixed(1);

/** Cardinal label for a heading in degrees. */
function cardinalDir(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

function formatCanId(id: number | null): string {
  return id == null ? '--' : `0x${id.toString(16).toUpperCase().padStart(3, '0')}`;
}

/** Compact SVG compass ring with tick marks and heading needle. */
function CompassRing({ heading, size = 80 }: { heading: number; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = cx * 0.8;
  const cardLen = r * 0.22;
  const tickLen = r * 0.13;
  const labelR = r + r * 0.19;
  const ticks = [];

  // 36 tick marks (every 10°), longer at cardinals
  for (let i = 0; i < 36; i++) {
    const deg = i * 10;
    const rad = ((deg - 90) * Math.PI) / 180;
    const isCardinal = deg % 90 === 0;
    const inner = r - (isCardinal ? cardLen : tickLen);
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

  const needleRad = ((heading - 90) * Math.PI) / 180;
  const needleLen = r - r * 0.06;
  const labelFontPx = Math.max(6, Math.round(size * 0.09));

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img" aria-label={`Compass heading ${Math.round(heading)} degrees`}>
      <title>{`Heading ${Math.round(heading)}°`}</title>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
      {ticks}
      {(['N', 'E', 'S', 'W'] as const).map((dir, i) => {
        const deg = i * 90;
        const rad = ((deg - 90) * Math.PI) / 180;
        return (
          <text
            key={dir}
            x={cx + labelR * Math.cos(rad)}
            y={cy + labelR * Math.sin(rad)}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={labelFontPx}
            className="fill-white/20 font-medium"
          >
            {dir}
          </text>
        );
      })}
      <line
        x1={cx}
        y1={cy}
        x2={cx + needleLen * Math.cos(needleRad)}
        y2={cy + needleLen * Math.sin(needleRad)}
        stroke="oklch(0.65 0.17 50)"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r={Math.max(1.25, size * 0.025)} fill="oklch(0.65 0.17 50)" opacity={0.6} />
    </svg>
  );
}

export default function TelemetryPanel() {
  const { boat, calibrateUpright, calibrateCompass, triggerGpsCalibration, triggerGpsCalibrationReset, rebootPi } = useNavigation();
  const uptimeSeconds = Math.floor(boat.uptime);
  const [motorModalOpen, setMotorModalOpen] = useState(false);

  const findChannel = (label: string) =>
    boat.power?.channels.find((ch) => ch.label === label);

  const leftMotor = findChannel('left_motor');
  const rightMotor = findChannel('right_motor');

  const leftThrust = boat.nav?.left_thrust ?? 0;
  const rightThrust = boat.nav?.right_thrust ?? 0;
  const payload = boat.payload;

  // Extract thermal readings by label
  const temp1 = boat.thermal?.temps.find((t) => t.label === 'board_temp_1');
  const temp2 = boat.thermal?.temps.find((t) => t.label === 'board_temp_2');
  const coreTemp = temp1 && temp2 ? (temp1.temp_c + temp2.temp_c) / 2 : temp1?.temp_c ?? temp2?.temp_c ?? null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Connection badge */}
      <div className="px-3.5 pt-3 pb-1.5 flex items-center gap-2">
        <div className={`w-1.5 h-1.5 rounded-full ${
          boat.boatOnline ? 'bg-teal animate-pulse' : 'bg-white/15'
        }`} />
        <span className="text-[10px] font-medium tracking-wide text-white/40">
          {boat.boatOnline ? 'LIVE' : 'OFFLINE'}
        </span>
        <ConnectionIcon
          network={boat.network}
          online={boat.boatOnline}
          latencyMs={boat.latencyMs}
        />
        {boat.uptime > 0 && (
          <span className="text-[10px] font-mono text-white/20 ml-auto">
            {Math.floor(uptimeSeconds / 60)}:{String(uptimeSeconds % 60).padStart(2, '0')}
          </span>
        )}
      </div>

      {/* Speed · Compass · Heading — single compact row */}
      <div className="px-3 py-1.5 flex items-center justify-between gap-1">
        <div className="flex flex-col items-start min-w-0">
          <span className="text-[8px] font-medium text-white/25 uppercase tracking-[0.1em]">Speed</span>
          <div className="flex items-baseline gap-0.5">
            <span className="text-2xl font-mono font-extralight text-white/90 tabular-nums leading-none">
              {mpsToKnots(boat.speed)}
            </span>
            <span className="text-[10px] text-white/25 font-light">kn</span>
          </div>
          <span className="text-[9px] font-medium text-teal/60 leading-tight mt-0.5 tabular-nums">
            {mpsToMph(boat.speed)} mph
          </span>
        </div>
        <CompassRing heading={boat.heading} size={64} />
        <div className="flex flex-col items-end min-w-0">
          <span className="text-[8px] font-medium text-white/25 uppercase tracking-[0.1em]">Heading</span>
          <div className="flex items-baseline gap-0.5">
            <span className="text-2xl font-mono font-light text-white/85 tabular-nums leading-none">
              {boat.heading.toFixed(0)}
            </span>
            <span className="text-[10px] text-white/30">&deg;</span>
          </div>
          <span className="text-[9px] font-medium text-teal/60 leading-tight mt-0.5">
            {cardinalDir(boat.heading)}
          </span>
        </div>
      </div>

      {/* Position + sats — one line. Position is hidden without a fix
          (sats == 0) since the value is unreliable / stale in that case. */}
      <div className="px-3.5 py-1 flex items-baseline justify-between text-[10px] font-mono tabular-nums">
        <span className="text-white/40">
          {boat.satellites > 0
            ? `${boat.position.lat.toFixed(5)}, ${boat.position.lng.toFixed(5)}`
            : <span className="text-white/20 italic">no fix</span>}
        </span>
        <span>
          <span className="text-white/25 uppercase tracking-wider mr-1 text-[9px]">Sats</span>
          <span className={boat.satellites >= 4 ? 'text-emerald-400' : boat.satellites > 0 ? 'text-amber-400' : 'text-red-400'}>
            {boat.satellites}
          </span>
        </span>
      </div>

      {boat.nav && (boat.nav.mode === 'running' || boat.nav.mode === 'holding') && (
        <div className="px-3.5 py-1 flex items-baseline justify-center gap-1.5 border-t border-white/[0.04]">
          <span className="text-[9px] text-white/25 uppercase tracking-wider">To WP</span>
          <span className="text-[10px] font-mono text-teal/60 tabular-nums">
            {boat.nav.distance_m.toFixed(0)}
            <span className="text-white/25 ml-0.5">m</span>
          </span>
        </div>
      )}

      <div className="h-px bg-white/[0.04] mx-3" />

      {/* Motors — with embedded temperature. Clickable to open control modal. */}
      <button
        type="button"
        onClick={() => setMotorModalOpen(true)}
        className="block w-full text-left hover:bg-white/[0.02] transition-colors"
      >
        <Section
          title="Motors"
          accent={(
            <span className="text-[9px] font-medium uppercase tracking-[0.1em] text-white/25">
              Open
            </span>
          )}
        >
          <div className="flex gap-2 mt-1">
            <MotorBar label="Port" thrust={leftThrust} current={leftMotor?.current_a ?? 0} temp={temp1?.temp_c ?? null} />
            <MotorBar label="Stbd" thrust={rightThrust} current={rightMotor?.current_a ?? 0} temp={temp2?.temp_c ?? null} />
          </div>
        </Section>
      </button>

      {motorModalOpen && (
        <MotorControlModal
          leftMotor={leftMotor}
          rightMotor={rightMotor}
          leftThrust={leftThrust}
          rightThrust={rightThrust}
          leftTemp={temp1?.temp_c ?? null}
          rightTemp={temp2?.temp_c ?? null}
          onClose={() => setMotorModalOpen(false)}
        />
      )}

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

      <div className="h-px bg-white/[0.04] mx-3" />
      <Section
        title="Payload"
        accent={(
          <span className={`text-[9px] font-medium uppercase tracking-[0.12em] ${
            payload?.connected ? 'text-teal/70' : payload ? 'text-amber-300/70' : 'text-white/20'
          }`}>
            {payload?.connected ? 'CAN Live' : payload ? 'Stale' : 'Waiting'}
          </span>
        )}
      >
        {payload ? (
          <>
            <div className="space-y-2">
              <PayloadMetric label="Temp" value={payload.temperature_f} unit="°F" min={32} max={100} precision={1} color="oklch(0.73 0.17 55)" />
              <PayloadMetric label="pH" value={payload.ph} unit="pH" min={0} max={14} precision={2} color="oklch(0.74 0.13 160)" />
              <PayloadMetric label="Conduct." value={payload.ec_ms_cm} unit="mS/cm" min={0} max={10} precision={2} color="oklch(0.74 0.15 250)" />
              <PayloadMetric label="Turbid." value={payload.turbidity_ntu} unit="NTU" min={0} max={1000} precision={1} color="oklch(0.71 0.17 210)" />
              <PayloadMetric label="Depth" value={payload.sonar_in} unit="in" min={0} max={120} precision={1} color="oklch(0.72 0.12 290)" />
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/[0.04] text-[9px] font-mono text-white/25">
              <span>{payload.rx_count} rx</span>
              <span>{formatCanId(payload.last_frame_id)}</span>
            </div>
          </>
        ) : (
          <div className="text-center py-4 text-white/15 text-xs">Waiting for payload CAN</div>
        )}
      </Section>

      {/* Calibration dropdown */}
      <div className="mt-auto">
        <div className="h-px bg-white/[0.04] mx-3" />
        <div className="px-3.5 py-2.5">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="w-full flex items-center justify-between px-2.5 py-2 text-[10px] font-medium tracking-wide rounded-lg bg-white/[0.04] border border-white/[0.06] text-white/50 hover:text-white/80 hover:bg-white/[0.08] transition-colors"
              >
                Calibrate
                <svg className="w-3 h-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="min-w-[160px] bg-[#1a1c24] border border-white/[0.08] rounded-xl p-1 shadow-xl shadow-black/50 backdrop-blur-xl z-[9999]"
                sideOffset={6}
                align="center"
                side="top"
              >
                <DropdownMenu.Item
                  className="flex items-center gap-2.5 px-2.5 py-2 text-[11px] font-medium text-white/60 hover:text-white/90 hover:bg-white/[0.06] rounded-lg outline-none cursor-pointer transition-colors"
                  onSelect={calibrateUpright}
                >
                  <svg className="w-3.5 h-3.5 text-white/35" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-4 4m4-4l4 4" />
                  </svg>
                  Set Upright
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="flex items-center gap-2.5 px-2.5 py-2 text-[11px] font-medium text-white/60 hover:text-white/90 hover:bg-white/[0.06] rounded-lg outline-none cursor-pointer transition-colors"
                  onSelect={calibrateCompass}
                >
                  <svg className="w-3.5 h-3.5 text-white/35" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l2.09 6.26L20 9.27l-5 3.64L16.18 20 12 16.9 7.82 20 9 12.91l-5-3.64 5.91-1.01L12 2z" />
                  </svg>
                  Set North
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="flex items-center gap-2.5 px-2.5 py-2 text-[11px] font-medium text-white/60 hover:text-white/90 hover:bg-white/[0.06] rounded-lg outline-none cursor-pointer transition-colors"
                  onSelect={triggerGpsCalibration}
                >
                  <svg className="w-3.5 h-3.5 text-white/35" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 4v12m-6-6h12" />
                  </svg>
                  Cal GPS
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="flex items-center gap-2.5 px-2.5 py-2 text-[11px] font-medium text-white/60 hover:text-white/90 hover:bg-white/[0.06] rounded-lg outline-none cursor-pointer transition-colors"
                  onSelect={triggerGpsCalibrationReset}
                >
                  <svg className="w-3.5 h-3.5 text-white/35" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
                  </svg>
                  Clear GPS
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="h-px bg-white/[0.06] my-1" />
                <DropdownMenu.Item
                  className="flex items-center gap-2.5 px-2.5 py-2 text-[11px] font-medium text-red-400/70 hover:text-red-400 hover:bg-red-500/[0.06] rounded-lg outline-none cursor-pointer transition-colors"
                  onSelect={rebootPi}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Reboot Pi
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact connection-type indicator with hover tooltip. Shows a wifi or
 * cellular glyph whose filled-bar count reflects signal strength. Tooltip
 * surfaces SSID, signal, IP, and link speed.
 */
function ConnectionIcon({
  network,
  online,
  latencyMs,
}: {
  network: NetworkData | null;
  online: boolean;
  latencyMs: number | null;
}) {
  // While we're offline or have never received a network packet, render a
  // muted placeholder so the row layout stays stable.
  const kind = network?.kind ?? 'none';
  const dim = !online || kind === 'none';
  const bars = signalBars(network);
  const tone = dim ? 'text-white/25' : kind === 'wifi' ? 'text-teal/70' : kind === 'cellular' ? 'text-amber-300/80' : 'text-white/55';

  const label = (() => {
    if (!online) return 'Boat offline';
    if (kind === 'none') return 'No uplink';
    if (kind === 'wifi') return network?.ssid ?? 'Wi-Fi';
    if (kind === 'cellular') return network?.operator ?? 'Cellular';
    if (kind === 'ethernet') return 'Ethernet';
    return 'Unknown';
  })();

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  // Recompute the tooltip anchor whenever it opens. Portalled to document.body
  // so the surrounding sidebar's overflow:hidden doesn't clip it.
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setAnchor({ top: rect.bottom + 6, left: rect.left });
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Connection: ${label}`}
        className={`flex items-center cursor-default outline-none ${tone}`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {kind === 'cellular' ? (
          <CellularGlyph bars={bars} />
        ) : kind === 'ethernet' ? (
          <EthernetGlyph />
        ) : (
          <WifiGlyph bars={bars} />
        )}
      </button>

      {open && anchor && createPortal(
        <div
          role="tooltip"
          style={{ position: 'fixed', top: anchor.top, left: anchor.left }}
          className="pointer-events-none z-[1100] w-44 rounded-xl border border-panel-border/60 bg-panel/70 px-2.5 py-2 shadow-2xl shadow-black/50 backdrop-blur-2xl"
        >
          <ConnectionTooltipBody
            network={network}
            online={online}
            label={label}
            latencyMs={latencyMs}
          />
        </div>,
        document.body,
      )}
    </>
  );
}

function ConnectionTooltipBody({
  network,
  online,
  label,
  latencyMs,
}: {
  network: NetworkData | null;
  online: boolean;
  label: string;
  latencyMs: number | null;
}) {
  const latencyRow =
    latencyMs != null ? (
      <TooltipRow label="RTT" value={`${Math.round(latencyMs)} ms`} />
    ) : null;

  if (!online) {
    return (
      <>
        <div className="text-[10px] text-white/40 mb-1.5">No telemetry from boat.</div>
        {latencyRow && <dl className="space-y-1 text-[10px] font-mono">{latencyRow}</dl>}
      </>
    );
  }
  if (!network || network.kind === 'none') {
    return (
      <>
        <div className="text-[10px] text-white/40 mb-1.5">No active uplink reported.</div>
        {latencyRow && <dl className="space-y-1 text-[10px] font-mono">{latencyRow}</dl>}
      </>
    );
  }
  return (
    <>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-[11px] font-semibold text-white/85 truncate">{label}</span>
        <span className="text-[9px] uppercase tracking-[0.14em] text-white/30">
          {network.kind === 'wifi' ? 'Wi-Fi' : network.kind === 'cellular' ? 'LTE' : 'Eth'}
        </span>
      </div>
      <dl className="space-y-1 text-[10px] font-mono">
        {network.signal_pct != null && (
          <TooltipRow label="Signal" value={`${network.signal_pct}%${network.signal_dbm != null ? ` (${network.signal_dbm} dBm)` : ''}`} />
        )}
        {network.kind === 'wifi' && network.ssid && (
          <TooltipRow label="SSID" value={network.ssid} />
        )}
        {network.kind === 'cellular' && network.operator && (
          <TooltipRow label="Carrier" value={network.operator} />
        )}
        {network.interface && <TooltipRow label="Iface" value={network.interface} />}
        {network.ip_addr && <TooltipRow label="IP" value={network.ip_addr} />}
        {network.link_speed_mbps != null && (
          <TooltipRow label="Link" value={`${network.link_speed_mbps.toFixed(0)} Mb/s`} />
        )}
        {latencyRow}
      </dl>
    </>
  );
}

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-white/35 uppercase tracking-wider text-[9px]">{label}</dt>
      <dd className="text-white/75 truncate text-right">{value}</dd>
    </div>
  );
}

/** Discretize signal strength into 0..4 bars. Null falls back to 1 (connected
 *  but unknown strength) so the icon renders something meaningful. */
function signalBars(network: NetworkData | null): number {
  if (!network || network.kind === 'none') return 0;
  const pct = network.signal_pct;
  if (pct == null) return 1;
  if (pct >= 75) return 4;
  if (pct >= 50) return 3;
  if (pct >= 25) return 2;
  if (pct > 0) return 1;
  return 0;
}

function WifiGlyph({ bars }: { bars: number }) {
  // Three nested arcs + a base dot. Active arcs scale with bar count.
  const activeOpacity = (i: number) => (bars >= i ? 1 : 0.18);
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" role="img" aria-hidden="true">
      <path d="M2 8.5a16 16 0 0 1 20 0" strokeWidth={2} strokeLinecap="round" opacity={activeOpacity(4)} />
      <path d="M5 12a12 12 0 0 1 14 0" strokeWidth={2} strokeLinecap="round" opacity={activeOpacity(3)} />
      <path d="M8 15.5a8 8 0 0 1 8 0" strokeWidth={2} strokeLinecap="round" opacity={activeOpacity(2)} />
      <circle cx={12} cy={19} r={1.4} fill="currentColor" stroke="none" opacity={activeOpacity(1)} />
    </svg>
  );
}

function CellularGlyph({ bars }: { bars: number }) {
  const heights = [
    { id: 'b1', h: 4 },
    { id: 'b2', h: 7 },
    { id: 'b3', h: 10 },
    { id: 'b4', h: 13 },
  ];
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" role="img" aria-hidden="true">
      {heights.map(({ id, h }, i) => (
        <rect
          key={id}
          x={3 + i * 5.2}
          y={20 - h}
          width={3.6}
          height={h}
          rx={0.6}
          fill="currentColor"
          opacity={bars >= i + 1 ? 1 : 0.18}
        />
      ))}
    </svg>
  );
}

function EthernetGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" role="img" aria-hidden="true">
      <rect x={5} y={4} width={14} height={10} rx={1.5} />
      <path d="M8 14v3M12 14v4M16 14v3" />
    </svg>
  );
}

function PayloadMetric({
  label,
  value,
  unit,
  min,
  max,
  precision,
  color,
}: {
  label: string;
  value: number | null;
  unit: string;
  min: number;
  max: number;
  precision: number;
  color: string;
}) {
  const ratio = value == null ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] text-white/35 uppercase tracking-wider">{label}</span>
        <span className={`text-sm font-mono tabular-nums ${value == null ? 'text-white/20' : 'text-white/85'}`}>
          {value == null ? '--' : value.toFixed(precision)}
          <span className="text-white/30 text-[9px] ml-0.5">{unit}</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${ratio * 100}%`,
            backgroundColor: color,
            opacity: value == null ? 0.12 : 0.75,
          }}
        />
      </div>
    </div>
  );
}

function MotorStatTile({ label, value, unit, color = 'text-white/80' }: {
  label: string;
  value: string;
  unit: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] text-white/35 uppercase tracking-wider">{label}</span>
      <span className={`font-mono text-sm ${color} tabular-nums`}>
        {value}
        <span className="text-white/30 text-[10px] ml-0.5">{unit}</span>
      </span>
    </div>
  );
}

function MotorStatsColumn({
  title,
  motor,
  commandedThrust,
  temp,
  sliderValue,
  onZero,
  canControl,
  align,
}: {
  title: string;
  motor: Ina228Reading | undefined;
  commandedThrust: number;
  temp: number | null;
  sliderValue: number;
  onZero: () => void;
  canControl: boolean;
  align: 'left' | 'right';
}) {
  const pct = Math.round(sliderValue * 100);
  const commandedPct = Math.round(commandedThrust * 100);
  const alignClass = align === 'right' ? 'text-right items-end' : 'text-left items-start';

  return (
    <div className={`flex-1 min-w-0 flex flex-col gap-2 bg-white/[0.02] rounded-xl border border-white/[0.04] p-3 ${alignClass}`}>
      <div className="flex items-baseline justify-between w-full">
        <span className="text-[11px] font-medium text-white/70 uppercase tracking-[0.1em]">{title}</span>
        <span className="text-[10px] font-mono text-white/30 tabular-nums">
          cmd {commandedPct > 0 ? '+' : ''}{commandedPct}%
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 w-full">
        <MotorStatTile
          label="Voltage"
          value={motor ? motor.voltage_v.toFixed(2) : '--'}
          unit="V"
        />
        <MotorStatTile
          label="Current"
          value={motor ? Math.abs(motor.current_a).toFixed(2) : '--'}
          unit="A"
          color={motor && Math.abs(motor.current_a) > 10 ? 'text-amber-400' : 'text-white/80'}
        />
        <MotorStatTile
          label="Power"
          value={motor ? Math.abs(motor.power_w).toFixed(1) : '--'}
          unit="W"
        />
        <MotorStatTile
          label="Temp"
          value={temp !== null ? temp.toFixed(1) : '--'}
          unit="°C"
          color={temp !== null && temp > 60 ? 'text-amber-400' : 'text-white/80'}
        />
      </div>

      <div className="flex-1" />

      <div className="w-full flex items-baseline justify-between">
        <span className="text-[9px] text-white/35 uppercase tracking-wider">Set</span>
        <span className="font-mono text-sm text-white/80 tabular-nums">
          {pct > 0 ? '+' : ''}{pct}
          <span className="text-white/30 text-[10px] ml-0.5">%</span>
        </span>
      </div>
      <button
        type="button"
        onClick={onZero}
        disabled={!canControl}
        className={`w-full py-1 rounded bg-white/[0.04] border border-white/[0.06] text-[10px] font-mono text-white/50 hover:bg-white/[0.08] hover:text-white/80 transition-colors ${
          canControl ? '' : 'opacity-30 cursor-not-allowed'
        }`}
      >
        Zero
      </button>
    </div>
  );
}

function VerticalThrustSlider({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  return (
    <input
      type="range"
      min={-100}
      max={100}
      step={1}
      value={Math.round(value * 100)}
      onChange={e => onChange(Number(e.target.value) / 100)}
      disabled={disabled}
      style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
      className={`h-full w-4 accent-teal ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
    />
  );
}

function MotorControlModal({
  leftMotor,
  rightMotor,
  leftThrust,
  rightThrust,
  leftTemp,
  rightTemp,
  onClose,
}: {
  leftMotor: Ina228Reading | undefined;
  rightMotor: Ina228Reading | undefined;
  leftThrust: number;
  rightThrust: number;
  leftTemp: number | null;
  rightTemp: number | null;
  onClose: () => void;
}) {
  const {
    controlMode,
    setControlMode,
    sendTeleop,
    reinitMotors,
    calibrateMotors,
    leftInverted,
    rightInverted,
    setLeftInverted,
    setRightInverted,
  } = useNavigation();
  const [leftCmd, setLeftCmd] = useState(0);
  const [rightCmd, setRightCmd] = useState(0);
  const [linked, setLinked] = useState(false);
  const [reinitAt, setReinitAt] = useState<number | null>(null);
  const [calAt, setCalAt] = useState<number | null>(null);
  const leftRef = useRef(leftCmd);
  const rightRef = useRef(rightCmd);
  leftRef.current = leftCmd;
  rightRef.current = rightCmd;

  const canControl = controlMode === 'teleop';
  // Firmware holds neutral for ESC_BRINGUP_NEUTRAL_TIME = 3s. Match that here so the UI
  // reflects the blocked-input window.
  const REINIT_WINDOW_MS = 3000;
  // Calibration: MAX (3s) + MIN (3s) + NEUTRAL re-arm (3s) = 9s. Match firmware config.rs.
  const CAL_MAX_MS = 3000;
  const CAL_MIN_MS = 3000;
  const CAL_NEUTRAL_MS = 3000;
  const CAL_WINDOW_MS = CAL_MAX_MS + CAL_MIN_MS + CAL_NEUTRAL_MS;
  const reinitInProgress = reinitAt !== null && Date.now() - reinitAt < REINIT_WINDOW_MS;
  const calInProgress = calAt !== null && Date.now() - calAt < CAL_WINDOW_MS;
  const inputsLocked = reinitInProgress || calInProgress;
  const calElapsed = calAt !== null ? Date.now() - calAt : 0;
  const calPhase: 'max' | 'min' | 'neutral' | null = !calInProgress
    ? null
    : calElapsed < CAL_MIN_MS
      ? 'min'
      : calElapsed < CAL_MIN_MS + CAL_MAX_MS
        ? 'max'
        : 'neutral';

  // Continuously stream commanded thrust while in teleop — matches Sidebar's 10Hz cadence.
  // Skip during reinit/calibration so the sliders can't push commands into the firmware
  // while it's holding fixed PWM.
  useEffect(() => {
    if (!canControl || inputsLocked) return;
    const id = setInterval(() => {
      sendTeleop(leftRef.current, rightRef.current);
    }, 100);
    return () => clearInterval(id);
  }, [canControl, inputsLocked, sendTeleop]);

  const stopAll = useCallback(() => {
    setLeftCmd(0);
    setRightCmd(0);
    if (canControl) sendTeleop(0, 0);
  }, [canControl, sendTeleop]);

  // Keyboard shortcuts: Esc closes, Space e-stops (even if focus is on a slider).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.code === 'Space') {
        // Swallow the space press so it doesn't nudge a focused range slider.
        e.preventDefault();
        stopAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, stopAll]);

  const setLeft = useCallback((v: number) => {
    if (inputsLocked) return;
    setLeftCmd(v);
    if (linked) setRightCmd(v);
  }, [linked, inputsLocked]);

  const setRight = useCallback((v: number) => {
    if (inputsLocked) return;
    setRightCmd(v);
    if (linked) setLeftCmd(v);
  }, [linked, inputsLocked]);

  const setBoth = useCallback((v: number) => {
    if (inputsLocked) return;
    setLeftCmd(v);
    setRightCmd(v);
    if (canControl) sendTeleop(v, v);
  }, [canControl, inputsLocked, sendTeleop]);

  const handleReinit = useCallback(() => {
    // Zero sliders first so stale values don't snap the motors on when the arming window ends.
    setLeftCmd(0);
    setRightCmd(0);
    if (canControl) sendTeleop(0, 0);
    reinitMotors();
    setReinitAt(Date.now());
  }, [canControl, reinitMotors, sendTeleop]);

  const handleCalibrate = useCallback(() => {
    const ok = window.confirm(
      'ESC endpoint calibration\n\n' +
      '⚠  Props MUST be OFF the motor shafts.\n\n' +
      'This teaches both ESCs full-reverse and full-forward. The boat will send:\n' +
      '  • MIN for 3s\n' +
      '  • MAX for 3s\n' +
      '  • NEUTRAL for 3s (re-arm)\n\n' +
      'Continue?'
    );
    if (!ok) return;
    setLeftCmd(0);
    setRightCmd(0);
    if (canControl) sendTeleop(0, 0);
    calibrateMotors();
    setCalAt(Date.now());
  }, [canControl, calibrateMotors, sendTeleop]);

  // Tick so the "Arming…" / calibration labels update as time elapses.
  useEffect(() => {
    if (!inputsLocked) return;
    const id = setInterval(() => {
      if (reinitAt !== null && Date.now() - reinitAt >= REINIT_WINDOW_MS) {
        setReinitAt(null);
      }
      if (calAt !== null && Date.now() - calAt >= CAL_WINDOW_MS) {
        setCalAt(null);
      }
    }, 100);
    return () => clearInterval(id);
  }, [reinitAt, calAt, inputsLocked, CAL_WINDOW_MS]);

  const takeControl = () => {
    setControlMode('teleop');
  };

  const releaseControl = () => {
    setLeftCmd(0);
    setRightCmd(0);
    sendTeleop(0, 0);
    setControlMode('autonomous');
  };

  return createPortal(
    <div className="fixed inset-0 z-[1999] pointer-events-auto bg-black/40" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(60vw,calc(100vw-34rem))] aspect-[4/3] max-h-[85vh] z-[2000] pointer-events-auto rounded-2xl bg-panel/95 backdrop-blur-xl border border-panel-border/60 shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] gap-3">
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-medium text-white/35 uppercase tracking-[0.1em]">Motors</span>
            <span className="text-sm text-white/85 font-medium">Manual Control</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-mono px-2 py-1 rounded border ${
              canControl
                ? 'bg-amber-400/10 border-amber-400/30 text-amber-300'
                : 'bg-white/[0.04] border-white/[0.08] text-white/50'
            }`}>
              {canControl ? 'TELEOP' : 'AUTONOMOUS'}
            </span>
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

        {/* Stats on outer edges, sliders paired in the middle */}
        <div className="flex-1 min-h-0 px-4 py-3 flex gap-3 items-stretch">
          <MotorStatsColumn
            title="Port"
            motor={leftMotor}
            commandedThrust={leftThrust}
            temp={leftTemp}
            sliderValue={leftCmd}
            onZero={() => setLeft(0)}
            canControl={canControl}
            align="left"
          />

          <div className="flex flex-col items-center gap-2 py-1">
            <div className="flex items-stretch gap-2 flex-1 min-h-0">
              <div className="flex flex-col justify-between text-[9px] font-mono text-white/25 tabular-nums">
                <span>+100</span>
                <span>0</span>
                <span>-100</span>
              </div>
              <VerticalThrustSlider value={leftCmd} onChange={setLeft} disabled={!canControl || inputsLocked} />
              <VerticalThrustSlider value={rightCmd} onChange={setRight} disabled={!canControl || inputsLocked} />
              <div className="flex flex-col justify-between text-[9px] font-mono text-white/25 tabular-nums">
                <span>+100</span>
                <span>0</span>
                <span>-100</span>
              </div>
            </div>
            <div className="flex flex-col gap-1 w-full">
              <button
                type="button"
                onClick={() => setBoth(1)}
                disabled={!canControl || inputsLocked}
                className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                  !canControl || inputsLocked
                    ? 'bg-white/[0.02] border-white/[0.06] text-white/25 cursor-not-allowed'
                    : 'bg-teal/10 border-teal/25 text-teal/85 hover:bg-teal/20 hover:text-teal'
                }`}
                title="Full forward (+100%) on both motors"
              >
                +100
              </button>
              <button
                type="button"
                onClick={() => setBoth(0)}
                disabled={!canControl || inputsLocked}
                className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                  !canControl || inputsLocked
                    ? 'bg-white/[0.02] border-white/[0.06] text-white/25 cursor-not-allowed'
                    : 'bg-white/[0.04] border-white/[0.08] text-white/60 hover:bg-white/[0.08] hover:text-white/90'
                }`}
                title="Neutral (0%) on both motors"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => setBoth(-1)}
                disabled={!canControl || inputsLocked}
                className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                  !canControl || inputsLocked
                    ? 'bg-white/[0.02] border-white/[0.06] text-white/25 cursor-not-allowed'
                    : 'bg-amber-400/10 border-amber-400/25 text-amber-300/85 hover:bg-amber-400/20 hover:text-amber-300'
                }`}
                title="Full reverse (-100%) on both motors"
              >
                -100
              </button>
            </div>
          </div>

          <MotorStatsColumn
            title="Stbd"
            motor={rightMotor}
            commandedThrust={rightThrust}
            temp={rightTemp}
            sliderValue={rightCmd}
            onZero={() => setRight(0)}
            canControl={canControl}
            align="right"
          />
        </div>

        {/* Control bar: STOP centered and dominant, secondary actions flanking */}
        <div className="px-4 py-3 border-t border-white/[0.06] bg-black/20 grid grid-cols-3 items-center gap-2">
          {/* Left — secondary controls */}
          <div className="flex items-center gap-2 justify-start">
            <button
              type="button"
              onClick={() => setLinked(l => !l)}
              className={`px-2.5 py-1.5 text-[10px] font-mono rounded border transition-colors ${
                linked
                  ? 'bg-teal/15 border-teal/30 text-teal'
                  : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:text-white/80'
              }`}
              title="Link both sliders so they move together"
            >
              {linked ? 'Linked' : 'Link'}
            </button>
            <button
              type="button"
              onClick={() => setLeftInverted(!leftInverted)}
              className={`px-2.5 py-1.5 text-[10px] font-mono rounded border transition-colors ${
                leftInverted
                  ? 'bg-amber-400/15 border-amber-400/30 text-amber-300'
                  : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:text-white/80'
              }`}
              title="Flip port motor direction (swap forward/reverse)"
            >
              {leftInverted ? 'Port ⇄' : 'Port →'}
            </button>
            <button
              type="button"
              onClick={() => setRightInverted(!rightInverted)}
              className={`px-2.5 py-1.5 text-[10px] font-mono rounded border transition-colors ${
                rightInverted
                  ? 'bg-amber-400/15 border-amber-400/30 text-amber-300'
                  : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:text-white/80'
              }`}
              title="Flip starboard motor direction (swap forward/reverse)"
            >
              {rightInverted ? 'Stbd ⇄' : 'Stbd →'}
            </button>
            <button
              type="button"
              onClick={handleReinit}
              disabled={inputsLocked}
              className={`px-2.5 py-1.5 text-[10px] font-mono rounded border transition-colors ${
                reinitInProgress
                  ? 'bg-amber-400/10 border-amber-400/20 text-amber-300/60 cursor-not-allowed'
                  : inputsLocked
                    ? 'bg-white/[0.02] border-white/[0.06] text-white/30 cursor-not-allowed'
                    : 'bg-white/[0.04] border-white/[0.08] text-white/60 hover:bg-white/[0.08] hover:text-white/90'
              }`}
              title="Re-arm both ESCs by holding neutral PWM for 3 seconds"
            >
              {reinitInProgress ? 'Arming…' : 'Reinit ESCs'}
            </button>
            <button
              type="button"
              onClick={handleCalibrate}
              disabled={inputsLocked}
              className={`px-2.5 py-1.5 text-[10px] font-mono rounded border transition-colors ${
                calInProgress
                  ? 'bg-orange-400/15 border-orange-400/30 text-orange-300 cursor-not-allowed'
                  : inputsLocked
                    ? 'bg-white/[0.02] border-white/[0.06] text-white/30 cursor-not-allowed'
                    : 'bg-white/[0.04] border-white/[0.08] text-white/60 hover:bg-white/[0.08] hover:text-white/90'
              }`}
              title="Teach ESCs min/max PWM endpoints. Props MUST be off."
            >
              {calInProgress
                ? calPhase === 'min' ? 'Cal: MIN' : calPhase === 'max' ? 'Cal: MAX' : 'Cal: ARM'
                : 'Calibrate'}
            </button>
          </div>

          {/* Center — dominant Stop */}
          <div className="flex flex-col items-center">
            <button
              type="button"
              onClick={stopAll}
              className="w-full max-w-[14rem] py-3 text-sm font-bold uppercase tracking-[0.2em] rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 hover:bg-red-500/30 hover:border-red-500/60 active:bg-red-500/40 transition-colors shadow-lg shadow-red-500/10"
              title="Stop both motors (hotkey: Space)"
            >
              Stop
            </button>
            <span className="mt-1 text-[9px] font-mono text-white/25 uppercase tracking-wider">
              Space
            </span>
          </div>

          {/* Right — mode toggle */}
          <div className="flex items-center justify-end">
            {canControl ? (
              <button
                type="button"
                onClick={releaseControl}
                className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider rounded bg-white/[0.06] border border-white/[0.1] text-white/70 hover:text-white/90 hover:bg-white/[0.1] transition-colors"
              >
                Release
              </button>
            ) : (
              <button
                type="button"
                onClick={takeControl}
                className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider rounded bg-amber-400/15 border border-amber-400/30 text-amber-300 hover:bg-amber-400/20 transition-colors"
                title="Stops the mission and lets these sliders drive the motors"
              >
                Take Control
              </button>
            )}
          </div>
        </div>

        {(!canControl || inputsLocked) && (
          <div className="px-4 py-2 border-t border-white/[0.06] text-[10px] text-white/35 leading-relaxed">
            {calInProgress ? (
              <>
                <span className="text-orange-300/90">Calibrating ESC endpoints</span> —
                {' '}{calPhase === 'min' ? 'holding MIN (full reverse)' : calPhase === 'max' ? 'holding MAX (full forward)' : 'returning to neutral (re-arm)'}.
                {' '}Props must be off. Sliders are locked for ~{Math.max(0, Math.ceil((CAL_WINDOW_MS - calElapsed) / 1000))}s.
              </>
            ) : reinitInProgress ? (
              <>
                <span className="text-amber-300/80">Holding neutral PWM</span> — ESCs re-arming. Sliders are locked and will not send thrust for ~3s.
              </>
            ) : (
              <>
                Sliders are read-only while autonomous. Click <span className="text-white/65">Take Control</span> to drive. Sends at 10Hz while held in teleop.
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
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
      <div className="h-5 bg-white/[0.04] rounded-lg overflow-hidden relative">
        <div
          className="absolute inset-y-0 left-0 bg-teal/25 transition-all duration-300 rounded-lg"
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
