import type { ImuData } from "../types/index";

export function ImuPanel({ data }: { data: ImuData | null }) {
  return (
    <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
      <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-3">Orientation</h3>

      {!data ? (
        <div className="py-6 flex items-center justify-center">
          <div className="text-center text-white/20">
            <p className="text-sm">No IMU data</p>
            <p className="text-xs mt-1 text-white/15">Waiting for BNO055</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          {/* Compass */}
          <div className="relative">
            <svg viewBox="0 0 200 200" className="w-40 h-40" aria-hidden="true">
              <title>Compass</title>
              {/* Compass ring */}
              <circle cx="100" cy="100" r="90" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
              <circle cx="100" cy="100" r="70" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />

              {/* Tick marks */}
              {Array.from({ length: 36 }).map((_, i) => {
                const angle = i * 10;
                const r1 = i % 9 === 0 ? 78 : 84;
                const r2 = 90;
                const rad = (angle * Math.PI) / 180;
                return (
                  <line
                    key={`tick-${angle}`}
                    x1={100 + r1 * Math.sin(rad)}
                    y1={100 - r1 * Math.cos(rad)}
                    x2={100 + r2 * Math.sin(rad)}
                    y2={100 - r2 * Math.cos(rad)}
                    stroke={i % 9 === 0 ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)"}
                    strokeWidth={i % 9 === 0 ? 2 : 1}
                  />
                );
              })}

              {/* Cardinal labels */}
              <text x="100" y="22" textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize="12" fontWeight="600">N</text>
              <text x="182" y="105" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="10">E</text>
              <text x="100" y="190" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="10">S</text>
              <text x="18" y="105" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="10">W</text>

              {/* Heading needle */}
              <g transform={`rotate(${data.heading}, 100, 100)`}>
                <line x1="100" y1="100" x2="100" y2="32" stroke="rgba(255,255,255,0.9)" strokeWidth="2.5" strokeLinecap="round" />
                <polygon points="100,28 95,42 105,42" fill="rgba(255,255,255,0.9)" />
                <line x1="100" y1="100" x2="100" y2="168" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" />
              </g>

              {/* Center dot */}
              <circle cx="100" cy="100" r="4" fill="rgba(255,255,255,0.6)" />
            </svg>
          </div>

          {/* Heading value */}
          <div className="text-white/90 font-semibold text-lg">
            {data.heading.toFixed(1)}<span className="text-white/40 text-sm ml-0.5">&deg;</span>
          </div>

          {/* Roll & Pitch */}
          <div className="w-full space-y-2">
            <AttitudeBar label="Roll" value={data.roll} />
            <AttitudeBar label="Pitch" value={data.pitch} />
          </div>
        </div>
      )}
    </div>
  );
}

function AttitudeBar({ label, value }: { label: string; value: number }) {
  const position = 50 + (value / 90) * 50;

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-white/40 uppercase tracking-wide w-10">{label}</span>
      <span className="text-xs text-white/80 font-mono w-12 text-right">{value.toFixed(1)}&deg;</span>
      <div className="flex-1 h-1.5 bg-white/10 rounded-full relative">
        <div className="absolute top-0 left-1/2 w-px h-1.5 bg-white/20" />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white/80 rounded-full transition-all duration-100"
          style={{ left: `${Math.max(0, Math.min(100, position))}%`, transform: "translate(-50%, -50%)" }}
        />
      </div>
    </div>
  );
}
