import { useNavigation } from '../context/NavigationContext';

export default function StatusBar() {
  const { boat, mission } = useNavigation();

  const mpsToKnots = (mps: number) => mps * 1.94384;

  return (
    <div className="h-14 flex items-center justify-between px-5">
      {/* Connection Status */}
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${boat.mqttConnected ? (boat.boatOnline ? 'bg-emerald-400' : 'bg-amber-400') : 'bg-red-400'}`} />
          <span className="text-white/50 text-sm">
            {boat.mqttConnected ? (boat.boatOnline ? 'Online' : 'MQTT OK / Boat Offline') : 'Disconnected'}
          </span>
        </div>

        {boat.uptime > 0 && (
          <>
            <div className="h-4 w-px bg-white/10" />
            <span className="text-white/40 text-xs font-mono">
              Up {Math.floor(boat.uptime / 60)}m {boat.uptime % 60}s
            </span>
          </>
        )}
      </div>

      {/* Boat Stats */}
      <div className="flex items-center gap-5">
        <div className="text-center">
          <div className="text-white/30 text-[10px] uppercase tracking-wider">Speed</div>
          <div className="text-white/80 font-medium text-sm">{mpsToKnots(boat.speed).toFixed(1)} <span className="text-white/40 text-xs">kn</span></div>
        </div>

        <div className="h-6 w-px bg-white/10" />

        <div className="text-center">
          <div className="text-white/30 text-[10px] uppercase tracking-wider">Heading</div>
          <div className="text-white/80 font-medium text-sm">{Math.round(boat.heading)}&deg;</div>
        </div>

        <div className="h-6 w-px bg-white/10" />

        <div className="text-center">
          <div className="text-white/30 text-[10px] uppercase tracking-wider">Position</div>
          <div className="text-white/80 font-medium text-xs font-mono">
            {boat.position.lat.toFixed(5)}, {boat.position.lng.toFixed(5)}
          </div>
        </div>
      </div>

      {/* Mission Info */}
      <div className="flex items-center gap-4">
        {mission.status !== 'idle' && (
          <>
            <div className="text-right">
              <div className="text-white/30 text-[10px] uppercase tracking-wider">Waypoints</div>
              <div className="text-white/80 font-medium text-sm">
                {mission.waypoints.filter((wp) => wp.completed).length}/{mission.waypoints.length}
              </div>
            </div>

            {boat.nav && boat.nav.mode === 'running' && (
              <div className="text-right">
                <div className="text-white/30 text-[10px] uppercase tracking-wider">Distance</div>
                <div className="text-white/80 font-medium text-sm">{boat.nav.distance_m.toFixed(0)}m</div>
              </div>
            )}
          </>
        )}

        <div className={`px-3 py-1.5 rounded-full text-xs font-medium ${
          mission.status === 'running'
            ? 'bg-white/10 text-white/80'
            : mission.status === 'paused'
            ? 'bg-amber-500/20 text-amber-400'
            : mission.status === 'completed'
            ? 'bg-emerald-500/20 text-emerald-400'
            : mission.status === 'planning'
            ? 'bg-white/10 text-white/60'
            : 'bg-white/5 text-white/40'
        }`}>
          {mission.status === 'running' && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-white mr-2 animate-pulse" />
          )}
          {mission.status.charAt(0).toUpperCase() + mission.status.slice(1)}
        </div>
      </div>
    </div>
  );
}
