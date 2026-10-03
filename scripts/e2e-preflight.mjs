// Pre-flight for `pnpm e2e`: turn the three raw failures people hit (port already used, ffprobe missing, Chrome
// missing) into one named line, and keep data/e2e from accumulating a SQLite DB per run forever.
// Plain .mjs (typed by e2e-preflight.d.mts) so node:test covers the pure parts and playwright.config.ts can call it
// at load time - Playwright starts webServer before globalSetup, so a collision has to be caught in the config.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

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
    ...deps,
  };
  const problems = [];
  if (d.portInUse(apiPort)) problems.push(portCollisionMessage(apiPort, "API"));
  if (d.portInUse(studioPort)) problems.push(portCollisionMessage(studioPort, "studio"));
  if (!d.ffprobeOk()) problems.push(ffprobeMessage());
  if (!d.candidates.some((c) => d.exists(c))) problems.push(chromeMessage(d.candidates));
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
