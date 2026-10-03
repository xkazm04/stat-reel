import path from "node:path";
import { defineConfig } from "@playwright/test";

// Ports are overridable so the suite can run next to a developer's own `pnpm dev` (8787 / 5173).
const apiPort = process.env.E2E_API_PORT ?? "8787";
const studioPort = process.env.E2E_STUDIO_PORT ?? "5173";
const e2eData = path.resolve("data", "e2e");
// a fresh app DB per run (Windows keeps an open SQLite file locked, so it is never deleted in place)
const runDb = path.join(e2eData, `app-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);

export default defineConfig({
  testDir: "e2e",
  timeout: 10 * 60_000,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: `http://127.0.0.1:${studioPort}`, channel: "chrome", viewport: { width: 1280, height: 800 }, trace: "retain-on-failure" },
  webServer: [
    {
      command: "pnpm --filter @statreel/server start",
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { STATREEL_PORT: apiPort, STATREEL_APP_DB: runDb, LLM_MODE: process.env.LLM_MODE ?? "replay", AUDIO_MODE: process.env.AUDIO_MODE ?? "replay", PUBLISH_MODE: process.env.PUBLISH_MODE ?? "dry", LLM_RECORD: process.env.LLM_RECORD ?? "", AUDIO_RECORD: process.env.AUDIO_RECORD ?? "" },
    },
    {
      // generation worker (ADR 010): a separate process, no port; ready when it logs so. Fake mode in `pnpm e2e`.
      command: "pnpm --filter @statreel/server worker",
      wait: { stdout: /generation worker ready/ },
      reuseExistingServer: false,
      timeout: 120_000,
      env: { STATREEL_PORT: apiPort, STATREEL_APP_DB: runDb, GEN_MODE: process.env.GEN_MODE ?? "live", STATREEL_GEN_WORKER: "on", GEN_FAKE_DELAY_MS: "800" },
    },
    { command: `pnpm --filter @statreel/studio exec vite --host 127.0.0.1 --port ${studioPort} --strictPort`, url: `http://127.0.0.1:${studioPort}`, reuseExistingServer: false, timeout: 120_000, env: { STATREEL_API: `http://127.0.0.1:${apiPort}` } },
  ],
});
