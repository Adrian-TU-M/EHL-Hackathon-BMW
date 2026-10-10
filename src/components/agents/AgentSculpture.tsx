import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  ShaderMaterial,
} from "three";
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

// Each identity is an instrument: a fluid knot, orbital ribbon, turbine,
// interlocking network, and crystalline evaluator. All geometry is original.
function ribbonGeometry() {
  const geometry = new BufferGeometry();
  const vertices: number[] = [];
  const indices: number[] = [];
  const steps = 220;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 4;
    for (const side of [-1, 1]) {
      const radius = 0.56 + Math.sin(t * 1.5) * 0.12 + side * 0.1;
      vertices.push(
        Math.cos(t) * radius,
        (i / steps - 0.5) * 1.35 + side * Math.sin(t * 0.5) * 0.16,
        Math.sin(t) * radius,
      );
    }
    if (i < steps) {
      const v = i * 2;
      indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
const coreVertex = `
  uniform float u_time;
  varying vec3 v_normal;
  varying vec3 v_position;
  void main() {
    vec3 p = position;
    float wave = sin(p.x * 8. + u_time) * cos(p.y * 7. - u_time * .7) * .028;
    p += normal * wave;
    v_normal = normalize(normalMatrix * normal);
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.);
    v_position = viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;
const coreFragment = `
  uniform vec3 u_color;
  uniform float u_time;
  uniform float u_energy;
  varying vec3 v_normal;
  varying vec3 v_position;
  void main() {
    float fresnel = pow(1. - abs(dot(normalize(v_normal), normalize(-v_position))), 2.5);
    float band = pow(.5 + .5 * sin(v_position.y * 32. + v_position.x * 9. - u_time * 1.8), 5.);
    vec3 color = u_color * (.16 + fresnel * 1.7 + band * .28 * u_energy);
    color += vec3(.65, .84, 1.) * pow(fresnel, 3.) * .6;
    gl_FragColor = vec4(color, 1.);
  }
`;
function IntelligenceCore({
  color,
  active,
  paused,
  radius = 0.35,
}: {
  color: string;
  active: boolean;
  paused: boolean;
  radius?: number;
}) {
  const material = useRef<ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_color: { value: new Color(color) },
      u_energy: { value: 1 },
    }),
    [color],
  );
  useFrame((_, delta) => {
    if (!material.current || paused) return;
    material.current.uniforms.u_time.value +=
      Math.min(delta, 0.05) * (active ? 1.8 : 0.6);
    material.current.uniforms.u_energy.value = active ? 2.4 : 1;
  });
  return (
    <mesh>
      <sphereGeometry args={[radius, 48, 32]} />
      <shaderMaterial
        ref={material}
        vertexShader={coreVertex}
        fragmentShader={coreFragment}
        uniforms={uniforms}
      />
    </mesh>
  );
}

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
  const mechanism = useRef<Group>(null);
  const elapsed = useRef(0);
  const ribbon = useMemo(ribbonGeometry, []);
  const active = ["speaking", "challenging", "evaluating"].includes(state);
  const paused = state === "paused" || reduced;
  const color = agentMeta[agent].color;
  useFrame((_, delta) => {
    if (!group.current || paused) return;
    const step = Math.min(delta, 0.05);
    elapsed.current += step;
    const t = elapsed.current;
    group.current.rotation.y += step * (active ? 0.45 : 0.16);
    group.current.position.y =
      position[1] + Math.sin(t * (active ? 1.6 : 0.65)) * 0.055;
    group.current.rotation.z = Math.sin(t * 0.32) * 0.055;
    const target = scale * (active ? 1.12 : 1);
    group.current.scale.setScalar(
      group.current.scale.x +
        (target - group.current.scale.x) * (1 - Math.exp(-step * 5)),
    );
    if (mechanism.current)
      mechanism.current.rotation.y -= step * (active ? 0.75 : 0.24);
  });
  const chrome = (
    <meshPhysicalMaterial
      color="#b8d1e8"
      metalness={1}
      roughness={0.17}
      clearcoat={1}
      side={DoubleSide}
    />
  );
  const blueMetal = (
    <meshPhysicalMaterial
      color={color}
      metalness={0.85}
      roughness={0.2}
      clearcoat={1}
      emissive={color}
      emissiveIntensity={active ? 0.2 : 0.04}
      side={DoubleSide}
    />
  );
  return (
    <group ref={group} position={position} scale={scale}>
      {agent === "customer" && (
        <group rotation={[0.35, 0, -0.2]}>
          <mesh>
            <torusKnotGeometry args={[0.48, 0.145, 200, 20, 2, 3]} />
            {chrome}
          </mesh>
          <mesh rotation={[0, Math.PI / 2, 0]} scale={0.87}>
            <torusKnotGeometry args={[0.48, 0.042, 160, 10, 2, 3]} />
            {blueMetal}
          </mesh>
          <IntelligenceCore
            color={color}
            active={active}
            paused={paused}
            radius={0.3}
          />
        </group>
      )}
      {agent === "market" && (
        <group rotation={[0.2, 0, -0.25]}>
          <mesh geometry={ribbon}>{chrome}</mesh>
          <group ref={mechanism}>
            <mesh geometry={ribbon} rotation={[0, Math.PI, 0]} scale={0.83}>
              {blueMetal}
            </mesh>
            {[-0.5, 0, 0.5].map((y, i) => (
              <mesh
                key={y}
                position={[
                  Math.cos(i * 2.6) * 0.65,
                  y,
                  Math.sin(i * 2.6) * 0.65,
                ]}
              >
                <sphereGeometry args={[0.045, 16, 12]} />
                <meshBasicMaterial color="#a4edff" />
              </mesh>
            ))}
          </group>
          <IntelligenceCore
            color={color}
            active={active}
            paused={paused}
            radius={0.27}
          />
        </group>
      )}
      {agent === "competitor" && (
        <group rotation={[0.25, 0, 0.25]}>
          <group ref={mechanism}>
            {Array.from({ length: 14 }, (_, i) => (
              <group key={i} rotation={[0, 0, (i / 14) * Math.PI * 2]}>
                <mesh position={[0.43, 0, 0]} rotation={[0.4, 0.55, 0.28]}>
                  <boxGeometry args={[0.62, 0.045, 0.35]} />
                  {i % 4 === 0 ? blueMetal : chrome}
                </mesh>
              </group>
            ))}
          </group>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.31, 0.07, 14, 60]} />
            {chrome}
          </mesh>
          <IntelligenceCore
            color="#bcdcff"
            active={active}
            paused={paused}
            radius={0.24}
          />
        </group>
      )}
      {agent === "moderator" && (
        <group rotation={[0.6, 0.2, 0]}>
          <mesh>
            <torusKnotGeometry args={[0.48, 0.075, 180, 14, 3, 4]} />
            {chrome}
          </mesh>
          <group ref={mechanism}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusKnotGeometry args={[0.48, 0.022, 180, 8, 3, 4]} />
              {blueMetal}
            </mesh>
          </group>
          <IntelligenceCore
            color="#83baff"
            active={active}
            paused={paused}
            radius={0.2}
          />
        </group>
      )}
      {agent === "judge" && (
        <group rotation={[0.2, 0, 0.2]}>
          <mesh>
            <icosahedronGeometry args={[0.69, 0]} />
            <meshPhysicalMaterial
              color="#7482ab"
              metalness={0.95}
              roughness={0.18}
              wireframe
            />
          </mesh>
          <group ref={mechanism} rotation={[0, 0.5, 0.4]}>
            <mesh>
              <octahedronGeometry args={[0.54, 0]} />
              <meshPhysicalMaterial
                color="#293e68"
                metalness={0.95}
                roughness={0.13}
                transparent
                opacity={0.7}
                side={DoubleSide}
              />
            </mesh>
            <mesh scale={1.015}>
              <octahedronGeometry args={[0.54, 0]} />
              <meshBasicMaterial
                color="#b0baff"
                wireframe
                transparent
                opacity={0.8}
              />
            </mesh>
          </group>
          <IntelligenceCore
            color={color}
            active={active}
            paused={paused}
            radius={0.34}
          />
          {[-1, 1].map((i) => (
            <mesh key={i} position={[0, i * 0.74, 0]}>
              <sphereGeometry args={[0.055, 16, 12]} />
              <meshBasicMaterial color="#bed0ff" />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}
