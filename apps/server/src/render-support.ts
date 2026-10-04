/**
 * Process + filesystem helpers for the produce pipeline (DESIGN §6.3, ADR 003/004). Pure of the DB and
 * the config singleton so they can be unit-tested against fixture temp dirs: the worker child runner
 * (cancel = kill the whole tree, per-job timeout, guarded JSON lines, bounded stderr) and the startup
 * sweeps for what a crashed or cancelled render leaves behind.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { killTree } from "./proc";

/** A stuck Chromium must not hold the single render slot forever; override with STATREEL_RENDER_TIMEOUT_MS. */
export const DEFAULT_RENDER_TIMEOUT_MS = 30 * 60_000;
/** Worker stderr is kept as a tail: the cause of a crash is at the end, and the rest is unbounded noise. */
export const STDERR_CAP = 64 * 1024;
const STDOUT_LINE_CAP = 1024 * 1024;
const MAX_NOTES = 20;

export function renderTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.STATREEL_RENDER_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RENDER_TIMEOUT_MS;
}

/** Keeps only the last `cap` characters appended. */
export class TailBuffer {
  private s = "";
  constructor(private readonly cap = STDERR_CAP) {}
  push(chunk: string): void {
    this.s += chunk;
    if (this.s.length > this.cap) this.s = this.s.slice(this.s.length - this.cap);
  }
  toString(): string {
    return this.s;
  }
}

export type WorkerMessage = { type: string; progress?: number; stage?: string; message?: string; [k: string]: unknown };
export type ParsedLine = { kind: "skip" } | { kind: "msg"; msg: WorkerMessage } | { kind: "bad"; note: string };

/** One stdout line of the worker. Non-JSON chatter is skipped; a `{` line that does not parse is reported, never thrown. */
export function parseWorkerLine(raw: string): ParsedLine {
  const line = raw.trim();
  if (!line.startsWith("{")) return { kind: "skip" };
  try {
    const msg = JSON.parse(line) as unknown;
    if (msg && typeof msg === "object" && typeof (msg as { type?: unknown }).type === "string") return { kind: "msg", msg: msg as WorkerMessage };
    return { kind: "bad", note: `worker line without a type: ${line.slice(0, 200)}` };
  } catch {
    return { kind: "bad", note: `malformed worker line: ${line.slice(0, 200)}` };
  }
}

export type RunWorkerOpts = {
  cmd: string;
  args: string[];
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  onMessage?: (msg: WorkerMessage) => void;
  onNote?: (note: string) => void;
};

/**
 * Spawns the render worker and resolves with its `done` message. Cancel and timeout kill the whole
 * process tree (`taskkill /T` on Windows: `child.kill()` would leave Chromium and ffmpeg running).
 */
export function runWorker(o: RunWorkerOpts): Promise<WorkerMessage> {
  return new Promise((resolve, reject) => {
    if (o.signal?.aborted) return reject(new Error("render cancelled"));
    const child = spawn(o.cmd, o.args, { cwd: o.cwd, windowsHide: true, detached: process.platform !== "win32" });
    let reason: "cancelled" | "timeout" | undefined;
    const stop = (why: "cancelled" | "timeout") => {
      reason ??= why;
      if (child.pid) void killTree(child.pid);
      child.kill();
    };
    const onAbort = () => stop("cancelled");
    o.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => stop("timeout"), o.timeoutMs);
    let buf = "";
    let notes = 0;
    let done: WorkerMessage | undefined;
    let error = "";
    const note = (n: string) => {
      if (notes++ < MAX_NOTES) o.onNote?.(n);
    };
    const onLine = (line: string) => {
      const parsed = parseWorkerLine(line);
      if (parsed.kind === "bad") note(parsed.note);
      if (parsed.kind !== "msg") return;
      if (parsed.msg.type === "done") done = parsed.msg;
      else if (parsed.msg.type === "error") error = parsed.msg.message ?? "render failed";
      o.onMessage?.(parsed.msg);
    };
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        onLine(line);
      }
      if (buf.length > STDOUT_LINE_CAP) {
        note(`worker line over ${STDOUT_LINE_CAP} bytes dropped`);
        buf = "";
      }
    });
    const stderr = new TailBuffer();
    child.stderr.on("data", (d: Buffer) => stderr.push(d.toString("utf8")));
    const cleanup = () => {
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", onAbort);
    };
    child.on("error", (e) => {
      cleanup();
      reject(e);
    });
    child.on("close", (code) => {
      cleanup();
      // stdout has ended: a last line written without "\n" (process.stdout.write, then exit) is still a line
      if (buf.trim()) onLine(buf);
      buf = "";
      if (reason === "cancelled") return reject(new Error("render cancelled"));
      if (reason === "timeout") return reject(new Error(`render worker timed out after ${Math.round(o.timeoutMs / 1000)} s and was killed`));
      if (done && code === 0) return resolve(done);
      reject(new Error(error || `render worker exited ${code}: ${stderr.toString().slice(-1500)}`));
    });
  });
}

// ------------------------------------------------------------------ startup sweeps

/** Render run directories are named by `new Date().toISOString()` with `:` and `.` replaced (see Pipeline.renderJob). */
export const RUN_DIR = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

/**
 * data/renders and data/cache/jobs are shared by every server process on the machine (dev server, e2e
 * server, ...), so a sweep must only remove what no live process can own: nothing is written for longer
 * than the render timeout, so anything untouched for timeout + margin is a leftover.
 */
export const SWEEP_MARGIN_MS = 5 * 60_000;
export const staleCutoffMs = (now = Date.now(), timeoutMs = renderTimeoutMs()): number => now - timeoutMs - SWEEP_MARGIN_MS;

/** Newest mtime of a directory and everything inside it. */
function newestMtime(dir: string): number {
  let newest = statSync(dir).mtimeMs;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    newest = Math.max(newest, e.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return newest;
}

/**
 * Removes `<rendersDir>/<project>/<run>` directories that never got a `manifest.json` (the last file a
 * successful render writes) AND whose newest mtime is before `cutoffMs`, so a render another live
 * process is writing is never touched. Runs with a manifest and anything else (keyframe stills) stay.
 */
export function sweepPartialRuns(rendersDir: string, cutoffMs = staleCutoffMs()): string[] {
  const removed: string[] = [];
  if (!existsSync(rendersDir)) return removed;
  for (const proj of readdirSync(rendersDir, { withFileTypes: true })) {
    if (!proj.isDirectory()) continue;
    const projDir = path.join(rendersDir, proj.name);
    for (const run of readdirSync(projDir, { withFileTypes: true })) {
      if (!run.isDirectory() || !RUN_DIR.test(run.name)) continue;
      const dir = path.join(projDir, run.name);
      if (existsSync(path.join(dir, "manifest.json")) || newestMtime(dir) >= cutoffMs) continue;
      rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    }
  }
  return removed;
}

/** Removes worker job files (`<uuid>.json`) last modified before `beforeMs` (use staleCutoffMs(): a live process may own newer ones). */
export function sweepJobFiles(dir: string, beforeMs: number): string[] {
  const removed: string[] = [];
  if (!existsSync(dir)) return removed;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith(".json")) continue;
    const f = path.join(dir, e.name);
    if (statSync(f).mtimeMs >= beforeMs) continue;
    rmSync(f, { force: true });
    removed.push(f);
  }
  return removed;
}

// ------------------------------------------------------------------ font report (DESIGN §6.3)

/** Keep in sync with FONTS_REPORT_PREFIX in packages/compositions/src/fonts.ts (a test pins the literal). */
export const FONTS_REPORT_PREFIX = "[statreel-fonts]";

export type FontsReport = { measured: boolean; fallbacks: number };

/**
 * Turns the console lines the worker forwarded into a measured fallback count. Every browser page logs
 * one report; the worst page wins. No parsable report means `measured: false`: the caller must leave
 * the evidence out (the gate then denies it as missing) rather than claim zero.
 */
export function parseFontsReport(logs: unknown): FontsReport {
  let measured = false;
  let fallbacks = 0;
  for (const raw of Array.isArray(logs) ? logs : []) {
    if (typeof raw !== "string" || !raw.startsWith(FONTS_REPORT_PREFIX)) continue;
    try {
      const r = JSON.parse(raw.slice(FONTS_REPORT_PREFIX.length)) as { failed?: unknown; check?: unknown; fallbacks?: unknown };
      if (!Array.isArray(r.failed) || !r.check || typeof r.check !== "object") continue;
      const missing = Object.values(r.check as Record<string, unknown>).filter((ok) => ok !== true).length;
      const stated = typeof r.fallbacks === "number" ? r.fallbacks : 0;
      fallbacks = Math.max(fallbacks, r.failed.length + missing, stated);
      measured = true;
    } catch {
      /* a mangled report is no report */
    }
  }
  return { measured, fallbacks };
}

/** Families every browser page reported loaded (a family any page lost is not listed); empty without a parsable report. */
export function loadedFontFamilies(logs: unknown): string[] {
  const loaded = new Set<string>();
  const lost = new Set<string>();
  for (const raw of Array.isArray(logs) ? logs : []) {
    if (typeof raw !== "string" || !raw.startsWith(FONTS_REPORT_PREFIX)) continue;
    try {
      const r = JSON.parse(raw.slice(FONTS_REPORT_PREFIX.length)) as { check?: unknown };
      if (!r.check || typeof r.check !== "object") continue;
      for (const [family, ok] of Object.entries(r.check as Record<string, unknown>)) (ok === true ? loaded : lost).add(family);
    } catch {
      /* a mangled report is no report */
    }
  }
  return [...loaded].filter((f) => !lost.has(f));
}

/**
 * The fonts this render drew with, for manifest.fonts. MEASURED when the browser reported (only the families it
 * loaded, so a family the render never used cannot ride along and a lying list cannot pass the allow-list);
 * with no report the whole shipped list stays as ATTESTED evidence and the gate still denies the render through
 * the missing checks.font_fallbacks.
 */
export function fontsUsedByRender<T extends { family: string }>(shipped: readonly T[], report: FontsReport, families: readonly string[]): T[] {
  return report.measured ? shipped.filter((f) => families.includes(f.family)) : [...shipped];
}

/**
 * manifest.captions.burned_in, DERIVED from the render input: the composition draws BurnedCaptions from
 * props.timing.cues (no flag switches it off), so a render handed no cues burned nothing. Not a pixel probe.
 */
export const captionsBurnedIn = (cues: readonly unknown[]): boolean => cues.length > 0;
