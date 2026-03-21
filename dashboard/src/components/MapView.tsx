import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigation } from '../context/NavigationContext';

type LeafletModule = typeof import('leaflet');
type ReactLeafletModule = typeof import('react-leaflet');

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
  const { mapCenter, setMapCenter, waypointMode, areaCoverage, addPolygonVertex, controlMode } = useNavigation();
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [mapMode, setMapMode] = useState<'map' | 'satellite'>('map');

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

  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setView([mapCenter.lat, mapCenter.lng], mapRef.current.getZoom());
    }
  }, [mapCenter]);

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
        <div style="width:56px;height:56px;display:flex;align-items:center;justify-content:center;transform:rotate(${boat.heading}deg);">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <!-- Outer glow -->
            <defs>
              <radialGradient id="boat-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="${accent}" stop-opacity="0.25"/>
                <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
              </radialGradient>
              <filter id="boat-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#000" flood-opacity="0.5"/>
              </filter>
            </defs>
            <circle cx="24" cy="24" r="20" fill="url(#boat-glow)"/>
            <!-- Heading cone -->
            <path d="M24 4 L20 16 L28 16 Z" fill="${accent}" opacity="0.2"/>
            <!-- Hull -->
            <path d="M24 8 L17 28 C17 32 19 36 24 38 C29 36 31 32 31 28 Z" fill="rgba(20,22,30,0.9)" stroke="rgba(255,255,255,0.6)" stroke-width="1.2" stroke-linejoin="round" filter="url(#boat-shadow)"/>
            <!-- Keel line -->
            <line x1="24" y1="12" x2="24" y2="34" stroke="rgba(255,255,255,0.12)" stroke-width="0.8"/>
            <!-- Deck -->
            <ellipse cx="24" cy="24" rx="4.5" ry="7" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.15)" stroke-width="0.6"/>
            <!-- Bow accent -->
            <circle cx="24" cy="13" r="2" fill="${accent}" opacity="0.9"/>
            <!-- Stern marks -->
            <line x1="20" y1="32" x2="28" y2="32" stroke="rgba(255,255,255,0.2)" stroke-width="0.6" stroke-linecap="round"/>
          </svg>
        </div>
      `,
      iconSize: [56, 56],
      iconAnchor: [28, 28],
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
        center={[boat.position.lat, boat.position.lng]}
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

      <div className="absolute top-3 right-[16.5rem] z-[500] flex gap-2">
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
          onClick={() => setMapMode(mapMode === 'map' ? 'satellite' : 'map')}
          className="bg-panel/70 backdrop-blur-xl rounded-lg px-3 py-1.5 border border-panel-border/50 hover:bg-panel/90 transition-colors text-xs text-white/50 hover:text-white/70"
        >
          {mapMode === 'map' ? 'Satellite' : 'Map'}
        </button>
      </div>
    </div>
  );
}
