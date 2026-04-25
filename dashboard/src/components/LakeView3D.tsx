import { useRef, useMemo, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Text, Line, Environment, Clone, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useNavigation } from '../context/NavigationContext';
import type { Waypoint, MeasurementType } from '../types/index';
import { MEASUREMENT_CONFIGS } from '../types/index';

// ----------------------------------------------------------------------------
// World constants
// ----------------------------------------------------------------------------

const LAKE_SIZE = 40;
const WATER_SIZE = 200;
const GRID_RESOLUTION = 80;
const WATER_RES = 96;
const COORD_SCALE = 10000;
const BURNT_ORANGE = new THREE.Color('#c47a2a');

// Sun direction shared between sky shader, water shader, and directional light.
const SUN_AZIMUTH = 0.55 * Math.PI;
const SUN_ELEVATION = 0.20 * Math.PI;
const SUN_DISTANCE = 100;
const SUN_POSITION = new THREE.Vector3(
  Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION) * SUN_DISTANCE,
  Math.sin(SUN_ELEVATION) * SUN_DISTANCE,
  Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION) * SUN_DISTANCE,
);
const SUN_DIR = SUN_POSITION.clone().normalize();

// ----------------------------------------------------------------------------
// Wave parameters — shared between GLSL (rendering) and JS (boat float-tracking).
// 5 waves spanning swells to chop, with physically-plausible deep-water dispersion
// (omega ~= sqrt(g*k)) and irrational direction angles to avoid grid artefacts.
// ----------------------------------------------------------------------------

interface Wave { dir: [number, number]; k: number; w: number; a: number }
const WAVES: Wave[] = [
  { dir: [Math.cos(0.30), Math.sin(0.30)], k: 0.22, w: 0.95, a: 0.16 },
  { dir: [Math.cos(2.10), Math.sin(2.10)], k: 0.42, w: 1.30, a: 0.08 },
  { dir: [Math.cos(-0.55), Math.sin(-0.55)], k: 0.78, w: 1.85, a: 0.04 },
  { dir: [Math.cos(1.25), Math.sin(1.25)], k: 1.35, w: 2.60, a: 0.018 },
];

function sampleWaveHeight(x: number, z: number, t: number): number {
  let h = 0;
  for (const wv of WAVES) {
    h += wv.a * Math.sin((wv.dir[0] * x + wv.dir[1] * z) * wv.k - wv.w * t);
  }
  return h;
}

// ----------------------------------------------------------------------------
// Measurement-field colour scales
// ----------------------------------------------------------------------------

const MEASUREMENT_VIS_CONFIG: Record<MeasurementType, {
  min: number;
  max: number;
  colorScale: [number, number, number][];
  unit: string;
}> = {
  depth: {
    min: 0, max: 25,
    colorScale: [[0.55, 0.85, 0.95], [0.15, 0.45, 0.75], [0.04, 0.10, 0.30]],
    unit: 'm',
  },
  temperature: {
    min: 10, max: 30,
    colorScale: [[0.2, 0.4, 0.9], [0.3, 0.85, 0.4], [0.95, 0.35, 0.2]],
    unit: '°C',
  },
  ph: {
    min: 5, max: 9,
    colorScale: [[0.95, 0.35, 0.35], [0.35, 0.95, 0.35], [0.35, 0.35, 0.95]],
    unit: 'pH',
  },
  dissolved_oxygen: {
    min: 0, max: 14,
    colorScale: [[0.5, 0.2, 0.2], [0.95, 0.65, 0.2], [0.2, 0.95, 0.55]],
    unit: 'mg/L',
  },
  turbidity: {
    min: 0, max: 100,
    colorScale: [[0.25, 0.65, 0.95], [0.65, 0.55, 0.3], [0.3, 0.2, 0.1]],
    unit: 'NTU',
  },
  conductivity: {
    min: 0, max: 1000,
    colorScale: [[0.2, 0.2, 0.45], [0.55, 0.3, 0.75], [0.95, 0.75, 0.25]],
    unit: 'μS/cm',
  },
};

function getColorForValue(value: number, config: typeof MEASUREMENT_VIS_CONFIG[MeasurementType]): THREE.Color {
  const t = Math.max(0, Math.min(1, (value - config.min) / (config.max - config.min)));
  const scale = config.colorScale;
  if (t <= 0.5) {
    const lt = t * 2;
    return new THREE.Color(
      scale[0][0] + (scale[1][0] - scale[0][0]) * lt,
      scale[0][1] + (scale[1][1] - scale[0][1]) * lt,
      scale[0][2] + (scale[1][2] - scale[0][2]) * lt,
    );
  }
  const lt = (t - 0.5) * 2;
  return new THREE.Color(
    scale[1][0] + (scale[2][0] - scale[1][0]) * lt,
    scale[1][1] + (scale[2][1] - scale[1][1]) * lt,
    scale[1][2] + (scale[2][2] - scale[1][2]) * lt,
  );
}

interface MeasurementPoint { x: number; z: number; value: number; waypointId: string }

function generateMeasurementField(
  waypoints: Waypoint[],
  measurements: import('../types/index').MeasurementData[],
  measurementType: MeasurementType,
  centerLat: number,
  centerLng: number,
): { values: Float32Array; points: MeasurementPoint[] } {
  const values = new Float32Array(GRID_RESOLUTION * GRID_RESOLUTION);
  const points: MeasurementPoint[] = [];

  measurements.forEach(m => {
    const v = m.values[measurementType];
    if (v !== undefined) {
      const wp = waypoints.find(w => w.id === m.waypointId);
      if (wp) {
        points.push({
          x: (wp.lng - centerLng) * COORD_SCALE,
          z: (wp.lat - centerLat) * COORD_SCALE,
          value: v,
          waypointId: m.waypointId,
        });
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
        const noise =
          Math.sin(x * 0.22) * Math.cos(z * 0.22) * 0.35 +
          Math.sin(x * 0.55 + 1.3) * Math.cos(z * 0.45 - 0.7) * 0.20 +
          Math.sin(x * 1.10 + 0.6) * Math.cos(z * 0.95 + 1.1) * 0.10;
        values[i * GRID_RESOLUTION + j] = defaultValue + noise * (config.max - config.min) * 0.4;
      } else {
        let weightedSum = 0;
        let weightSum = 0;
        for (const p of points) {
          const dx = x - p.x;
          const dz = z - p.z;
          const d2 = dx * dx + dz * dz;
          const w = 1 / (d2 + 0.5);
          weightedSum += p.value * w;
          weightSum += w;
        }
        let v = weightSum > 0 ? weightedSum / weightSum : defaultValue;
        v = Math.max(config.min, Math.min(config.max, v));
        values[i * GRID_RESOLUTION + j] = v;
      }
    }
  }
  return { values, points };
}

// ----------------------------------------------------------------------------
// Custom skybox — gradient horizon → zenith with sun disc + halo. Renders at
// renderOrder=-1 with depthTest off, always. No external HDR needed; we just
// share colours with the water shader so reflections feel coherent.
// ----------------------------------------------------------------------------

const skyVertexShader = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragmentShader = /* glsl */`
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  varying vec3 vDir;

  void main() {
    float vy = vDir.y;
    vec3 c;
    if (vy >= 0.0) {
      // Sky: blend horizon to zenith with a soft curve.
      float t = clamp(vy, 0.0, 1.0);
      c = mix(uHorizon, uZenith, pow(t, 0.55));
    } else {
      // Below horizon: blend horizon to a slightly darker ground tone so a
      // slightly-below camera angle still feels lit, not black.
      float t = clamp(-vy, 0.0, 1.0);
      c = mix(uHorizon, uGround, pow(t, 0.6));
    }

    vec3 sd = normalize(uSunDir);
    float dotSun = max(dot(vDir, sd), 0.0);
    c += uSunColor * pow(dotSun, 600.0) * 12.0;   // sun disc
    c += uSunColor * pow(dotSun, 14.0)  * 0.40;   // halo
    c += uSunColor * pow(dotSun, 3.0)   * 0.10;   // sky brightening

    gl_FragColor = vec4(c, 1.0);
  }
`;

function SkyDome() {
  const uniforms = useMemo(() => ({
    uHorizon:  { value: new THREE.Color('#cfdef0') },
    uZenith:   { value: new THREE.Color('#2f5d99') },
    uGround:   { value: new THREE.Color('#0d1a2c') },
    uSunDir:   { value: SUN_DIR.clone() },
    uSunColor: { value: new THREE.Color('#fff1cc') },
  }), []);

  return (
    <mesh scale={[5000, 5000, 5000]} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[1, 32, 16]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        depthTest={false}
        uniforms={uniforms}
        vertexShader={skyVertexShader}
        fragmentShader={skyFragmentShader}
      />
    </mesh>
  );
}

// ----------------------------------------------------------------------------
// Water shader
//
// Vertex stage: 5 sines (matching JS WAVES[]) with analytic gradient → normal.
// Fragment stage: FBM-noise-modulated foam (no grid pattern), procedural sky
// reflection that matches SkyDome, Schlick Fresnel, sharp Blinn-Phong sun
// glitter, distance fog blending into the horizon.
// ----------------------------------------------------------------------------

const WAVE_GLSL = WAVES.map((w, i) =>
  `  d = vec2(${w.dir[0].toFixed(5)}, ${w.dir[1].toFixed(5)});\n` +
  `  ph = dot(d, p) * ${w.k.toFixed(5)} - ${w.w.toFixed(5)} * uTime;\n` +
  `  s${i} = sin(ph); c${i} = cos(ph);\n` +
  `  h    += ${w.a.toFixed(5)} * s${i};\n` +
  `  grad += ${w.a.toFixed(5)} * ${w.k.toFixed(5)} * d * c${i};\n`,
).join('');
const WAVE_GLSL_DECL = WAVES.map((_, i) => `  float s${i}; float c${i};`).join('\n');

const waterVertexShader = /* glsl */`
  uniform float uTime;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying float vHeight;
  varying vec2 vWaveUV;

  void main() {
    vec2 p = position.xy;
    float h = 0.0;
    vec2 grad = vec2(0.0);
    vec2 d;
    float ph;
    ${WAVE_GLSL_DECL}
    ${WAVE_GLSL}

    vec3 newPos = vec3(p, h);
    vec3 nLocal = normalize(vec3(-grad.x, -grad.y, 1.0));
    vWorldNormal = normalize(mat3(modelMatrix) * nLocal);

    vec4 worldPos = modelMatrix * vec4(newPos, 1.0);
    vWorldPos = worldPos.xyz;
    vHeight = h;
    vWaveUV = p;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const waterFragmentShader = /* glsl */`
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uColorDeep;
  uniform vec3 uColorShallow;
  uniform vec3 uHorizonColor;
  uniform vec3 uZenithColor;
  uniform float uOpacity;

  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying float vHeight;
  varying vec2 vWaveUV;

  // Better hash than the canonical sin-trick — fewer stripe artefacts.
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y);
  }
  // 4-octave FBM with a rotation between octaves so the layers don't align.
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 R = mat2(0.86602, -0.5, 0.5, 0.86602); // 30deg
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p = R * p * 2.13 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }

  // Gradient sky lookup matching SkyDome so reflections are coherent.
  vec3 sampleSky(vec3 dir) {
    float vy = dir.y;
    vec3 c;
    if (vy >= 0.0) {
      float t = clamp(vy, 0.0, 1.0);
      c = mix(uHorizonColor, uZenithColor, pow(t, 0.55));
    } else {
      c = uHorizonColor;
    }
    float sd = max(dot(dir, normalize(uSunDir)), 0.0);
    c += uSunColor * pow(sd, 600.0) * 10.0;
    c += uSunColor * pow(sd, 14.0)  * 0.40;
    return c;
  }

  void main() {
    vec3 N = normalize(vWorldNormal);

    // Detail-scale ripples — light perturbation only. We deliberately keep
    // this gentle; large detail-normal magnitudes create noisy speckled
    // highlights that read as harsh light, not water.
    float t = uTime;
    vec2 uv = vWaveUV;
    vec2 dn;
    dn.x = fbm(uv * 0.7 + vec2(t * 0.12, t * 0.05)) - fbm(uv * 0.7 - vec2(0.07, 0.0) + vec2(t * 0.12, t * 0.05));
    dn.y = fbm(uv * 0.7 + vec2(0.0, 0.07) + vec2(t * 0.12, t * 0.05)) - fbm(uv * 0.7 + vec2(t * 0.12, t * 0.05));
    N = normalize(N + vec3(dn.x, 0.0, dn.y) * 0.35);

    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDir);

    // Schlick Fresnel — water reflects ~2% at normal incidence.
    float f0 = 0.02;
    float vDotN = max(dot(N, V), 0.0);
    float fresnel = f0 + (1.0 - f0) * pow(1.0 - vDotN, 4.0);

    // Reflected sky.
    vec3 R = reflect(-V, N);
    vec3 sky = sampleSky(R);

    // Base water colour: deeper troughs darker, crests brighter.
    float depthMix = smoothstep(-0.25, 0.30, vHeight);
    vec3 baseColor = mix(uColorDeep, uColorShallow, depthMix);

    // Subsurface scattering — backlit crests glow slightly green.
    float backLight = pow(max(dot(-L, V), 0.0), 2.0) * smoothstep(0.0, 0.18, vHeight);
    baseColor += vec3(0.12, 0.45, 0.45) * backLight * 0.20;

    // Diffuse softens the base by sun direction.
    float diff = max(dot(N, L), 0.0);
    baseColor *= 0.65 + 0.35 * diff;

    // Mix toward sky reflection by Fresnel.
    vec3 color = mix(baseColor, sky, fresnel);

    // Soft, broad Blinn-Phong sun highlight — wide and gentle instead of
    // sharp glitter. Two layers blend a wide halo with a slightly tighter
    // core so the sun's reflection still has shape.
    vec3 H = normalize(L + V);
    float NdotH = max(dot(N, H), 0.0);
    float specBroad = pow(NdotH, 30.0);
    float specCore  = pow(NdotH, 90.0);
    color += uSunColor * (specBroad * 0.55 + specCore * 0.55);

    // Foam — kept very subtle. Only gentle hints at sharp crests.
    float crest = smoothstep(0.16, 0.26, vHeight);
    float foamMask = fbm(uv * 1.0 + vec2(t * 0.18, -t * 0.10));
    float foamShape = smoothstep(0.50, 0.72, foamMask);
    color = mix(color, vec3(0.97, 0.99, 1.0), crest * foamShape * 0.30);

    // Distance fog blends into the horizon colour.
    float dist = length(cameraPosition - vWorldPos);
    float fogFactor = 1.0 - exp(-max(dist - 30.0, 0.0) * 0.013);
    color = mix(color, uHorizonColor, clamp(fogFactor, 0.0, 0.85));

    gl_FragColor = vec4(color, uOpacity);
  }
`;

function WaterSurface() {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({
    uTime:         { value: 0 },
    uSunDir:       { value: SUN_DIR.clone() },
    uSunColor:     { value: new THREE.Color('#fff1cc') },
    uColorDeep:    { value: new THREE.Color('#062035') },
    uColorShallow: { value: new THREE.Color('#1f7aa6') },
    uHorizonColor: { value: new THREE.Color('#cfdef0') },
    uZenithColor:  { value: new THREE.Color('#2f5d99') },
    uOpacity:      { value: 0.86 },
  }), []);

  useFrame((state) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
      <planeGeometry args={[WATER_SIZE, WATER_SIZE, WATER_RES, WATER_RES]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={waterVertexShader}
        fragmentShader={waterFragmentShader}
        uniforms={uniforms}
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

// ----------------------------------------------------------------------------
// Lake bed — a deep blue floor with subtle moving caustics. Sized larger than
// the visible water so the underwater view still feels enclosed.
// ----------------------------------------------------------------------------

const causticsVertexShader = /* glsl */`
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const causticsFragmentShader = /* glsl */`
  uniform float uTime;
  uniform vec3 uColorBase;
  uniform vec3 uColorCaustic;
  varying vec3 vWorldPos;

  float caustic(vec2 p, float t) {
    float v = 0.0;
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      vec2 q = p * (1.0 + fi * 0.7) + vec2(t * (0.13 + fi * 0.07), t * (0.21 - fi * 0.05));
      v += sin(q.x + sin(q.y * 1.7 + t)) * cos(q.y - sin(q.x * 1.3 - t));
    }
    return v * 0.5;
  }

  void main() {
    vec2 p = vWorldPos.xz * 0.45;
    float c = caustic(p, uTime * 0.6);
    c = pow(max(c * 0.5 + 0.5, 0.0), 6.0);
    vec3 col = mix(uColorBase, uColorCaustic, c * 0.7);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function LakeBed({ depthEnabled }: { depthEnabled: boolean }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({
    uTime:         { value: 0 },
    uColorBase:    { value: new THREE.Color('#04162a') },
    uColorCaustic: { value: new THREE.Color('#2b6a8a') },
  }), []);

  useFrame((state) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, depthEnabled ? -16 : -3, 0]} renderOrder={0}>
      <planeGeometry args={[WATER_SIZE * 1.5, WATER_SIZE * 1.5, 1, 1]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={causticsVertexShader}
        fragmentShader={causticsFragmentShader}
        uniforms={uniforms}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ----------------------------------------------------------------------------
// Data field — depth deformation OR flat heatmap below the water surface.
// ----------------------------------------------------------------------------

function DataField({ values, measurementType }: { values: Float32Array; measurementType: MeasurementType }) {
  const config = MEASUREMENT_VIS_CONFIG[measurementType];

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(LAKE_SIZE, LAKE_SIZE, GRID_RESOLUTION - 1, GRID_RESOLUTION - 1);
    const positions = geo.attributes.position.array as Float32Array;
    const colors = new Float32Array(positions.length);

    for (let i = 0; i < GRID_RESOLUTION; i++) {
      for (let j = 0; j < GRID_RESOLUTION; j++) {
        const vi = (i * GRID_RESOLUTION + j) * 3;
        const v = values[i * GRID_RESOLUTION + j];

        positions[vi + 2] = measurementType === 'depth' ? -v * 0.5 - 0.4 : -0.3;

        const c = getColorForValue(v, config);
        colors[vi] = c.r;
        colors[vi + 1] = c.g;
        colors[vi + 2] = c.b;
      }
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }, [values, measurementType, config]);

  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1} receiveShadow>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.95} metalness={0.04} />
    </mesh>
  );
}

// ----------------------------------------------------------------------------
// Boat — orientation comes entirely from the IMU quaternion (matching the
// orientation panel's coord transform). Y position tracks the visible wave
// surface so the boat physically rises and falls. We do NOT fake any tilt
// from the wave gradient: the IMU already reports the boat's real attitude.
// ----------------------------------------------------------------------------

// BNO055 → three.js axis flip (negate imaginary X and Y components). Same as
// Boat3DView so both views agree on what "upright" means.
const Q_BNO_TO_WORLD = (q: { w: number; x: number; y: number; z: number }) =>
  new THREE.Quaternion(-q.x, -q.y, q.z, q.w);

function BoatGLTF({
  position, quaternion, centerLat, centerLng,
}: {
  position: { lat: number; lng: number };
  quaternion: { w: number; x: number; y: number; z: number };
  centerLat: number;
  centerLng: number;
}) {
  const orientRef = useRef<THREE.Group>(null);
  const innerRef = useRef<THREE.Group>(null);
  const colored = useRef(false);
  const targetQuat = useRef(new THREE.Quaternion());
  const { scene } = useGLTF('/FInalAssembly.gltf');

  const x = (position.lng - centerLng) * COORD_SCALE;
  const z = (position.lat - centerLat) * COORD_SCALE;

  const centerOffset = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    return box.getCenter(new THREE.Vector3()).negate();
  }, [scene]);

  useFrame((state) => {
    if (!colored.current && innerRef.current) {
      innerRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = (child.material as THREE.MeshStandardMaterial).clone();
          mat.color.copy(BURNT_ORANGE);
          mat.metalness = 0.35;
          mat.roughness = 0.5;
          mat.envMapIntensity = 1.4;
          child.material = mat;
        }
      });
      colored.current = true;
    }

    if (orientRef.current) {
      // Y position rides the actual wave surface so the boat looks anchored
      // to the visible water; orientation comes from the IMU only.
      orientRef.current.position.y = sampleWaveHeight(x, -z, state.clock.elapsedTime) + 0.05;

      targetQuat.current.copy(Q_BNO_TO_WORLD(quaternion));
      orientRef.current.quaternion.slerp(targetQuat.current, 0.18);
    }
  });

  return (
    <group position={[x, 0, -z]}>
      <group ref={orientRef}>
        {/* Same model-axis correction the orientation panel uses. */}
        <group ref={innerRef} rotation={[Math.PI / 2, Math.PI, 0]} scale={1.2}>
          <Clone object={scene} position={centerOffset} castShadow receiveShadow />
        </group>
      </group>
    </group>
  );
}

useGLTF.preload('/FInalAssembly.gltf');

// ----------------------------------------------------------------------------
// Markers
// ----------------------------------------------------------------------------

function DataPointMarkers({
  points, measurementType, config,
}: {
  points: MeasurementPoint[];
  measurementType: MeasurementType;
  config: typeof MEASUREMENT_VIS_CONFIG[MeasurementType];
}) {
  return (
    <>
      {points.map((point, i) => {
        const color = getColorForValue(point.value, config);
        const yPos = 0.9;
        const bathYWorld = -point.value * 0.5 - 0.4;
        const cylTopY = yPos - 0.34;
        const cylHeight = Math.max(0, cylTopY - bathYWorld);
        const cylCenterLocalY = (cylTopY + bathYWorld) / 2 - yPos;

        return (
          <group key={i} position={[point.x, yPos, -point.z]}>
            <mesh>
              <sphereGeometry args={[0.34, 24, 24]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={0.55}
                metalness={0.4}
                roughness={0.3}
              />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.85, 0]}>
              <ringGeometry args={[0.45, 0.65, 36]} />
              <meshBasicMaterial color={color} transparent opacity={0.45} side={THREE.DoubleSide} />
            </mesh>
            <Text
              position={[0, 0.95, 0]}
              fontSize={0.42}
              color="white"
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.03}
              outlineColor="#000"
            >
              {point.value.toFixed(1)}{config.unit}
            </Text>
            {measurementType === 'depth' && cylHeight > 0.05 && (
              <mesh position={[0, cylCenterLocalY, 0]}>
                <cylinderGeometry args={[0.03, 0.03, cylHeight, 8]} />
                <meshStandardMaterial
                  color={color}
                  transparent
                  opacity={0.55}
                  emissive={color}
                  emissiveIntensity={0.3}
                />
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
  const flagRef = useRef<THREE.Group>(null);
  const x = (waypoint.lng - centerLng) * COORD_SCALE;
  const z = (waypoint.lat - centerLat) * COORD_SCALE;
  const color = waypoint.completed ? '#22c55e' : isActive ? '#f59e0b' : '#e2e8f0';

  useFrame((state) => {
    if (flagRef.current) {
      const wave = sampleWaveHeight(x, -z, state.clock.elapsedTime);
      flagRef.current.position.y = 2.6 + wave + (isActive ? Math.sin(state.clock.elapsedTime * 2) * 0.12 : 0);
    }
  });

  return (
    <group position={[x, 0, -z]}>
      <mesh position={[0, 1.3, 0]}>
        <cylinderGeometry args={[0.04, 0.06, 2.6, 8]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.4, 0.62, 36]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>
      <group ref={flagRef} position={[0, 2.6, 0]}>
        <mesh>
          <sphereGeometry args={[0.3, 24, 24]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={isActive ? 0.7 : 0.25}
            metalness={0.3}
            roughness={0.4}
          />
        </mesh>
        <Text
          position={[0, 0, 0.001]}
          fontSize={0.34}
          color="white"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.025}
          outlineColor="#000"
        >
          {waypoint.completed ? '✓' : `${index + 1}`}
        </Text>
        {waypoint.takeMeasurement && (
          <mesh position={[0.45, 0.27, 0]}>
            <sphereGeometry args={[0.13, 12, 12]} />
            <meshStandardMaterial color="#60a5fa" emissive="#60a5fa" emissiveIntensity={0.5} />
          </mesh>
        )}
      </group>
    </group>
  );
}

function WaypointPath({
  waypoints, centerLat, centerLng,
}: {
  waypoints: Waypoint[]; centerLat: number; centerLng: number;
}) {
  const points = useMemo(() => waypoints.map(wp => [
    (wp.lng - centerLng) * COORD_SCALE,
    1.6,
    -(wp.lat - centerLat) * COORD_SCALE,
  ] as [number, number, number]), [waypoints, centerLat, centerLng]);

  if (points.length < 2) return null;
  return (
    <Line points={points} color="#ffffff" lineWidth={2} opacity={0.55} transparent
          dashed dashSize={0.6} gapSize={0.35} />
  );
}

// ----------------------------------------------------------------------------
// Underwater toggle — when the camera dips below y=0 we switch the fog tone
// to deep blue and dim exposure so the "submerged" view feels different.
// ----------------------------------------------------------------------------

function UnderwaterEffects() {
  const { scene, camera, gl } = useThree();
  const fog = useMemo(() => new THREE.FogExp2('#cfdef0', 0.012), []);
  const last = useRef<boolean | null>(null);

  scene.fog = fog;

  useFrame(() => {
    const below = camera.position.y < 0;
    if (below === last.current) return;
    last.current = below;

    if (below) {
      fog.color.set('#082136');
      fog.density = 0.075;
      gl.toneMappingExposure = 0.7;
    } else {
      fog.color.set('#cfdef0');
      fog.density = 0.012;
      gl.toneMappingExposure = 1.0;
    }
  });
  return null;
}

// ----------------------------------------------------------------------------
// Camera + controls
// ----------------------------------------------------------------------------

function CameraSetup() {
  const { camera } = useThree();
  useMemo(() => {
    camera.position.set(28, 18, 28);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  return (
    <OrbitControls
      enableDamping
      dampingFactor={0.06}
      minDistance={5}
      maxDistance={140}
      maxPolarAngle={Math.PI - 0.05}
      target={[0, 0, 0]}
    />
  );
}

// ----------------------------------------------------------------------------
// Scene
// ----------------------------------------------------------------------------

function LakeScene({ measurementType }: { measurementType: MeasurementType }) {
  const { boat, mission } = useNavigation();
  const centerLat = boat.position.lat;
  const centerLng = boat.position.lng;

  const { values, points } = useMemo(
    () => generateMeasurementField(mission.waypoints, mission.measurements, measurementType, centerLat, centerLng),
    [mission.waypoints, mission.measurements, measurementType, centerLat, centerLng],
  );

  const config = MEASUREMENT_VIS_CONFIG[measurementType];

  return (
    <>
      <CameraSetup />
      <UnderwaterEffects />

      <SkyDome />

      {/* Sunset HDR for IBL — used by the metal-ish boat material so its
          highlights look like real sky reflections. Wrapped so a failed HDR
          fetch never blocks the rest of the scene. */}
      <Suspense fallback={null}>
        <Environment preset="sunset" environmentIntensity={1.0} />
      </Suspense>

      <hemisphereLight args={['#cfe7ff', '#0a1a30', 0.5]} />
      <ambientLight intensity={0.18} />
      <directionalLight
        position={[SUN_POSITION.x, SUN_POSITION.y, SUN_POSITION.z]}
        intensity={2.2}
        color="#fff1cc"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.5}
        shadow-camera-far={250}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
      />

      <LakeBed depthEnabled={measurementType === 'depth'} />
      <DataField values={values} measurementType={measurementType} />
      <WaterSurface />

      <DataPointMarkers points={points} measurementType={measurementType} config={config} />
      <WaypointPath waypoints={mission.waypoints} centerLat={centerLat} centerLng={centerLng} />
      {mission.waypoints.map((wp, i) => (
        <WaypointMarker3D
          key={wp.id}
          waypoint={wp}
          index={i}
          isActive={mission.currentWaypointIndex === i}
          centerLat={centerLat}
          centerLng={centerLng}
        />
      ))}
      <BoatGLTF
        position={boat.position}
        quaternion={boat.quaternion}
        centerLat={centerLat}
        centerLng={centerLng}
      />
    </>
  );
}

// ----------------------------------------------------------------------------
// Legend (selector lives in the sidebar now)
// ----------------------------------------------------------------------------

function ColorLegend({ measurementType }: { measurementType: MeasurementType }) {
  const config = MEASUREMENT_VIS_CONFIG[measurementType];
  const measurementConfig = MEASUREMENT_CONFIGS.find(c => c.type === measurementType);

  const gradientColors = config.colorScale.map(([r, g, b]) =>
    `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`,
  );

  return (
    <div className="absolute top-3 right-3 z-[500] bg-black/60 backdrop-blur-xl rounded-xl px-4 py-3 border border-white/10">
      <div className="text-white/80 text-xs font-medium mb-1.5">
        {measurementConfig?.icon} {measurementConfig?.label}
      </div>
      <div
        className="w-32 h-2.5 rounded mb-1.5"
        style={{ background: `linear-gradient(to right, ${gradientColors.join(', ')})` }}
      />
      <div className="flex justify-between text-[10px] text-white/50">
        <span>{config.min}{config.unit}</span>
        <span>{config.max}{config.unit}</span>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Top-level
// ----------------------------------------------------------------------------

export default function LakeView3D() {
  const { measurementType } = useNavigation();

  return (
    <div className="w-full h-full" style={{ background: '#0a0c14' }}>
      <Canvas
        shadows
        camera={{ position: [28, 18, 28], fov: 45, near: 0.1, far: 8000 }}
        gl={{
          antialias: true,
          alpha: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
        }}
      >
        <LakeScene measurementType={measurementType} />
      </Canvas>

      <ColorLegend measurementType={measurementType} />

      <div className="absolute bottom-20 left-[16.75rem] z-[500] bg-black/60 backdrop-blur-xl rounded-xl px-3 py-1.5 border border-white/10">
        <span className="text-white/50 text-xs">
          Drag to orbit &bull; Scroll to zoom &bull; Drop the camera under the surface for the underwater view
        </span>
      </div>
    </div>
  );
}
