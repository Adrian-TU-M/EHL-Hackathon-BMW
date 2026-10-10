import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const filename of ["backend/.env", ".env"]) {
  const filenamePath = path.join(root, filename);
  if (existsSync(filenamePath)) {
    for (const [key, value] of Object.entries(parseEnv(readFileSync(filenamePath, "utf8")))) {
      if ((key.startsWith("JUDGE_") || key === "OPENAI_API_KEY") && process.env[key] === undefined)
        process.env[key] = value;
    }
  }
}
const demo = process.argv.includes("--demo");
const localPython = path.join(root, "backend", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!existsSync(path.join(root, "node_modules/vite/bin/vite.js"))) {
  console.error("Frontend dependencies are missing. Run npm ci before starting the app.");
  process.exit(1);
}
// Do not silently attach to a different backend or change its execution mode.
try {
  await fetch("http://127.0.0.1:8000/health", { signal: AbortSignal.timeout(3000) });
  console.error("Port 8000 already has a server. Stop it before starting both services, or run npm run dev:frontend to use it.");
  process.exit(1);
} catch { /* No reachable backend; start our own. */ }

// First-run setup is isolated to the project environment, never system Python.
const setup = spawn(process.execPath, [path.join(root, "scripts/setup-backend.mjs")], { cwd: root, env: process.env, stdio: "inherit" });
const setupCode = await new Promise(resolve => {
  setup.on("error", error => { console.error(error.message); resolve(1); });
  setup.on("exit", resolve);
});
if (setupCode !== 0) process.exit(1);
const backendPython = process.env.JUDGE_PYTHON || localPython;

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
  child.on("error", error => { console.error(error.message); stop(1); });
  child.on("exit", code => { if (!stopping) stop(code ?? 1); });
  return child;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
console.log(`Starting FastAPI and frontend (${demo ? "explicit DEMO fixtures" : "LIVE adapters"}).`);
start(backendPython, ["-m", "uvicorn", "judge.api:app", "--host", "127.0.0.1", "--port", "8000"], {
  ...process.env, JUDGE_DEMO_MODE: demo ? "1" : "0",
  JUDGE_INPUT_MODE: process.argv.includes("--team") ? "team" : process.env.JUDGE_INPUT_MODE || (process.env.JUDGE_MODERATOR_URL ? "team" : "context"),
});
let ready = false;
for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
  try {
    const response = await fetch("http://127.0.0.1:8000/health", { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const health = await response.json();
      if (health.model) console.log(`Judge model: ${health.model} (${health.provider}).`);
      if (health.model_error) console.warn(health.model_error);
      ready = true;
      break;
    }
  } catch { /* Wait for the backend to bind. */ }
  await new Promise(resolve => setTimeout(resolve, 250));
}
if (!ready) {
  console.error("FastAPI did not become ready on port 8000. Check the backend output above.");
  stop(1);
} else if (!stopping) {
  start(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "5173", "--strictPort"], process.env);
}
