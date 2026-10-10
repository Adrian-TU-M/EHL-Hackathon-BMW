import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadRuntimeEnv } from "./runtime-env.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
loadRuntimeEnv(root);
const windows = process.platform === "win32";
const localPython = path.join(
  root,
  "backend",
  ".venv",
  windows ? "Scripts/python.exe" : "bin/python",
);
const versionCheck =
  "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)";
function check(command, args) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
  });
}
async function run(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  return new Promise((resolve) => {
    child.on("error", (error) => {
      console.error(error.message);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const pythonOverride = process.env.BMW_PYTHON || process.env.JUDGE_PYTHON;
let python = pythonOverride || localPython;
if (!pythonOverride && !existsSync(localPython)) {
  const candidates = windows
    ? [["py", "-3"], ["python"]]
    : [["python3"], ["python"]];
  const candidate = candidates.find(
    ([command, ...args]) =>
      check(command, [...args, "-c", versionCheck]).status === 0,
  );
  if (!candidate) {
    console.error(
      "Python 3.11+ is required. Install Python, then run npm run dev again.",
    );
    process.exit(1);
  }
  const [command, ...args] = candidate;
  console.log(
    "Creating the project's isolated Python environment (backend/.venv)...",
  );
  if (
    (await run(command, [
      ...args,
      "-m",
      "venv",
      path.join(root, "backend", ".venv"),
    ])) !== 0
  ) {
    console.error(
      "Could not create backend/.venv. On Debian/Ubuntu install python3-venv. Alternatively set BMW_PYTHON to an already configured environment.",
    );
    process.exit(1);
  }
}
if (check(python, ["-c", versionCheck]).status !== 0) {
  console.error(
    "The selected Python environment cannot run Python 3.11+. Check backend/.venv or BMW_PYTHON.",
  );
  process.exit(1);
}
const importCheck =
  "import fastapi, uvicorn, pandas, fitz, yaml, dotenv, openpyxl, pypdf, fontTools, backend.main";
const importsReady = check(python, ["-c", importCheck]).status === 0;
if (!importsReady) {
  if (check(python, ["-m", "pip", "--version"]).status !== 0) {
    console.log("Setting up pip in the selected Python environment...");
    if ((await run(python, ["-m", "ensurepip", "--upgrade"])) !== 0) {
      console.error(
        "This Python environment has no pip. On Debian/Ubuntu install python3-venv and recreate backend/.venv, or set BMW_PYTHON to an environment with pip.",
      );
      process.exit(1);
    }
  }
  console.log(
    "Installing FastAPI backend dependencies into the selected Python environment...",
  );
  if (
    (await run(python, ["-m", "pip", "install", "-e", "./backend[dev]"])) !== 0
  ) {
    console.error(
      "Backend installation failed. Check the pip output above and your network connection, then run npm run dev again.",
    );
    process.exit(1);
  }
  if (check(python, ["-c", importCheck]).status !== 0) {
    console.error(
      "Backend imports failed after installation. Check the selected Python environment.",
    );
    process.exit(1);
  }
}
const bootstrapArgs = ["-m", "backend.bootstrap"];
if (process.argv.includes("--rebuild-indexes")) bootstrapArgs.push("--force");
if ((await run(python, bootstrapArgs)) !== 0) process.exit(1);
console.log("FastAPI backend environment ready.");
