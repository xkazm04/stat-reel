import path from "node:path";
import { defineConfig } from "@playwright/test";
import { e2eModes, preflightProblems } from "./scripts/e2e-preflight.mjs";

// Ports are overridable so the suite can run next to a developer's own `pnpm dev` (8787 / 5173).
const apiPort = process.env.E2E_API_PORT ?? "8787";
const studioPort = process.env.E2E_STUDIO_PORT ?? "5173";
const e2eData = path.resolve("data", "e2e");
// a fresh app DB per run (Windows keeps an open SQLite file locked, so it is never deleted in place). The path is
// pinned in the env so every re-evaluation of this config (each worker loads it again) and globalSetup's pruning
// agree on which DB is "current".
process.env.E2E_RUN_DB ??= path.join(e2eData, `app-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
const runDb = process.env.E2E_RUN_DB;
// every lane defaults to its no-spend mode (replay / dry / fake) when the run is not started through `pnpm e2e`
const modes = e2eModes(process.env);

// Fail fast, before any webServer starts (Playwright starts webServer ahead of globalSetup, so this cannot live
// there): a taken port, or a missing ffprobe / Chrome, becomes one named error instead of a raw "already used".
// Workers inherit E2E_PREFLIGHT_DONE and skip it; they would otherwise see the servers this run just started.
if (!process.env.E2E_PREFLIGHT_DONE && !process.argv.includes("--list") && !process.env.E2E_SKIP_PREFLIGHT) {
  const problems = preflightProblems({ apiPort, studioPort });
  if (problems.length > 0) throw new Error(`\n${problems.join("\n")}\n`);
  process.env.E2E_PREFLIGHT_DONE = "1";
}

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
      env: { STATREEL_PORT: apiPort, STATREEL_APP_DB: runDb, LLM_MODE: modes.LLM_MODE, AUDIO_MODE: modes.AUDIO_MODE, PUBLISH_MODE: modes.PUBLISH_MODE, LLM_RECORD: modes.LLM_RECORD, AUDIO_RECORD: modes.AUDIO_RECORD },
    },
    {
      // generation worker (ADR 010): a separate process, no port; ready when it logs so. Fake mode unless GEN_MODE says otherwise.
      command: "pnpm --filter @statreel/server worker",
      wait: { stdout: /generation worker ready/ },
      reuseExistingServer: false,
      timeout: 120_000,
      env: { STATREEL_PORT: apiPort, STATREEL_APP_DB: runDb, GEN_MODE: modes.GEN_MODE, STATREEL_GEN_WORKER: "on", GEN_FAKE_DELAY_MS: "800" },
    },
    { command: `pnpm --filter @statreel/studio exec vite --host 127.0.0.1 --port ${studioPort} --strictPort`, url: `http://127.0.0.1:${studioPort}`, reuseExistingServer: false, timeout: 120_000, env: { STATREEL_API: `http://127.0.0.1:${apiPort}` } },
  ],
});
