import { defineConfig } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
const externalPreview = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalPreview ?? "http://127.0.0.1:3000";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined,
  },
  webServer: externalPreview ? undefined : {
    command: "npm run dev -- --port 3000",
    url: baseURL + "/api/owner/dashboard",
    reuseExistingServer: !process.env.CI,
    env: {
      AGENTPAY_MODE: "demo",
      AGENTPAY_DEMO_STATE: join(tmpdir(), `agentpay-e2e-${randomUUID()}.json`),
      MONGODB_URI: "",
      APP_ORIGIN: baseURL,
    },
    timeout: 120_000,
  },
});
