import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import { useNavigation } from '../context/NavigationContext';
import { MEASUREMENT_CONFIGS } from '../types/index';
import type { Waypoint, SavedMission, MissionSchedule, ScheduleRepeat } from '../types/index';

const SPACING_PRESETS = [5, 10, 15, 20, 25];
const ANGLE_PRESETS = [0, 45, 90, 135];

/* ── Shared atoms ── */

function SectionHeader({
  title,
  right,
  onClick,
  expandable,
  expanded,
}: {
  title: string;
  right?: React.ReactNode;
  onClick?: () => void;
  expandable?: boolean;
  expanded?: boolean;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`flex items-center justify-between w-full ${onClick ? 'cursor-pointer' : ''}`}
    >
      <span className="text-[9px] font-medium text-white/30 uppercase tracking-[0.12em]">{title}</span>
      <div className="flex items-center gap-2">
        {right}
        {expandable && (
          <svg
            className={`w-3 h-3 text-white/25 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>
    </Tag>
  );
}

function SegmentedControl<T extends string>({ value, onChange, options, disabled }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; accent?: 'teal' | 'amber' | 'neutral' }[];
  disabled?: boolean;
}) {
  return (
    <div className="flex bg-white/[0.04] rounded-xl p-0.5 gap-0.5">
      {options.map(opt => {
        const active = value === opt.value;
        const accent = opt.accent ?? 'neutral';
        const activeClass =
          accent === 'teal' ? 'bg-teal-dim/30 text-teal'
          : accent === 'amber' ? 'bg-amber-500/15 text-amber-300'
          : 'bg-white/[0.08] text-white/85';
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => !disabled && onChange(opt.value)}
            disabled={disabled}
            className={`flex-1 py-1.5 text-[11px] font-medium tracking-wide rounded-lg transition-colors ${
              active ? activeClass : 'text-white/40 hover:text-white/65'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function IconButton({
  label, onClick, disabled, tone = 'neutral', children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'neutral' | 'danger' | 'teal';
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'danger' ? 'text-red-400/70 hover:text-red-400 hover:bg-red-500/10'
    : tone === 'teal' ? 'text-teal/85 hover:text-teal hover:bg-teal/10'
    : 'text-white/40 hover:text-white/75 hover:bg-white/[0.06]';
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`w-6 h-6 flex items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${toneClass}`}
    >
      {children}
    </button>
  );
}

/* ── Teleop Controls ── */

const THRUST = 0.7;
const TURN_THRUST = 0.5;
const SEND_HZ = 10;

type Direction = 'forward' | 'back' | 'left' | 'right';

function dirToMotor(dirs: Set<Direction>): { left: number; right: number } {
  let left = 0;
  let right = 0;
  if (dirs.has('forward')) { left += THRUST; right += THRUST; }
  if (dirs.has('back')) { left -= THRUST; right -= THRUST; }
  if (dirs.has('left')) { left -= TURN_THRUST; right += TURN_THRUST; }
  if (dirs.has('right')) { left += TURN_THRUST; right -= TURN_THRUST; }
  return {
    left: Math.max(-1, Math.min(1, left)),
    right: Math.max(-1, Math.min(1, right)),
  };
}

const KEY_MAP: Record<string, Direction> = {
  w: 'forward', arrowup: 'forward',
  s: 'back', arrowdown: 'back',
  a: 'left', arrowleft: 'left',
  d: 'right', arrowright: 'right',
};

function TeleopControls() {
  const { sendTeleop } = useNavigation();
  const [speed, setSpeed] = useState(70);
  const [directControlArmed, setDirectControlArmed] = useState(false);
  const [directLeft, setDirectLeft] = useState(0);
  const [directRight, setDirectRight] = useState(0);
  const activeKeys = useRef(new Set<Direction>());
  const activeTouch = useRef(new Set<Direction>());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speedRef = useRef(speed);
  const directControlRef = useRef(directControlArmed);
  const directLeftRef = useRef(directLeft);
  const directRightRef = useRef(directRight);
  speedRef.current = speed;
  directControlRef.current = directControlArmed;
  directLeftRef.current = directLeft;
  directRightRef.current = directRight;

  const clearDirectionalInput = useCallback(() => {
    activeKeys.current.clear();
    activeTouch.current.clear();
  }, []);

  const resolveCommand = useCallback(() => {
    if (directControlRef.current) {
      return {
        left: directLeftRef.current,
        right: directRightRef.current,
      };
    }
    const merged = new Set([...activeKeys.current, ...activeTouch.current]);
    const { left, right } = dirToMotor(merged);
    const scale = speedRef.current / 100;
    return { left: left * scale, right: right * scale };
  }, []);

  const sendCurrent = useCallback(() => {
    const { left, right } = resolveCommand();
    sendTeleop(left, right);
  }, [resolveCommand, sendTeleop]);

  const updateLoop = useCallback(() => {
    const hasDirectionalInput = activeKeys.current.size > 0 || activeTouch.current.size > 0;
    const needsHeartbeat = directControlRef.current || hasDirectionalInput;
    if (needsHeartbeat && !intervalRef.current) {
      sendCurrent();
      intervalRef.current = setInterval(sendCurrent, 1000 / SEND_HZ);
    } else if (!needsHeartbeat && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
      sendTeleop(0, 0);
    }
  }, [sendCurrent, sendTeleop]);

  const stopAll = useCallback(() => {
    clearDirectionalInput();
    setDirectLeft(0);
    setDirectRight(0);
    setDirectControlArmed(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    sendTeleop(0, 0);
  }, [clearDirectionalInput, sendTeleop]);

  const setDirectMode = useCallback((armed: boolean) => {
    clearDirectionalInput();
    setDirectControlArmed(armed);
    if (!armed) {
      setDirectLeft(0);
      setDirectRight(0);
    }
  }, [clearDirectionalInput]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (directControlRef.current) return;
      const dir = KEY_MAP[e.key.toLowerCase()];
      if (!dir) return;
      e.preventDefault();
      activeKeys.current.add(dir);
      updateLoop();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const dir = KEY_MAP[e.key.toLowerCase()];
      if (!dir) return;
      activeKeys.current.delete(dir);
      updateLoop();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      clearDirectionalInput();
      sendTeleop(0, 0);
    };
  }, [clearDirectionalInput, sendTeleop, updateLoop]);

  useEffect(() => {
    if (directControlArmed) {
      sendCurrent();
    }
    updateLoop();
  }, [directControlArmed, directLeft, directRight, sendCurrent, updateLoop]);

  const touchStart = (dir: Direction) => {
    if (directControlRef.current) return;
    activeTouch.current.add(dir);
    updateLoop();
  };
  const touchEnd = (dir: Direction) => {
    activeTouch.current.delete(dir);
    updateLoop();
  };

  return (
    <div className="px-3.5 py-3 space-y-4">
      <div>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <span className="text-[9px] font-medium text-white/25 uppercase tracking-[0.1em]">Speed</span>
            <div className="text-[10px] text-white/20 mt-1">
              {directControlArmed ? 'Direct motor mix overrides the D-pad' : 'Keyboard and touch steering mix'}
            </div>
          </div>
          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                type="button"
                className={`shrink-0 rounded-xl border px-2.5 py-2 text-[10px] font-medium transition-colors ${
                  directControlArmed
                    ? 'border-amber-400/35 bg-amber-500/12 text-amber-300'
                    : 'border-white/[0.08] bg-white/[0.04] text-white/55 hover:bg-white/[0.07] hover:text-white/75'
                }`}
              >
                Direct Mix
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="top"
                align="end"
                sideOffset={10}
                className="w-[18rem] rounded-2xl border border-white/[0.08] bg-[#171922]/95 p-3 shadow-2xl shadow-black/50 backdrop-blur-xl z-[10000]"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="text-[11px] font-semibold tracking-wide text-white/80">Direct Motor Mix</div>
                    <div className="text-[10px] text-white/35 mt-1">
                      Sends left and right throttle directly. Use this for ESC bringup, trim, and bench checks.
                    </div>
                  </div>
                  <div className={`mt-0.5 rounded-full px-2 py-1 text-[9px] font-medium uppercase tracking-[0.14em] ${
                    directControlArmed ? 'bg-amber-500/12 text-amber-300' : 'bg-white/[0.05] text-white/30'
                  }`}>
                    {directControlArmed ? 'Live' : 'Idle'}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setDirectMode(!directControlArmed)}
                  className={`w-full rounded-xl px-3 py-2 text-[11px] font-semibold transition-colors ${
                    directControlArmed
                      ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/22'
                      : 'bg-white/[0.05] text-white/70 hover:bg-white/[0.08]'
                  }`}
                >
                  {directControlArmed ? 'Release Direct Control' : 'Arm Direct Control'}
                </button>

                <div className={`mt-3 space-y-3 transition-opacity ${directControlArmed ? 'opacity-100' : 'opacity-45'}`}>
                  <DirectMotorSlider
                    label="Left Motor"
                    value={directLeft}
                    accent="#f59e0b"
                    disabled={!directControlArmed}
                    onChange={setDirectLeft}
                  />
                  <DirectMotorSlider
                    label="Right Motor"
                    value={directRight}
                    accent="#14b8a6"
                    disabled={!directControlArmed}
                    onChange={setDirectRight}
                  />
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDirectLeft(0);
                      setDirectRight(0);
                      if (directControlArmed) {
                        sendCurrent();
                      }
                    }}
                    className="flex-1 rounded-xl bg-white/[0.05] px-3 py-2 text-[10px] font-medium text-white/65 hover:bg-white/[0.08] hover:text-white/80 transition-colors"
                  >
                    Center
                  </button>
                  <button
                    type="button"
                    onClick={stopAll}
                    className="flex-1 rounded-xl bg-red-500/14 px-3 py-2 text-[10px] font-semibold text-red-300 hover:bg-red-500/20 transition-colors"
                  >
                    Stop
                  </button>
                </div>

                <Popover.Arrow className="fill-[#171922]" />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
        <div className={directControlArmed ? 'opacity-40' : ''}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-medium text-white/25 uppercase tracking-[0.1em]">D-Pad Scale</span>
            <span className="text-xs font-mono text-amber-400/80 tabular-nums">{speed}%</span>
          </div>
          <input
            type="range"
            min="10"
            max="100"
            step="10"
            value={speed}
            disabled={directControlArmed}
            onChange={e => setSpeed(Number(e.target.value))}
            className="w-full h-1.5 appearance-none bg-white/[0.06] rounded-full disabled:cursor-not-allowed"
            style={{ accentColor: '#f59e0b' }}
          />
          <div className="flex justify-between mt-1 text-[9px] font-mono text-white/15">
            <span>10%</span>
            <span>100%</span>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] font-medium text-white/25 uppercase tracking-[0.1em]">Direction</span>
          <span className="text-[9px] font-mono text-white/20">{directControlArmed ? 'Paused' : 'WASD'}</span>
        </div>
        <div className={`flex flex-col items-center gap-1 ${directControlArmed ? 'opacity-40' : ''}`}>
          <DPadButton dir="forward" label="W" icon="up" disabled={directControlArmed} onStart={touchStart} onEnd={touchEnd} />
          <div className="flex gap-1">
            <DPadButton dir="left" label="A" icon="left" disabled={directControlArmed} onStart={touchStart} onEnd={touchEnd} />
            <button
              type="button"
              onMouseDown={stopAll}
              onTouchStart={(e) => { e.preventDefault(); stopAll(); }}
              className="w-11 h-11 rounded-xl bg-red-500/15 hover:bg-red-500/25 active:bg-red-500/35 border border-red-500/25 flex items-center justify-center transition-colors"
            >
              <svg className="w-4 h-4 text-red-400/70" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
            <DPadButton dir="right" label="D" icon="right" disabled={directControlArmed} onStart={touchStart} onEnd={touchEnd} />
          </div>
          <DPadButton dir="back" label="S" icon="down" disabled={directControlArmed} onStart={touchStart} onEnd={touchEnd} />
        </div>
      </div>
    </div>
  );
}

function DPadButton({ dir, label, icon, disabled = false, onStart, onEnd }: {
  dir: Direction;
  label: string;
  icon: 'up' | 'down' | 'left' | 'right';
  disabled?: boolean;
  onStart: (dir: Direction) => void;
  onEnd: (dir: Direction) => void;
}) {
  const rotation = { up: 0, right: 90, down: 180, left: 270 }[icon];

  return (
    <button
      type="button"
      onMouseDown={() => !disabled && onStart(dir)}
      onMouseUp={() => !disabled && onEnd(dir)}
      onMouseLeave={() => !disabled && onEnd(dir)}
      onTouchStart={(e) => { e.preventDefault(); if (!disabled) onStart(dir); }}
      onTouchEnd={(e) => { e.preventDefault(); if (!disabled) onEnd(dir); }}
      className={`w-11 h-11 rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-colors ${
        disabled
          ? 'bg-white/[0.02] border-white/[0.04] text-white/20 cursor-not-allowed'
          : 'bg-white/[0.04] hover:bg-white/[0.08] active:bg-white/[0.14] border-white/[0.06]'
      }`}
    >
      <svg
        className={`w-3.5 h-3.5 ${disabled ? 'text-white/20' : 'text-white/45'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
      </svg>
      <span className={`text-[8px] font-mono ${disabled ? 'text-white/10' : 'text-white/20'}`}>{label}</span>
    </button>
  );
}

function DirectMotorSlider({
  label, value, accent, disabled, onChange,
}: {
  label: string;
  value: number;
  accent: string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const percent = Math.round(value * 100);
  const text = `${percent > 0 ? '+' : ''}${percent}%`;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-medium text-white/55">{label}</span>
        <span className="text-[10px] font-mono text-white/70 tabular-nums">{text}</span>
      </div>
      <input
        type="range"
        min="-100"
        max="100"
        step="1"
        value={percent}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="w-full h-1.5 appearance-none bg-white/[0.06] rounded-full disabled:cursor-not-allowed"
        style={{ accentColor: accent }}
      />
      <div className="mt-1 flex justify-between text-[9px] font-mono text-white/18">
        <span>REV</span>
        <span>NEUTRAL</span>
        <span>FWD</span>
      </div>
    </div>
  );
}

/* ── Mission Controls (autonomous mode) ── */

function MissionControls() {
  const { boat, mission, startMission, pauseMission, resumeMission, stopMission, clearWaypoints } = useNavigation();

  const completed = mission.waypoints.filter(wp => wp.completed).length;
  const total = mission.waypoints.length;
  const isActive = mission.status === 'running' || mission.status === 'paused';
  const navHolding = boat.nav?.mode === 'holding';
  const navProgress = boat.nav && (boat.nav.mode === 'running' || boat.nav.mode === 'holding')
    ? boat.nav
    : null;

  const primaryBtn = "flex-1 px-3 py-1.5 rounded-lg bg-teal/15 text-teal hover:bg-teal/25 disabled:bg-white/[0.04] disabled:text-white/25 text-[11px] font-medium tracking-wide transition-colors";
  const ghostBtn = "px-2.5 py-1.5 rounded-lg bg-white/[0.04] text-white/55 hover:bg-white/[0.08] hover:text-white/80 text-[11px] font-medium transition-colors";
  const warningBtn = "flex-1 px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 text-[11px] font-medium tracking-wide transition-colors";
  const dangerBtn = "px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-300/85 hover:bg-red-500/20 text-[11px] font-medium transition-colors";

  return (
    <div className="px-3.5 py-2.5">
      {isActive && (
        <div className="mb-2.5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              {mission.status === 'running' && (
                <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${navHolding ? 'bg-amber-400' : 'bg-teal'}`} />
              )}
              <span className="text-[10px] font-medium text-white/55 tracking-wide">
                {mission.status === 'paused'
                  ? 'Paused'
                  : navHolding
                  ? 'Holding for Sensors'
                  : 'Navigating'}
              </span>
            </div>
            <span className="text-[10px] font-mono text-white/35 tabular-nums">{completed}/{total}</span>
          </div>
          <div className="h-0.5 bg-white/[0.05] rounded-full overflow-hidden">
            <div
              className="h-full bg-teal/55 rounded-full transition-all duration-500"
              style={{ width: total > 0 ? `${(completed / total) * 100}%` : '0%' }}
            />
          </div>
          {navProgress && (
            <div className="mt-1 text-[10px] font-mono text-white/30 tabular-nums">
              {navProgress.distance_m.toFixed(0)}m to WP {navProgress.target_wp + 1}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-1">
        {mission.status === 'idle' || mission.status === 'planning' ? (
          <>
            <button onClick={startMission} disabled={total === 0} className={primaryBtn}>
              Start Mission
            </button>
            {total > 0 && (
              <button onClick={clearWaypoints} className={ghostBtn}>
                Clear
              </button>
            )}
          </>
        ) : mission.status === 'running' ? (
          <>
            <button onClick={pauseMission} className={warningBtn}>
              Pause
            </button>
            <button onClick={stopMission} className={dangerBtn}>
              Stop
            </button>
          </>
        ) : mission.status === 'paused' ? (
          <>
            <button onClick={resumeMission} className={primaryBtn}>
              Resume
            </button>
            <button onClick={stopMission} className={dangerBtn}>
              Stop
            </button>
          </>
        ) : (
          <button onClick={clearWaypoints} className={primaryBtn}>
            New Mission
          </button>
        )}
      </div>
    </div>
  );
}

function CoveragePane() {
  const {
    mission, clickMode, setClickMode,
    areaCoverage, updateAreaCoverage, clearPolygon, removeLastPolygonVertex, generateCoveragePath,
  } = useNavigation();

  const canEdit = mission.status === 'idle' || mission.status === 'planning';
  const active = clickMode === 'area';
  const canGenerate = areaCoverage.polygon.length >= 3;

  return (
    <div className="px-3.5 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-medium text-white/30 uppercase tracking-[0.12em]">Coverage</span>
        <button
          type="button"
          onClick={() => canEdit && setClickMode(active ? 'none' : 'area')}
          disabled={!canEdit}
          className={`text-[10px] px-2 py-0.5 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
            active
              ? 'bg-teal/15 text-teal hover:bg-teal/25'
              : 'bg-white/[0.05] text-white/55 hover:text-white/80 hover:bg-white/[0.08]'
          }`}
        >
          {active ? 'Done' : 'Outline area'}
        </button>
      </div>

      {active && (
        <div className="mt-2 space-y-2">
          <div className="text-[10px] text-white/35 leading-relaxed">
            Click map to outline an area. Generated waypoints replace your current list.
          </div>

          <div>
            <div className="text-[9px] uppercase tracking-[0.1em] text-white/30 mb-1">Spacing</div>
            <div className="flex gap-0.5">
              {SPACING_PRESETS.map(p => (
                <button
                  key={p}
                  onClick={() => canEdit && updateAreaCoverage({ lineSpacing: p })}
                  disabled={!canEdit}
                  className={`flex-1 py-1 text-[10px] rounded-md transition-colors tabular-nums ${
                    areaCoverage.lineSpacing === p ? 'bg-white/[0.10] text-white/85' : 'text-white/40 hover:bg-white/[0.04]'
                  }`}
                >
                  {p}m
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[9px] uppercase tracking-[0.1em] text-white/30 mb-1">Angle</div>
            <div className="flex gap-0.5">
              {ANGLE_PRESETS.map(p => (
                <button
                  key={p}
                  onClick={() => canEdit && updateAreaCoverage({ angle: p })}
                  disabled={!canEdit}
                  className={`flex-1 py-1 text-[10px] rounded-md transition-colors tabular-nums ${
                    areaCoverage.angle === p ? 'bg-white/[0.10] text-white/85' : 'text-white/40 hover:bg-white/[0.04]'
                  }`}
                >
                  {p}&deg;
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-0.5">
            <span className="text-[10px] text-white/35 tabular-nums">{areaCoverage.polygon.length} vertices</span>
            {areaCoverage.polygon.length > 0 && (
              <div className="flex gap-2">
                <button onClick={removeLastPolygonVertex} className="text-[10px] text-white/40 hover:text-white/70">Undo</button>
                <button onClick={clearPolygon} className="text-[10px] text-white/40 hover:text-white/70">Clear</button>
              </div>
            )}
          </div>

          <button
            onClick={generateCoveragePath}
            disabled={!canEdit || !canGenerate}
            className={`w-full py-1.5 text-[11px] font-medium rounded-md transition-colors ${
              canGenerate ? 'bg-teal/15 text-teal hover:bg-teal/25' : 'bg-white/[0.04] text-white/25'
            }`}
          >
            Generate Path
          </button>
        </div>
      )}
    </div>
  );
}

function ZoneList() {
  const {
    zones, removeZone, renameZone,
    clickMode, setClickMode,
    draftZone, removeLastDraftZoneVertex, cancelDraftZone, saveDraftZone,
  } = useNavigation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const drawingAllow = clickMode === 'zone-allow';
  const drawingExclude = clickMode === 'zone-exclude';

  const headerRight = (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setClickMode(drawingAllow ? 'none' : 'zone-allow')}
        className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${
          drawingAllow
            ? 'bg-teal/15 text-teal hover:bg-teal/25'
            : 'bg-white/[0.05] text-white/55 hover:text-white/80 hover:bg-white/[0.08]'
        }`}
        title="Outline a region the boat may operate in"
      >
        + Allowed
      </button>
      <button
        type="button"
        onClick={() => setClickMode(drawingExclude ? 'none' : 'zone-exclude')}
        className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${
          drawingExclude
            ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25'
            : 'bg-white/[0.05] text-white/55 hover:text-white/80 hover:bg-white/[0.08]'
        }`}
        title="Outline a no-go region"
      >
        + Exclusion
      </button>
      <span className="text-[10px] font-mono text-white/30 tabular-nums ml-0.5">{zones.length}</span>
    </div>
  );

  return (
    <div className="px-3.5 py-2.5">
      <SectionHeader title="Zones" right={headerRight} />

      {draftZone && (
        <div className="mt-2 rounded-md bg-white/[0.03] border border-white/[0.04] px-2.5 py-2 space-y-2">
          <div className="flex items-center gap-2 text-[10px] text-white/55">
            <span className={`w-1.5 h-1.5 rounded-full ${draftZone.kind === 'allow' ? 'bg-teal/80' : 'bg-red-400/85'}`} />
            <span>
              Drawing {draftZone.kind === 'allow' ? 'allowed area' : 'exclusion zone'} —{' '}
              <span className="tabular-nums text-white/75">{draftZone.vertices.length}</span> vertices
            </span>
          </div>
          <div className="text-[10px] text-white/30 leading-relaxed">
            Click map to drop vertices. Need at least 3.
          </div>
          <div className="flex gap-1">
            <button
              onClick={removeLastDraftZoneVertex}
              disabled={draftZone.vertices.length === 0}
              className="px-2 py-1 rounded-md text-[10px] text-white/55 hover:text-white/80 hover:bg-white/[0.05] transition-colors disabled:opacity-30"
            >
              Undo
            </button>
            <button
              onClick={cancelDraftZone}
              className="px-2 py-1 rounded-md text-[10px] text-white/55 hover:text-white/80 hover:bg-white/[0.05] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => saveDraftZone()}
              disabled={draftZone.vertices.length < 3}
              className={`flex-1 py-1 rounded-md text-[10px] font-medium transition-colors ${
                draftZone.vertices.length >= 3
                  ? draftZone.kind === 'allow'
                    ? 'bg-teal/15 text-teal hover:bg-teal/25'
                    : 'bg-red-500/15 text-red-300 hover:bg-red-500/25'
                  : 'bg-white/[0.04] text-white/25'
              }`}
            >
              Save
            </button>
          </div>
        </div>
      )}

      {zones.length === 0 && !draftZone ? (
        <div className="mt-2 text-[10px] text-white/25 text-center py-3 leading-relaxed">
          No zones yet
        </div>
      ) : (
        <div className="mt-2 space-y-0.5">
          {zones.map(zone => {
            const isEditing = editingId === zone.id;
            const dotClass = zone.kind === 'allow' ? 'bg-teal/70' : 'bg-red-400/80';
            return (
              <div
                key={zone.id}
                className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.03] transition-colors"
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <input
                      autoFocus
                      value={draftName}
                      onChange={e => setDraftName(e.target.value)}
                      onBlur={() => {
                        renameZone(zone.id, draftName);
                        setEditingId(null);
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { renameZone(zone.id, draftName); setEditingId(null); }
                        else if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="w-full bg-white/[0.06] rounded px-1.5 py-0.5 text-[11px] text-white/90 outline-none border border-white/10 focus:border-white/25"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setDraftName(zone.name); setEditingId(zone.id); }}
                      className="block w-full text-left text-[11px] text-white/75 truncate hover:text-white/90"
                      title="Click to rename"
                    >
                      {zone.name}
                    </button>
                  )}
                  <div className="text-[10px] text-white/30 tabular-nums">
                    {zone.kind === 'allow' ? 'allow' : 'exclude'} · {zone.vertices.length} pts
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeZone(zone.id)}
                  className="opacity-0 group-hover:opacity-100 text-[10px] text-red-300/70 hover:text-red-300 px-1.5 py-0.5 rounded transition-opacity"
                  aria-label={`Remove ${zone.name}`}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WaypointItem({ waypoint, index, isExpanded, onToggle, total }: {
  waypoint: Waypoint;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  total: number;
}) {
  const { removeWaypoint, toggleMeasurement, mission, updateWaypoint, moveWaypoint } = useNavigation();
  const canEdit = mission.status === 'idle' || mission.status === 'planning';
  const isActive = mission.currentWaypointIndex === index;

  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(waypoint.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingName) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingName]);

  useEffect(() => {
    if (!editingName) setDraftName(waypoint.name);
  }, [waypoint.name, editingName]);

  const commitName = () => {
    const next = draftName.trim();
    if (next && next !== waypoint.name) {
      updateWaypoint(waypoint.id, { name: next });
    } else {
      setDraftName(waypoint.name);
    }
    setEditingName(false);
  };

  return (
    <div className={`rounded-xl overflow-hidden transition-colors ${
      waypoint.completed ? 'opacity-55' : ''
    } ${isActive ? 'ring-1 ring-teal/40 bg-teal/5' : ''}`}>
      <div
        className="flex items-center gap-2.5 py-2 px-2.5 cursor-pointer hover:bg-white/[0.03] transition-colors"
        onClick={onToggle}
      >
        <div className={`w-5 h-5 rounded-lg flex items-center justify-center text-[10px] font-semibold shrink-0 ${
          waypoint.completed ? 'bg-emerald-500/70 text-white' : isActive ? 'bg-teal/70 text-white' : 'bg-white/10 text-white/65'
        }`}>
          {waypoint.completed ? (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            index + 1
          )}
        </div>
        <div className="flex-1 min-w-0">
          {editingName ? (
            <input
              ref={inputRef}
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              onClick={e => e.stopPropagation()}
              onBlur={commitName}
              onKeyDown={e => {
                if (e.key === 'Enter') commitName();
                else if (e.key === 'Escape') { setDraftName(waypoint.name); setEditingName(false); }
              }}
              className="w-full bg-white/[0.06] rounded-md px-1.5 py-0.5 text-xs text-white/90 outline-none border border-white/10 focus:border-teal/40"
            />
          ) : (
            <div
              className="text-white/80 text-xs truncate"
              onDoubleClick={(e) => { e.stopPropagation(); if (canEdit) setEditingName(true); }}
              title="Double-click to rename"
            >
              {waypoint.name}
            </div>
          )}
          <div className="text-white/30 text-[10px] font-mono">
            {waypoint.lat.toFixed(5)}, {waypoint.lng.toFixed(5)}
          </div>
        </div>
        {waypoint.takeMeasurement && (
          <span className="text-[9px] text-white/40 bg-white/[0.07] px-1.5 py-0.5 rounded-md">
            {waypoint.measurementTypes.length}
          </span>
        )}
        <svg
          className={`w-3 h-3 text-white/25 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {isExpanded && (
        <div className="px-2.5 pb-2.5 pt-1 border-t border-white/[0.04] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-[0.1em] text-white/30">Measurements</span>
            <div className="flex items-center gap-0.5">
              <IconButton
                label="Rename waypoint"
                onClick={() => canEdit && setEditingName(true)}
                disabled={!canEdit}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </IconButton>
              <IconButton
                label="Move up"
                onClick={() => canEdit && moveWaypoint(waypoint.id, 'up')}
                disabled={!canEdit || index === 0}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
              </IconButton>
              <IconButton
                label="Move down"
                onClick={() => canEdit && moveWaypoint(waypoint.id, 'down')}
                disabled={!canEdit || index === total - 1}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </IconButton>
              <IconButton
                label="Remove waypoint"
                tone="danger"
                onClick={() => canEdit && removeWaypoint(waypoint.id)}
                disabled={!canEdit}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                </svg>
              </IconButton>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-0.5">
            {MEASUREMENT_CONFIGS.map(config => {
              const active = waypoint.measurementTypes.includes(config.type);
              return (
                <button
                  key={config.type}
                  onClick={() => canEdit && toggleMeasurement(waypoint.id, config.type)}
                  disabled={!canEdit}
                  className={`text-left text-[10px] px-2 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
                    active ? 'bg-white/[0.07] text-white/80' : 'text-white/40 hover:bg-white/[0.04]'
                  } ${!canEdit ? 'opacity-50' : ''}`}
                >
                  <span className={`w-1 h-1 rounded-full shrink-0 ${active ? 'bg-teal/80' : 'bg-white/15'}`} />
                  <span className="truncate">{config.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function WaypointList() {
  const {
    mission, reverseWaypoints, duplicateWaypoint, boat, insertWaypointAt,
    clickMode, setClickMode,
  } = useNavigation();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const canEdit = mission.status === 'idle' || mission.status === 'planning';
  const total = mission.waypoints.length;
  const adding = clickMode === 'waypoint';

  const closeLoop = () => {
    if (total === 0) return;
    duplicateWaypoint(mission.waypoints[0].id);
  };

  const addBoatPosition = () => {
    if (!boat.boatOnline) return;
    insertWaypointAt(boat.position.lat, boat.position.lng, null);
  };

  const headerRight = (
    <div className="flex items-center gap-1">
      {canEdit && total > 0 && (
        <>
          <button
            type="button"
            onClick={addBoatPosition}
            disabled={!boat.boatOnline}
            className="text-[9px] px-1.5 py-0.5 rounded-md text-white/45 hover:text-white/75 hover:bg-white/[0.06] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Insert boat's current position"
          >
            +Boat
          </button>
          <button
            type="button"
            onClick={closeLoop}
            className="text-[9px] px-1.5 py-0.5 rounded-md text-white/45 hover:text-white/75 hover:bg-white/[0.06] transition-colors"
            title="Append a copy of the first waypoint"
          >
            Loop
          </button>
          <button
            type="button"
            onClick={reverseWaypoints}
            className="text-[9px] px-1.5 py-0.5 rounded-md text-white/45 hover:text-white/75 hover:bg-white/[0.06] transition-colors"
            title="Reverse waypoint order"
          >
            Reverse
          </button>
        </>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={() => setClickMode(adding ? 'none' : 'waypoint')}
          className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${
            adding
              ? 'bg-teal/15 text-teal hover:bg-teal/25'
              : 'bg-white/[0.05] text-white/55 hover:text-white/80 hover:bg-white/[0.08]'
          }`}
          title={adding ? 'Stop adding waypoints' : 'Add waypoints by clicking the map'}
        >
          {adding ? 'Done' : '+ Add'}
        </button>
      )}
      <span className="text-[10px] font-mono text-white/30 tabular-nums ml-0.5">{total}</span>
    </div>
  );

  return (
    <div className="px-3.5 py-2.5">
      <div className="mb-2">
        <SectionHeader title="Waypoints" right={headerRight} />
      </div>

      {adding && (
        <div className="mb-2 text-[10px] text-white/35 leading-relaxed">
          Click map to drop waypoints.
        </div>
      )}

      {total === 0 ? (
        <div className="py-6 text-center space-y-1">
          <div className="text-white/25 text-xs">Press <span className="text-white/55">+ Add</span> then click map</div>
          <div className="text-white/15 text-[10px]">Right-click any waypoint for actions</div>
        </div>
      ) : (
        <div className="space-y-0.5">
          {mission.waypoints.map((wp, i) => (
            <WaypointItem
              key={wp.id}
              waypoint={wp}
              index={i}
              total={total}
              isExpanded={expandedId === wp.id}
              onToggle={() => setExpandedId(expandedId === wp.id ? null : wp.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DataCollectionPane() {
  const { mission, updateDataCollection, toggleDataCollectionMeasurement } = useNavigation();
  const { dataCollection } = mission;
  const canEdit = mission.status === 'idle' || mission.status === 'planning';
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-3.5 py-2.5">
      <SectionHeader
        title="Data Collection"
        onClick={() => setExpanded(!expanded)}
        expandable
        expanded={expanded}
        right={dataCollection.enabled ? <span className="text-[9px] text-teal font-medium">ON</span> : null}
      />

      {expanded && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/35">Enabled</span>
            <button
              onClick={() => canEdit && updateDataCollection({ enabled: !dataCollection.enabled })}
              disabled={!canEdit || dataCollection.measurementTypes.length === 0}
              className={`w-8 h-[18px] rounded-full transition-colors relative ${
                dataCollection.enabled ? 'bg-teal/70' : 'bg-white/10'
              } ${!canEdit || dataCollection.measurementTypes.length === 0 ? 'opacity-30' : ''}`}
            >
              <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full transition-all ${
                dataCollection.enabled ? 'left-[16px] bg-white' : 'left-[2px] bg-white/50'
              }`} />
            </button>
          </div>

          <div>
            <div className="text-[10px] text-white/35 mb-1">Interval: {dataCollection.intervalMeters}m</div>
            <input
              type="range"
              min="10"
              max="200"
              step="10"
              value={dataCollection.intervalMeters}
              onChange={e => canEdit && updateDataCollection({ intervalMeters: Number(e.target.value) })}
              disabled={!canEdit}
              className="w-full h-1 appearance-none bg-white/10 rounded-full"
              style={{ accentColor: 'oklch(0.65 0.17 50)' }}
            />
          </div>

          <div className="grid grid-cols-2 gap-0.5">
            {MEASUREMENT_CONFIGS.map(config => {
              const active = dataCollection.measurementTypes.includes(config.type);
              return (
                <button
                  key={config.type}
                  onClick={() => canEdit && toggleDataCollectionMeasurement(config.type)}
                  disabled={!canEdit}
                  className={`text-left text-[10px] px-2 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
                    active ? 'bg-white/[0.07] text-white/80' : 'text-white/40 hover:bg-white/[0.04]'
                  } ${!canEdit ? 'opacity-50' : ''}`}
                >
                  <span className={`w-1 h-1 rounded-full shrink-0 ${active ? 'bg-teal/80' : 'bg-white/15'}`} />
                  <span className="truncate">{config.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MeasurementResults() {
  const { mission } = useNavigation();
  if (mission.measurements.length === 0) return null;

  const latest = mission.measurements[mission.measurements.length - 1];
  const wp = mission.waypoints.find(w => w.id === latest.waypointId);

  return (
    <div className="px-3.5 py-2.5">
      <span className="text-[9px] font-medium text-white/30 uppercase tracking-[0.12em]">Latest Data</span>
      <div className="text-[10px] text-white/30 mt-0.5 mb-2">
        {wp?.name} &middot; {new Date(latest.timestamp).toLocaleTimeString()}
      </div>
      <div className="grid grid-cols-2 gap-1">
        {Object.entries(latest.values).map(([type, value]) => {
          const config = MEASUREMENT_CONFIGS.find(c => c.type === type);
          if (!config) return null;
          return (
            <div key={type} className="bg-white/[0.03] rounded-md px-2 py-1.5">
              <div className="text-[9px] text-white/30 uppercase tracking-[0.1em]">{config.label}</div>
              <div className="text-xs font-mono text-white/75 mt-0.5 tabular-nums">
                {(value as number).toFixed(1)} <span className="text-white/35">{config.unit}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Mission Library: saved missions + schedules ── */

function formatScheduleTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function ScheduleCreatePopover({ savedMissions }: { savedMissions: SavedMission[] }) {
  const { createSchedule } = useNavigation();
  const [open, setOpen] = useState(false);
  const [missionId, setMissionId] = useState<string>('');
  const [whenLocal, setWhenLocal] = useState<string>(() => {
    const future = new Date(Date.now() + 30 * 60_000);
    const tz = future.getTimezoneOffset() * 60_000;
    return new Date(future.getTime() - tz).toISOString().slice(0, 16);
  });
  const [repeat, setRepeat] = useState<ScheduleRepeat>('none');

  useEffect(() => {
    if (open && !missionId && savedMissions.length > 0) {
      setMissionId(savedMissions[0].id);
    }
  }, [open, savedMissions, missionId]);

  const submit = () => {
    if (!missionId) return;
    const startAt = new Date(whenLocal).getTime();
    if (Number.isNaN(startAt)) return;
    createSchedule({ missionId, startAt, repeat });
    setOpen(false);
  };

  const noMissions = savedMissions.length === 0;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={noMissions}
          className="text-[10px] px-2 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-white/60 hover:text-white/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title={noMissions ? 'Save a mission first' : 'Schedule a mission'}
        >
          + Schedule
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={10}
          className="w-[18rem] rounded-2xl border border-white/[0.08] bg-[#171922]/95 p-3 shadow-2xl shadow-black/50 backdrop-blur-xl z-[10000] space-y-2.5"
        >
          <div className="text-[11px] font-semibold tracking-wide text-white/85">New Schedule</div>

          <div className="space-y-1">
            <div className="text-[9px] uppercase tracking-[0.1em] text-white/35">Mission</div>
            <select
              value={missionId}
              onChange={e => setMissionId(e.target.value)}
              className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1.5 text-[11px] text-white/85 outline-none focus:border-teal/40"
            >
              {savedMissions.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-[9px] uppercase tracking-[0.1em] text-white/35">Start time</div>
            <input
              type="datetime-local"
              value={whenLocal}
              onChange={e => setWhenLocal(e.target.value)}
              className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1.5 text-[11px] text-white/85 outline-none focus:border-teal/40"
            />
          </div>

          <div className="space-y-1">
            <div className="text-[9px] uppercase tracking-[0.1em] text-white/35">Repeat</div>
            <SegmentedControl
              value={repeat}
              onChange={setRepeat}
              options={[
                { value: 'none', label: 'Once' },
                { value: 'hourly', label: 'Hourly' },
                { value: 'daily', label: 'Daily' },
              ]}
            />
          </div>

          <div className="text-[10px] text-white/35 leading-relaxed">
            Fires while the dashboard is open. Skipped if a mission is already running.
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-1 rounded-xl bg-white/[0.05] px-3 py-2 text-[10px] font-medium text-white/65 hover:bg-white/[0.08] hover:text-white/85 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!missionId}
              className="flex-1 rounded-xl bg-teal/85 hover:bg-teal text-[#08090d] px-3 py-2 text-[10px] font-semibold transition-colors disabled:opacity-30"
            >
              Create
            </button>
          </div>

          <Popover.Arrow className="fill-[#171922]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SaveMissionInline({ disabled }: { disabled: boolean }) {
  const { saveCurrentMission } = useNavigation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const submit = () => {
    const result = saveCurrentMission(name);
    if (result) {
      setName('');
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="text-[10px] px-2 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-white/60 hover:text-white/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title={disabled ? 'Add waypoints first' : 'Save current waypoints as a mission'}
      >
        + Save Mission
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit();
          else if (e.key === 'Escape') { setName(''); setOpen(false); }
        }}
        placeholder="Mission name"
        className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1 text-[10px] text-white/85 outline-none focus:border-teal/40 w-28"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!name.trim()}
        className="text-[10px] px-2 py-1 rounded-lg bg-teal/85 hover:bg-teal text-[#08090d] font-medium disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => { setName(''); setOpen(false); }}
        className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
      >
        ✕
      </button>
    </div>
  );
}

function SavedMissionRow({ saved }: { saved: SavedMission }) {
  const { loadSavedMission, deleteSavedMission, renameSavedMission, mission } = useNavigation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(saved.name);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canLoad = mission.status === 'idle' || mission.status === 'planning' || mission.status === 'completed';

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(saved.name);
  }, [saved.name, editing]);

  const commit = () => {
    if (draft.trim() && draft.trim() !== saved.name) {
      renameSavedMission(saved.id, draft);
    }
    setEditing(false);
  };

  return (
    <div className="rounded-xl bg-white/[0.03] hover:bg-white/[0.05] transition-colors px-2.5 py-2 group">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={e => {
                if (e.key === 'Enter') commit();
                else if (e.key === 'Escape') { setDraft(saved.name); setEditing(false); }
              }}
              className="w-full bg-white/[0.06] rounded-md px-1.5 py-0.5 text-xs text-white/90 outline-none border border-white/10 focus:border-teal/40"
            />
          ) : (
            <div
              className="text-xs text-white/85 truncate"
              onDoubleClick={() => setEditing(true)}
              title="Double-click to rename"
            >
              {saved.name}
            </div>
          )}
          <div className="text-[10px] text-white/35 font-mono mt-0.5">
            {saved.waypoints.length} pts &middot; {new Date(saved.createdAt).toLocaleDateString()}
          </div>
        </div>
        <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => loadSavedMission(saved.id)}
            disabled={!canLoad}
            className="text-[10px] px-2 py-1 rounded-lg bg-teal/15 hover:bg-teal/25 text-teal disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Load
          </button>
          <IconButton
            label="Delete saved mission"
            tone="danger"
            onClick={() => deleteSavedMission(saved.id)}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
            </svg>
          </IconButton>
        </div>
      </div>
    </div>
  );
}

function ScheduleRow({ schedule, missionName, onDelete, onToggle }: {
  schedule: MissionSchedule;
  missionName: string;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const repeatLabel = schedule.repeat === 'none' ? 'Once' : schedule.repeat === 'hourly' ? 'Hourly' : 'Daily';
  const isFuture = schedule.startAt > Date.now();
  const statusText = !schedule.enabled
    ? 'Paused'
    : isFuture
    ? formatScheduleTime(schedule.startAt)
    : schedule.repeat === 'none'
    ? 'Past'
    : `Next ${formatScheduleTime(schedule.startAt)}`;
  return (
    <div className="rounded-xl bg-white/[0.03] hover:bg-white/[0.05] transition-colors px-2.5 py-2 group">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          className={`shrink-0 w-1.5 h-1.5 rounded-full ${schedule.enabled ? 'bg-teal' : 'bg-white/20'}`}
          title={schedule.enabled ? 'Pause schedule' : 'Resume schedule'}
        />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-white/85 truncate">{missionName}</div>
          <div className="text-[10px] text-white/40 font-mono mt-0.5">
            {repeatLabel} &middot; {statusText}
          </div>
        </div>
        <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
          <IconButton label="Delete schedule" tone="danger" onClick={onDelete}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
            </svg>
          </IconButton>
        </div>
      </div>
    </div>
  );
}

function MissionLibrary() {
  const {
    mission, savedMissions, schedules,
    deleteSchedule, updateSchedule,
  } = useNavigation();
  const [expanded, setExpanded] = useState(false);
  const canSave = mission.waypoints.length > 0;

  const missionsById = useMemo(() => {
    const map = new Map<string, SavedMission>();
    savedMissions.forEach(m => map.set(m.id, m));
    return map;
  }, [savedMissions]);

  const upcomingCount = schedules.filter(s => s.enabled).length;

  return (
    <div className="px-3.5 py-2.5">
      <SectionHeader
        title="Mission Library"
        onClick={() => setExpanded(!expanded)}
        expandable
        expanded={expanded}
        right={
          <span className="text-[10px] font-mono text-white/30">
            {savedMissions.length}{upcomingCount > 0 ? ` · ${upcomingCount}↻` : ''}
          </span>
        }
      />

      {expanded && (
        <div className="mt-2.5 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] uppercase tracking-[0.1em] text-white/35">Saved</span>
              <SaveMissionInline disabled={!canSave} />
            </div>
            {savedMissions.length === 0 ? (
              <div className="text-[10px] text-white/25 text-center py-3">No saved missions yet</div>
            ) : (
              <div className="space-y-1">
                {savedMissions.map(m => <SavedMissionRow key={m.id} saved={m} />)}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] uppercase tracking-[0.1em] text-white/35">Schedules</span>
              <ScheduleCreatePopover savedMissions={savedMissions} />
            </div>
            {schedules.length === 0 ? (
              <div className="text-[10px] text-white/25 text-center py-3">No schedules</div>
            ) : (
              <div className="space-y-1">
                {schedules.map(s => (
                  <ScheduleRow
                    key={s.id}
                    schedule={s}
                    missionName={missionsById.get(s.missionId)?.name ?? '(deleted mission)'}
                    onDelete={() => deleteSchedule(s.id)}
                    onToggle={() => updateSchedule(s.id, { enabled: !s.enabled })}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Mode Dropdown ── */

function ModeDropdown() {
  const { controlMode, setControlMode } = useNavigation();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={`flex items-center gap-1.5 text-[11px] font-medium tracking-wide rounded-full border px-2.5 py-1 outline-none cursor-pointer transition-colors ${
            controlMode === 'autonomous'
              ? 'border-teal/30 text-teal bg-teal/10 hover:bg-teal/15'
              : 'border-amber-500/30 text-amber-400 bg-amber-500/10 hover:bg-amber-500/15'
          }`}
        >
          {controlMode === 'autonomous' ? 'Autonomous' : 'Teleop'}
          <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[140px] bg-[#1a1c24] border border-white/[0.08] rounded-xl p-1 shadow-xl shadow-black/50 backdrop-blur-xl z-[9999]"
          sideOffset={6}
          align="end"
        >
          <DropdownMenu.Item
            className={`flex items-center gap-2 px-2.5 py-2 text-[11px] font-medium rounded-lg outline-none cursor-pointer transition-colors ${
              controlMode === 'autonomous' ? 'text-teal bg-teal/10' : 'text-white/60 hover:text-white/80 hover:bg-white/[0.06]'
            }`}
            onSelect={() => setControlMode('autonomous')}
          >
            <div className={`w-1.5 h-1.5 rounded-full ${controlMode === 'autonomous' ? 'bg-teal' : 'bg-white/15'}`} />
            Autonomous
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={`flex items-center gap-2 px-2.5 py-2 text-[11px] font-medium rounded-lg outline-none cursor-pointer transition-colors ${
              controlMode === 'teleop' ? 'text-amber-400 bg-amber-500/10' : 'text-white/60 hover:text-white/80 hover:bg-white/[0.06]'
            }`}
            onSelect={() => setControlMode('teleop')}
          >
            <div className={`w-1.5 h-1.5 rounded-full ${controlMode === 'teleop' ? 'bg-amber-400' : 'bg-white/15'}`} />
            Teleop
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* ── Main Sidebar ── */

function LayerSelector() {
  const { measurementType, setMeasurementType } = useNavigation();
  const current = MEASUREMENT_CONFIGS.find(c => c.type === measurementType);

  return (
    <div className="px-3.5 py-2.5 shrink-0">
      <div className="text-[10px] uppercase tracking-wider text-white/35 mb-1.5">Lake layer</div>
      <div className="relative">
        <select
          value={measurementType}
          onChange={(e) => setMeasurementType(e.target.value as typeof measurementType)}
          className="w-full appearance-none bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 rounded-lg pl-2.5 pr-8 py-1.5 text-xs text-white/85 cursor-pointer outline-none focus:border-white/25 transition-colors"
        >
          {MEASUREMENT_CONFIGS.map(c => (
            <option key={c.type} value={c.type} className="bg-[#0a0c14] text-white">
              {c.label}
            </option>
          ))}
        </select>
        <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-white/40">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        {current?.unit && (
          <div className="mt-1 text-[10px] text-white/40">Showing {current.label.toLowerCase()} ({current.unit})</div>
        )}
      </div>
    </div>
  );
}

export default function Sidebar() {
  const { controlMode, viewMode } = useNavigation();

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-3.5 pt-3.5 pb-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-white/85 tracking-tight">Castaway</div>
          <ModeDropdown />
        </div>
      </div>

      <div className="h-px bg-white/[0.04]" />

      {viewMode === '3d' && (
        <>
          <LayerSelector />
          <div className="h-px bg-white/[0.04]" />
        </>
      )}

      {controlMode === 'autonomous' ? (
        <>
          <MissionControls />
          <div className="h-px bg-white/[0.04]" />
          <div className="flex-1 overflow-y-auto">
            <WaypointList />
            <div className="h-px bg-white/[0.04]" />
            <CoveragePane />
            <div className="h-px bg-white/[0.04]" />
            <ZoneList />
            <div className="h-px bg-white/[0.04]" />
            <DataCollectionPane />
            <div className="h-px bg-white/[0.04]" />
            <MissionLibrary />
            <MeasurementResults />
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <TeleopControls />
        </div>
      )}
    </div>
  );
}
