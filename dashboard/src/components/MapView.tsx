import { useEffect, useState, useMemo, useCallback } from 'react';
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
      <div className="w-full h-full flex items-center justify-center" style={{ background: '#1a1a2e' }}>
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
  const { MapContainer, TileLayer, Marker, Polyline, Polygon, useMapEvents, useMap } = RL;
  const { mapCenter, waypointMode, areaCoverage, addPolygonVertex, controlMode } = useNavigation();
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

  const MapCenterUpdater = useCallback(() => {
    const map = useMap();
    useEffect(() => {
      map.setView([mapCenter.lat, mapCenter.lng], map.getZoom());
    }, [mapCenter.lat, mapCenter.lng, map]);
    return null;
  }, [mapCenter.lat, mapCenter.lng]);

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
    return L.divIcon({
      className: 'boat-marker',
      html: `
        <div style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;transform:rotate(${boat.heading}deg);">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L4 20H12H20L12 2Z" fill="rgba(255,255,255,0.9)" stroke="rgba(255,255,255,1)" stroke-width="1"/>
            <circle cx="12" cy="12" r="3" fill="rgba(0,0,0,0.3)"/>
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
        center={[boat.position.lat, boat.position.lng]}
        zoom={15}
        className="w-full h-full"
        style={{ background: '#1a1a2e' }}
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
        <MapCenterUpdater />

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

      {controlMode === 'autonomous' && (mission.status === 'idle' || mission.status === 'planning') && (
        <div className="absolute top-3 left-[20.5rem] z-[500] bg-panel/70 backdrop-blur-xl rounded-lg px-3 py-2 border border-panel-border/50">
          <span className="text-white/40 text-xs">
            {waypointMode === 'manual'
              ? 'Click map to add waypoints'
              : areaCoverage.polygon.length < 3
                ? `Click to add vertices (${areaCoverage.polygon.length}/3 min)`
                : 'Add more vertices or generate from sidebar'
            }
          </span>
        </div>
      )}

      <div className="absolute top-3 right-[16.5rem] z-[500]">
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
