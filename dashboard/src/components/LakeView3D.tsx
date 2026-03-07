import { useRef, useMemo, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Text, Line } from '@react-three/drei';
import * as THREE from 'three';
import { useNavigation } from '../context/NavigationContext';
import type { Waypoint, MeasurementType } from '../types/index';
import { MEASUREMENT_CONFIGS } from '../types/index';

const LAKE_SIZE = 40;
const GRID_RESOLUTION = 80;
const COORD_SCALE = 10000;

const MEASUREMENT_VIS_CONFIG: Record<MeasurementType, {
  min: number;
  max: number;
  colorScale: [number, number, number][];
  unit: string;
}> = {
  depth: {
    min: 0, max: 25,
    colorScale: [[0.4, 0.8, 0.9], [0.2, 0.5, 0.8], [0.1, 0.2, 0.5]],
    unit: 'm',
  },
  temperature: {
    min: 10, max: 30,
    colorScale: [[0.2, 0.4, 0.9], [0.3, 0.8, 0.3], [0.9, 0.3, 0.2]],
    unit: '\u00B0C',
  },
  ph: {
    min: 5, max: 9,
    colorScale: [[0.9, 0.3, 0.3], [0.3, 0.9, 0.3], [0.3, 0.3, 0.9]],
    unit: 'pH',
  },
  dissolved_oxygen: {
    min: 0, max: 14,
    colorScale: [[0.5, 0.2, 0.2], [0.9, 0.6, 0.2], [0.2, 0.9, 0.5]],
    unit: 'mg/L',
  },
  turbidity: {
    min: 0, max: 100,
    colorScale: [[0.2, 0.6, 0.9], [0.6, 0.5, 0.3], [0.3, 0.2, 0.1]],
    unit: 'NTU',
  },
  conductivity: {
    min: 0, max: 1000,
    colorScale: [[0.2, 0.2, 0.4], [0.5, 0.3, 0.7], [0.9, 0.7, 0.2]],
    unit: '\u03BCS/cm',
  },
};

function getColorForValue(value: number, config: typeof MEASUREMENT_VIS_CONFIG[MeasurementType]): THREE.Color {
  const t = Math.max(0, Math.min(1, (value - config.min) / (config.max - config.min)));
  const scale = config.colorScale;

  if (t <= 0.5) {
    const localT = t * 2;
    return new THREE.Color(
      scale[0][0] + (scale[1][0] - scale[0][0]) * localT,
      scale[0][1] + (scale[1][1] - scale[0][1]) * localT,
      scale[0][2] + (scale[1][2] - scale[0][2]) * localT
    );
  } else {
    const localT = (t - 0.5) * 2;
    return new THREE.Color(
      scale[1][0] + (scale[2][0] - scale[1][0]) * localT,
      scale[1][1] + (scale[2][1] - scale[1][1]) * localT,
      scale[1][2] + (scale[2][2] - scale[1][2]) * localT
    );
  }
}

interface MeasurementPoint {
  x: number;
  z: number;
  value: number;
  waypointId: string;
}

function generateMeasurementField(
  waypoints: Waypoint[],
  measurements: import('../types/index').MeasurementData[],
  measurementType: MeasurementType,
  centerLat: number,
  centerLng: number
): { values: Float32Array; points: MeasurementPoint[] } {
  const values = new Float32Array(GRID_RESOLUTION * GRID_RESOLUTION);
  const points: MeasurementPoint[] = [];

  measurements.forEach(measurement => {
    const value = measurement.values[measurementType];
    if (value !== undefined) {
      const waypoint = waypoints.find(wp => wp.id === measurement.waypointId);
      if (waypoint) {
        const x = (waypoint.lng - centerLng) * COORD_SCALE;
        const z = (waypoint.lat - centerLat) * COORD_SCALE;
        points.push({ x, z, value, waypointId: measurement.waypointId });
      }
    }
  });

  const config = MEASUREMENT_VIS_CONFIG[measurementType];
  const defaultValue = (config.min + config.max) / 2;

  for (let i = 0; i < GRID_RESOLUTION; i++) {
    for (let j = 0; j < GRID_RESOLUTION; j++) {
      const x = (i / (GRID_RESOLUTION - 1) - 0.5) * LAKE_SIZE;
      const z = (j / (GRID_RESOLUTION - 1) - 0.5) * LAKE_SIZE;

      if (points.length === 0) {
        const noise = Math.sin(x * 0.3) * Math.cos(z * 0.3) * 0.2;
        values[i * GRID_RESOLUTION + j] = defaultValue + noise * (config.max - config.min) * 0.3;
      } else {
        let weightedSum = 0;
        let weightSum = 0;

        points.forEach(point => {
          const dx = x - point.x;
          const dz = z - point.z;
          const distance = Math.sqrt(dx * dx + dz * dz);
          const weight = 1 / (distance * distance + 0.5);
          weightedSum += point.value * weight;
          weightSum += weight;
        });

        let value = weightSum > 0 ? weightedSum / weightSum : defaultValue;
        value = Math.max(config.min, Math.min(config.max, value));
        values[i * GRID_RESOLUTION + j] = value;
      }
    }
  }

  return { values, points };
}

function LakeSurface({ values, measurementType }: { values: Float32Array; measurementType: MeasurementType }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const config = MEASUREMENT_VIS_CONFIG[measurementType];

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(LAKE_SIZE, LAKE_SIZE, GRID_RESOLUTION - 1, GRID_RESOLUTION - 1);
    const positions = geo.attributes.position.array as Float32Array;
    const colors = new Float32Array(positions.length);

    for (let i = 0; i < GRID_RESOLUTION; i++) {
      for (let j = 0; j < GRID_RESOLUTION; j++) {
        const vertexIndex = (i * GRID_RESOLUTION + j) * 3;
        const value = values[i * GRID_RESOLUTION + j];

        if (measurementType === 'depth') {
          positions[vertexIndex + 2] = -value * 0.5;
        } else {
          positions[vertexIndex + 2] = -2 + Math.sin(i * 0.2) * Math.cos(j * 0.2) * 0.3;
        }

        const color = getColorForValue(value, config);
        colors[vertexIndex] = color.r;
        colors[vertexIndex + 1] = color.g;
        colors[vertexIndex + 2] = color.b;
      }
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();

    return geo;
  }, [values, measurementType, config]);

  return (
    <mesh ref={meshRef} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.6} metalness={0.2} />
    </mesh>
  );
}

function DataPointMarkers({
  points,
  measurementType,
  config,
}: {
  points: MeasurementPoint[];
  measurementType: MeasurementType;
  config: typeof MEASUREMENT_VIS_CONFIG[MeasurementType];
}) {
  return (
    <>
      {points.map((point, i) => {
        const color = getColorForValue(point.value, config);
        const yPos = measurementType === 'depth' ? -point.value * 0.25 : 0.5;

        return (
          <group key={i} position={[point.x, yPos, -point.z]}>
            <mesh>
              <sphereGeometry args={[0.4, 16, 16]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
            </mesh>
            <Text position={[0, 0.8, 0]} fontSize={0.35} color="white" anchorX="center" anchorY="middle" outlineWidth={0.02} outlineColor="black">
              {point.value.toFixed(1)}{config.unit}
            </Text>
            {measurementType === 'depth' && (
              <mesh position={[0, point.value * 0.25, 0]}>
                <cylinderGeometry args={[0.02, 0.02, point.value * 0.5, 8]} />
                <meshStandardMaterial color={color} transparent opacity={0.5} />
              </mesh>
            )}
          </group>
        );
      })}
    </>
  );
}

function WaypointMarker3D({
  waypoint, index, isActive, centerLat, centerLng,
}: {
  waypoint: Waypoint; index: number; isActive: boolean; centerLat: number; centerLng: number;
}) {
  const x = (waypoint.lng - centerLng) * COORD_SCALE;
  const z = (waypoint.lat - centerLat) * COORD_SCALE;
  const color = waypoint.completed ? '#22c55e' : isActive ? '#f59e0b' : '#ffffff';

  return (
    <group position={[x, 2, -z]}>
      <mesh position={[0, -1, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 2, 8]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={isActive ? 0.5 : 0.2} />
      </mesh>
      <Text position={[0, 0.6, 0]} fontSize={0.3} color="white" anchorX="center" anchorY="middle">
        {waypoint.completed ? '\u2713' : `${index + 1}`}
      </Text>
      {waypoint.takeMeasurement && (
        <mesh position={[0.4, 0.3, 0]}>
          <sphereGeometry args={[0.12, 8, 8]} />
          <meshStandardMaterial color="#60a5fa" emissive="#60a5fa" emissiveIntensity={0.3} />
        </mesh>
      )}
    </group>
  );
}

function BoatModel3D({
  position, heading, centerLat, centerLng,
}: {
  position: { lat: number; lng: number }; heading: number; centerLat: number; centerLng: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const x = (position.lng - centerLng) * COORD_SCALE;
  const z = (position.lat - centerLat) * COORD_SCALE;

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.position.y = 0.5 + Math.sin(state.clock.elapsedTime * 2) * 0.05;
    }
  });

  return (
    <group ref={groupRef} position={[x, 0.5, -z]} rotation={[0, -heading * (Math.PI / 180) + Math.PI, 0]}>
      <mesh>
        <coneGeometry args={[0.3, 1.2, 4]} />
        <meshStandardMaterial color="#e5e5e5" metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.1, 0]}>
        <boxGeometry args={[0.4, 0.1, 0.6]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.2} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.3, 0.4]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.1, 0.3, 8]} />
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.3} />
      </mesh>
    </group>
  );
}

function WaypointPath({ waypoints, centerLat, centerLng }: { waypoints: Waypoint[]; centerLat: number; centerLng: number }) {
  const points = useMemo(() => {
    return waypoints.map(wp => {
      const x = (wp.lng - centerLng) * COORD_SCALE;
      const z = (wp.lat - centerLat) * COORD_SCALE;
      return [x, 1.5, -z] as [number, number, number];
    });
  }, [waypoints, centerLat, centerLng]);

  if (points.length < 2) return null;

  return <Line points={points} color="#ffffff" lineWidth={2} opacity={0.5} transparent />;
}

function GridLines() {
  return <gridHelper args={[LAKE_SIZE, 10, 0x333333, 0x222222]} position={[0, 0.01, 0]} />;
}

function CameraSetup() {
  const { camera } = useThree();

  useMemo(() => {
    camera.position.set(30, 25, 30);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  return <OrbitControls enableDamping dampingFactor={0.05} minDistance={10} maxDistance={100} maxPolarAngle={Math.PI / 2.1} target={[0, -2, 0]} />;
}

function LakeScene({ measurementType }: { measurementType: MeasurementType }) {
  const { boat, mission } = useNavigation();
  const centerLat = boat.position.lat;
  const centerLng = boat.position.lng;

  const { values, points } = useMemo(() => {
    return generateMeasurementField(mission.waypoints, mission.measurements, measurementType, centerLat, centerLng);
  }, [mission.waypoints, mission.measurements, measurementType, centerLat, centerLng]);

  const config = MEASUREMENT_VIS_CONFIG[measurementType];

  return (
    <>
      <CameraSetup />
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 10]} intensity={1.2} castShadow />
      <pointLight position={[-10, 15, -10]} intensity={0.4} color="#6688ff" />
      <LakeSurface values={values} measurementType={measurementType} />
      <GridLines />
      <DataPointMarkers points={points} measurementType={measurementType} config={config} />
      <WaypointPath waypoints={mission.waypoints} centerLat={centerLat} centerLng={centerLng} />
      {mission.waypoints.map((waypoint, index) => (
        <WaypointMarker3D key={waypoint.id} waypoint={waypoint} index={index} isActive={mission.currentWaypointIndex === index} centerLat={centerLat} centerLng={centerLng} />
      ))}
      <BoatModel3D position={boat.position} heading={boat.heading} centerLat={centerLat} centerLng={centerLng} />
    </>
  );
}

function ColorLegend({ measurementType }: { measurementType: MeasurementType }) {
  const config = MEASUREMENT_VIS_CONFIG[measurementType];
  const measurementConfig = MEASUREMENT_CONFIGS.find(c => c.type === measurementType);

  const gradientColors = config.colorScale.map(([r, g, b]) =>
    `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
  );

  return (
    <div className="absolute top-14 right-3 z-[500] bg-black/70 backdrop-blur-xl rounded-xl px-4 py-3 border border-white/10">
      <div className="text-white/80 text-sm font-medium mb-2">
        {measurementConfig?.icon} {measurementConfig?.label}
      </div>
      <div className="w-32 h-3 rounded mb-2" style={{ background: `linear-gradient(to right, ${gradientColors.join(', ')})` }} />
      <div className="flex justify-between text-xs text-white/50">
        <span>{config.min}{config.unit}</span>
        <span>{config.max}{config.unit}</span>
      </div>
    </div>
  );
}

export default function LakeView3D() {
  const [measurementType, setMeasurementType] = useState<MeasurementType>('depth');

  const measurementOptions: { type: MeasurementType; label: string; icon: string }[] = [
    { type: 'depth', label: 'Depth', icon: '\uD83D\uDCCF' },
    { type: 'temperature', label: 'Temp', icon: '\uD83C\uDF21\uFE0F' },
    { type: 'ph', label: 'pH', icon: '\uD83E\uDDEA' },
    { type: 'dissolved_oxygen', label: 'O\u2082', icon: '\uD83D\uDCA8' },
    { type: 'turbidity', label: 'Turbidity', icon: '\uD83C\uDF0A' },
    { type: 'conductivity', label: 'Conduct.', icon: '\u26A1' },
  ];

  return (
    <div className="w-full h-full bg-black">
      <Canvas shadows camera={{ position: [30, 25, 30], fov: 50 }} gl={{ antialias: true, alpha: false }}>
        <color attach="background" args={['#000000']} />
        <LakeScene measurementType={measurementType} />
      </Canvas>

      <div className="absolute top-3 right-3 z-[500] bg-black/70 backdrop-blur-xl rounded-xl p-2 border border-white/10">
        <div className="grid grid-cols-3 gap-1">
          {measurementOptions.map(option => (
            <button
              key={option.type}
              onClick={() => setMeasurementType(option.type)}
              className={`px-3 py-2 rounded-lg text-xs transition-colors ${
                measurementType === option.type
                  ? 'bg-white/20 text-white'
                  : 'text-white/50 hover:text-white/70 hover:bg-white/10'
              }`}
            >
              <span className="mr-1">{option.icon}</span>
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <ColorLegend measurementType={measurementType} />

      <div className="absolute bottom-20 left-[22rem] z-[500] bg-black/70 backdrop-blur-xl rounded-xl px-4 py-2 border border-white/10">
        <span className="text-white/50 text-sm">
          Drag to orbit &bull; Scroll to zoom &bull; Right-click to pan
        </span>
      </div>
    </div>
  );
}
