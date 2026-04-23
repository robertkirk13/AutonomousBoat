import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigation } from '../context/NavigationContext';

type LeafletModule = typeof import('leaflet');
type ReactLeafletModule = typeof import('react-leaflet');

const GPS_CALIBRATION_SAMPLES = 5;
const GPS_CALIBRATION_INTERVAL_MS = 1000;

type GpsCalibrationPhase = 'idle' | 'sampling' | 'done' | 'error';

export default function MapView() {
  const { boat, mission, addWaypoint } = useNavigation();
  const [modules, setModules] = useState<{
    L: LeafletModule;
    RL: ReactLeafletModule;
  } | null>(null);

  useEffect(() => {
    Promise.all([
      import('leaflet'),
      import('react-leaflet'),
    ]).then(([leaflet, reactLeaflet]) => {
      if (!document.querySelector('link[href*="leaflet.css"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }
      setModules({
        L: leaflet.default,
        RL: reactLeaflet,
      });
    });
  }, []);

  if (!modules) {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: '#1a1a1a' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
          <div className="text-white/40">Loading map...</div>
        </div>
      </div>
    );
  }

  return (
    <MapContent
      L={modules.L}
      RL={modules.RL}
      boat={boat}
      mission={mission}
      addWaypoint={addWaypoint}
    />
  );
}

interface MapContentProps {
  L: LeafletModule;
  RL: ReactLeafletModule;
  boat: import('../types/index').BoatState;
  mission: import('../types/index').MissionState;
  addWaypoint: (lat: number, lng: number) => void;
}

function MapContent({ L, RL, boat, mission, addWaypoint }: MapContentProps) {
  const { MapContainer, TileLayer, Marker, Polyline, Polygon, useMapEvents } = RL;
  const {
    mapCenter,
    setMapCenter,
    waypointMode,
    areaCoverage,
    addPolygonVertex,
    controlMode,
    adjustGpsOffset,
    clearGpsOffset,
    registerGpsCalibrationTrigger,
    registerGpsCalibrationResetTrigger,
  } = useNavigation();
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [mapMode, setMapMode] = useState<'map' | 'satellite'>('map');
  const [gpsCalibration, setGpsCalibration] = useState<{
    phase: GpsCalibrationPhase;
    samples: number;
    message: string | null;
  }>({
    phase: 'idle',
    samples: 0,
    message: null,
  });

  useEffect(() => {
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        console.log('Error getting location:', error.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const MapClickHandler = useCallback(() => {
    useMapEvents({
      click: (e: { latlng: { lat: number; lng: number } }) => {
        if (controlMode === 'teleop') return;
        if (mission.status === 'idle' || mission.status === 'planning') {
          if (waypointMode === 'manual') {
            addWaypoint(e.latlng.lat, e.latlng.lng);
          } else if (waypointMode === 'area') {
            addPolygonVertex(e.latlng.lat, e.latlng.lng);
          }
        }
      },
    });
    return null;
  }, [mission.status, waypointMode, controlMode, addWaypoint, addPolygonVertex]);

  const mapRef = useRef<L.Map | null>(null);
  const boatPositionRef = useRef(boat.position);
  const calibrationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const calibrationMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevBoatOnlineRef = useRef(false);
  const hasSnappedToUserRef = useRef(false);

  boatPositionRef.current = boat.position;

  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setView([mapCenter.lat, mapCenter.lng], mapRef.current.getZoom());
    }
  }, [mapCenter]);

  // Snap to the boat whenever it transitions from offline to online.
  useEffect(() => {
    if (boat.boatOnline && !prevBoatOnlineRef.current) {
      setMapCenter(boatPositionRef.current.lat, boatPositionRef.current.lng);
    }
    prevBoatOnlineRef.current = boat.boatOnline;
  }, [boat.boatOnline, setMapCenter]);

  // Snap to the user's location the first time we get it, if no boat is online.
  useEffect(() => {
    if (userLocation && !hasSnappedToUserRef.current && !boat.boatOnline) {
      hasSnappedToUserRef.current = true;
      setMapCenter(userLocation.lat, userLocation.lng);
    }
  }, [userLocation, boat.boatOnline, setMapCenter]);

  useEffect(() => {
    return () => {
      if (calibrationIntervalRef.current) {
        clearInterval(calibrationIntervalRef.current);
      }
      if (calibrationMessageTimeoutRef.current) {
        clearTimeout(calibrationMessageTimeoutRef.current);
      }
    };
  }, []);

  const setCalibrationBanner = useCallback((phase: GpsCalibrationPhase, samples: number, message: string) => {
    if (calibrationMessageTimeoutRef.current) {
      clearTimeout(calibrationMessageTimeoutRef.current);
      calibrationMessageTimeoutRef.current = null;
    }
    setGpsCalibration({ phase, samples, message });
    if (phase === 'done' || phase === 'error') {
      calibrationMessageTimeoutRef.current = setTimeout(() => {
        setGpsCalibration({ phase: 'idle', samples: 0, message: null });
        calibrationMessageTimeoutRef.current = null;
      }, 5000);
    }
  }, []);

  const startGpsCalibration = useCallback(() => {
    if (!boat.boatOnline) {
      setCalibrationBanner('error', 0, 'Boat must be online to calibrate GPS.');
      return;
    }

    const center = mapRef.current?.getCenter();
    if (!center) {
      setCalibrationBanner('error', 0, 'Map center is unavailable right now.');
      return;
    }

    if (calibrationIntervalRef.current) {
      clearInterval(calibrationIntervalRef.current);
      calibrationIntervalRef.current = null;
    }

    const target = { lat: center.lat, lng: center.lng };
    const samples: Array<{ lat: number; lng: number }> = [];

    const collectSample = () => {
      samples.push({ ...boatPositionRef.current });

      if (samples.length >= GPS_CALIBRATION_SAMPLES) {
        if (calibrationIntervalRef.current) {
          clearInterval(calibrationIntervalRef.current);
          calibrationIntervalRef.current = null;
        }

        const avgLat = samples.reduce((sum, sample) => sum + sample.lat, 0) / samples.length;
        const avgLng = samples.reduce((sum, sample) => sum + sample.lng, 0) / samples.length;
        const deltaLat = target.lat - avgLat;
        const deltaLng = target.lng - avgLng;
        const northMeters = deltaLat * 111_320;
        const eastMeters = deltaLng * 111_320 * Math.cos(target.lat * Math.PI / 180);
        const correctionMeters = Math.hypot(northMeters, eastMeters);

        adjustGpsOffset(deltaLat, deltaLng);
        setCalibrationBanner('done', samples.length, `GPS aligned to map center. Applied ${correctionMeters.toFixed(1)} m correction.`);
        return;
      }

      setGpsCalibration({
        phase: 'sampling',
        samples: samples.length,
        message: `Hold the boat still while GPS is averaged (${samples.length}/${GPS_CALIBRATION_SAMPLES}).`,
      });
    };

    setGpsCalibration({
      phase: 'sampling',
      samples: 0,
      message: 'Hold the boat still while GPS is averaged (0/5).',
    });

    collectSample();
    calibrationIntervalRef.current = setInterval(collectSample, GPS_CALIBRATION_INTERVAL_MS);
  }, [adjustGpsOffset, boat.boatOnline, setCalibrationBanner]);

  useEffect(() => {
    registerGpsCalibrationTrigger(startGpsCalibration);
    return () => registerGpsCalibrationTrigger(null);
  }, [registerGpsCalibrationTrigger, startGpsCalibration]);

  const resetGpsCalibration = useCallback(() => {
    if (calibrationIntervalRef.current) {
      clearInterval(calibrationIntervalRef.current);
      calibrationIntervalRef.current = null;
    }
    clearGpsOffset();
    setCalibrationBanner('done', 0, 'GPS offset cleared.');
  }, [clearGpsOffset, setCalibrationBanner]);

  useEffect(() => {
    registerGpsCalibrationResetTrigger(resetGpsCalibration);
    return () => registerGpsCalibrationResetTrigger(null);
  }, [registerGpsCalibrationResetTrigger, resetGpsCalibration]);

  const userLocationIcon = useMemo(() => {
    return L.divIcon({
      className: 'user-location-marker',
      html: `
        <div style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;position:relative;">
          <div style="position:absolute;width:32px;height:32px;border-radius:50%;background:rgba(59,130,246,0.3);animation:pulse 2s ease-out infinite;"></div>
          <div style="width:16px;height:16px;border-radius:50%;background:rgba(59,130,246,0.9);border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>
        </div>
        <style>@keyframes pulse{0%{transform:scale(0.5);opacity:1}100%{transform:scale(1.5);opacity:0}}</style>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }, [L]);

  const boatIcon = useMemo(() => {
    const accent = 'oklch(0.65 0.17 50)';
    return L.divIcon({
      className: 'boat-marker',
      html: `
        <div style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;">
          <div style="position:absolute;width:14px;height:14px;border-radius:50%;background:rgba(20,22,30,0.85);border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.45);"></div>
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(${boat.heading}deg);">
            <path d="M20 4 L15 12 L25 12 Z" fill="${accent}" stroke="white" stroke-width="1.2" stroke-linejoin="round"/>
          </svg>
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }, [L, boat.heading]);

  const waypointIcons = useMemo(() => {
    const icons: Record<string, L.DivIcon> = {};

    mission.waypoints.forEach((waypoint, index) => {
      const completed = waypoint.completed || false;
      const isActive = mission.currentWaypointIndex === index;
      const hasMeasurement = waypoint.takeMeasurement;

      const bgColor = completed ? 'rgba(34, 197, 94, 0.9)' : isActive ? 'rgba(245, 158, 11, 0.9)' : 'rgba(255, 255, 255, 0.15)';
      const borderColor = completed ? 'rgba(34, 197, 94, 1)' : isActive ? 'rgba(245, 158, 11, 1)' : 'rgba(255, 255, 255, 0.4)';
      const textColor = completed || isActive ? 'white' : 'rgba(255, 255, 255, 0.8)';

      icons[waypoint.id] = L.divIcon({
        className: 'waypoint-marker',
        html: `
          <div style="width:32px;height:32px;border-radius:50%;background:${bgColor};border:2px solid ${borderColor};display:flex;align-items:center;justify-content:center;color:${textColor};font-weight:600;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,0.4);position:relative;backdrop-filter:blur(8px);">
            ${completed ? `<svg style="width:16px;height:16px;" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>` : index + 1}
            ${hasMeasurement ? `<div style="position:absolute;top:-3px;right:-3px;width:12px;height:12px;background:rgba(255,255,255,0.9);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:7px;color:rgba(0,0,0,0.7);font-weight:700;">M</div>` : ''}
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
    });

    return icons;
  }, [L, mission.waypoints, mission.currentWaypointIndex]);

  const polygonVertexIcon = useMemo(() => {
    return L.divIcon({
      className: 'polygon-vertex-marker',
      html: `<div style="width:16px;height:16px;border-radius:50%;background:rgba(59,130,246,0.9);border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }, [L]);

  const waypointPath = mission.waypoints.map((wp) => [wp.lat, wp.lng] as [number, number]);

  const fullPath = mission.status === 'running' && mission.currentWaypointIndex >= 0
    ? [[boat.position.lat, boat.position.lng] as [number, number], ...waypointPath.slice(mission.currentWaypointIndex)]
    : waypointPath;

  return (
    <div className="w-full h-full relative">
      <MapContainer
        center={[mapCenter.lat, mapCenter.lng]}
        zoom={15}
        className="w-full h-full"
        style={{ background: '#1a1a1a' }}
        ref={mapRef}
      >
        {mapMode === 'map' ? (
          <TileLayer
            key="map"
            attribution='&copy; <a href="https://stadiamaps.com/" target="_blank">Stadia Maps</a>'
            url="https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png"
          />
        ) : (
          <TileLayer
            key="satellite"
            attribution='&copy; <a href="https://www.esri.com/" target="_blank">Esri</a>'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        )}

        <MapClickHandler />

        {fullPath.length > 1 && (
          <Polyline
            positions={fullPath}
            pathOptions={{ color: 'rgba(255, 255, 255, 0.4)', weight: 2, opacity: 1, dashArray: '8, 8' }}
          />
        )}

        {mission.currentWaypointIndex > 0 && (
          <Polyline
            positions={[
              [boat.position.lat, boat.position.lng],
              ...waypointPath.slice(0, mission.currentWaypointIndex),
            ]}
            pathOptions={{ color: 'rgba(34, 197, 94, 0.6)', weight: 2, opacity: 1 }}
          />
        )}

        {mission.waypoints.map((waypoint) => (
          <Marker key={waypoint.id} position={[waypoint.lat, waypoint.lng]} icon={waypointIcons[waypoint.id]} />
        ))}

        {areaCoverage.polygon.length > 0 && (
          <>
            {areaCoverage.polygon.length >= 3 && (
              <Polygon
                positions={areaCoverage.polygon.map(p => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: 'rgba(59, 130, 246, 0.8)', fillColor: 'rgba(59, 130, 246, 0.2)', fillOpacity: 0.3, weight: 2 }}
              />
            )}
            {areaCoverage.polygon.length >= 2 && areaCoverage.polygon.length < 3 && (
              <Polyline
                positions={areaCoverage.polygon.map(p => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: 'rgba(59, 130, 246, 0.8)', weight: 2, dashArray: '5, 5' }}
              />
            )}
            {areaCoverage.polygon.map((vertex, index) => (
              <Marker key={`polygon-vertex-${index}`} position={[vertex.lat, vertex.lng]} icon={polygonVertexIcon} />
            ))}
          </>
        )}

        <Marker position={[boat.position.lat, boat.position.lng]} icon={boatIcon} />

        {userLocation && (
          <Marker position={[userLocation.lat, userLocation.lng]} icon={userLocationIcon} />
        )}
      </MapContainer>

      <div className="pointer-events-none absolute inset-0 z-[450] flex items-center justify-center">
        <div className="relative">
          <div className="absolute left-1/2 top-1/2 h-8 w-px -translate-x-1/2 -translate-y-1/2 bg-amber-300/55" />
          <div className="absolute left-1/2 top-1/2 h-px w-8 -translate-x-1/2 -translate-y-1/2 bg-amber-300/55" />
          <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-300/70 bg-amber-300/8" />
        </div>
      </div>

      <div className="absolute top-3 right-[16.5rem] z-[500] flex flex-col items-end gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMapCenter(boat.position.lat, boat.position.lng)}
            className="bg-panel/70 backdrop-blur-xl rounded-lg px-3 py-1.5 border border-panel-border/50 hover:bg-panel/90 transition-colors text-xs text-white/50 hover:text-white/70"
            title="Center on boat"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Center on boat">
              <title>Center on boat</title>
              <circle cx="12" cy="12" r="3" />
              <line x1="12" y1="2" x2="12" y2="6" />
              <line x1="12" y1="18" x2="12" y2="22" />
              <line x1="2" y1="12" x2="6" y2="12" />
              <line x1="18" y1="12" x2="22" y2="12" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setMapMode(mapMode === 'map' ? 'satellite' : 'map')}
            className="bg-panel/70 backdrop-blur-xl rounded-lg px-3 py-1.5 border border-panel-border/50 hover:bg-panel/90 transition-colors text-xs text-white/50 hover:text-white/70"
          >
            {mapMode === 'map' ? 'Satellite' : 'Map'}
          </button>
        </div>

        {gpsCalibration.message && (
          <div className="max-w-[18rem] rounded-xl border border-panel-border/50 bg-panel/72 px-3 py-2 text-[10px] leading-relaxed text-white/45 backdrop-blur-xl">
            {gpsCalibration.message}
          </div>
        )}
      </div>
    </div>
  );
}
