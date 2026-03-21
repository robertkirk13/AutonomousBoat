import { useState } from 'react';

const CAMERA_URL = import.meta.env.VITE_CAMERA_URL || 'http://boat.local:8554/stream';

export default function CameraView({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  const [error, setError] = useState(false);

  return (
    <div className="w-full h-full relative">
      {/* Toggle button */}
      <button
        type="button"
        onClick={onToggle}
        className="absolute top-1.5 right-1.5 z-10 w-6 h-6 flex items-center justify-center rounded-md bg-black/50 hover:bg-black/70 text-white/50 hover:text-white/80 transition-colors pointer-events-auto"
        title={enabled ? 'Disable camera' : 'Enable camera'}
      >
        {enabled ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} role="img"><title>Disable camera</title>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} role="img"><title>Enable camera</title>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M3 3l18 18" />
          </svg>
        )}
      </button>

      <div className="w-full h-full rounded-2xl overflow-hidden bg-black/60 border border-white/10">
        {enabled && !error ? (
          <img
            src={CAMERA_URL}
            alt="Live camera feed"
            className="w-full h-full object-contain rotate-180"
            onError={() => setError(true)}
            onLoad={() => setError(false)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-white/30 gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} role="img"><title>Camera offline</title>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <span className="text-[10px] font-mono">{enabled ? 'Camera offline' : 'Camera disabled'}</span>
            {enabled && (
              <button
                type="button"
                onClick={() => setError(false)}
                className="text-[9px] font-mono text-white/20 hover:text-white/40 transition-colors mt-1 pointer-events-auto"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
