import { lazy, Suspense, useState } from 'react';
import { NavigationProvider, useNavigation } from './context/NavigationContext';
import { ReplayProvider } from './context/ReplayContext';
import { ErrorBanner, Sidebar, TelemetryPanel } from './components';
import Boat3DView from './components/Boat3DView';
import CameraView from './components/CameraView';
import ReplayBar from './components/ReplayBar';
import './App.css';

const MapView = lazy(() => import('./components/MapView'));
const LakeView3D = lazy(() => import('./components/LakeView3D'));

function AppInner() {
  const [cameraLive, setCameraLive] = useState(false);
  const { boat, camera, setCameraSettings, viewMode, setViewMode } = useNavigation();

  return (
    <div className="h-screen w-screen relative overflow-hidden" style={{ background: 'var(--background)' }}>
      {/* Full-screen map */}
      <div className="absolute inset-0">
        <Suspense fallback={
          <div className="w-full h-full flex items-center justify-center" style={{ background: '#0a0c14' }}>
            <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          </div>
        }>
          {viewMode === '2d' ? <MapView /> : <LakeView3D />}
        </Suspense>
      </div>

      {/* Left sidebar */}
      <aside className="absolute top-2.5 left-2.5 bottom-2.5 w-60 z-[1000]">
        <div className="h-full bg-panel/80 backdrop-blur-xl rounded-2xl border border-panel-border/60 shadow-2xl shadow-black/40 overflow-hidden">
          <Sidebar />
        </div>
      </aside>

      <ErrorBanner />

      {/* Top-left controls */}
      <div className="absolute top-2.5 z-[1000]" style={{ left: '16.25rem' }}>
        <div className="flex gap-1.5">
          {/* View toggle */}
          <div className="flex bg-panel/80 backdrop-blur-xl rounded-xl border border-panel-border/60 overflow-hidden">
            <button
              onClick={() => setViewMode('2d')}
              className={`px-3.5 py-1.5 text-xs font-medium tracking-wide transition-colors ${
                viewMode === '2d'
                  ? 'bg-white/8 text-white/90'
                  : 'text-white/35 hover:text-white/55'
              }`}
            >
              Map
            </button>
            <button
              onClick={() => setViewMode('3d')}
              className={`px-3.5 py-1.5 text-xs font-medium tracking-wide transition-colors ${
                viewMode === '3d'
                  ? 'bg-white/8 text-white/90'
                  : 'text-white/35 hover:text-white/55'
              }`}
            >
              3D
            </button>
          </div>
          {/* Camera toggle: lets the user re-enable when the box is hidden */}
          <button
            onClick={() => setCameraSettings({ ...camera, enabled: !camera.enabled })}
            className={`px-3 py-1.5 text-xs font-medium tracking-wide rounded-xl border backdrop-blur-xl transition-colors flex items-center gap-1.5 ${
              cameraLive
                ? 'bg-panel/80 border-panel-border/60 text-white/75 hover:text-white/90'
                : camera.enabled
                ? 'bg-amber-500/10 border-amber-500/25 text-amber-300 hover:bg-amber-500/15'
                : 'bg-panel/80 border-panel-border/60 text-white/35 hover:text-white/55'
            }`}
            title={cameraLive ? 'Disable camera' : camera.enabled ? 'Camera offline (click to disable)' : 'Enable camera'}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {cameraLive ? (
                <>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                </>
              ) : (
                <>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
                </>
              )}
            </svg>
            {cameraLive ? 'Camera' : camera.enabled ? 'Offline' : 'Camera'}
          </button>
        </div>
      </div>

      {/* Floating 3D boat view + camera — constrained between sidebars */}
      <div className="absolute -bottom-1 z-[999] flex items-end gap-3 pointer-events-none" style={{ left: '16.75rem', right: '16.75rem', justifyContent: 'center' }}>
        {/* Boat model */}
        <div className="w-[18rem] aspect-[4/3] shrink-0">
          <div className="relative w-full h-full">
            <div
              className="absolute pointer-events-none"
              style={{
                inset: '-40%',
                background:
                  'radial-gradient(ellipse 30% 25% at 50% 55%, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.45) 40%, rgba(0,0,0,0) 75%)',
                filter: 'blur(40px)',
              }}
            />
            <div className="relative w-full h-full">
              <Boat3DView quaternion={boat.quaternion} />
            </div>
          </div>
          <div className="flex justify-between px-2 mt-1 text-[9px] font-mono text-white/40">
            <span>H {boat.heading.toFixed(0)}&deg;</span>
            <span>R {boat.roll.toFixed(1)}&deg;</span>
            <span>P {boat.pitch.toFixed(1)}&deg;</span>
          </div>
        </div>
        {/* Live camera feed — wrapper is hidden via CSS while offline, but the
            component stays mounted so HLS can keep retrying in the background. */}
        <div className={`w-[18rem] aspect-[4/3] shrink-0 pointer-events-auto ${cameraLive ? '' : 'hidden'}`}>
          <CameraView onLiveChange={setCameraLive} />
          <div className="text-center mt-1 text-[9px] font-mono text-white/40">
            Camera
          </div>
        </div>
      </div>

      {/* Right telemetry panel */}
      <aside className="absolute top-2.5 right-2.5 bottom-2.5 w-60 z-[1000]">
        <div className="h-full bg-panel/80 backdrop-blur-xl rounded-2xl border border-panel-border/60 shadow-2xl shadow-black/40 overflow-hidden">
          <TelemetryPanel />
        </div>
      </aside>

      {/* Replay controls — pill button in live mode, full bar in replay mode. */}
      <ReplayBar />
    </div>
  );
}

export default function App() {
  // ReplayProvider wraps NavigationProvider because the latter consumes
  // replay state to swap the boat snapshot when scrubbing through history.
  return (
    <ReplayProvider>
      <NavigationProvider>
        <AppInner />
      </NavigationProvider>
    </ReplayProvider>
  );
}
