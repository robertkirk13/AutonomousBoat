import type { PowerData as PowerState } from "../types/index";

const LABEL_DISPLAY: Record<string, string> = {
  left_motor: "Left Motor",
  right_motor: "Right Motor",
  payload: "Payload",
  reel: "Reel",
  left_battery: "Left Battery",
  right_battery: "Right Battery",
  solar: "Solar",
  dock_charger: "Dock Charger",
  core_digital: "Core Digital",
};

function voltageColor(v: number): string {
  if (v > 12.0) return "text-emerald-400";
  if (v > 11.0) return "text-amber-400";
  return "text-red-400";
}

export function PowerPanel({ data }: { data: PowerState | null }) {
  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-3 shrink-0">
        Power Channels
      </h3>

      {!data || data.channels.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-white/20">
            <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <title>Power</title>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <p className="text-sm">No power data</p>
            <p className="text-xs mt-1 text-white/15">Waiting for INA228</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pr-1 -mr-1">
          <div className="grid grid-cols-3 gap-2">
            {data.channels.map((ch) => (
              <div key={ch.label} className="bg-white/5 rounded-xl p-3 border border-white/5">
                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">
                  {LABEL_DISPLAY[ch.label] || ch.label}
                </div>
                <div className={`text-lg font-semibold ${voltageColor(ch.voltage_v)}`}>
                  {ch.voltage_v.toFixed(2)}
                  <span className="text-white/40 text-xs font-normal ml-0.5">V</span>
                </div>
                <div className="text-xs text-white/50 mt-1 font-mono">
                  {ch.current_a.toFixed(3)}A &middot; {ch.power_w.toFixed(2)}W
                </div>
                {(ch.label.includes("battery") || ch.label === "solar") && (
                  <div className="text-[10px] text-white/30 mt-0.5 font-mono">
                    {ch.energy_wh.toFixed(3)}Wh &middot; {ch.charge_ah.toFixed(3)}Ah
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
