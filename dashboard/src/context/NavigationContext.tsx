import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import type { Waypoint, BoatState, MissionState, MeasurementType, DataCollectionConfig, WaypointMode, AreaCoverageConfig, ControlMode } from '../types/index';
import { useBoatMqtt } from '../hooks/useBoatMqtt';

interface NavigationContextType {
  boat: BoatState;
  mission: MissionState;
  addWaypoint: (lat: number, lng: number) => void;
  removeWaypoint: (id: string) => void;
  updateWaypoint: (id: string, updates: Partial<Waypoint>) => void;
  reorderWaypoints: (startIndex: number, endIndex: number) => void;
  toggleMeasurement: (waypointId: string, measurementType: MeasurementType) => void;
  startMission: () => void;
  pauseMission: () => void;
  resumeMission: () => void;
  stopMission: () => void;
  clearWaypoints: () => void;
  setMapCenter: (lat: number, lng: number) => void;
  mapCenter: { lat: number; lng: number; _v: number };
  updateDataCollection: (updates: Partial<DataCollectionConfig>) => void;
  toggleDataCollectionMeasurement: (measurementType: MeasurementType) => void;
  setBoatPosition: (lat: number, lng: number) => void;
  controlMode: ControlMode;
  setControlMode: (mode: ControlMode) => void;
  sendTeleop: (left: number, right: number) => void;
  waypointMode: WaypointMode;
  setWaypointMode: (mode: WaypointMode) => void;
  areaCoverage: AreaCoverageConfig;
  addPolygonVertex: (lat: number, lng: number) => void;
  removeLastPolygonVertex: () => void;
  clearPolygon: () => void;
  updateAreaCoverage: (updates: Partial<AreaCoverageConfig>) => void;
  generateCoveragePath: () => void;
}

const NavigationContext = createContext<NavigationContextType | null>(null);

export function useNavigation() {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
}

const DEFAULT_LAKE_CENTER = { lat: 47.6062, lng: -122.3321 };

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [mapCenter, setMapCenterState] = useState({ ...DEFAULT_LAKE_CENTER, _v: 0 });
  const waypointCountRef = useRef(0);

  // All boat state comes from MQTT
  const { boat, publish } = useBoatMqtt();

  const [mission, setMission] = useState<MissionState>({
    status: 'idle',
    waypoints: [],
    currentWaypointIndex: -1,
    measurements: [],
    dataCollection: {
      enabled: false,
      intervalMeters: 50,
      measurementTypes: [],
    },
  });

  const [controlMode, setControlModeState] = useState<ControlMode>('autonomous');
  const [waypointMode, setWaypointMode] = useState<WaypointMode>('manual');
  const [areaCoverage, setAreaCoverage] = useState<AreaCoverageConfig>({
    lineSpacing: 10,
    angle: 0,
    polygon: [],
  });

  const addWaypoint = useCallback((lat: number, lng: number) => {
    waypointCountRef.current += 1;
    const newWaypoint: Waypoint = {
      id: `wp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      lat,
      lng,
      name: `Waypoint ${waypointCountRef.current}`,
      takeMeasurement: false,
      measurementTypes: [],
      completed: false,
    };

    setMission((prev) => ({
      ...prev,
      status: prev.status === 'idle' ? 'planning' : prev.status,
      waypoints: [...prev.waypoints, newWaypoint],
    }));
  }, []);

  const removeWaypoint = useCallback((id: string) => {
    setMission((prev) => ({
      ...prev,
      waypoints: prev.waypoints.filter((wp) => wp.id !== id),
    }));
  }, []);

  const updateWaypoint = useCallback((id: string, updates: Partial<Waypoint>) => {
    setMission((prev) => ({
      ...prev,
      waypoints: prev.waypoints.map((wp) =>
        wp.id === id ? { ...wp, ...updates } : wp
      ),
    }));
  }, []);

  const reorderWaypoints = useCallback((startIndex: number, endIndex: number) => {
    setMission((prev) => {
      const newWaypoints = [...prev.waypoints];
      const [removed] = newWaypoints.splice(startIndex, 1);
      newWaypoints.splice(endIndex, 0, removed);
      return { ...prev, waypoints: newWaypoints };
    });
  }, []);

  const toggleMeasurement = useCallback((waypointId: string, measurementType: MeasurementType) => {
    setMission((prev) => ({
      ...prev,
      waypoints: prev.waypoints.map((wp) => {
        if (wp.id !== waypointId) return wp;
        const hasMeasurement = wp.measurementTypes.includes(measurementType);
        const newMeasurementTypes = hasMeasurement
          ? wp.measurementTypes.filter((t) => t !== measurementType)
          : [...wp.measurementTypes, measurementType];
        return {
          ...wp,
          measurementTypes: newMeasurementTypes,
          takeMeasurement: newMeasurementTypes.length > 0,
        };
      }),
    }));
  }, []);

  const updateDataCollection = useCallback((updates: Partial<DataCollectionConfig>) => {
    setMission((prev) => ({
      ...prev,
      dataCollection: { ...prev.dataCollection, ...updates },
    }));
  }, []);

  const toggleDataCollectionMeasurement = useCallback((measurementType: MeasurementType) => {
    setMission((prev) => {
      const hasMeasurement = prev.dataCollection.measurementTypes.includes(measurementType);
      const newMeasurementTypes = hasMeasurement
        ? prev.dataCollection.measurementTypes.filter((t) => t !== measurementType)
        : [...prev.dataCollection.measurementTypes, measurementType];
      return {
        ...prev,
        dataCollection: {
          ...prev.dataCollection,
          measurementTypes: newMeasurementTypes,
          enabled: newMeasurementTypes.length > 0 ? prev.dataCollection.enabled : false,
        },
      };
    });
  }, []);

  const startMission = useCallback(() => {
    if (mission.waypoints.length === 0) return;

    // Publish mission to firmware via MQTT
    const missionPayload = {
      waypoints: mission.waypoints.map((wp) => ({ lat: wp.lat, lon: wp.lng })),
    };
    publish('boat/mission/set', missionPayload);

    setMission((prev) => ({
      ...prev,
      status: 'running',
      currentWaypointIndex: 0,
      waypoints: prev.waypoints.map((wp) => ({ ...wp, completed: false })),
    }));
  }, [mission.waypoints, publish]);

  const pauseMission = useCallback(() => {
    // Send empty mission to stop the boat
    publish('boat/mission/set', { waypoints: [] });
    setMission((prev) => ({ ...prev, status: 'paused' }));
  }, [publish]);

  const resumeMission = useCallback(() => {
    // Re-send remaining waypoints
    const remaining = mission.waypoints.slice(mission.currentWaypointIndex);
    publish('boat/mission/set', {
      waypoints: remaining.map((wp) => ({ lat: wp.lat, lon: wp.lng })),
    });
    setMission((prev) => ({ ...prev, status: 'running' }));
  }, [mission.waypoints, mission.currentWaypointIndex, publish]);

  const stopMission = useCallback(() => {
    // Send empty mission to stop the boat
    publish('boat/mission/set', { waypoints: [] });
    setMission((prev) => ({
      ...prev,
      status: 'planning',
      currentWaypointIndex: -1,
      waypoints: prev.waypoints.map((wp) => ({ ...wp, completed: false })),
    }));
  }, [publish]);

  const clearWaypoints = useCallback(() => {
    publish('boat/mission/set', { waypoints: [] });
    waypointCountRef.current = 0;
    setMission((prev) => ({
      ...prev,
      status: 'idle',
      waypoints: [],
      currentWaypointIndex: -1,
      measurements: [],
    }));
  }, [publish]);

  const setMapCenter = useCallback((lat: number, lng: number) => {
    setMapCenterState((prev) => ({ lat, lng, _v: prev._v + 1 }));
  }, []);

  const setBoatPosition = useCallback((_lat: number, _lng: number) => {
    // No-op: boat position comes from MQTT GPS data
  }, []);

  const setControlMode = useCallback((mode: ControlMode) => {
    if (mode === 'teleop') {
      // Clear mission so nav autopilot goes idle
      publish('boat/mission/set', { waypoints: [] });
      setMission((prev) => ({
        ...prev,
        status: 'idle',
        waypoints: [],
        currentWaypointIndex: -1,
      }));
    } else {
      // Switching back to autonomous — stop teleop motors
      publish('boat/motor/set', { left: 0, right: 0 });
    }
    setControlModeState(mode);
  }, [publish]);

  const sendTeleop = useCallback((left: number, right: number) => {
    publish('boat/motor/set', { left, right });
  }, [publish]);

  const addPolygonVertex = useCallback((lat: number, lng: number) => {
    setAreaCoverage((prev) => ({
      ...prev,
      polygon: [...prev.polygon, { lat, lng }],
    }));
  }, []);

  const removeLastPolygonVertex = useCallback(() => {
    setAreaCoverage((prev) => ({
      ...prev,
      polygon: prev.polygon.slice(0, -1),
    }));
  }, []);

  const clearPolygon = useCallback(() => {
    setAreaCoverage((prev) => ({
      ...prev,
      polygon: [],
    }));
  }, []);

  const updateAreaCoverage = useCallback((updates: Partial<AreaCoverageConfig>) => {
    setAreaCoverage((prev) => ({ ...prev, ...updates }));
  }, []);

  const generateCoveragePath = useCallback(() => {
    if (areaCoverage.polygon.length < 3) return;

    const polygon = areaCoverage.polygon;
    const spacing = areaCoverage.lineSpacing;
    const angle = areaCoverage.angle * (Math.PI / 180);

    const centerLat = polygon.reduce((sum, p) => sum + p.lat, 0) / polygon.length;
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 111320 * Math.cos(centerLat * Math.PI / 180);

    const localPolygon = polygon.map(p => ({
      x: (p.lng - polygon[0].lng) * metersPerDegreeLng,
      y: (p.lat - polygon[0].lat) * metersPerDegreeLat,
    }));

    const rotatedPolygon = localPolygon.map(p => ({
      x: p.x * Math.cos(-angle) - p.y * Math.sin(-angle),
      y: p.x * Math.sin(-angle) + p.y * Math.cos(-angle),
    }));

    const minY = Math.min(...rotatedPolygon.map(p => p.y));
    const maxY = Math.max(...rotatedPolygon.map(p => p.y));

    const waypoints: { lat: number; lng: number }[] = [];
    let lineIndex = 0;

    for (let y = minY + spacing / 2; y <= maxY; y += spacing) {
      const intersections: number[] = [];

      for (let i = 0; i < rotatedPolygon.length; i++) {
        const p1 = rotatedPolygon[i];
        const p2 = rotatedPolygon[(i + 1) % rotatedPolygon.length];

        if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
          const t = (y - p1.y) / (p2.y - p1.y);
          const x = p1.x + t * (p2.x - p1.x);
          intersections.push(x);
        }
      }

      intersections.sort((a, b) => a - b);

      for (let i = 0; i < intersections.length - 1; i += 2) {
        const x1 = intersections[i];
        const x2 = intersections[i + 1];

        if (x1 < x2) {
          const start = lineIndex % 2 === 0 ? { x: x1, y } : { x: x2, y };
          const end = lineIndex % 2 === 0 ? { x: x2, y } : { x: x1, y };

          const startRotated = {
            x: start.x * Math.cos(angle) - start.y * Math.sin(angle),
            y: start.x * Math.sin(angle) + start.y * Math.cos(angle),
          };
          const endRotated = {
            x: end.x * Math.cos(angle) - end.y * Math.sin(angle),
            y: end.x * Math.sin(angle) + end.y * Math.cos(angle),
          };

          waypoints.push({
            lat: polygon[0].lat + startRotated.y / metersPerDegreeLat,
            lng: polygon[0].lng + startRotated.x / metersPerDegreeLng,
          });
          waypoints.push({
            lat: polygon[0].lat + endRotated.y / metersPerDegreeLat,
            lng: polygon[0].lng + endRotated.x / metersPerDegreeLng,
          });
        }
      }
      lineIndex++;
    }

    waypointCountRef.current = 0;
    const newWaypoints: Waypoint[] = waypoints.map((wp) => {
      waypointCountRef.current++;
      return {
        id: `wp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        lat: wp.lat,
        lng: wp.lng,
        name: `Coverage ${waypointCountRef.current}`,
        takeMeasurement: false,
        measurementTypes: [],
        completed: false,
      };
    });

    setMission((prev) => ({
      ...prev,
      status: 'planning',
      waypoints: newWaypoints,
    }));

    setAreaCoverage((prev) => ({ ...prev, polygon: [] }));
    setWaypointMode('manual');
  }, [areaCoverage.polygon, areaCoverage.lineSpacing, areaCoverage.angle]);

  // Sync mission status from firmware nav state
  // When nav reports completed/idle, update local mission status
  React.useEffect(() => {
    if (!boat.nav || mission.status !== 'running') return;

    const { mode, target_wp } = boat.nav;
    if (mode === 'completed') {
      setMission((prev) => ({
        ...prev,
        status: 'completed',
        currentWaypointIndex: -1,
        waypoints: prev.waypoints.map((wp) => ({ ...wp, completed: true })),
      }));
    } else if (mode === 'running') {
      setMission((prev) => ({
        ...prev,
        currentWaypointIndex: target_wp,
        waypoints: prev.waypoints.map((wp, i) => ({
          ...wp,
          completed: i < target_wp,
        })),
      }));
    }
  }, [boat.nav, mission.status]);

  return (
    <NavigationContext.Provider
      value={{
        boat,
        mission,
        addWaypoint,
        removeWaypoint,
        updateWaypoint,
        reorderWaypoints,
        toggleMeasurement,
        startMission,
        pauseMission,
        resumeMission,
        stopMission,
        clearWaypoints,
        setMapCenter,
        mapCenter,
        updateDataCollection,
        toggleDataCollectionMeasurement,
        setBoatPosition,
        controlMode,
        setControlMode,
        sendTeleop,
        waypointMode,
        setWaypointMode,
        areaCoverage,
        addPolygonVertex,
        removeLastPolygonVertex,
        clearPolygon,
        updateAreaCoverage,
        generateCoveragePath,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}
