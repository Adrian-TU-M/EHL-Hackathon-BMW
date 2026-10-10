import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 12000 },
  use: {
    baseURL: "http://127.0.0.1:5175",
    channel: "chrome",
    viewport: { width: 1440, height: 1050 },
    launchOptions: { args: ["--enable-unsafe-swiftshader"] },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1050 },
      },
    },
  ],
  webServer: [
    {
      command:
        "backend/.venv/bin/python -m uvicorn tests.browser_server:app --app-dir backend --host 127.0.0.1 --port 8001",
      url: "http://127.0.0.1:8001/api/moderator/health",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev -- --port 5175 --strictPort",
      url: "http://127.0.0.1:5175",
      env: { MODERATOR_API_URL: "http://127.0.0.1:8001" },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
