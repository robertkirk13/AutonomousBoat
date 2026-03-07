import type { ThermalData as ThermalState } from "../types/index";

function getTempColor(c: number): string {
  if (c < 40) return "emerald";
  if (c < 60) return "amber";
  return "red";
}

export function ThermalPanel({ data }: { data: ThermalState | null }) {
  return (
    <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
      <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-3">Thermal</h3>

      {!data || data.temps.length === 0 ? (
        <div className="py-6 flex items-center justify-center">
          <div className="text-center text-white/20">
            <p className="text-sm">No thermal data</p>
            <p className="text-xs mt-1 text-white/15">Waiting for TMP1075</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {data.temps.map((t) => {
            const color = getTempColor(t.temp_c);
            const barColorClass =
              color === "emerald"
                ? "bg-emerald-500"
                : color === "amber"
                ? "bg-amber-500"
                : "bg-red-500";
            const textColorClass =
              color === "emerald"
                ? "text-emerald-400"
                : color === "amber"
                ? "text-amber-400"
                : "text-red-400";

            return (
              <div key={t.label}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] text-white/40 uppercase tracking-wide">
                    {t.label.replace("_", " ")}
                  </span>
                  <span className={`text-xs font-mono ${textColorClass}`}>
                    {t.temp_c.toFixed(1)}<span className="text-white/40 ml-0.5">&deg;C</span>
                  </span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${barColorClass} transition-all duration-300 rounded-full`}
                    style={{ width: `${Math.min(100, (t.temp_c / 80) * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}

          {/* Fan duty */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] text-white/40 uppercase tracking-wide">Fan</span>
              <span className="text-xs text-white/80 font-mono">
                {(data.fan_duty * 100).toFixed(0)}<span className="text-white/40 ml-0.5">%</span>
              </span>
            </div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300 rounded-full"
                style={{ width: `${data.fan_duty * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
