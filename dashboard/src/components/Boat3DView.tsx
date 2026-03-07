import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';

interface BoatModelProps {
  heading: number;
  roll: number;
  pitch: number;
}

function CatamaranModel({ heading, roll, pitch }: BoatModelProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const targetRotation = useRef(new THREE.Euler());

  useFrame(() => {
    // Convert degrees to radians, apply smooth interpolation
    const headingRad = THREE.MathUtils.degToRad(-heading);
    const rollRad = THREE.MathUtils.degToRad(roll);
    const pitchRad = THREE.MathUtils.degToRad(pitch);

    targetRotation.current.set(pitchRad, headingRad, rollRad, 'YXZ');

    const group = groupRef.current;
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, targetRotation.current.x, 0.1);
    group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, targetRotation.current.y, 0.1);
    group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, targetRotation.current.z, 0.1);
  });

  const hullColor = '#1a2744';
  const deckColor = '#2a3a5c';
  const accentColor = '#3b82f6';

  return (
    <group ref={groupRef}>
      {/* Left Hull */}
      <group position={[-0.55, -0.1, 0]}>
        <mesh>
          <boxGeometry args={[0.25, 0.15, 1.6]} />
          <meshStandardMaterial color={hullColor} roughness={0.3} metalness={0.6} />
        </mesh>
        {/* Hull bottom curve */}
        <mesh position={[0, -0.08, 0]}>
          <boxGeometry args={[0.2, 0.05, 1.5]} />
          <meshStandardMaterial color={hullColor} roughness={0.3} metalness={0.6} />
        </mesh>
        {/* Motor mount */}
        <mesh position={[0, -0.05, -0.75]}>
          <cylinderGeometry args={[0.06, 0.08, 0.12, 8]} />
          <meshStandardMaterial color="#334155" roughness={0.4} metalness={0.7} />
        </mesh>
        {/* Propeller */}
        <mesh position={[0, -0.05, -0.85]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 0.02, 6]} />
          <meshStandardMaterial color={accentColor} roughness={0.2} metalness={0.8} emissive={accentColor} emissiveIntensity={0.3} />
        </mesh>
      </group>

      {/* Right Hull */}
      <group position={[0.55, -0.1, 0]}>
        <mesh>
          <boxGeometry args={[0.25, 0.15, 1.6]} />
          <meshStandardMaterial color={hullColor} roughness={0.3} metalness={0.6} />
        </mesh>
        <mesh position={[0, -0.08, 0]}>
          <boxGeometry args={[0.2, 0.05, 1.5]} />
          <meshStandardMaterial color={hullColor} roughness={0.3} metalness={0.6} />
        </mesh>
        <mesh position={[0, -0.05, -0.75]}>
          <cylinderGeometry args={[0.06, 0.08, 0.12, 8]} />
          <meshStandardMaterial color="#334155" roughness={0.4} metalness={0.7} />
        </mesh>
        <mesh position={[0, -0.05, -0.85]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 0.02, 6]} />
          <meshStandardMaterial color={accentColor} roughness={0.2} metalness={0.8} emissive={accentColor} emissiveIntensity={0.3} />
        </mesh>
      </group>

      {/* Cross Beams */}
      <mesh position={[0, 0, 0.3]}>
        <boxGeometry args={[1.1, 0.04, 0.08]} />
        <meshStandardMaterial color={deckColor} roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0, -0.3]}>
        <boxGeometry args={[1.1, 0.04, 0.08]} />
        <meshStandardMaterial color={deckColor} roughness={0.4} metalness={0.5} />
      </mesh>

      {/* Center Deck */}
      <mesh position={[0, 0.04, 0]}>
        <boxGeometry args={[0.6, 0.06, 0.8]} />
        <meshStandardMaterial color={deckColor} roughness={0.4} metalness={0.5} />
      </mesh>

      {/* Solar Panel */}
      <mesh position={[0, 0.1, 0.05]}>
        <boxGeometry args={[0.5, 0.02, 0.6]} />
        <meshStandardMaterial color="#1e3a5f" roughness={0.1} metalness={0.9} />
      </mesh>
      {/* Solar panel grid lines */}
      <mesh position={[0, 0.115, 0.05]}>
        <boxGeometry args={[0.48, 0.002, 0.58]} />
        <meshStandardMaterial color={accentColor} roughness={0.2} metalness={0.8} transparent opacity={0.3} />
      </mesh>

      {/* Control Box */}
      <mesh position={[0, 0.16, -0.1]}>
        <boxGeometry args={[0.2, 0.08, 0.15]} />
        <meshStandardMaterial color="#334155" roughness={0.3} metalness={0.6} />
      </mesh>
      {/* Antenna */}
      <mesh position={[0.05, 0.25, -0.1]}>
        <cylinderGeometry args={[0.008, 0.008, 0.14, 6]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.3} metalness={0.8} />
      </mesh>
      {/* Antenna tip */}
      <mesh position={[0.05, 0.33, -0.1]}>
        <sphereGeometry args={[0.015, 8, 8]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.5} />
      </mesh>

      {/* Bow marker */}
      <mesh position={[0, 0.05, 0.75]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.04, 0.04, 0.04]} />
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}

export default function Boat3DView({ heading, roll, pitch }: BoatModelProps) {
  return (
    <div className="w-full h-48 rounded-xl overflow-hidden">
      <Canvas
        camera={{ position: [1.8, 1.2, 1.8], fov: 35 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[3, 5, 2]} intensity={0.8} color="#94a3b8" />
        <directionalLight position={[-2, 3, -1]} intensity={0.3} color="#3b82f6" />
        <pointLight position={[0, 2, 0]} intensity={0.3} color="#60a5fa" />

        <CatamaranModel heading={heading} roll={roll} pitch={pitch} />
        <Environment preset="night" />
      </Canvas>
    </div>
  );
}
