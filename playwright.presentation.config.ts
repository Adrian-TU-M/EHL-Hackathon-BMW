import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Exercise the teammate's full studio against isolated fixture storage and ports.
export default defineConfig({
  ...base,
  outputDir: "test-results/browser-presentations",
  testMatch: /presentation\.spec\.ts/,
  testIgnore: [],
  use: { ...base.use, baseURL: "http://127.0.0.1:5175" },
  webServer: [
    {
      command:
        "backend/.venv/bin/python -m uvicorn tests.browser_server:app --app-dir backend --host 127.0.0.1 --port 8012",
      url: "http://127.0.0.1:8012/api/moderator/health",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev:frontend -- --port 5175",
      url: "http://127.0.0.1:5175",
      env: {
        BMW_API_URL: "http://127.0.0.1:8012",
        VITE_ELEVENLABS_PRESENTATION_AGENT_ID: "",
      },
      reuseExistingServer: false,
    },
  ],
});
