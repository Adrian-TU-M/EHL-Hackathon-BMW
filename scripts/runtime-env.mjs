import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import path from "node:path";

/** Match the backend's precedence: shell, backend/.env, then repo-root .env. */
export function loadRuntimeEnv(root) {
  for (const filename of ["backend/.env", ".env"]) {
    const file = path.join(root, filename);
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(
      parseEnv(readFileSync(file, "utf8")),
    )) {
      if (
        /^(OLLAMA_|BMW_|MODERATOR_|ELEVENLABS_|JUDGE_|CUSTOMER_|AGENT_|MARKET_|EVIDENCE_|FRONTEND_)/.test(
          key,
        ) &&
        process.env[key] === undefined
      ) {
        process.env[key] = value;
      }
    }
  }
}
