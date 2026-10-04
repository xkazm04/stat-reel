// Pre-flight for `pnpm e2e`: turn the raw failures people hit (port already used, ffprobe missing, Chrome missing,
// local-only warehouse or audio fixtures absent) into one named line, and keep data/e2e from accumulating a SQLite DB per run forever.
// Plain .mjs (typed by e2e-preflight.d.mts) so node:test covers the pure parts and playwright.config.ts can call it
// at load time - Playwright starts webServer before globalSetup, so a collision has to be caught in the config.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The message people see when a port is taken; the default ports belong to `pnpm dev`. */
export function portCollisionMessage(port, label = "API") {
  return `e2e preflight: ${label} port ${port} is in use (probably your pnpm dev) - run with E2E_API_PORT=8797 E2E_STUDIO_PORT=5183 or stop the dev server`;
}

/** Is something already listening on host:port? A connect probe (not a bind) so wildcard-bound servers count too. */
export function portInUse(port, host = "127.0.0.1", timeoutMs = 1500) {
  const probe = `const s=require("net").connect({port:${Number(port)},host:${JSON.stringify(host)}});
    s.setTimeout(${timeoutMs},()=>{s.destroy();process.exit(1)});
    s.on("connect",()=>{s.destroy();process.exit(0)});s.on("error",()=>process.exit(1));`;
  return spawnSync(process.execPath, ["-e", probe]).status === 0;
}

export function ffprobeMessage() {
  return "e2e preflight: ffprobe not found on PATH (m1.spec.ts probes the rendered MP4 with it) - install ffmpeg (e.g. winget install Gyan.FFmpeg) and reopen the terminal";
}

export function chromeMessage(candidates) {
  return `e2e preflight: Google Chrome not found (playwright.config.ts uses channel "chrome"); looked in: ${candidates.join(", ")} - install Chrome or run 'pnpm exec playwright install chrome'`;
}

/** Same resolution as apps/server/src/config.ts `paths.warehouse`: the server throws at boot without this file. */
export function warehousePath(env = process.env, root = repoRoot) {
  return path.resolve(root, env.STATREEL_WAREHOUSE ?? path.join("data", "warehouse.duckdb"));
}

export function warehouseMessage(file) {
  return `e2e preflight: warehouse not found at ${file} (apps/server/src/main.ts refuses to boot without it; it is local-only, never committed) - build it with: just ingest f1db && just transform`;
}

/** Replay AUDIO_MODE reads e2e/fixtures/audio (paths.fixtures in config.ts); the e2e default mode is replay. */
export function audioFixturesDir(root = repoRoot) {
  return path.join(root, "e2e", "fixtures", "audio");
}

export function audioFixturesMessage(dir) {
  return `e2e preflight: audio replay fixtures missing or empty at ${dir} - they are local-only by policy (the owner's "never commit audio" rule keeps them out of git) and are produced only by a recorded live run (AUDIO_RECORD, owner-gated ElevenLabs spend); restore them from the owner's machine, do not record one without approval`;
}

/**
 * The mode env the e2e servers get. Unset means the no-spend side for EVERY lane: `pnpm e2e` sets these
 * explicitly, but a bare `playwright test` (the IDE runner, one spec by hand) does not, and the server's own
 * defaults are the live ones. GEN_MODE=live would hand the generation specs' jobs to the real Claude CLI.
 */
export function e2eModes(env = process.env) {
  return {
    LLM_MODE: env.LLM_MODE ?? "replay",
    AUDIO_MODE: env.AUDIO_MODE ?? "replay",
    PUBLISH_MODE: env.PUBLISH_MODE ?? "dry",
    GEN_MODE: env.GEN_MODE ?? "fake",
    LLM_RECORD: env.LLM_RECORD ?? "",
    AUDIO_RECORD: env.AUDIO_RECORD ?? "",
  };
}

/** Where Playwright's "chrome" channel would find an installed Chrome. */
export function chromeCandidates(platform = process.platform, env = process.env) {
  if (platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean);
    return roots.map((r) => path.join(r, "Google", "Chrome", "Application", "chrome.exe"));
  }
  if (platform === "darwin") return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  return ["/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
}

/** Returns the list of problems (empty = go). `deps` are injectable so tests need no real ports or binaries. */
export function preflightProblems({ apiPort, studioPort }, deps = {}) {
  const d = {
    portInUse,
    ffprobeOk: () => spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0,
    exists: existsSync,
    candidates: chromeCandidates(),
    warehouse: warehousePath(),
    audioDir: audioFixturesDir(),
    audioMode: process.env.AUDIO_MODE ?? "replay",
    audioFiles: (dir) => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    },
    ...deps,
  };
  const problems = [];
  if (d.portInUse(apiPort)) problems.push(portCollisionMessage(apiPort, "API"));
  if (d.portInUse(studioPort)) problems.push(portCollisionMessage(studioPort, "studio"));
  if (!d.ffprobeOk()) problems.push(ffprobeMessage());
  if (!d.candidates.some((c) => d.exists(c))) problems.push(chromeMessage(d.candidates));
  if (!d.exists(d.warehouse)) problems.push(warehouseMessage(d.warehouse));
  if (d.audioMode !== "live" && !d.audioFiles(d.audioDir).some((f) => f.endsWith(".mp3"))) problems.push(audioFixturesMessage(d.audioDir));
  return problems;
}

const RUN_FILE = /^app-(.+)\.sqlite(?:-shm|-wal)?$/;

/**
 * Which files in a data/e2e listing to delete: every per-run app DB (+ its -shm/-wal) except the newest `keep`
 * runs. The current run always survives and counts as one of the kept runs. Run stems are ISO timestamps, so a
 * lexical sort is chronological. Unrelated files (app.sqlite, fixtures) never match.
 */
export function pruneCandidates(files, currentDb, keep = 5) {
  const current = RUN_FILE.exec(path.basename(currentDb))?.[1];
  const stems = [...new Set(files.map((f) => RUN_FILE.exec(f)?.[1]).filter(Boolean))].sort().reverse();
  const kept = new Set(stems.filter((s) => s !== current).slice(0, Math.max(0, keep - 1)));
  if (current) kept.add(current);
  return files.filter((f) => {
    const stem = RUN_FILE.exec(f)?.[1];
    return stem !== undefined && !kept.has(stem);
  });
}

/** Delete old run DBs; a file still locked by a leftover server (EBUSY/EPERM on Windows) is skipped, not fatal. */
export function pruneRunDbs(dir, currentDb, keep = 5) {
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return { removed: [], skipped: [] };
  }
  const removed = [];
  const skipped = [];
  for (const f of pruneCandidates(files, currentDb, keep)) {
    try {
      rmSync(path.join(dir, f), { force: true });
      removed.push(f);
    } catch (err) {
      if (err?.code === "EBUSY" || err?.code === "EPERM") skipped.push(f);
      else throw err;
    }
  }
  return { removed, skipped };
}
