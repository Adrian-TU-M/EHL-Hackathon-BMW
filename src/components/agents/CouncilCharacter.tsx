import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line, RoundedBox } from "@react-three/drei";
import {
  Color,
  Float32BufferAttribute,
  Group,
  Shape,
  SphereGeometry,
} from "three";
import type { AgentId, AgentState } from "../../lib/types";

const palettes: Record<AgentId, [string, string, string]> = {
  judge: ["#0757a5", "#703ab2", "#f4d88c"],
  market: ["#08704a", "#3ddf9c", "#f3cf76"],
  customer: ["#c85786", "#7c6dce", "#ffe2c7"],
  competitor: ["#a21e42", "#471b85", "#ff8b51"],
  moderator: ["#6950b5", "#9ba7ed", "#e3e8ff"],
};
const SILVER = "#dae9fa";
const GOLD = "#efc564";
function Metal({ color = SILVER }: { color?: string }) {
  return (
    <meshStandardMaterial color={color} metalness={0.68} roughness={0.24} />
  );
}
function Glow({ color = "#fff0d8" }: { color?: string }) {
  return (
    <meshStandardMaterial
      color={color}
      emissive={color}
      emissiveIntensity={0.75}
      roughness={0.3}
      toneMapped={false}
    />
  );
}
function Coin({
  position,
  angle,
}: {
  position: [number, number, number];
  angle: number;
}) {
  return (
    <group position={position} rotation={[0, angle, -0.12]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.115, 0.115, 0.045, 32]} />
        <Metal color={GOLD} />
      </mesh>
      <mesh position={[0, 0, 0.026]}>
        <torusGeometry args={[0.089, 0.008, 6, 28]} />
        <Metal color="#fff0bb" />
      </mesh>
      {[-0.034, 0, 0.034].map((x, i) => (
        <mesh key={x} position={[x, -0.02 + i * 0.016, 0.029]}>
          <boxGeometry args={[0.02, 0.035 + i * 0.028, 0.008]} />
          <Glow color="#fff0b0" />
        </mesh>
      ))}
    </group>
  );
}
function Heart() {
  const shape = useMemo(() => {
    const s = new Shape();
    s.moveTo(0, -0.12);
    s.bezierCurveTo(-0.27, 0.06, -0.12, 0.25, 0, 0.12);
    s.bezierCurveTo(0.12, 0.25, 0.27, 0.06, 0, -0.12);
    return s;
  }, []);
  return (
    <mesh rotation={[0, -0.2, -0.12]}>
      <extrudeGeometry
        args={[
          shape,
          {
            depth: 0.055,
            bevelEnabled: true,
            bevelThickness: 0.018,
            bevelSize: 0.018,
            bevelSegments: 3,
            steps: 1,
          },
        ]}
      />
      <Metal color="#ffadcc" />
    </mesh>
  );
}
function Accessories({
  agent,
  active,
  paused,
}: {
  agent: AgentId;
  active: boolean;
  paused: boolean;
}) {
  const orbit = useRef<Group>(null);
  const elapsed = useRef(0);
  useFrame((_, delta) => {
    if (paused || !orbit.current) return;
    elapsed.current += Math.min(delta, 0.05);
    const t = elapsed.current;
    orbit.current.rotation.y =
      agent === "moderator" ? t * 0.3 : Math.sin(t * 0.65) * 0.16;
    orbit.current.position.y = Math.sin(t * (active ? 2.4 : 1.1)) * 0.025;
  });
  if (agent === "market")
    return (
      <group ref={orbit}>
        <mesh position={[0, 0.64, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.4, 0.023, 10, 48]} />
          <Metal color={GOLD} />
        </mesh>
        {Array.from({ length: 5 }, (_, i) => {
          const angle = (i * Math.PI * 2) / 5;
          return (
            <Coin
              key={i}
              position={[
                Math.sin(angle) * 0.4,
                0.74 + (i === 0 ? 0.05 : 0),
                Math.cos(angle) * 0.4,
              ]}
              angle={angle}
            />
          );
        })}
      </group>
    );
  if (agent === "customer")
    return (
      <>
        <mesh position={[0, 0, -0.02]}>
          <torusGeometry args={[0.635, 0.037, 12, 48, Math.PI]} />
          <Metal />
        </mesh>
        {[-1, 1].map((side) => (
          <group key={side} position={[side * 0.59, 0.02, 0]}>
            <RoundedBox args={[0.14, 0.3, 0.25]} radius={0.055}>
              <Metal color="#dcb9e0" />
            </RoundedBox>
            <mesh
              position={[side * 0.078, 0, 0]}
              rotation={[0, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[0.084, 0.084, 0.012, 24]} />
              <Glow color="#ffd5e7" />
            </mesh>
          </group>
        ))}
        <group ref={orbit}>
          <group position={[0.68, 0.52, 0.08]} scale={0.8}>
            <Heart />
          </group>
        </group>
      </>
    );
  if (agent === "competitor")
    return (
      <>
        {[-1, 1].map((side) => (
          <group
            key={side}
            position={[side * 0.44, 0.39, -0.16]}
            rotation={[0, side * 0.3, -side * 0.55]}
          >
            <mesh>
              <coneGeometry args={[0.115, 0.47, 3]} />
              <Metal color="#e3b4c1" />
            </mesh>
            <mesh position={[0, -0.13, 0.05]}>
              <boxGeometry args={[0.06, 0.2, 0.028]} />
              <Glow color="#ff824f" />
            </mesh>
          </group>
        ))}
        <group ref={orbit}>
          <group position={[0.76, 0.08, 0]} rotation={[0, -0.2, -0.16]}>
            <mesh>
              <cylinderGeometry args={[0.014, 0.014, 0.62, 8]} />
              <Metal />
            </mesh>
            {[0, 1, 2].flatMap((col) =>
              [0, 1].map((row) => (
                <mesh
                  key={`${col}-${row}`}
                  position={[0.06 + col * 0.075, 0.19 + row * 0.075, 0]}
                >
                  <boxGeometry args={[0.075, 0.075, 0.012]} />
                  <meshStandardMaterial
                    color={(col + row) % 2 ? "#10172a" : "#ecedfa"}
                    roughness={0.35}
                  />
                </mesh>
              )),
            )}
          </group>
        </group>
      </>
    );
  if (agent === "moderator")
    return (
      <>
        <group rotation={[0.5, 0.15, 0.18]}>
          <group ref={orbit}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.76, 0.012, 8, 64]} />
              <Glow color="#b4a2ff" />
            </mesh>
            {["#ffb4d2", "#5ee4b4", "#ff7b83", "#b9a1ff", "#6fbaff"].map(
              (color, i) => (
                <mesh
                  key={color}
                  position={[
                    Math.cos((i * Math.PI * 2) / 5) * 0.76,
                    0,
                    Math.sin((i * Math.PI * 2) / 5) * 0.76,
                  ]}
                >
                  <sphereGeometry args={[0.05, 16, 12]} />
                  <Glow color={color} />
                </mesh>
              ),
            )}
          </group>
        </group>
        <group position={[-0.68, -0.13, 0.22]} rotation={[0, 0, -0.18]}>
          <mesh position={[0, 0.12, 0]}>
            <capsuleGeometry args={[0.075, 0.17, 6, 16]} />
            <Metal />
          </mesh>
          {[-0.015, 0.035, 0.085, 0.135].map((y) => (
            <mesh key={y} position={[0, y, 0.071]}>
              <boxGeometry args={[0.105, 0.013, 0.012]} />
              <meshBasicMaterial color="#24314b" />
            </mesh>
          ))}
          <mesh position={[0, -0.1, 0]}>
            <cylinderGeometry args={[0.022, 0.022, 0.18, 12]} />
            <Metal />
          </mesh>
          <mesh position={[0, -0.2, 0]}>
            <cylinderGeometry args={[0.11, 0.13, 0.03, 24]} />
            <Metal />
          </mesh>
        </group>
      </>
    );
  return (
    <group ref={orbit}>
      <mesh position={[0, 0.7, -0.1]} rotation={[Math.PI / 2, 0.15, 0]}>
        <torusGeometry args={[0.27, 0.012, 8, 48]} />
        <Glow color="#ffe5ae" />
      </mesh>
    </group>
  );
}

/** Shared character silhouette; all surfaces and role accessories are real 3D meshes. */
export function CouncilCharacter({
  agent,
  state,
  paused,
}: {
  agent: AgentId;
  state: AgentState;
  paused: boolean;
}) {
  const eyes = useRef<Group>(null);
  const time = useRef(0);
  const active = ["speaking", "challenging", "evaluating"].includes(state);
  const geometry = useMemo(() => {
    const sphere = new SphereGeometry(0.57, 64, 48);
    const vertices = sphere.getAttribute("position");
    const colors = new Float32Array(vertices.count * 3);
    const [base, accent, warm] = palettes[agent].map(
      (color) => new Color(color),
    );
    const c = new Color();
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i) / 0.57,
        y = vertices.getY(i) / 0.57,
        z = vertices.getZ(i) / 0.57;
      const violet = Math.exp(
        -((x - 0.65) ** 2 + (y - 0.25) ** 2 + (z - 0.45) ** 2) * 2,
      );
      const gold = Math.exp(
        -((x + 0.55) ** 2 + (y + 0.45) ** 2 + (z - 0.65) ** 2) * 2.4,
      );
      c.copy(base)
        .lerp(accent, violet * 0.86)
        .lerp(warm, gold * 0.86);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    sphere.setAttribute("color", new Float32BufferAttribute(colors, 3));
    return sphere;
  }, [agent]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((_, delta) => {
    if (paused || !eyes.current) return;
    time.current += Math.min(delta, 0.05);
    const phase =
      (time.current + Object.keys(palettes).indexOf(agent) * 1.17) % 5.3;
    const blink =
      phase > 4.95 ? Math.max(0.07, Math.abs(phase - 5.12) / 0.17) : 1;
    eyes.current.scale.y =
      blink * (active ? 0.92 + 0.08 * Math.sin(time.current * 4) : 1);
  });
  return (
    <group name={`${agent}-character`}>
      <mesh geometry={geometry}>
        <meshPhysicalMaterial
          vertexColors
          metalness={0.35}
          roughness={0.26}
          clearcoat={1}
          clearcoatRoughness={0.14}
          iridescence={0.22}
          iridescenceIOR={1.3}
        />
      </mesh>
      <group rotation={[-0.12, 0, 0]}>
        <group ref={eyes} position={[0, 0.055, 0.525]}>
          {[-1, 1].map((side) => (
            <RoundedBox
              key={side}
              position={[side * 0.215, 0, 0]}
              rotation={[0, side * 0.32, side * -0.06]}
              args={[0.27, agent === "competitor" ? 0.085 : 0.115, 0.045]}
              radius={0.04}
              smoothness={4}
            >
              <Glow />
            </RoundedBox>
          ))}
        </group>
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            position={[side * 0.23, 0.235, 0.469]}
            rotation={[
              0,
              side * 0.25,
              Math.PI / 2 + side * (state === "challenging" ? -0.18 : 0.08),
            ]}
          >
            <capsuleGeometry args={[0.014, 0.1, 4, 12]} />
            <meshStandardMaterial
              color={agent === "judge" ? "#0864c6" : "#283e6e"}
              roughness={0.3}
            />
          </mesh>
        ))}
        <Line
          points={[
            [-0.07, -0.16, 0.541],
            [0, -0.18, 0.548],
            [0.07, -0.16, 0.541],
          ]}
          color="#edf0e7"
          lineWidth={1.25}
          transparent
          opacity={0.65}
        />
      </group>
      <Accessories agent={agent} active={active} paused={paused} />
    </group>
  );
}
