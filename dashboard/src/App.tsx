import { lazy, useCallback, Suspense, useState } from 'react';
import { NavigationProvider, useNavigation } from './context/NavigationContext';
import { Sidebar, TelemetryPanel } from './components';
import Boat3DView from './components/Boat3DView';
import CameraView from './components/CameraView';
import './App.css';

const MapView = lazy(() => import('./components/MapView'));
const LakeView3D = lazy(() => import('./components/LakeView3D'));

type ViewMode = '2d' | '3d';

function AppInner() {
  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const { boat } = useNavigation();
  const toggleCamera = useCallback(() => setCameraEnabled(prev => !prev), []);

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
        </div>
      </div>

      {/* Floating 3D boat view + camera — constrained between sidebars */}
      <div className="absolute -bottom-1 z-[999] flex items-end gap-3 pointer-events-none" style={{ left: '16.75rem', right: '16.75rem', justifyContent: 'center' }}>
        {/* Boat model */}
        <div className="w-[18rem] aspect-[4/3] shrink-0">
          <div className="w-full h-full rounded-2xl overflow-hidden border border-white/10 bg-black/60">
            <Boat3DView quaternion={boat.quaternion} />
          </div>
          <div className="flex justify-between px-2 mt-1 text-[9px] font-mono text-white/40">
            <span>H {boat.heading.toFixed(0)}&deg;</span>
            <span>R {boat.roll.toFixed(1)}&deg;</span>
            <span>P {boat.pitch.toFixed(1)}&deg;</span>
          </div>
        </div>
        {/* Live camera feed */}
        <div className="w-[18rem] aspect-[4/3] shrink-0 pointer-events-auto">
          <CameraView enabled={cameraEnabled} onToggle={toggleCamera} />
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
    </div>
  );
}

export default function App() {
  return (
    <NavigationProvider>
      <AppInner />
    </NavigationProvider>
  );
}
