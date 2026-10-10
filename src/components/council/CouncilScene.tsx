import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  Environment,
  Lightformer,
  OrbitControls,
  Line,
} from "@react-three/drei";
import { Vector3 } from "three";
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
const positions: Record<AgentId, [number, number, number]> = {
  customer: [-2.35, 0.4, 0],
  market: [0, 0.65, -1],
  competitor: [2.35, 0.4, 0],
  moderator: [-1.05, -0.05, 2],
  judge: [1.15, 0.05, 2],
};
function ProjectLabels({
  labels,
}: {
  labels: RefObject<Partial<Record<AgentId, HTMLDivElement>>>;
}) {
  const point = useRef(new Vector3());
  useFrame(({ camera, size }) => {
    for (const agent of agents) {
      const label = labels.current[agent];
      if (!label) continue;
      const [x, y, z] = positions[agent];
      point.current
        .set(x, y - (agent === "moderator" ? 0.65 : 0.9), z)
        .project(camera);
      label.style.transform = `translate(${((point.current.x + 1) * size.width) / 2}px, ${((-point.current.y + 1) * size.height) / 2}px) translate(-50%, -50%)`;
      label.style.visibility = "visible";
    }
  });
  return null;
}
export default function CouncilScene({
  council,
  showcase,
}: {
  council: CouncilState;
  showcase?: AgentState;
}) {
  const { reduced, visible } = useMotion();
  const wrapper = useRef<HTMLDivElement>(null);
  const labels = useRef<Partial<Record<AgentId, HTMLDivElement>>>({});
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry.isIntersecting),
    );
    if (wrapper.current) observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, []);
  const fallback = (
    <div className="agent-static-row">
      {agents.map((a) => (
        <div key={a} className={`agent-static ${a}`}>
          <span />
          {agentMeta[a].name}
          <small>{showcase || avatarState(council, a)}</small>
        </div>
      ))}
    </div>
  );
  return (
    <div className="council-scene" ref={wrapper}>
      <div className="chamber-grid" />
      <SceneBoundary fallback={fallback}>
        <Canvas
          dpr={[1, 1.5]}
          frameloop={
            !visible || !inView ? "never" : reduced ? "demand" : "always"
          }
          camera={{ position: [0, 4.3, 7.3], fov: 34 }}
          fallback={fallback}
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
            <group key={a}>
              <AgentSculpture
                agent={a}
                position={positions[a]}
                state={showcase || avatarState(council, a)}
                scale={a === "moderator" ? 0.6 : a === "judge" ? 0.75 : 1}
                reduced={reduced || !visible || !inView}
              />
              <Line
                points={[
                  [positions[a][0], -0.64, positions[a][2]],
                  [0, -0.64, 0.5],
                ]}
                color="#4e84b8"
                lineWidth={0.6}
                transparent
                opacity={0.35}
              />
            </group>
          ))}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.65, 0.4]}>
            <ringGeometry args={[2.6, 2.62, 100]} />
            <meshBasicMaterial color="#3274a5" transparent opacity={0.4} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.66, 0.4]}>
            <circleGeometry args={[2.6, 100]} />
            <meshStandardMaterial
              color="#081a2b"
              metalness={0.6}
              roughness={0.35}
              transparent
              opacity={0.65}
            />
          </mesh>
          <OrbitControls
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
          <div
            key={a}
            ref={(el) => {
              if (el) labels.current[a] = el;
              else delete labels.current[a];
            }}
            className={`scene-agent-label ${council.events[council.cursor]?.actor === a ? "is-speaking" : ""}`}
          >
            <span style={{ background: agentMeta[a].color }} />
            {agentMeta[a].name}
            <small>{showcase || avatarState(council, a)}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
