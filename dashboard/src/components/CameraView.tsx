import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Hls from 'hls.js';
import { useNavigation } from '../context/NavigationContext';
import { CAMERA_RESOLUTIONS, CAMERA_FPS_OPTIONS } from '../types/index';

// VITE_CAMERA_URL is the *base* URL (no trailing slash); the playlist
// path is appended below. Default works for on-LAN dev; the cellular
// build sets it to the Cloudflare Tunnel hostname.
const CAMERA_BASE = (import.meta.env.VITE_CAMERA_URL || 'http://boat.local:8554').replace(/\/$/, '');
const HLS_URL = `${CAMERA_BASE}/hls/stream.m3u8`;

interface CameraViewProps {
  onLiveChange?: (live: boolean) => void;
}

export default function CameraView({ onLiveChange }: CameraViewProps = {}) {
  const { boat, camera, setCameraSettings } = useNavigation();
  const [error, setError] = useState(false);
  const [streamReady, setStreamReady] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Cache-buster so restarting the service on resolution change forces the
  // <video> to re-request the stream instead of replaying stale chunks.
  const [streamKey, setStreamKey] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const isLive = boat.boatOnline && camera.enabled && streamReady && !error;

  useEffect(() => {
    onLiveChange?.(isLive);
  }, [isLive, onLiveChange]);

  useLayoutEffect(() => {
    if (!boat.boatOnline || !camera.enabled) {
      // Reset before paint so the parent never briefly shows stale video.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStreamReady(false);
      setError(false);
    }
    if (!boat.boatOnline) {
      setExpanded(false);
      setSettingsOpen(false);
    }
  }, [boat.boatOnline, camera.enabled]);

  useEffect(() => {
    if (!boat.boatOnline || !camera.enabled) return;
    const video = videoRef.current;
    if (!video) return;

    const markReady = () => setStreamReady(true);
    const markError = () => {
      setStreamReady(false);
      setError(true);
    };

    video.addEventListener('loadeddata', markReady);
    video.addEventListener('canplay', markReady);
    video.addEventListener('playing', markReady);
    video.addEventListener('error', markError);

    let hls: Hls | null = null;
    if (Hls.isSupported()) {
      hls = new Hls({
        lowLatencyMode: true,
        // Stay close to live: ~2s sync target, 5s upper bound. The HLS
        // segments themselves are 1s so this leaves only a couple of
        // segments of jitter buffer.
        liveSyncDuration: 2,
        liveMaxLatencyDuration: 5,
        maxBufferLength: 6,
        // The boat's playlist always has omit_endlist; treat it as live.
        liveDurationInfinity: true,
      });
      hls.loadSource(HLS_URL);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) markError();
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari (incl. iOS) plays HLS natively without hls.js.
      video.src = HLS_URL;
    } else {
      markError();
    }

    return () => {
      if (hls) hls.destroy();
      video.removeEventListener('loadeddata', markReady);
      video.removeEventListener('canplay', markReady);
      video.removeEventListener('playing', markReady);
      video.removeEventListener('error', markError);
    };
  }, [boat.boatOnline, camera.enabled, streamKey]);

  // Auto-retry after a fatal error so the stream recovers when the boat is
  // reachable again — without this the box stays hidden until the user toggles.
  useEffect(() => {
    if (!boat.boatOnline || !camera.enabled || !error) return;
    const t = setInterval(() => {
      setStreamReady(false);
      setError(false);
      setStreamKey(k => k + 1);
    }, 8000);
    return () => clearInterval(t);
  }, [boat.boatOnline, camera.enabled, error]);

  const toggleEnabled = () => {
    setCameraSettings({ ...camera, enabled: !camera.enabled });
    setStreamKey(k => k + 1);
    setStreamReady(false);
    setError(false);
  };

  const applyResolution = (width: number, height: number) => {
    if (width === camera.width && height === camera.height) return;
    setCameraSettings({ ...camera, width, height });
    setStreamKey(k => k + 1);
    setStreamReady(false);
    setError(false);
  };

  const applyFps = (fps: number) => {
    if (fps === camera.fps) return;
    setCameraSettings({ ...camera, fps });
    setStreamKey(k => k + 1);
    setStreamReady(false);
    setError(false);
  };

  const inner = (
    <div
      className={
        expanded
          ? 'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(60vw,calc(100vw-34rem))] aspect-[4/3] max-h-[80vh] z-[2000] pointer-events-auto'
          : 'w-full h-full relative'
      }
    >
      {/* Top-right control buttons */}
      <div className="absolute top-1.5 right-1.5 z-10 flex gap-1 pointer-events-auto">
        <button
          type="button"
          onClick={() => setSettingsOpen(prev => !prev)}
          className={`w-6 h-6 flex items-center justify-center rounded-md transition-colors ${
            settingsOpen
              ? 'bg-white/20 text-white/90'
              : 'bg-black/50 hover:bg-black/70 text-white/50 hover:text-white/80'
          }`}
          title="Camera settings"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} role="img"><title>Camera settings</title>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setExpanded(prev => !prev)}
          className="w-6 h-6 flex items-center justify-center rounded-md bg-black/50 hover:bg-black/70 text-white/50 hover:text-white/80 transition-colors"
          title={expanded ? 'Collapse camera' : 'Expand camera'}
        >
          {expanded ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} role="img"><title>Collapse camera</title>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4M9 9H4M9 9L4 4M15 9V4M15 9h5M15 9l5-5M9 15v5M9 15H4m5 0l-5 5M15 15v5m0-5h5m-5 0l5 5" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} role="img"><title>Expand camera</title>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={toggleEnabled}
          className="w-6 h-6 flex items-center justify-center rounded-md bg-black/50 hover:bg-black/70 text-white/50 hover:text-white/80 transition-colors"
          title={camera.enabled ? 'Disable camera' : 'Enable camera'}
        >
          {camera.enabled ? (
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
      </div>

      {settingsOpen && (
        <div className="absolute top-9 right-1.5 z-20 w-48 rounded-lg bg-black/80 backdrop-blur-md border border-white/10 p-2.5 pointer-events-auto shadow-xl">
          <div className="text-[9px] uppercase tracking-wider text-white/40 mb-1.5">Resolution</div>
          <div className="grid grid-cols-2 gap-1 mb-2.5">
            {CAMERA_RESOLUTIONS.map(r => {
              const active = r.width === camera.width && r.height === camera.height;
              return (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => applyResolution(r.width, r.height)}
                  className={`px-2 py-1 rounded text-[10px] font-mono transition-colors ${
                    active
                      ? 'bg-white/15 text-white/90'
                      : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80'
                  }`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
          <div className="text-[9px] uppercase tracking-wider text-white/40 mb-1.5">Frame rate</div>
          <div className="grid grid-cols-4 gap-1">
            {CAMERA_FPS_OPTIONS.map(fps => {
              const active = fps === camera.fps;
              return (
                <button
                  key={fps}
                  type="button"
                  onClick={() => applyFps(fps)}
                  className={`px-1 py-1 rounded text-[10px] font-mono transition-colors ${
                    active
                      ? 'bg-white/15 text-white/90'
                      : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80'
                  }`}
                >
                  {fps}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="w-full h-full rounded-2xl overflow-hidden bg-black/60 border border-white/10">
        {boat.boatOnline && camera.enabled && !error ? (
          <video
            key={streamKey}
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-contain rotate-180"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-white/30 gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} role="img"><title>Camera offline</title>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <span className="text-[10px] font-mono">{camera.enabled ? 'Camera offline' : 'Camera disabled'}</span>
            {boat.boatOnline && camera.enabled && (
              <button
                type="button"
                onClick={() => {
                  setStreamReady(false);
                  setError(false);
                  setStreamKey(k => k + 1);
                }}
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

  if (expanded) {
    return createPortal(
      <div className="fixed inset-0 z-[1999] pointer-events-auto" onClick={() => setExpanded(false)}>
        <div onClick={e => e.stopPropagation()} className="w-full h-full">
          {inner}
        </div>
      </div>,
      document.body,
    );
  }

  return inner;
}
