import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import type {
  Waypoint, BoatState, MissionState, MeasurementType, DataCollectionConfig,
  ClickMode, AreaCoverageConfig, ControlMode, CameraSettings, MotorConfig, NavParams,
  SavedMission, MissionSchedule, ScheduleRepeat, Zone, ZoneKind,
} from '../types/index';
import { useBoatMqtt } from '../hooks/useBoatMqtt';
import { useReplayContext } from './ReplayContext';

export type ViewMode = '2d' | '3d';

interface NavigationContextType {
  boat: BoatState;
  mission: MissionState;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  measurementType: MeasurementType;
  setMeasurementType: (type: MeasurementType) => void;
  addWaypoint: (lat: number, lng: number) => void;
  removeWaypoint: (id: string) => void;
  updateWaypoint: (id: string, updates: Partial<Waypoint>) => void;
  reorderWaypoints: (startIndex: number, endIndex: number) => void;
  moveWaypoint: (id: string, direction: 'up' | 'down') => void;
  duplicateWaypoint: (id: string) => void;
  reverseWaypoints: () => void;
  setWaypointAsStart: (id: string) => void;
  insertWaypointAt: (lat: number, lng: number, afterId: string | null) => void;
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
  motorConfig: MotorConfig;
  setMotorConfig: (config: MotorConfig) => void;
  navParams: NavParams;
  setNavParams: (params: NavParams) => void;
  adjustGpsOffset: (deltaLat: number, deltaLng: number) => void;
  clearGpsOffset: () => void;
  calibrateUpright: () => void;
  calibrateCompass: () => void;
  triggerGpsCalibration: () => void;
  registerGpsCalibrationTrigger: (fn: (() => void) | null) => void;
  triggerGpsCalibrationReset: () => void;
  registerGpsCalibrationResetTrigger: (fn: (() => void) | null) => void;
  rebootPi: () => void;
  powerOffPi: () => void;
  reinitMotors: () => void;
  calibrateMotors: () => void;
  camera: CameraSettings;
  setCameraSettings: (settings: CameraSettings) => void;
  clickMode: ClickMode;
  setClickMode: (mode: ClickMode) => void;
  areaCoverage: AreaCoverageConfig;
  addPolygonVertex: (lat: number, lng: number) => void;
  removeLastPolygonVertex: () => void;
  clearPolygon: () => void;
  updateAreaCoverage: (updates: Partial<AreaCoverageConfig>) => void;
  generateCoveragePath: () => void;
  zones: Zone[];
  draftZone: { kind: ZoneKind; vertices: { lat: number; lng: number }[] } | null;
  addDraftZoneVertex: (lat: number, lng: number) => void;
  removeLastDraftZoneVertex: () => void;
  cancelDraftZone: () => void;
  saveDraftZone: (name?: string) => void;
  removeZone: (id: string) => void;
  renameZone: (id: string, name: string) => void;
  savedMissions: SavedMission[];
  saveCurrentMission: (name: string) => SavedMission | null;
  loadSavedMission: (id: string) => void;
  deleteSavedMission: (id: string) => void;
  renameSavedMission: (id: string, name: string) => void;
  schedules: MissionSchedule[];
  createSchedule: (input: { missionId: string; startAt: number; repeat: ScheduleRepeat }) => void;
  updateSchedule: (id: string, updates: Partial<Pick<MissionSchedule, 'startAt' | 'repeat' | 'enabled' | 'missionId'>>) => void;
  deleteSchedule: (id: string) => void;
}

const NavigationContext = createContext<NavigationContextType | null>(null);

export function useNavigation() {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
}

const DEFAULT_LAKE_CENTER = { lat: 30.2672, lng: -97.7431 };

const STORAGE_KEYS = {
  waypoints: 'castaway:waypoints',
  dataCollection: 'castaway:dataCollection',
  savedMissions: 'castaway:savedMissions',
  schedules: 'castaway:schedules',
  zones: 'castaway:zones',
} as const;

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage may be unavailable (private mode, quota) — silently skip.
  }
}

function newId(prefix: string): string {
  // crypto.randomUUID is available in all modern browsers and Node ≥ 19.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

const REPEAT_INTERVAL_MS: Record<ScheduleRepeat, number> = {
  none: 0,
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
};

function nextOccurrence(startAt: number, repeat: ScheduleRepeat, now: number): number {
  const interval = REPEAT_INTERVAL_MS[repeat];
  if (interval === 0 || startAt > now) return startAt;
  const elapsed = now - startAt;
  const periods = Math.ceil(elapsed / interval);
  return startAt + periods * interval;
}

export function NavigationProvider({
  children,
  boatKey,
}: {
  children: React.ReactNode;
  boatKey: string | null;
}) {
  const [mapCenter, setMapCenterState] = useState({ ...DEFAULT_LAKE_CENTER, _v: 0 });
  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [measurementType, setMeasurementType] = useState<MeasurementType>('depth');

  const {
    boat: liveBoat,
    camera,
    motorConfig,
    navParams,
    publish,
    calibrateUpright,
    calibrateCompass,
    rebootPi,
    powerOffPi,
    setCameraSettings,
    setMotorConfig,
    setNavParams,
  } = useBoatMqtt(boatKey);

  // Swap the live MQTT boat state for the replay-synthesized state when
  // the user is scrubbing through history. All downstream panels read
  // `boat` from this context, so they don't need to know the source.
  const { mode: replayMode, replayBoat } = useReplayContext();
  const boat: BoatState = replayMode === 'replay' && replayBoat ? replayBoat : liveBoat;

  const [mission, setMission] = useState<MissionState>(() => {
    const persistedWaypoints = loadFromStorage<Waypoint[]>(STORAGE_KEYS.waypoints, []);
    const persistedDataCollection = loadFromStorage<DataCollectionConfig>(
      STORAGE_KEYS.dataCollection,
      { enabled: false, intervalMeters: 50, measurementTypes: [] },
    );
    return {
      status: persistedWaypoints.length > 0 ? 'planning' : 'idle',
      waypoints: persistedWaypoints.map(wp => ({ ...wp, completed: false })),
      currentWaypointIndex: -1,
      measurements: [],
      dataCollection: persistedDataCollection,
    };
  });

  const [controlMode, setControlModeState] = useState<ControlMode>('autonomous');
  const [clickMode, setClickModeState] = useState<ClickMode>('none');
  const [areaCoverage, setAreaCoverage] = useState<AreaCoverageConfig>({
    lineSpacing: 10,
    angle: 0,
    polygon: [],
  });
  const [zones, setZones] = useState<Zone[]>(() =>
    loadFromStorage<Zone[]>(STORAGE_KEYS.zones, []),
  );
  const [draftZone, setDraftZone] = useState<{ kind: ZoneKind; vertices: { lat: number; lng: number }[] } | null>(null);

  const [savedMissions, setSavedMissions] = useState<SavedMission[]>(() =>
    loadFromStorage<SavedMission[]>(STORAGE_KEYS.savedMissions, []),
  );
  const [schedules, setSchedules] = useState<MissionSchedule[]>(() =>
    loadFromStorage<MissionSchedule[]>(STORAGE_KEYS.schedules, []),
  );

  useEffect(() => {
    saveToStorage(STORAGE_KEYS.waypoints, mission.waypoints.map(wp => ({ ...wp, completed: false })));
  }, [mission.waypoints]);

  useEffect(() => {
    saveToStorage(STORAGE_KEYS.dataCollection, mission.dataCollection);
  }, [mission.dataCollection]);

  useEffect(() => {
    saveToStorage(STORAGE_KEYS.savedMissions, savedMissions);
  }, [savedMissions]);

  useEffect(() => {
    saveToStorage(STORAGE_KEYS.schedules, schedules);
  }, [schedules]);

  useEffect(() => {
    saveToStorage(STORAGE_KEYS.zones, zones);
  }, [zones]);

  // Switching click mode resets any in-flight drawing so each tool starts clean.
  // Picking 'zone-allow' / 'zone-exclude' opens a fresh draft of that kind.
  const setClickMode = useCallback((mode: ClickMode) => {
    setClickModeState((prev) => {
      if (prev === mode) return prev;
      if (prev === 'area' && mode !== 'area') {
        setAreaCoverage((p) => ({ ...p, polygon: [] }));
      }
      if (mode === 'zone-allow') {
        setDraftZone({ kind: 'allow', vertices: [] });
      } else if (mode === 'zone-exclude') {
        setDraftZone({ kind: 'exclude', vertices: [] });
      } else {
        setDraftZone(null);
      }
      return mode;
    });
  }, []);

  const addWaypoint = useCallback((lat: number, lng: number) => {
    setMission((prev) => {
      const newWaypoint: Waypoint = {
        id: newId('wp'),
        lat,
        lng,
        name: `Waypoint ${prev.waypoints.length + 1}`,
        takeMeasurement: false,
        measurementTypes: [],
        completed: false,
      };
      return {
        ...prev,
        status: prev.status === 'idle' ? 'planning' : prev.status,
        waypoints: [...prev.waypoints, newWaypoint],
      };
    });
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

  const moveWaypoint = useCallback((id: string, direction: 'up' | 'down') => {
    setMission((prev) => {
      const idx = prev.waypoints.findIndex(wp => wp.id === id);
      if (idx === -1) return prev;
      const target = direction === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.waypoints.length) return prev;
      const next = [...prev.waypoints];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...prev, waypoints: next };
    });
  }, []);

  // Append a copy of an existing waypoint to the end. Clicking the first
  // waypoint produces a closed loop; clicking any other lets the boat revisit
  // that point at the end of the run.
  const duplicateWaypoint = useCallback((id: string) => {
    setMission((prev) => {
      const src = prev.waypoints.find(wp => wp.id === id);
      if (!src) return prev;
      const copy: Waypoint = {
        id: newId('wp'),
        lat: src.lat,
        lng: src.lng,
        name: `${src.name} ↻`,
        takeMeasurement: false,
        measurementTypes: [],
        completed: false,
      };
      return {
        ...prev,
        status: prev.status === 'idle' ? 'planning' : prev.status,
        waypoints: [...prev.waypoints, copy],
      };
    });
  }, []);

  const reverseWaypoints = useCallback(() => {
    setMission((prev) => ({
      ...prev,
      waypoints: [...prev.waypoints].reverse().map(wp => ({ ...wp, completed: false })),
    }));
  }, []);

  const setWaypointAsStart = useCallback((id: string) => {
    setMission((prev) => {
      const idx = prev.waypoints.findIndex(wp => wp.id === id);
      if (idx <= 0) return prev;
      const next = [...prev.waypoints];
      const [picked] = next.splice(idx, 1);
      next.unshift(picked);
      return { ...prev, waypoints: next };
    });
  }, []);

  const insertWaypointAt = useCallback((lat: number, lng: number, afterId: string | null) => {
    setMission((prev) => {
      const newWaypoint: Waypoint = {
        id: newId('wp'),
        lat,
        lng,
        name: `Waypoint ${prev.waypoints.length + 1}`,
        takeMeasurement: false,
        measurementTypes: [],
        completed: false,
      };
      if (afterId === null) {
        return {
          ...prev,
          status: prev.status === 'idle' ? 'planning' : prev.status,
          waypoints: [...prev.waypoints, newWaypoint],
        };
      }
      const idx = prev.waypoints.findIndex(wp => wp.id === afterId);
      if (idx === -1) {
        return {
          ...prev,
          status: prev.status === 'idle' ? 'planning' : prev.status,
          waypoints: [...prev.waypoints, newWaypoint],
        };
      }
      const next = [...prev.waypoints];
      next.splice(idx + 1, 0, newWaypoint);
      return {
        ...prev,
        status: prev.status === 'idle' ? 'planning' : prev.status,
        waypoints: next,
      };
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

  const startMissionRef = useRef<() => void>(() => {});

  const startMission = useCallback(() => {
    setMission((prev) => {
      if (prev.waypoints.length === 0) return prev;
      publish('boat/mission/set', {
        waypoints: prev.waypoints.map((wp) => ({ lat: wp.lat, lon: wp.lng })),
      });
      return {
        ...prev,
        status: 'running',
        currentWaypointIndex: 0,
        waypoints: prev.waypoints.map((wp) => ({ ...wp, completed: false })),
      };
    });
  }, [publish]);

  useEffect(() => {
    startMissionRef.current = startMission;
  });

  const pauseMission = useCallback(() => {
    publish('boat/mission/set', { waypoints: [] });
    setMission((prev) => ({ ...prev, status: 'paused' }));
  }, [publish]);

  const resumeMission = useCallback(() => {
    setMission((prev) => {
      const remaining = prev.waypoints.slice(Math.max(prev.currentWaypointIndex, 0));
      publish('boat/mission/set', {
        waypoints: remaining.map((wp) => ({ lat: wp.lat, lon: wp.lng })),
      });
      return { ...prev, status: 'running' };
    });
  }, [publish]);

  const stopMission = useCallback(() => {
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
      publish('boat/mission/set', { waypoints: [] });
      setMission((prev) => ({
        ...prev,
        status: prev.waypoints.length > 0 ? 'planning' : 'idle',
        currentWaypointIndex: -1,
        waypoints: prev.waypoints.map(wp => ({ ...wp, completed: false })),
      }));
    } else {
      publish('boat/motor/set', { left: 0, right: 0 });
    }
    setControlModeState(mode);
  }, [publish]);

  const sendTeleop = useCallback((left: number, right: number) => {
    publish('boat/motor/set', { left, right });
  }, [publish]);

  const adjustGpsOffset = useCallback((deltaLat: number, deltaLng: number) => {
    publish('boat/command', {
      action: 'gps_adjust_offset',
      delta_lat: deltaLat,
      delta_lon: deltaLng,
    });
  }, [publish]);

  const clearGpsOffset = useCallback(() => {
    publish('boat/command', { action: 'gps_clear_offset' });
  }, [publish]);

  const reinitMotors = useCallback(() => {
    publish('boat/command', { action: 'motor_reinit' });
  }, [publish]);

  const calibrateMotors = useCallback(() => {
    publish('boat/command', { action: 'motor_calibrate' });
  }, [publish]);

  const gpsCalibrationTriggerRef = useRef<(() => void) | null>(null);
  const registerGpsCalibrationTrigger = useCallback((fn: (() => void) | null) => {
    gpsCalibrationTriggerRef.current = fn;
  }, []);
  const triggerGpsCalibration = useCallback(() => {
    gpsCalibrationTriggerRef.current?.();
  }, []);

  const gpsCalibrationResetRef = useRef<(() => void) | null>(null);
  const registerGpsCalibrationResetTrigger = useCallback((fn: (() => void) | null) => {
    gpsCalibrationResetRef.current = fn;
  }, []);
  const triggerGpsCalibrationReset = useCallback(() => {
    if (gpsCalibrationResetRef.current) {
      gpsCalibrationResetRef.current();
    } else {
      clearGpsOffset();
    }
  }, [clearGpsOffset]);

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

    const coords: { lat: number; lng: number }[] = [];
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

          coords.push({
            lat: polygon[0].lat + startRotated.y / metersPerDegreeLat,
            lng: polygon[0].lng + startRotated.x / metersPerDegreeLng,
          });
          coords.push({
            lat: polygon[0].lat + endRotated.y / metersPerDegreeLat,
            lng: polygon[0].lng + endRotated.x / metersPerDegreeLng,
          });
        }
      }
      lineIndex++;
    }

    const newWaypoints: Waypoint[] = coords.map((wp, i) => ({
      id: newId('wp'),
      lat: wp.lat,
      lng: wp.lng,
      name: `Coverage ${i + 1}`,
      takeMeasurement: false,
      measurementTypes: [],
      completed: false,
    }));

    setMission((prev) => ({
      ...prev,
      status: 'planning',
      waypoints: newWaypoints,
    }));

    setAreaCoverage((prev) => ({ ...prev, polygon: [] }));
    setClickModeState('none');
  }, [areaCoverage.polygon, areaCoverage.lineSpacing, areaCoverage.angle]);

  const addDraftZoneVertex = useCallback((lat: number, lng: number) => {
    setDraftZone((prev) => prev ? { ...prev, vertices: [...prev.vertices, { lat, lng }] } : prev);
  }, []);

  const removeLastDraftZoneVertex = useCallback(() => {
    setDraftZone((prev) => prev ? { ...prev, vertices: prev.vertices.slice(0, -1) } : prev);
  }, []);

  const cancelDraftZone = useCallback(() => {
    setDraftZone(null);
    setClickModeState('none');
  }, []);

  const saveDraftZone = useCallback((name?: string) => {
    setDraftZone((prev) => {
      if (!prev || prev.vertices.length < 3) return prev;
      const fallback = prev.kind === 'allow' ? 'Allowed Area' : 'Exclusion Zone';
      setZones((zs) => [
        ...zs,
        {
          id: newId('zone'),
          kind: prev.kind,
          name: name?.trim() || `${fallback} ${zs.filter(z => z.kind === prev.kind).length + 1}`,
          vertices: prev.vertices,
        },
      ]);
      return null;
    });
    setClickModeState('none');
  }, []);

  const removeZone = useCallback((id: string) => {
    setZones((prev) => prev.filter(z => z.id !== id));
  }, []);

  const renameZone = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setZones((prev) => prev.map(z => z.id === id ? { ...z, name: trimmed } : z));
  }, []);

  // Sync mission status from firmware nav state
  useEffect(() => {
    if (!boat.nav || mission.status !== 'running') return;

    const { mode, target_wp } = boat.nav;
    if (mode === 'completed') {
      setMission((prev) => ({
        ...prev,
        status: 'completed',
        currentWaypointIndex: -1,
        waypoints: prev.waypoints.map((wp) => ({ ...wp, completed: true })),
      }));
    } else if (mode === 'running' || mode === 'holding') {
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

  /* ── Saved missions ── */

  const saveCurrentMission = useCallback((name: string): SavedMission | null => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (mission.waypoints.length === 0) return null;
    const now = Date.now();
    const saved: SavedMission = {
      id: newId('sm'),
      name: trimmed,
      waypoints: mission.waypoints.map(wp => ({
        lat: wp.lat,
        lng: wp.lng,
        name: wp.name,
        takeMeasurement: wp.takeMeasurement,
        measurementTypes: [...wp.measurementTypes],
      })),
      dataCollection: { ...mission.dataCollection, measurementTypes: [...mission.dataCollection.measurementTypes] },
      createdAt: now,
      updatedAt: now,
    };
    setSavedMissions(prev => [saved, ...prev]);
    return saved;
  }, [mission.waypoints, mission.dataCollection]);

  const loadSavedMission = useCallback((id: string) => {
    const saved = savedMissions.find(m => m.id === id);
    if (!saved) return;
    publish('boat/mission/set', { waypoints: [] });
    const waypoints: Waypoint[] = saved.waypoints.map(wp => ({
      id: newId('wp'),
      lat: wp.lat,
      lng: wp.lng,
      name: wp.name,
      takeMeasurement: wp.takeMeasurement,
      measurementTypes: [...wp.measurementTypes],
      completed: false,
    }));
    setMission(prev => ({
      ...prev,
      status: waypoints.length > 0 ? 'planning' : 'idle',
      currentWaypointIndex: -1,
      waypoints,
      measurements: [],
      dataCollection: { ...saved.dataCollection, measurementTypes: [...saved.dataCollection.measurementTypes] },
    }));
  }, [savedMissions, publish]);

  const deleteSavedMission = useCallback((id: string) => {
    setSavedMissions(prev => prev.filter(m => m.id !== id));
    setSchedules(prev => prev.filter(s => s.missionId !== id));
  }, []);

  const renameSavedMission = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSavedMissions(prev => prev.map(m =>
      m.id === id ? { ...m, name: trimmed, updatedAt: Date.now() } : m,
    ));
  }, []);

  /* ── Schedules ── */

  const createSchedule = useCallback((input: { missionId: string; startAt: number; repeat: ScheduleRepeat }) => {
    const schedule: MissionSchedule = {
      id: newId('sched'),
      missionId: input.missionId,
      startAt: input.startAt,
      repeat: input.repeat,
      enabled: true,
      lastFiredAt: null,
    };
    setSchedules(prev => [...prev, schedule]);
  }, []);

  const updateSchedule = useCallback((id: string, updates: Partial<Pick<MissionSchedule, 'startAt' | 'repeat' | 'enabled' | 'missionId'>>) => {
    setSchedules(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }, []);

  const deleteSchedule = useCallback((id: string) => {
    setSchedules(prev => prev.filter(s => s.id !== id));
  }, []);

  // Schedule timers: arm a setTimeout for every enabled schedule with a future
  // fire time. On fire, load the saved mission and start it (if autonomous and
  // no mission is running). Repeating schedules advance their next-fire time.
  const scheduleStateRef = useRef({ savedMissions, mission, controlMode });
  useEffect(() => {
    scheduleStateRef.current = { savedMissions, mission, controlMode };
  });

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const now = Date.now();

    schedules.forEach(schedule => {
      if (!schedule.enabled) return;
      const fireAt = nextOccurrence(schedule.startAt, schedule.repeat, now);
      const delay = Math.max(0, fireAt - now);

      const fire = () => {
        const state = scheduleStateRef.current;
        const mission = state.savedMissions.find(m => m.id === schedule.missionId);
        const canFire = mission
          && state.mission.status !== 'running'
          && state.mission.status !== 'paused';

        if (canFire && mission) {
          loadSavedMission(mission.id);
          // Schedule kicks off after the load applies. Use a short delay so the
          // mission state has a tick to settle before publishing the start.
          setTimeout(() => startMissionRef.current?.(), 250);
        }

        setSchedules(prev => prev.map(s => {
          if (s.id !== schedule.id) return s;
          const updated = { ...s, lastFiredAt: Date.now() };
          if (s.repeat !== 'none') {
            updated.startAt = fireAt + REPEAT_INTERVAL_MS[s.repeat];
          } else {
            updated.enabled = false;
          }
          return updated;
        }));
      };

      timers.push(setTimeout(fire, delay));
    });

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [schedules, loadSavedMission]);

  return (
    <NavigationContext.Provider
      value={{
        boat,
        mission,
        viewMode,
        setViewMode,
        measurementType,
        setMeasurementType,
        addWaypoint,
        removeWaypoint,
        updateWaypoint,
        reorderWaypoints,
        moveWaypoint,
        duplicateWaypoint,
        reverseWaypoints,
        setWaypointAsStart,
        insertWaypointAt,
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
        motorConfig,
        setMotorConfig,
        navParams,
        setNavParams,
        adjustGpsOffset,
        clearGpsOffset,
        calibrateUpright,
        calibrateCompass,
        triggerGpsCalibration,
        registerGpsCalibrationTrigger,
        triggerGpsCalibrationReset,
        registerGpsCalibrationResetTrigger,
        rebootPi,
        powerOffPi,
        reinitMotors,
        calibrateMotors,
        camera,
        setCameraSettings,
        clickMode,
        setClickMode,
        areaCoverage,
        addPolygonVertex,
        removeLastPolygonVertex,
        clearPolygon,
        updateAreaCoverage,
        generateCoveragePath,
        zones,
        draftZone,
        addDraftZoneVertex,
        removeLastDraftZoneVertex,
        cancelDraftZone,
        saveDraftZone,
        removeZone,
        renameZone,
        savedMissions,
        saveCurrentMission,
        loadSavedMission,
        deleteSavedMission,
        renameSavedMission,
        schedules,
        createSchedule,
        updateSchedule,
        deleteSchedule,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}
