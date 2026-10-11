import { useEffect, useRef, type ReactNode } from "react";
import { fragmentShader } from "./fluted-glass-shader";
import "../../styles/fluted-glass.css";

const vertexShader = `attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;

export default function FlutedGlass({ children }: { children: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
    });
    if (!gl) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let shaders: WebGLShader[] = [];
    let frame = 0;
    let lastTime = 0;
    let elapsed = 0;
    let lost = false;
    let uniforms: Record<string, WebGLUniformLocation | null> = {};
    const pointer = { x: 0, y: 0, presence: 0 };
    const target = { x: 0, y: 0, presence: 0 };

    const dispose = () => {
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      shaders.forEach((shader) => gl.deleteShader(shader));
      shaders = [];
      program = null;
      buffer = null;
    };
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Shader allocation failed");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(
          gl.getShaderInfoLog(shader) || "Shader compilation failed",
        );
      return shader;
    };
    const setup = () => {
      try {
        program = gl.createProgram();
        if (!program) throw new Error("WebGL program allocation failed");
        gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexShader));
        gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentShader));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
          throw new Error(
            gl.getProgramInfoLog(program) || "Shader linking failed",
          );
        gl.useProgram(program);
        buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 3, -1, -1, 3]),
          gl.STATIC_DRAW,
        );
        const position = gl.getAttribLocation(program, "a_position");
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        uniforms = Object.fromEntries(
          [
            "u_scene",
            "u_shape",
            "u_surface",
            "u_finish",
            "u_transform",
            "u_space",
            "u_cursor",
            "u_colors[0]",
          ].map((name) => [name, gl.getUniformLocation(program!, name)]),
        );
        // Deep navy → roundel-inspired blue → pale blue → white. No teal/green.
        const palette = ["050b18", "103b80", "0066b1", "f3f7ff"];
        const colors = new Float32Array(24);
        palette.forEach((hex, i) => {
          for (let c = 0; c < 3; c++)
            colors[i * 3 + c] = parseInt(hex.slice(c * 2, c * 2 + 2), 16) / 255;
        });
        gl.uniform3fv(uniforms["u_colors[0]"], colors);
        gl.uniform4f(uniforms.u_shape, 1.26, 0.35, 0.28, 0);
        gl.uniform4f(uniforms.u_surface, 1.82, 1, 0, 1);
        gl.uniform4f(uniforms.u_finish, 0, 0, 0, 0.04);
        gl.uniform4f(uniforms.u_transform, 1, 0, 0, 0);
        canvas.style.visibility = "visible";
        return true;
      } catch (error) {
        console.warn("Fluted glass background unavailable", error);
        dispose();
        canvas.style.visibility = "hidden";
        return false;
      }
    };
    const draw = () => {
      if (!program || lost) return;
      gl.uniform4f(
        uniforms.u_scene,
        canvas.width,
        canvas.height,
        elapsed * 0.57,
        4,
      );
      gl.uniform4f(uniforms.u_space, 0, 0, pointer.x, pointer.y);
      gl.uniform4f(
        uniforms.u_cursor,
        motion.matches ? 0 : pointer.presence,
        2,
        0.65,
        0.46,
      );
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const resize = () => {
      // Bound fill rate on Retina/4K screens while keeping DPR below 2.
      const dpr = Math.min(
        window.devicePixelRatio || 1,
        2,
        Math.sqrt(2600000 / (innerWidth * innerHeight)),
      );
      canvas.width = Math.max(1, Math.round(innerWidth * dpr));
      canvas.height = Math.max(1, Math.round(innerHeight * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      draw();
    };
    const animate = (now: number) => {
      const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0;
      lastTime = now;
      elapsed += dt;
      const ease = 1 - Math.exp(-dt * 9);
      pointer.x += (target.x - pointer.x) * ease;
      pointer.y += (target.y - pointer.y) * ease;
      pointer.presence += (target.presence - pointer.presence) * ease;
      draw();
      frame = requestAnimationFrame(animate);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      lastTime = 0;
      if (document.hidden || lost || !program) return;
      draw();
      if (!motion.matches) frame = requestAnimationFrame(animate);
    };
    const move = (event: PointerEvent) => {
      target.x = (event.clientX / innerWidth) * 2 - 1;
      target.y = 1 - (event.clientY / innerHeight) * 2;
      target.presence = 1;
    };
    const leave = () => {
      target.presence = 0;
    };
    const out = (event: PointerEvent) => {
      if (!event.relatedTarget) leave();
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      cancelAnimationFrame(frame);
      canvas.style.visibility = "hidden";
    };
    const contextRestored = () => {
      lost = false;
      dispose();
      if (setup()) {
        resize();
        sync();
      }
    };
    if (!setup()) return;
    resize();
    sync();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerout", out, { passive: true });
    window.addEventListener("blur", leave);
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener("change", sync);
    canvas.addEventListener("webglcontextlost", contextLost);
    canvas.addEventListener("webglcontextrestored", contextRestored);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerout", out);
      window.removeEventListener("blur", leave);
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", sync);
      canvas.removeEventListener("webglcontextlost", contextLost);
      canvas.removeEventListener("webglcontextrestored", contextRestored);
      dispose();
    };
  }, []);

  return (
    <div className="fluted-glass">
      <canvas
        ref={canvasRef}
        className="fluted-glass-canvas"
        aria-hidden="true"
      />
      <div className="fluted-glass-content">{children}</div>
    </div>
  );
}
