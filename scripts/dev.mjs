import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "node:net";
import { loadRuntimeEnv } from "./runtime-env.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
loadRuntimeEnv(root);
const demo = process.argv.includes("--demo");
const backendOnly = process.argv.includes("--backend-only");
const localPython = path.join(
  root,
  "backend",
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
if (
  !backendOnly &&
  !existsSync(path.join(root, "node_modules/vite/bin/vite.js"))
) {
  console.error(
    "Frontend dependencies are missing. Run npm ci before starting the app.",
  );
  process.exit(1);
}
// Do not silently attach to a different backend or change its execution mode.
const portAvailable = await new Promise((resolve) => {
  const probe = createServer();
  probe.once("error", () => resolve(false));
  probe.listen(8001, "127.0.0.1", () => probe.close(() => resolve(true)));
});
if (!portAvailable) {
  console.error(
    "Port 8001 already has a server. Stop it before starting both services, or run npm run dev:frontend to use it.",
  );
  process.exit(1);
}

// First-run setup is isolated to the project environment, never system Python.
const setup = spawn(
  process.execPath,
  [path.join(root, "scripts/setup-backend.mjs")],
  { cwd: root, env: process.env, stdio: "inherit" },
);
const setupCode = await new Promise((resolve) => {
  setup.on("error", (error) => {
    console.error(error.message);
    resolve(1);
  });
  setup.on("exit", resolve);
});
if (setupCode !== 0) process.exit(1);
const backendPython =
  process.env.BMW_PYTHON || process.env.JUDGE_PYTHON || localPython;

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}
function start(command, args, env) {
  const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
  return child;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
console.log(
  `Starting ${backendOnly ? "unified FastAPI" : "FastAPI and frontend"} (${demo ? "explicit Judge/Moderator demo mode" : "LIVE adapters"}).`,
);
start(
  backendPython,
  [
    "-m",
    "uvicorn",
    "backend.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    "8001",
    "--timeout-graceful-shutdown",
    "5",
  ],
  {
    ...process.env,
    JUDGE_DEMO_MODE: demo ? "1" : "0",
    MODERATOR_ADAPTER: demo ? "deterministic" : "ollama",
    JUDGE_INPUT_MODE: process.argv.includes("--team")
      ? "team"
      : process.env.JUDGE_INPUT_MODE ||
        (process.env.JUDGE_MODERATOR_URL ? "team" : "context"),
  },
);
let ready = false;
const readinessDeadline = Date.now() + 120000;
while (Date.now() < readinessDeadline && !stopping) {
  try {
    const response = await fetch("http://127.0.0.1:8001/api/health", {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const health = await response.json();
      if (health.ollama_model)
        console.log(`All agents use local Ollama: ${health.ollama_model}.`);
      if (health.model_error) console.warn(health.model_error);
      ready = true;
      break;
    }
  } catch {
    /* Wait for the backend to bind. */
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!ready) {
  console.error(
    "FastAPI did not become ready on port 8001. Check the backend output above.",
  );
  stop(1);
} else if (!stopping && !backendOnly) {
  start(
    process.execPath,
    [
      path.join(root, "node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "5173",
      "--strictPort",
    ],
    process.env,
  );
}
