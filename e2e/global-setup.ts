import { mkdirSync } from "node:fs";
import path from "node:path";
import { pruneRunDbs } from "../scripts/e2e-preflight.mjs";

/**
 * Each run gets its own app DB (see playwright.config.ts); the warehouse and caches are reused. Old run DBs are
 * pruned to the newest 5 (never the current one; locked files are skipped). Port / ffprobe / Chrome preflight lives
 * in the config, because webServer starts before this runs.
 */
export default function globalSetup() {
  const dir = path.resolve("data", "e2e");
  mkdirSync(dir, { recursive: true });
  const current = process.env.E2E_RUN_DB;
  if (current) pruneRunDbs(dir, current, 5);
}
