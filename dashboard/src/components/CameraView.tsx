import { useState } from 'react';

const CAMERA_URL = import.meta.env.VITE_CAMERA_URL || 'http://boat.local:8554/stream';

export default function CameraView() {
  const [error, setError] = useState(false);

  return (
    <div className="w-full h-full rounded-xl overflow-hidden relative bg-black/40">
      {!error ? (
        <img
          src={CAMERA_URL}
          alt="Live camera feed"
          className="w-full h-full object-contain"
          onError={() => setError(true)}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-white/30 gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <span className="text-[10px] font-mono">Camera offline</span>
          <button
            onClick={() => setError(false)}
            className="text-[9px] font-mono text-white/20 hover:text-white/40 transition-colors mt-1 pointer-events-auto"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
