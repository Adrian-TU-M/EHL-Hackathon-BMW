import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  Environment,
  Lightformer,
  OrbitControls,
  Line,
} from "@react-three/drei";
import { Vector3 } from "three";
import {
  UserRound,
  ChartNoAxesCombined,
  CarFront,
  Mic,
  Scale,
} from "lucide-react";
import type { RefObject } from "react";
import { AgentSculpture, agentMeta } from "../agents/AgentSculpture";
import { SceneBoundary } from "../ui/SceneBoundary";
import { useMotion } from "../ui/useMotion";
import { avatarState } from "../../lib/council/machine";
import type { AgentId, AgentState, CouncilState } from "../../lib/types";
const agents: AgentId[] = [
  "customer",
  "market",
  "competitor",
  "moderator",
  "judge",
];
const fallbackIcons = {
  customer: UserRound,
  market: ChartNoAxesCombined,
  competitor: CarFront,
  moderator: Mic,
  judge: Scale,
};
const positions: Record<AgentId, [number, number, number]> = {
  customer: [-2.35, 0.35, 0.15],
  market: [-1.3, 0.35, -1.8],
  competitor: [1.35, 0.35, -1.8],
  moderator: [-1.1, 0.35, 1.9],
  judge: [1.5, 0.35, 1.4],
};
function ProjectLabels({
  labels,
}: {
  labels: RefObject<Partial<Record<AgentId, HTMLButtonElement>>>;
}) {
  const point = useRef(new Vector3());
  useFrame(({ camera, size }) => {
    for (const agent of agents) {
      const label = labels.current[agent];
      if (!label) continue;
      const [x, y, z] = positions[agent];
      point.current.set(x, y - 0.9, z).project(camera);
      label.style.transform = `translate(${((point.current.x + 1) * size.width) / 2}px, ${((-point.current.y + 1) * size.height) / 2}px) translate(-50%, -50%)`;
      label.style.visibility = "visible";
    }
  });
  return null;
}
export default function CouncilScene({
  council,
  showcase,
  agentStates,
  onSelectAgent,
  selectedAgent,
}: {
  council: CouncilState;
  showcase?: AgentState;
  agentStates?: Partial<Record<AgentId, AgentState>>;
  onSelectAgent?: (agent: AgentId) => void;
  selectedAgent?: AgentId | null;
}) {
  const { reduced, visible } = useMotion();
  const wrapper = useRef<HTMLDivElement>(null);
  const labels = useRef<Partial<Record<AgentId, HTMLButtonElement>>>({});
  const [inView, setInView] = useState(true);
  const stateFor = (agent: AgentId) =>
    showcase ?? agentStates?.[agent] ?? avatarState(council, agent);
  const highlighted = (agent: AgentId) =>
    agentStates?.[agent] !== undefined
      ? ["speaking", "challenging", "evaluating"].includes(stateFor(agent))
      : council.events[council.cursor]?.actor === agent;
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry.isIntersecting),
    );
    if (wrapper.current) observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, []);
  const fallback = (
    <div className="agent-static-row">
      {agents.map((a) => {
        const Icon = fallbackIcons[a];
        return (
          <button
            type="button"
            key={a}
            className={`agent-static ${a}`}
            onClick={() => onSelectAgent?.(a)}
            aria-pressed={selectedAgent === a}
          >
            <Icon
              size={52}
              strokeWidth={1.3}
              aria-hidden="true"
              style={{ color: agentMeta[a].color, marginBottom: 12 }}
            />
            {agentMeta[a].name}
            <small>{stateFor(a)}</small>
          </button>
        );
      })}
    </div>
  );
  return (
    <div
      className="council-scene"
      ref={wrapper}
      role="group"
      aria-label="Agent council: customer feedback, market trends, rival cars, moderator microphone and judge scales"
    >
      <div className="chamber-grid" />
      <SceneBoundary fallback={fallback}>
        <Canvas
          dpr={[1, 1.5]}
          frameloop={
            !visible || !inView ? "never" : reduced ? "demand" : "always"
          }
          camera={{ position: [0, 4.4, 7], fov: 34 }}
          fallback={<p>3D rendering is unavailable in this browser.</p>}
        >
          <ProjectLabels labels={labels} />
          <ambientLight intensity={1.2} />
          <pointLight position={[0, 3, 4]} intensity={35} color="#9ebeff" />
          <Environment resolution={128}>
            <Lightformer
              position={[0, 6, 0]}
              scale={[10, 4, 1]}
              rotation={[-Math.PI / 2, 0, 0]}
              intensity={4}
            />
            <Lightformer
              position={[-4, 2, 3]}
              scale={[3, 5, 1]}
              intensity={3}
              color="#448eff"
            />
            <Lightformer position={[4, 2, 2]} scale={[3, 5, 1]} intensity={4} />
          </Environment>
          {agents.map((a) => (
            <group
              key={a}
              onClick={(event) => {
                event.stopPropagation();
                onSelectAgent?.(a);
              }}
            >
              <AgentSculpture
                agent={a}
                position={positions[a]}
                state={stateFor(a)}
                scale={1.08}
                reduced={reduced || !visible || !inView}
              />
              <Line
                points={[
                  [positions[a][0], -0.43, positions[a][2]],
                  [0, -0.43, 0.15],
                ]}
                color="#4e84b8"
                lineWidth={0.6}
                transparent
                opacity={0.35}
              />
            </group>
          ))}
          <mesh position={[0, -0.61, 0.1]}>
            <cylinderGeometry args={[3, 2.87, 0.32, 96]} />
            <meshStandardMaterial
              color="#0b192d"
              metalness={0.85}
              roughness={0.24}
            />
          </mesh>
          <mesh position={[0, -1.05, 0.1]}>
            <cylinderGeometry args={[1.2, 1.65, 0.65, 48]} />
            <meshStandardMaterial
              color="#081222"
              metalness={0.85}
              roughness={0.3}
            />
          </mesh>
          {[2.94, 2.72, 0.65].map((radius) => (
            <mesh
              key={radius}
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, -0.44, 0.1]}
            >
              <ringGeometry args={[radius, radius + 0.018, 96]} />
              <meshBasicMaterial
                color={radius < 1 ? "#b4daff" : "#398bff"}
                transparent
                opacity={0.8}
              />
            </mesh>
          ))}
          <OrbitControls
            target={[0, -0.35, 0.1]}
            enablePan={false}
            enableZoom={false}
            minPolarAngle={0.7}
            maxPolarAngle={1.3}
            minAzimuthAngle={-0.4}
            maxAzimuthAngle={0.4}
          />
        </Canvas>
      </SceneBoundary>
      <div className="spatial-agent-labels">
        {agents.map((a) => (
          <button
            type="button"
            key={a}
            onClick={() => onSelectAgent?.(a)}
            aria-pressed={selectedAgent === a}
            ref={(el) => {
              if (el) labels.current[a] = el;
              else delete labels.current[a];
            }}
            className={`scene-agent-label ${highlighted(a) ? "is-speaking" : ""} ${selectedAgent === a ? "is-selected" : ""}`}
          >
            <span style={{ background: agentMeta[a].color }} />
            {agentMeta[a].name}
            <small>{stateFor(a)}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
