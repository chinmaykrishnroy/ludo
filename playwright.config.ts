import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3027",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "node build/server/index.js --production",
    url: "http://127.0.0.1:3027/readyz",
    reuseExistingServer: false,
    env: {
      HOST: "127.0.0.1",
      PORT: "3027",
      DB_PATH: ":memory:",
      BACKUP_INTERVAL_MS: "0",
      PUBLIC_ROOMS_ENABLED: "false",
    },
  },
});
