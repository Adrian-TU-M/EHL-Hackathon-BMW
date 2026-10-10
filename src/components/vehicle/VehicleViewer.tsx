import { Suspense, useMemo, useRef, useState, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Lightformer,
  OrbitControls,
  useGLTF,
  Center,
} from "@react-three/drei";
import { Box3, Mesh, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { RotateCcw, Rotate3D, Minus, Plus, Move } from "lucide-react";
import { SceneBoundary } from "../ui/SceneBoundary";
import { useMotion } from "../ui/useMotion";
import { Loading } from "../ui/Primitives";

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    const box = new Box3().setFromObject(clone);
    const size = box.getSize(new Vector3());
    clone.scale.setScalar(5 / Math.max(size.x, size.z));
    // Approved replacement assets can be normalized here; original GLB is Y-up.
    return clone;
  }, [scene]);
  return (
    <Center top>
      <primitive object={model} />
    </Center>
  );
}
function CameraControls({
  command,
  auto,
}: {
  command: { type: string; key: number };
  auto: boolean;
}) {
  const ref = useRef<OrbitControlsImpl>(null);
  const { camera, invalidate, size } = useThree();
  useEffect(() => {
    if (command.type === "reset") {
      const distance = Math.max(7.7, 17 / (size.width / size.height));
      camera.position.set(
        -0.73 * distance,
        0.55 + 0.27 * distance,
        0.63 * distance,
      );
      ref.current?.target.set(0, 0.55, 0);
    }
    if (command.type === "in" || command.type === "out") {
      const target = ref.current?.target ?? new Vector3();
      const offset = camera.position
        .clone()
        .sub(target)
        .multiplyScalar(command.type === "in" ? 0.82 : 1.2);
      if (offset.length() >= 4.5 && offset.length() <= 14)
        camera.position.copy(target).add(offset);
    }
    if (command.type === "left" || command.type === "right") {
      const target = ref.current?.target ?? new Vector3();
      const offset = camera.position.clone().sub(target);
      offset.applyAxisAngle(
        new Vector3(0, 1, 0),
        command.type === "left" ? 0.3 : -0.3,
      );
      camera.position.copy(target).add(offset);
    }
    ref.current?.update();
    invalidate();
  }, [command, camera, invalidate, size.width, size.height]);
  return (
    <OrbitControls
      ref={ref}
      target={[0, 0.55, 0]}
      autoRotate={auto}
      autoRotateSpeed={0.35}
      enablePan={false}
      minDistance={4.5}
      maxDistance={14}
      minPolarAngle={0.25}
      maxPolarAngle={Math.PI / 2 - 0.04}
      makeDefault
    />
  );
}
function VehicleFallback() {
  return (
    <div className="vehicle-fallback">
      <svg
        viewBox="0 0 800 320"
        role="img"
        aria-label="Concept sedan silhouette"
      >
        <defs>
          <linearGradient id="carpaint" x2="0" y2="1">
            <stop stopColor="#aab9c9" />
            <stop offset="1" stopColor="#36424e" />
          </linearGradient>
        </defs>
        <ellipse
          cx="400"
          cy="254"
          rx="290"
          ry="15"
          fill="#172537"
          opacity=".1"
        />
        <path
          d="M90 220 L112 168 Q130 153 227 146 L309 90 Q380 64 487 90 L567 145 L680 165 Q714 180 714 225 L650 237 L144 238 Z"
          fill="url(#carpaint)"
        />
        <path d="M253 144 L322 99 Q396 80 478 102 L536 146Z" fill="#182736" />
        <path d="M406 90V149" stroke="#9baab7" strokeWidth="8" />
        {[212, 607].map((x) => (
          <g key={x}>
            <circle cx={x} cy="220" r="43" fill="#17202a" />
            <circle cx={x} cy="220" r="29" fill="#9facb8" />
            <circle cx={x} cy="220" r="16" fill="#3f4a57" />
          </g>
        ))}
      </svg>
      <span>Static concept view · 3D unavailable</span>
    </div>
  );
}
export default function VehicleViewer({
  compact = false,
  modelUrl = "/models/concept-sedan.glb",
}: {
  compact?: boolean;
  modelUrl?: string;
}) {
  const { reduced, visible } = useMotion();
  const [auto, setAuto] = useState(false);
  const [command, setCommand] = useState({ type: "reset", key: 0 });
  const [inView, setInView] = useState(true);
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry.isIntersecting),
    );
    if (wrapper.current) observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, []);
  function send(type: string) {
    setCommand((c) => ({ type, key: c.key + 1 }));
  }
  return (
    <div
      ref={wrapper}
      className={`vehicle-viewer ${compact ? "compact" : ""}`}
      aria-label="Interactive concept sedan viewer"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          send(e.key === "ArrowLeft" ? "left" : "right");
        }
        if (e.key === "+") send("in");
        if (e.key === "-") send("out");
      }}
    >
      <SceneBoundary fallback={<VehicleFallback />}>
        <Suspense fallback={<Loading label="Preparing the studio…" />}>
          <Canvas
            shadows
            dpr={[1, 1.5]}
            camera={{ position: [-6.8, 3, 7.8], fov: 22 }}
            frameloop={visible && inView ? "always" : "never"}
            gl={{ antialias: true, alpha: true }}
            fallback={<VehicleFallback />}
          >
            <ambientLight intensity={0.8} />
            <directionalLight
              position={[5, 8, 4]}
              intensity={3}
              castShadow
              shadow-mapSize={[1024, 1024]}
            />
            <Environment resolution={256}>
              <Lightformer
                form="rect"
                intensity={4}
                position={[0, 6, 0]}
                scale={[8, 6, 1]}
                rotation={[-Math.PI / 2, 0, 0]}
              />
              <Lightformer
                intensity={3}
                position={[-5, 3, 2]}
                scale={[10, 3, 1]}
                rotation={[0, Math.PI / 2, 0]}
              />
              <Lightformer
                intensity={2}
                position={[5, 2, -3]}
                scale={[10, 2, 1]}
                rotation={[0, -Math.PI / 2, 0]}
              />
            </Environment>
            <Model url={modelUrl} />
            <ContactShadows
              position={[0, -0.01, 0]}
              opacity={0.4}
              scale={15}
              blur={2.8}
              far={4}
              resolution={512}
              frames={1}
            />
            <CameraControls
              command={command}
              auto={auto && !reduced && visible && inView}
            />
          </Canvas>
        </Suspense>
      </SceneBoundary>
      <div className="viewer-controls">
        <span className="viewer-hint">
          <Move size={13} /> Drag to explore
        </span>
        <div>
          <button
            className={`icon-button ${auto ? "active" : ""}`}
            title="Toggle automatic rotation"
            aria-label="Toggle automatic rotation"
            aria-pressed={auto}
            onClick={() => setAuto(!auto)}
          >
            <Rotate3D size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Zoom out"
            onClick={() => send("out")}
          >
            <Minus size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Zoom in"
            onClick={() => send("in")}
          >
            <Plus size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Reset vehicle view"
            onClick={() => send("reset")}
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>
      <div className="model-disclosure">
        Concept sedan · visual placeholder, not a BMW model
      </div>
    </div>
  );
}
