import { useEffect, useRef, useCallback } from 'react';
import { useNavigation } from '../context/NavigationContext';

const THRUST = 0.7;
const TURN_THRUST = 0.5;
const SEND_HZ = 10;

type Direction = 'forward' | 'back' | 'left' | 'right';

function dirToMotor(dirs: Set<Direction>): { left: number; right: number } {
  let left = 0;
  let right = 0;

  if (dirs.has('forward')) {
    left += THRUST;
    right += THRUST;
  }
  if (dirs.has('back')) {
    left -= THRUST;
    right -= THRUST;
  }
  if (dirs.has('left')) {
    left -= TURN_THRUST;
    right += TURN_THRUST;
  }
  if (dirs.has('right')) {
    left += TURN_THRUST;
    right -= TURN_THRUST;
  }

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

export default function TeleopOverlay() {
  const { sendTeleop } = useNavigation();
  const activeKeys = useRef(new Set<Direction>());
  const activeTouch = useRef(new Set<Direction>());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendCurrent = useCallback(() => {
    const merged = new Set([...activeKeys.current, ...activeTouch.current]);
    const { left, right } = dirToMotor(merged);
    sendTeleop(left, right);
  }, [sendTeleop]);

  // Start/stop the send loop based on whether any input is active
  const updateLoop = useCallback(() => {
    const hasInput = activeKeys.current.size > 0 || activeTouch.current.size > 0;
    if (hasInput && !intervalRef.current) {
      sendCurrent();
      intervalRef.current = setInterval(sendCurrent, 1000 / SEND_HZ);
    } else if (!hasInput && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
      sendTeleop(0, 0); // stop
    }
  }, [sendCurrent, sendTeleop]);

  // Keyboard handling
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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
      activeKeys.current.clear();
    };
  }, [updateLoop]);

  const touchStart = (dir: Direction) => {
    activeTouch.current.add(dir);
    updateLoop();
  };
  const touchEnd = (dir: Direction) => {
    activeTouch.current.delete(dir);
    updateLoop();
  };

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] select-none">
      <div className="flex flex-col items-center gap-1.5">
        {/* Forward */}
        <DPadButton dir="forward" label="W" icon="up" onStart={touchStart} onEnd={touchEnd} />

        <div className="flex gap-1.5">
          {/* Left */}
          <DPadButton dir="left" label="A" icon="left" onStart={touchStart} onEnd={touchEnd} />

          {/* Stop (center) */}
          <button
            onMouseDown={() => { activeTouch.current.clear(); activeKeys.current.clear(); sendTeleop(0, 0); }}
            className="w-14 h-14 rounded-xl bg-red-500/20 hover:bg-red-500/30 active:bg-red-500/40 border border-red-500/30 backdrop-blur-xl flex items-center justify-center transition-colors"
          >
            <svg className="w-5 h-5 text-red-400/80" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>

          {/* Right */}
          <DPadButton dir="right" label="D" icon="right" onStart={touchStart} onEnd={touchEnd} />
        </div>

        {/* Back */}
        <DPadButton dir="back" label="S" icon="down" onStart={touchStart} onEnd={touchEnd} />
      </div>

      <div className="mt-2 text-center text-[10px] text-white/25 font-mono">
        WASD or Arrow Keys
      </div>
    </div>
  );
}

function DPadButton({ dir, label, icon, onStart, onEnd }: {
  dir: Direction;
  label: string;
  icon: 'up' | 'down' | 'left' | 'right';
  onStart: (dir: Direction) => void;
  onEnd: (dir: Direction) => void;
}) {
  const rotation = { up: 0, right: 90, down: 180, left: 270 }[icon];

  return (
    <button
      onMouseDown={() => onStart(dir)}
      onMouseUp={() => onEnd(dir)}
      onMouseLeave={() => onEnd(dir)}
      onTouchStart={(e) => { e.preventDefault(); onStart(dir); }}
      onTouchEnd={(e) => { e.preventDefault(); onEnd(dir); }}
      className="w-14 h-14 rounded-xl bg-panel/60 hover:bg-panel/80 active:bg-white/15 border border-panel-border/50 backdrop-blur-xl flex flex-col items-center justify-center gap-0.5 transition-colors"
    >
      <svg
        className="w-4 h-4 text-white/50"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
      </svg>
      <span className="text-[9px] font-mono text-white/25">{label}</span>
    </button>
  );
}
