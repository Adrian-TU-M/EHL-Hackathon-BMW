import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshDistortMaterial } from "@react-three/drei";
import { Group } from "three";
import type { AgentId, AgentState } from "../../lib/types";
export const agentMeta: Record<
  AgentId,
  { name: string; role: string; color: string; number: string }
> = {
  customer: {
    name: "Customer",
    role: "The human perspective",
    color: "#4799ff",
    number: "01",
  },
  market: {
    name: "Market",
    role: "The future perspective",
    color: "#3fcbe6",
    number: "02",
  },
  competitor: {
    name: "Competitor",
    role: "The competitive perspective",
    color: "#b9c8e0",
    number: "03",
  },
  moderator: {
    name: "Moderator",
    role: "Discussion & coordination",
    color: "#e3e9f3",
    number: "04",
  },
  judge: {
    name: "Judge",
    role: "Evidence & evaluation",
    color: "#7b94ff",
    number: "05",
  },
};
export function AgentSculpture({
  agent,
  state = "idle",
  position = [0, 0, 0],
  scale = 1,
  reduced = false,
}: {
  agent: AgentId;
  state?: AgentState;
  position?: [number, number, number];
  scale?: number;
  reduced?: boolean;
}) {
  const group = useRef<Group>(null);
  const active = ["speaking", "challenging", "evaluating"].includes(state);
  const paused = state === "paused" || reduced;
  const color = agentMeta[agent].color;
  useFrame(({ clock }, delta) => {
    if (!group.current || paused) return;
    const t = clock.elapsedTime;
    group.current.rotation.y += delta * (active ? 0.45 : 0.14);
    group.current.position.y =
      position[1] + Math.sin(t * (active ? 1.8 : 0.8)) * 0.07;
    const target = scale * (active ? 1.1 : 1);
    group.current.scale.setScalar(
      group.current.scale.x + (target - group.current.scale.x) * 0.05,
    );
  });
  return (
    <group ref={group} position={position} scale={scale}>
      {agent === "customer" && (
        <>
          <mesh>
            <icosahedronGeometry args={[0.63, 5]} />
            <MeshDistortMaterial
              color={color}
              roughness={0.15}
              metalness={0.65}
              distort={0.34}
              speed={paused ? 0 : active ? 3 : 1.3}
              emissive="#064092"
              emissiveIntensity={active ? 0.65 : 0.2}
            />
          </mesh>
          {[0, 1, 2].map((i) => (
            <mesh
              key={i}
              rotation={[Math.PI / 2 + i * 0.2, 0, i * 0.5]}
              scale={[1, 1.07, 1]}
            >
              <torusGeometry args={[0.85 + i * 0.07, 0.012, 12, 80]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={0.7}
                transparent
                opacity={0.45}
              />
            </mesh>
          ))}
        </>
      )}
      {agent === "market" && (
        <>
          <mesh>
            <sphereGeometry args={[0.34, 32, 32]} />
            <meshPhysicalMaterial
              color="#163f6c"
              roughness={0.06}
              metalness={0.9}
              clearcoat={1}
            />
          </mesh>
          {[0, 1, 2].map((i) => (
            <group key={i} rotation={[i * 0.8 + 0.3, i * 0.4, i * 0.9]}>
              <mesh>
                <torusGeometry args={[0.62 + i * 0.13, 0.045, 16, 90]} />
                <meshStandardMaterial
                  color={i === 1 ? "#b1edff" : "#269ec8"}
                  metalness={0.9}
                  roughness={0.16}
                  emissive={color}
                  emissiveIntensity={active ? 0.4 : 0.12}
                />
              </mesh>
              <mesh position={[0.62 + i * 0.13, 0, 0]}>
                <sphereGeometry args={[0.085, 20, 20]} />
                <meshStandardMaterial
                  color="#edfdff"
                  emissive={color}
                  emissiveIntensity={2}
                />
              </mesh>
            </group>
          ))}
        </>
      )}
      {agent === "competitor" && (
        <>
          {[0, 1, 2].map((i) => (
            <mesh
              key={i}
              position={[0, (i - 1) * 0.5, 0]}
              rotation={[0.15, Math.PI / 4 + i * 0.4, 0.1]}
              scale={[1 - i * 0.12, 0.8, 1 - i * 0.12]}
            >
              <octahedronGeometry args={[0.65, 0]} />
              <meshPhysicalMaterial
                color={i === 1 ? "#728aa8" : "#d7e2f1"}
                metalness={1}
                roughness={0.15}
                clearcoat={1}
              />
            </mesh>
          ))}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.85, 0.009, 8, 80]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={1}
            />
          </mesh>
        </>
      )}
      {agent === "moderator" && (
        <>
          <mesh rotation={[0.5, 0, 0]}>
            <torusGeometry args={[0.52, 0.065, 20, 90]} />
            <meshStandardMaterial
              color="#d7e3f4"
              metalness={0.8}
              roughness={0.2}
            />
          </mesh>
          <mesh rotation={[-0.5, Math.PI / 2, 0]}>
            <torusGeometry args={[0.52, 0.025, 12, 90]} />
            <meshStandardMaterial
              color="#629df2"
              emissive="#1c69d4"
              emissiveIntensity={1}
            />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.16, 24, 24]} />
            <meshStandardMaterial
              color="white"
              emissive="#9ac9ff"
              emissiveIntensity={2}
            />
          </mesh>
        </>
      )}
      {agent === "judge" && (
        <>
          <mesh rotation={[0, 0, Math.PI / 4]}>
            <octahedronGeometry args={[0.7, 0]} />
            <meshPhysicalMaterial
              color="#293543"
              metalness={1}
              roughness={0.19}
              clearcoat={1}
            />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.36, 32, 32]} />
            <meshStandardMaterial
              color="#8fd9ff"
              emissive="#96d2ff"
              emissiveIntensity={active ? 3 : 1}
            />
          </mesh>
          {[-1, 1].map((i) => (
            <mesh
              key={i}
              position={[0, i * 0.72, 0]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <torusGeometry args={[0.43, 0.028, 12, 60]} />
              <meshStandardMaterial
                color="#879cc4"
                metalness={0.7}
                roughness={0.1}
                emissive="#5f86ff"
                emissiveIntensity={0.3}
              />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
}
