import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Clone, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

interface BoatModelProps {
  quaternion: { w: number; x: number; y: number; z: number };
}

const BURNT_ORANGE = new THREE.Color('#c47a2a');

function BoatModel({ quaternion }: BoatModelProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const innerRef = useRef<THREE.Group>(null!);
  const targetQuat = useRef(new THREE.Quaternion());
  const colored = useRef(false);
  const { scene } = useGLTF('/FInalAssembly.gltf');

  useFrame(() => {
    // Apply color once after the clone is mounted
    if (!colored.current && innerRef.current) {
      innerRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = (child.material as THREE.MeshStandardMaterial).clone();
          mat.color.copy(BURNT_ORANGE);
          child.material = mat;
        }
      });
      colored.current = true;
    }

    targetQuat.current.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    groupRef.current.quaternion.slerp(targetQuat.current, 0.1);
  });

  return (
    <group ref={groupRef}>
      {/* Clone gives each instance its own copy of the scene graph */}
      <group ref={innerRef} rotation={[-Math.PI / 2, 0, 0]} scale={1.2}>
        <Clone object={scene} />
      </group>
    </group>
  );
}

export default function Boat3DView({ quaternion }: BoatModelProps) {
  return (
    <div className="w-full h-full rounded-xl overflow-hidden">
      <Canvas
        camera={{ position: [1.8, 1.2, 1.8], fov: 35 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 2]} intensity={0.8} color="#94a3b8" />
        <directionalLight position={[-2, 3, -1]} intensity={0.3} color="#3b82f6" />
        <pointLight position={[0, 2, 0]} intensity={0.3} color="#60a5fa" />

        <BoatModel quaternion={quaternion} />
      </Canvas>
    </div>
  );
}
