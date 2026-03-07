import { useState } from 'react';
import { useNavigation } from '../context/NavigationContext';
import { MEASUREMENT_CONFIGS } from '../types/index';
import type { Waypoint } from '../types/index';

const SPACING_PRESETS = [5, 10, 15, 20, 25];
const ANGLE_PRESETS = [0, 45, 90, 135];

function MissionControls() {
  const { boat, mission, startMission, pauseMission, resumeMission, stopMission, clearWaypoints } = useNavigation();

  const completed = mission.waypoints.filter(wp => wp.completed).length;
  const total = mission.waypoints.length;
  const isActive = mission.status === 'running' || mission.status === 'paused';

  return (
    <div className="px-3.5 py-3">
      {/* Mission status + progress */}
      {isActive && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              {mission.status === 'running' && (
                <div className="w-1.5 h-1.5 rounded-full bg-teal animate-pulse" />
              )}
              <span className="text-xs font-medium text-white/60">
                {mission.status === 'running' ? 'Navigating' : 'Paused'}
              </span>
            </div>
            <span className="text-xs font-mono text-white/40">{completed}/{total}</span>
          </div>
          <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full bg-teal/60 rounded-full transition-all duration-500"
              style={{ width: total > 0 ? `${(completed / total) * 100}%` : '0%' }}
            />
          </div>
          {boat.nav && boat.nav.mode === 'running' && (
            <div className="mt-1.5 text-[10px] font-mono text-white/30">
              {boat.nav.distance_m.toFixed(0)}m to WP {boat.nav.target_wp + 1}
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-1.5">
        {mission.status === 'idle' || mission.status === 'planning' ? (
          <>
            <button
              onClick={startMission}
              disabled={total === 0}
              className="flex-1 bg-teal/90 hover:bg-teal disabled:bg-white/[0.06] disabled:text-white/20 text-[#08090d] font-semibold py-2.5 rounded-lg transition-colors text-sm"
            >
              Start Mission
            </button>
            {total > 0 && (
              <button
                onClick={clearWaypoints}
                className="px-3 py-2.5 rounded-lg bg-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.08] transition-colors text-sm"
              >
                Clear
              </button>
            )}
          </>
        ) : mission.status === 'running' ? (
          <>
            <button
              onClick={pauseMission}
              className="flex-1 bg-amber-500/80 hover:bg-amber-500 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
            >
              Pause
            </button>
            <button
              onClick={stopMission}
              className="px-4 py-2.5 rounded-lg bg-white/[0.06] text-white/50 hover:text-white/70 hover:bg-white/[0.08] transition-colors text-sm"
            >
              Stop
            </button>
          </>
        ) : mission.status === 'paused' ? (
          <>
            <button
              onClick={resumeMission}
              className="flex-1 bg-teal/90 hover:bg-teal text-[#08090d] font-semibold py-2.5 rounded-lg transition-colors text-sm"
            >
              Resume
            </button>
            <button
              onClick={stopMission}
              className="px-4 py-2.5 rounded-lg bg-white/[0.06] text-white/50 hover:text-white/70 hover:bg-white/[0.08] transition-colors text-sm"
            >
              Stop
            </button>
          </>
        ) : (
          <button
            onClick={clearWaypoints}
            className="flex-1 bg-teal/90 hover:bg-teal text-[#08090d] font-semibold py-2.5 rounded-lg transition-colors text-sm"
          >
            New Mission
          </button>
        )}
      </div>
    </div>
  );
}

function WaypointModePane() {
  const {
    mission, waypointMode, setWaypointMode,
    areaCoverage, updateAreaCoverage, clearPolygon, removeLastPolygonVertex, generateCoveragePath,
  } = useNavigation();

  const canEdit = mission.status === 'idle' || mission.status === 'planning';
  const canGenerate = areaCoverage.polygon.length >= 3;

  return (
    <div className="px-3.5 py-2.5">
      <div className="flex gap-1 mb-2">
        <button
          onClick={() => canEdit && setWaypointMode('manual')}
          disabled={!canEdit}
          className={`flex-1 py-1.5 text-[11px] rounded-md transition-colors ${
            waypointMode === 'manual'
              ? 'bg-white/10 text-white/80'
              : 'text-white/30 hover:text-white/50'
          } ${!canEdit ? 'opacity-40' : ''}`}
        >
          Manual
        </button>
        <button
          onClick={() => canEdit && setWaypointMode('area')}
          disabled={!canEdit}
          className={`flex-1 py-1.5 text-[11px] rounded-md transition-colors ${
            waypointMode === 'area'
              ? 'bg-teal-dim/30 text-teal'
              : 'text-white/30 hover:text-white/50'
          } ${!canEdit ? 'opacity-40' : ''}`}
        >
          Area Cover
        </button>
      </div>

      {waypointMode === 'area' && (
        <div className="space-y-2.5">
          <div>
            <div className="text-[10px] text-white/30 mb-1">Spacing</div>
            <div className="flex gap-0.5">
              {SPACING_PRESETS.map(p => (
                <button
                  key={p}
                  onClick={() => canEdit && updateAreaCoverage({ lineSpacing: p })}
                  disabled={!canEdit}
                  className={`flex-1 py-1 text-[10px] rounded transition-colors ${
                    areaCoverage.lineSpacing === p ? 'bg-teal-dim/30 text-teal' : 'text-white/30 hover:bg-white/[0.04]'
                  }`}
                >
                  {p}m
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] text-white/30 mb-1">Angle</div>
            <div className="flex gap-0.5">
              {ANGLE_PRESETS.map(p => (
                <button
                  key={p}
                  onClick={() => canEdit && updateAreaCoverage({ angle: p })}
                  disabled={!canEdit}
                  className={`flex-1 py-1 text-[10px] rounded transition-colors ${
                    areaCoverage.angle === p ? 'bg-teal-dim/30 text-teal' : 'text-white/30 hover:bg-white/[0.04]'
                  }`}
                >
                  {p}&deg;
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/30">
              {areaCoverage.polygon.length} vertices
            </span>
            {areaCoverage.polygon.length > 0 && (
              <div className="flex gap-1">
                <button onClick={removeLastPolygonVertex} className="text-[10px] text-white/30 hover:text-white/50">Undo</button>
                <button onClick={clearPolygon} className="text-[10px] text-white/30 hover:text-white/50">Clear</button>
              </div>
            )}
          </div>

          <button
            onClick={generateCoveragePath}
            disabled={!canEdit || !canGenerate}
            className={`w-full py-2 text-xs font-medium rounded-lg transition-colors ${
              canGenerate
                ? 'bg-teal/80 hover:bg-teal text-[#08090d]'
                : 'bg-white/[0.04] text-white/20'
            }`}
          >
            Generate Path
          </button>
        </div>
      )}
    </div>
  );
}

function WaypointItem({ waypoint, index, isExpanded, onToggle }: {
  waypoint: Waypoint;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { removeWaypoint, toggleMeasurement, mission } = useNavigation();
  const canEdit = mission.status === 'idle' || mission.status === 'planning';
  const isActive = mission.currentWaypointIndex === index;

  return (
    <div className={`rounded-lg overflow-hidden transition-colors ${
      waypoint.completed ? 'opacity-50' : ''
    } ${isActive ? 'ring-1 ring-teal/40' : ''}`}>
      <div
        className="flex items-center gap-2.5 py-2 px-2.5 cursor-pointer hover:bg-white/[0.03] transition-colors"
        onClick={onToggle}
      >
        <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-semibold shrink-0 ${
          waypoint.completed ? 'bg-emerald-500/70 text-white' : isActive ? 'bg-teal/70 text-white' : 'bg-white/10 text-white/60'
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
          <div className="text-white/75 text-xs truncate">{waypoint.name}</div>
          <div className="text-white/25 text-[10px] font-mono">
            {waypoint.lat.toFixed(5)}, {waypoint.lng.toFixed(5)}
          </div>
        </div>
        {waypoint.takeMeasurement && (
          <span className="text-[9px] text-white/30 bg-white/[0.06] px-1.5 py-0.5 rounded">
            {waypoint.measurementTypes.length}
          </span>
        )}
        <svg
          className={`w-3 h-3 text-white/20 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {isExpanded && (
        <div className="px-2.5 pb-2.5 pt-1 border-t border-white/[0.04]">
          <div className="grid grid-cols-2 gap-1">
            {MEASUREMENT_CONFIGS.map(config => {
              const active = waypoint.measurementTypes.includes(config.type);
              return (
                <button
                  key={config.type}
                  onClick={() => canEdit && toggleMeasurement(waypoint.id, config.type)}
                  disabled={!canEdit}
                  className={`text-left text-[10px] px-2 py-1.5 rounded transition-colors flex items-center gap-1.5 ${
                    active ? 'bg-white/10 text-white/75' : 'text-white/30 hover:bg-white/[0.04]'
                  } ${!canEdit ? 'opacity-40' : ''}`}
                >
                  <span className="text-xs">{config.icon}</span>
                  <span className="truncate">{config.label}</span>
                </button>
              );
            })}
          </div>
          {canEdit && (
            <button
              onClick={() => removeWaypoint(waypoint.id)}
              className="mt-2 w-full text-red-400/60 hover:text-red-400 hover:bg-red-500/[0.06] text-[10px] py-1.5 rounded transition-colors"
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function WaypointList() {
  const { mission } = useNavigation();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="px-3.5 py-2.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-medium text-white/25 uppercase tracking-[0.1em]">Waypoints</span>
        <span className="text-[10px] font-mono text-white/25">{mission.waypoints.length}</span>
      </div>

      {mission.waypoints.length === 0 ? (
        <div className="py-6 text-center">
          <div className="text-white/15 text-xs">Click map to add waypoints</div>
        </div>
      ) : (
        <div className="space-y-0.5">
          {mission.waypoints.map((wp, i) => (
            <WaypointItem
              key={wp.id}
              waypoint={wp}
              index={i}
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
      <button
        className="flex items-center justify-between w-full"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[9px] font-medium text-white/25 uppercase tracking-[0.1em]">Data Collection</span>
        <div className="flex items-center gap-2">
          {dataCollection.enabled && (
            <span className="text-[9px] text-teal font-medium">ON</span>
          )}
          <svg
            className={`w-3 h-3 text-white/20 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/30">Enabled</span>
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
            <div className="text-[10px] text-white/30 mb-1">Interval: {dataCollection.intervalMeters}m</div>
            <input
              type="range"
              min="10"
              max="200"
              step="10"
              value={dataCollection.intervalMeters}
              onChange={e => canEdit && updateDataCollection({ intervalMeters: Number(e.target.value) })}
              disabled={!canEdit}
              className="w-full h-1 appearance-none bg-white/10 rounded-full"
              style={{ accentColor: 'oklch(0.72 0.14 185)' }}
            />
          </div>

          <div className="grid grid-cols-2 gap-1">
            {MEASUREMENT_CONFIGS.map(config => {
              const active = dataCollection.measurementTypes.includes(config.type);
              return (
                <button
                  key={config.type}
                  onClick={() => canEdit && toggleDataCollectionMeasurement(config.type)}
                  disabled={!canEdit}
                  className={`text-left text-[10px] px-2 py-1.5 rounded transition-colors flex items-center gap-1.5 ${
                    active ? 'bg-white/10 text-white/75' : 'text-white/30 hover:bg-white/[0.04]'
                  } ${!canEdit ? 'opacity-40' : ''}`}
                >
                  <span className="text-xs">{config.icon}</span>
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
      <span className="text-[9px] font-medium text-white/25 uppercase tracking-[0.1em]">Latest Data</span>
      <div className="text-[10px] text-white/20 mt-0.5 mb-2">
        {wp?.name} &middot; {new Date(latest.timestamp).toLocaleTimeString()}
      </div>
      <div className="grid grid-cols-2 gap-1">
        {Object.entries(latest.values).map(([type, value]) => {
          const config = MEASUREMENT_CONFIGS.find(c => c.type === type);
          if (!config) return null;
          return (
            <div key={type} className="bg-white/[0.03] rounded-md px-2 py-1.5">
              <div className="text-[9px] text-white/25">{config.icon} {config.label}</div>
              <div className="text-xs font-mono text-white/70 mt-0.5">
                {(value as number).toFixed(1)} <span className="text-white/30">{config.unit}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Sidebar() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3.5 pt-3.5 pb-2 shrink-0">
        <div className="text-sm font-semibold text-white/80 tracking-tight">AquaNav</div>
      </div>

      <div className="h-px bg-white/[0.04]" />

      <MissionControls />

      <div className="h-px bg-white/[0.04]" />

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <WaypointModePane />
        <div className="h-px bg-white/[0.04]" />
        <WaypointList />
        <div className="h-px bg-white/[0.04]" />
        <DataCollectionPane />
        <MeasurementResults />
      </div>
    </div>
  );
}
