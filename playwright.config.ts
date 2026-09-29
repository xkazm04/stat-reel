import path from "node:path";
import { defineConfig } from "@playwright/test";

const e2eData = path.resolve("data", "e2e");

export default defineConfig({
  testDir: "e2e",
  timeout: 10 * 60_000,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: "http://127.0.0.1:5173", channel: "chrome", viewport: { width: 1280, height: 800 }, trace: "retain-on-failure" },
  webServer: [
    {
      command: "pnpm --filter @statreel/server start",
      url: "http://127.0.0.1:8787/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { STATREEL_APP_DB: path.join(e2eData, "app.sqlite"), LLM_MODE: process.env.LLM_MODE ?? "replay", AUDIO_MODE: process.env.AUDIO_MODE ?? "replay", PUBLISH_MODE: process.env.PUBLISH_MODE ?? "dry" },
    },
    { command: "pnpm --filter @statreel/studio dev", url: "http://127.0.0.1:5173", reuseExistingServer: false, timeout: 120_000 },
  ],
});
