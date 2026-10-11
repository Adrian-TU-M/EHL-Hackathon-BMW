import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group } from "three";
import type { AgentId, AgentState } from "../../lib/types";
import { AgentIcon } from "./AgentIcons";

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
    color: "#82baff",
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
    color: "#729fff",
    number: "05",
  },
};

/** Shared by the live council, overview and agent-state studio. */
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
  const emblem = useRef<Group>(null),
    halo = useRef<Group>(null),
    elapsed = useRef(0);
  const active =
    state === "speaking" || state === "challenging" || state === "evaluating";
  const paused = state === "paused" || reduced;
  const color = agentMeta[agent].color;
  useFrame((_, delta) => {
    if (paused || !emblem.current) return;
    const step = Math.min(delta, 0.05);
    elapsed.current += step;
    const t = elapsed.current;
    // Restrained movement keeps each symbol facing the PM and recognizable.
    emblem.current.rotation.y = Math.sin(t * 0.38) * 0.13;
    emblem.current.position.y = active
      ? Math.abs(Math.sin(t * 2.4)) * 0.14
      : Math.sin(t * 0.8) * 0.035;
    const target = active ? 1.06 : 1;
    emblem.current.scale.setScalar(
      emblem.current.scale.x +
        (target - emblem.current.scale.x) * (1 - Math.exp(-step * 5)),
    );
    if (halo.current) halo.current.rotation.z += step * (active ? 0.5 : 0.12);
  });
  return (
    <group position={position} scale={scale} name={`${agent}-agent-emblem`}>
      {active && (
        <group>
          <mesh position={[0, 0.02, 0]}>
            <cylinderGeometry args={[0.83, 0.56, 1.5, 48, 1, true]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.08}
              depthWrite={false}
              side={2}
            />
          </mesh>
          {[-0.52, -0.34, 0.78].map((y) => (
            <mesh key={y} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.72, 0.738, 64]} />
              <meshBasicMaterial color={color} transparent opacity={0.65} />
            </mesh>
          ))}
          <pointLight
            position={[0, 0.3, 0.8]}
            color={color}
            intensity={2.5}
            distance={2}
          />
        </group>
      )}
      <group ref={emblem}>
        <AgentIcon agent={agent} active={active} paused={paused} />
        <group ref={halo} position={[0, 0.02, -0.23]}>
          {[0, Math.PI].map((angle) => (
            <mesh key={angle} rotation={[0, 0, angle]}>
              <torusGeometry args={[0.73, 0.009, 5, 40, Math.PI * 0.68]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={active ? 0.7 : 0.28}
              />
            </mesh>
          ))}
        </group>
      </group>
      <mesh position={[0, -0.68, 0]}>
        <cylinderGeometry args={[0.54, 0.61, 0.065, 40]} />
        <meshStandardMaterial
          color="#162236"
          metalness={0.8}
          roughness={0.28}
        />
      </mesh>
      <mesh position={[0, -0.645, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.49, 0.52, 48]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={active ? 0.95 : 0.4}
        />
      </mesh>
      {[-0.13, 0, 0.13].map((x, index) => (
        <mesh key={x} position={[x, -0.665, 0.565]} rotation={[0, 0, -0.3]}>
          <boxGeometry args={[0.06, 0.035, 0.014]} />
          <meshBasicMaterial color={["#8bc7ff", "#2e8aff", "#154790"][index]} />
        </mesh>
      ))}
    </group>
  );
}
