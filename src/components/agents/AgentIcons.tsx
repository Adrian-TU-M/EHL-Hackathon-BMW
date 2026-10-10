import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, Quaternion, Shape, Vector3 } from "three";
import type { AgentId } from "../../lib/types";

type Motion = { active: boolean; paused: boolean };
type Point = [number, number, number];
const BLUE = "#338aff",
  SILVER = "#dce9f7",
  DARK = "#122b48";
const Y_AXIS = new Vector3(0, 1, 0);
const EXTRUSION = {
  depth: 0.1,
  bevelEnabled: true,
  bevelSegments: 3,
  steps: 1,
  bevelSize: 0.035,
  bevelThickness: 0.035,
  curveSegments: 8,
};
function roundedShape(width: number, height: number, radius: number) {
  const s = new Shape(),
    x = -width / 2,
    y = -height / 2;
  s.moveTo(x + radius, y);
  s.lineTo(x + width - radius, y);
  s.quadraticCurveTo(x + width, y, x + width, y + radius);
  s.lineTo(x + width, y + height - radius);
  s.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  s.lineTo(x + radius, y + height);
  s.quadraticCurveTo(x, y + height, x, y + height - radius);
  s.lineTo(x, y + radius);
  s.quadraticCurveTo(x, y, x + radius, y);
  return s;
}
const CHAT = roundedShape(0.52, 0.34, 0.085),
  CHART = roundedShape(1.06, 1.03, 0.09);
function Metal({
  color = SILVER,
  luminous = false,
}: {
  color?: string;
  luminous?: boolean;
}) {
  return (
    <meshStandardMaterial
      color={color}
      metalness={0.72}
      roughness={0.23}
      emissive={luminous ? color : "#000000"}
      emissiveIntensity={luminous ? 0.3 : 0}
    />
  );
}
function Rod({
  from,
  to,
  radius = 0.025,
  color = SILVER,
}: {
  from: Point;
  to: Point;
  radius?: number;
  color?: string;
}) {
  const [ax, ay, az] = from,
    [bx, by, bz] = to;
  const transform = useMemo(() => {
    const a = new Vector3(ax, ay, az),
      b = new Vector3(bx, by, bz),
      delta = b.clone().sub(a);
    return {
      position: a.add(b).multiplyScalar(0.5),
      length: delta.length(),
      rotation: new Quaternion().setFromUnitVectors(Y_AXIS, delta.normalize()),
    };
  }, [ax, ay, az, bx, by, bz]);
  return (
    <mesh position={transform.position} quaternion={transform.rotation}>
      <cylinderGeometry args={[radius, radius, transform.length, 10]} />
      <Metal color={color} luminous={color === BLUE} />
    </mesh>
  );
}
function CustomerIcon({ active, paused }: Motion) {
  const bubble = useRef<Group>(null),
    time = useRef(0);
  useFrame((_, delta) => {
    if (paused || !bubble.current) return;
    time.current += Math.min(delta, 0.05);
    bubble.current.position.y =
      0.29 + Math.sin(time.current * (active ? 2.4 : 1.2)) * 0.028;
  });
  return (
    <group name="person-and-feedback">
      <mesh position={[-0.16, 0.24, 0.04]}>
        <sphereGeometry args={[0.225, 28, 20]} />
        <Metal />
      </mesh>
      <mesh position={[-0.16, -0.23, 0.035]} scale={[0.39, 0.285, 0.23]}>
        <sphereGeometry args={[1, 28, 20]} />
        <Metal color={BLUE} />
      </mesh>
      <mesh position={[-0.16, -0.42, 0.065]} scale={[0.38, 0.055, 0.22]}>
        <sphereGeometry args={[1, 24, 12]} />
        <Metal color={DARK} />
      </mesh>
      <group
        ref={bubble}
        position={[0.36, 0.29, 0.19]}
        rotation={[0, -0.12, 0]}
      >
        <mesh>
          <extrudeGeometry args={[CHAT, EXTRUSION]} />
          <Metal color="#f2f6fc" />
        </mesh>
        <mesh position={[-0.14, -0.21, 0.052]} rotation={[0, 0, Math.PI]}>
          <coneGeometry args={[0.085, 0.17, 3]} />
          <Metal color="#f2f6fc" />
        </mesh>
        {[-0.14, 0, 0.14].map((x) => (
          <mesh key={x} position={[x, 0, 0.15]}>
            <sphereGeometry args={[0.028, 12, 8]} />
            <Metal color={BLUE} luminous />
          </mesh>
        ))}
      </group>
    </group>
  );
}
function MarketIcon({ active, paused }: Motion) {
  const bars = useRef<Group>(null),
    time = useRef(0);
  useFrame((_, delta) => {
    if (paused || !bars.current) return;
    time.current += Math.min(delta, 0.05);
    bars.current.children.forEach((bar, index) => {
      bar.scale.y =
        1 +
        Math.sin(time.current * (active ? 2 : 0.7) - index * 0.7) *
          (active ? 0.07 : 0.025);
    });
  });
  return (
    <group name="market-growth-chart" rotation={[0, -0.13, 0]}>
      <mesh position={[0, -0.02, -0.16]}>
        <extrudeGeometry args={[CHART, EXTRUSION]} />
        <meshStandardMaterial
          color={DARK}
          metalness={0.55}
          roughness={0.28}
          transparent
          opacity={0.85}
        />
      </mesh>
      {[-0.29, -0.02, 0.25].map((y) => (
        <mesh key={y} position={[0, y, -0.015]}>
          <boxGeometry args={[0.93, 0.009, 0.01]} />
          <meshBasicMaterial color="#4676a8" transparent opacity={0.6} />
        </mesh>
      ))}
      <group ref={bars} position={[0, -0.47, 0.075]}>
        {[0.28, 0.5, 0.76].map((height, index) => (
          <group key={height} position={[-0.32 + index * 0.3, 0, 0]}>
            <mesh position={[0, height / 2, 0]}>
              <boxGeometry args={[0.17, height, 0.2]} />
              <Metal color={["#23549a", "#338aff", "#a2ceff"][index]} />
            </mesh>
            <mesh position={[0, height - 0.025, 0.106]}>
              <boxGeometry args={[0.12, 0.012, 0.01]} />
              <meshBasicMaterial color="#e8f3ff" />
            </mesh>
          </group>
        ))}
      </group>
      <Rod from={[-0.43, -0.04, 0.23]} to={[-0.08, 0.19, 0.23]} />
      <Rod from={[-0.08, 0.19, 0.23]} to={[0.17, 0.17, 0.23]} />
      <Rod from={[0.17, 0.17, 0.23]} to={[0.49, 0.5, 0.23]} />
      <Rod from={[0.49, 0.5, 0.23]} to={[0.29, 0.47, 0.23]} />
      <Rod from={[0.49, 0.5, 0.23]} to={[0.48, 0.3, 0.23]} />
    </group>
  );
}
function Car({ blue = false }: { blue?: boolean }) {
  return (
    <group>
      <mesh scale={[0.46, 0.1, 0.22]}>
        <sphereGeometry args={[1, 24, 12]} />
        <Metal color={blue ? BLUE : SILVER} />
      </mesh>
      <mesh position={[0, 0.105, -0.015]} scale={[0.265, 0.14, 0.178]}>
        <sphereGeometry args={[1, 20, 12]} />
        <Metal color={blue ? "#89beff" : "#8cabc9"} />
      </mesh>
      <mesh position={[0, 0.147, 0.07]} scale={[0.19, 0.07, 0.12]}>
        <sphereGeometry args={[1, 16, 10]} />
        <Metal color={DARK} />
      </mesh>
      {[-0.27, 0.27].flatMap((x) =>
        [-0.18, 0.18].map((z) => (
          <group
            key={`${x}-${z}`}
            position={[x, -0.065, z]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <mesh>
              <cylinderGeometry args={[0.09, 0.09, 0.055, 16]} />
              <meshStandardMaterial color="#0c1624" roughness={0.65} />
            </mesh>
            <mesh position={[0, z < 0 ? -0.03 : 0.03, 0]}>
              <cylinderGeometry args={[0.047, 0.047, 0.009, 12]} />
              <Metal />
            </mesh>
          </group>
        )),
      )}
      {[-0.11, 0.11].map((z) => (
        <mesh key={z} position={[0.407, 0.015, z]}>
          <boxGeometry args={[0.012, 0.025, 0.09]} />
          <meshBasicMaterial color="#d8edff" />
        </mesh>
      ))}
    </group>
  );
}
function CompetitorIcon({ active, paused }: Motion) {
  const rivals = useRef<Group>(null),
    time = useRef(0);
  useFrame((_, delta) => {
    if (paused || !rivals.current) return;
    time.current += Math.min(delta, 0.05);
    rivals.current.children.forEach((car, index) => {
      car.position.x =
        (index ? 1 : -1) *
        (0.08 + Math.sin(time.current * (active ? 1.7 : 0.8)) * 0.025);
    });
  });
  return (
    <group name="rival-car-comparison">
      <group ref={rivals} rotation={[0.12, -0.24, 0]}>
        <group position={[-0.08, 0.27, 0]} rotation={[0, -0.12, 0]}>
          <Car blue />
        </group>
        <group position={[0.08, -0.29, 0.14]} rotation={[0, Math.PI - 0.12, 0]}>
          <Car />
        </group>
      </group>
      <Rod
        from={[-0.56, -0.015, 0.04]}
        to={[0.56, -0.015, 0.04]}
        radius={0.01}
        color={BLUE}
      />
      {[-1, 1].map((side) => (
        <group
          key={side}
          position={[side * 0.57, -0.015, 0.04]}
          rotation={[0, 0, (side * -Math.PI) / 2]}
        >
          <mesh>
            <coneGeometry args={[0.052, 0.11, 3]} />
            <Metal color={BLUE} luminous />
          </mesh>
        </group>
      ))}
    </group>
  );
}
function ModeratorIcon({ active, paused }: Motion) {
  const signal = useRef<Group>(null),
    time = useRef(0);
  useFrame((_, delta) => {
    if (paused || !signal.current) return;
    time.current += Math.min(delta, 0.05);
    signal.current.children.forEach((bar, index) => {
      bar.scale.y =
        0.65 +
        (Math.sin(time.current * (active ? 5 : 1.1) + index) + 1) *
          (active ? 0.4 : 0.12);
    });
  });
  return (
    <group name="moderator-microphone">
      <mesh position={[0, 0.22, 0]}>
        <capsuleGeometry args={[0.17, 0.38, 6, 20]} />
        <Metal />
      </mesh>
      {[-0.03, 0.06, 0.15, 0.24, 0.33, 0.42].map((y) => (
        <mesh key={y} position={[0, y, 0.163]}>
          <boxGeometry args={[0.22, 0.023, 0.012]} />
          <Metal color={DARK} />
        </mesh>
      ))}
      <mesh position={[0, -0.035, 0.178]}>
        <sphereGeometry args={[0.024, 12, 8]} />
        <meshBasicMaterial color={BLUE} />
      </mesh>
      <mesh position={[0, 0.13, 0]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[0.28, 0.035, 8, 24, Math.PI]} />
        <Metal color={BLUE} />
      </mesh>
      {[-0.28, 0.28].map((x) => (
        <Rod
          key={x}
          from={[x, 0.13, 0]}
          to={[x, 0.3, 0]}
          color={BLUE}
          radius={0.035}
        />
      ))}
      <Rod from={[0, -0.16, 0]} to={[0, -0.49, 0]} radius={0.038} />
      <mesh position={[0, -0.53, 0]}>
        <cylinderGeometry args={[0.24, 0.3, 0.055, 32]} />
        <Metal />
      </mesh>
      <group ref={signal}>
        {[-0.59, -0.47, 0.47, 0.59].map((x, index) => (
          <mesh key={x} position={[x, 0.16, 0]}>
            <capsuleGeometry
              args={[0.022, index === 1 || index === 2 ? 0.32 : 0.15, 4, 8]}
            />
            <Metal color={BLUE} luminous />
          </mesh>
        ))}
      </group>
    </group>
  );
}
function JudgeIcon({ active, paused }: Motion) {
  const balance = useRef<Group>(null),
    time = useRef(0);
  useFrame((_, delta) => {
    if (paused || !balance.current) return;
    time.current += Math.min(delta, 0.05);
    balance.current.rotation.z =
      Math.sin(time.current * (active ? 1.4 : 0.7)) * (active ? 0.055 : 0.025);
  });
  return (
    <group name="judge-scales-of-evidence">
      <mesh position={[0, -0.52, 0]}>
        <cylinderGeometry args={[0.28, 0.36, 0.09, 32]} />
        <Metal color={BLUE} />
      </mesh>
      <Rod from={[0, -0.47, 0]} to={[0, 0.49, 0]} radius={0.045} />
      <mesh position={[0, 0.54, 0]}>
        <sphereGeometry args={[0.095, 20, 12]} />
        <Metal color={BLUE} />
      </mesh>
      <group ref={balance} position={[0, 0.37, 0]}>
        <Rod from={[-0.51, 0, 0]} to={[0.51, 0, 0]} radius={0.033} />
        {[-0.45, 0.45].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <Rod
              from={[0, 0, 0]}
              to={[-0.16, -0.43, 0]}
              radius={0.012}
              color={BLUE}
            />
            <Rod
              from={[0, 0, 0]}
              to={[0.16, -0.43, 0]}
              radius={0.012}
              color={BLUE}
            />
            <mesh position={[0, -0.47, 0]}>
              <cylinderGeometry args={[0.205, 0.1, 0.095, 24]} />
              <Metal />
            </mesh>
            <mesh position={[0, -0.42, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.195, 0.015, 6, 24]} />
              <Metal color={BLUE} luminous />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}
export function AgentIcon({ agent, ...motion }: { agent: AgentId } & Motion) {
  switch (agent) {
    case "customer":
      return <CustomerIcon {...motion} />;
    case "market":
      return <MarketIcon {...motion} />;
    case "competitor":
      return <CompetitorIcon {...motion} />;
    case "moderator":
      return <ModeratorIcon {...motion} />;
    case "judge":
      return <JudgeIcon {...motion} />;
  }
}
