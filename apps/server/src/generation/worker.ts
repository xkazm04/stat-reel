/**
 * The generation worker (ADR 010, SPEC D.4): takes the single lease, recovers stale jobs, then runs
 * queued jobs one at a time: prepare -> run (engine) -> finalize. Cancel, heartbeat and the optional
 * wall-clock timeout are timers around the run. Transport-free so tests can drive `tick()`.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { type GenerationConfig, type GenerationJob, type GenerationJobType, perTypeValue } from "@statreel/schemas";
import type { Db } from "../db";
import type { ServerCallbacks } from "./callbacks";
import { GenerationError, type GenerationEngine, type RunContext } from "./engine";
import { acquireLease, heartbeatLease, type LeaseOptions, releaseLease } from "./lease";
import { jobPaths } from "./paths";
import { buildCaseData, configSnapshot, prepareDirs, writeCaseJson } from "./prepare";
import type { GenerationQueue } from "./queue";
import type { RenderStep } from "./render-steps";
import { type GenerationValidator, stubValidator } from "./validator";

export type WorkerDeps = {
  db: Db;
  queue: GenerationQueue;
  config: GenerationConfig;
  engine: GenerationEngine;
  callbacks: ServerCallbacks;
  validator?: GenerationValidator;
  /** renders requested from the server before finalize (stills / video); absent = nothing to render (unit tests) */
  renderStep?: RenderStep;
  dataRoot: string;
  /** server reachable? (checked before each claim; the job stays queued while it is down) */
  health: () => Promise<boolean>;
  /** kill the recorded CLI tree of a stale `running` row (only if the pid is still our child) */
  kill: (job: GenerationJob) => Promise<unknown>;
  /** extra staging for live runs: reference docs, prompt.md (T8) */
  stage?: (job: GenerationJob, paths: ReturnType<typeof jobPaths>, caseData: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>;
  lease?: LeaseOptions;
  pollMs?: number;
  heartbeatMs?: number;
  cancelPollMs?: number;
  backoffMs?: { start: number; max: number };
  onLeaseLost?: () => void;
  /** retries for server callbacks while the server restarts (network errors only) */
  callbackRetries?: { tries: number; baseMs: number };
  log?: (msg: string) => void;
};

export type TickResult = "off" | "server-down" | "idle" | "ran";

/** No timer when the limit is not configured (Q7); otherwise a timer that calls `onTimeout`. */
export function armTimeout(config: GenerationConfig, type: GenerationJobType, onTimeout: () => void, setT: typeof setTimeout = setTimeout): NodeJS.Timeout | null {
  const min = perTypeValue(config.timeoutMin, type);
  if (min === null) return null;
  return setT(onTimeout, min * 60_000);
}

export class GenerationWorker {
  private stopped = false;
  private busy = false;
  private leaseTimer: NodeJS.Timeout | null = null;
  private loopWake: (() => void) | null = null;
  /** aborts the running job with reason "shutdown" (set by runJob, cleared when it ends) */
  private abortForShutdown: (() => void) | null = null;
  private inflight: Promise<unknown> | null = null;
  private backoff: number;
  /** the job currently running, for tests and shutdown */
  current: GenerationJob | null = null;

  constructor(private readonly d: WorkerDeps) {
    this.backoff = d.backoffMs?.start ?? 5000;
  }

  private log(m: string) {
    this.d.log?.(m);
  }

  /** Take the lease and recover stale jobs. `{ok:false}` means another worker holds it: exit. */
  async start(): Promise<{ ok: true; requeued: string[]; failed: string[] } | { ok: false; pid: number }> {
    const got = acquireLease(this.d.db, this.d.lease);
    if (!got.ok) return { ok: false, pid: got.pid };
    const rec = await this.d.queue.recover(this.d.kill);
    this.leaseTimer = setInterval(() => {
      // a timer callback must never throw: SQLITE_BUSY here would kill the worker; the next beat retries
      try {
        if (!heartbeatLease(this.d.db, this.d.lease)) {
          this.log("generation lease lost; stopping");
          this.stopped = true;
          this.d.onLeaseLost?.();
        }
      } catch (e) {
        this.log(`lease heartbeat failed (${e instanceof Error ? e.message : e}); will retry`);
      }
    }, this.d.heartbeatMs ?? 15_000);
    this.leaseTimer.unref();
    return { ok: true, ...rec };
  }

  stop(): void {
    this.stopped = true;
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    this.leaseTimer = null;
    this.loopWake?.();
  }

  release(): void {
    this.stop();
    releaseLease(this.d.db, this.d.lease);
  }

  /**
   * Controlled shutdown (close-is-a-controlled-crash, like jobs.ts): abort the running job (the engine kills its
   * child tree), put the row back to queued WITHOUT burning an attempt, release the lease. Bounded by `timeoutMs`:
   * if the job does not unwind in time the row is re-queued here anyway, so the process can always exit.
   */
  async shutdown(timeoutMs = 4000): Promise<{ requeued: string | null; timedOut: boolean }> {
    this.stopped = true;
    this.loopWake?.();
    const job = this.current;
    let timedOut = false;
    if (job) {
      this.abortForShutdown?.();
      const unwound = await Promise.race([
        this.inflight?.then(() => true, () => true) ?? Promise.resolve(true),
        new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs).unref()),
      ]);
      timedOut = !unwound;
      if (timedOut) this.log(`job ${job.id} did not unwind within ${timeoutMs} ms; re-queueing it anyway`);
    }
    let requeued: string | null = null;
    try {
      if (job && this.requeueInterrupted(job.id)) requeued = job.id;
    } catch (e) { this.log(`re-queue failed (${e instanceof Error ? e.message : e}); recover() will handle the row`); }
    try { this.release(); } catch (e) { this.log(`lease release failed (${e instanceof Error ? e.message : e})`); }
    return { requeued, timedOut };
  }

  /** running -> queued for a clean shutdown: attempts are given back (the claim counted this one), nothing failed. */
  private requeueInterrupted(id: string): boolean {
    const at = new Date().toISOString();
    const res = this.d.db.$client.prepare(
      `update generation_jobs set status = 'queued', attempts = max(attempts - 1, 0), pid = null, phase = null, progress_note = null, last_tool = null,
         started_at = null, error = null, error_kind = null, updated_at = ? where id = ? and status = 'running' and cancel_requested_at is null`,
    ).run(at, id);
    if (!res.changes) return false;
    this.d.queue.event(id, "queued", { requeued: true, reason: "shutdown" });
    return true;
  }

  /** A server restart must not fail a running job: retry callbacks on network errors only (HTTP errors are real). */
  private async callServer<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const tries = this.d.callbackRetries?.tries ?? 8;
    let delay = this.d.callbackRetries?.baseMs ?? 500;
    for (let i = 1; ; i++) {
      try {
        return await fn();
      } catch (e) {
        const network = e instanceof TypeError || /fetch failed|ECONNREFUSED|ECONNRESET|UND_ERR/i.test(String(e));
        if (!network || i >= tries || signal?.aborted) throw e;
        this.log(`server unreachable (${i}/${tries}); retrying in ${delay} ms`);
        await new Promise<void>((r) => {
          const done = () => { clearTimeout(t); signal?.removeEventListener("abort", done); r(); };
          const t = setTimeout(done, delay);
          signal?.addEventListener("abort", done, { once: true });
        });
        delay = Math.min(delay * 2, 10_000);
      }
    }
  }

  /** One scheduling attempt. */
  async tick(): Promise<TickResult> {
    if (this.d.config.worker === "off" || !this.d.config.enabled) return "off";
    if (this.busy) return "idle"; // one job at a time, also against overlapping ticks
    this.busy = true;
    try {
      if (!(await this.d.health())) {
        this.backoff = Math.min(this.d.backoffMs?.max ?? 60_000, this.backoff * 2);
        return "server-down";
      }
      this.backoff = this.d.backoffMs?.start ?? 5000;
      if (this.stopped) return "idle";
      const job = this.d.queue.claim();
      if (!job) return "idle";
      this.inflight = this.runJob(job);
      await this.inflight;
      return "ran";
    } finally {
      this.busy = false;
    }
  }

  async loop(): Promise<void> {
    while (!this.stopped) {
      const r = await this.tick();
      if (r === "ran") continue;
      const wait = r === "server-down" ? this.backoff : (this.d.pollMs ?? 1000);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, wait);
        this.loopWake = () => { clearTimeout(t); resolve(); };
      });
      this.loopWake = null;
    }
  }

  /** prepare -> run -> finalize for a claimed job. Always leaves the row in a terminal state (or running if the lease was lost). */
  async runJob(job: GenerationJob): Promise<GenerationJob | undefined> {
    const { queue, config, db } = this.d;
    const controller = new AbortController();
    let reason: "cancel" | "timeout" | "lease" | "shutdown" | null = null;
    const abort = (r: "cancel" | "timeout" | "lease" | "shutdown") => {
      if (!reason) { reason = r; controller.abort(); }
    };
    let phase: "prepare" | "run" | "finalize" | "render" = "prepare";
    this.current = job;
    this.abortForShutdown = () => abort("shutdown");
    // timer callbacks never throw (SQLITE_BUSY must not crash the worker): a missed beat is retried by the next one
    const hb = setInterval(() => {
      try {
        queue.heartbeat(job.id);
        if (!heartbeatLease(db, this.d.lease)) abort("lease");
      } catch (e) {
        this.log(`job heartbeat failed (${e instanceof Error ? e.message : e}); will retry`);
      }
    }, this.d.heartbeatMs ?? 15_000);
    const cancelPoll = setInterval(() => {
      try {
        if (queue.get(job.id)?.cancel_requested_at) abort("cancel");
      } catch (e) {
        this.log(`cancel poll failed (${e instanceof Error ? e.message : e}); will retry`);
      }
    }, this.d.cancelPollMs ?? 1000);
    const timer = armTimeout(config, job.type, () => abort("timeout"));
    const jp = jobPaths(job.id, this.d.dataRoot);
    const logLine = (line: string) => {
      try { appendFileSync(jp.runLog, `${new Date().toISOString()} ${line.slice(0, 2048)}\n`); } catch { /* log is best effort */ }
    };
    try {
      mkdirSync(jp.dir, { recursive: true });
      logLine(`job ${job.id} ${job.type} case=${job.case_id} attempt=${job.attempts} engine=${this.d.engine.name}`);
      // ---- prepare
      prepareDirs(jp);
      const caseData = buildCaseData(db, job);
      writeCaseJson(jp, caseData);
      const staged = (await this.d.stage?.(job, jp, caseData)) ?? {};
      queue.setParams(job.id, configSnapshot(config, job.type, { engine: this.d.engine.name, ...staged }));
      if (reason) throw new GenerationError("cancelled", "aborted during prepare");
      // ---- run
      phase = "run";
      queue.update(job.id, { phase: "run" });
      const ctx: RunContext = {
        job, paths: jp, config, signal: controller.signal, setPid: (pid) => queue.setPid(job.id, pid),
        note: (u) => queue.update(job.id, u), log: logLine,
      };
      const run = await this.d.engine.run(ctx);
      if (reason) throw new GenerationError("cancelled", "aborted");
      // ---- finalize
      phase = "finalize";
      queue.update(job.id, { phase: "finalize", progress_note: "validating outputs" });
      const v = await (this.d.validator ?? stubValidator).validate({ type: job.type, paths: jp });
      if (!v.ok) throw new GenerationError("validation", v.errors.slice(0, 5).join("; "));
      let rendered: Record<string, unknown> = {};
      if (this.d.renderStep) {
        phase = "render";
        queue.update(job.id, { phase: "render", progress_note: "rendering" });
        rendered = await this.d.renderStep({
          job, paths: jp, signal: controller.signal, note: (n) => queue.update(job.id, { progress_note: n }), log: logLine,
          call: (fn) => this.callServer(fn, controller.signal),
        });
        if (reason) throw new GenerationError("cancelled", "aborted");
        phase = "finalize";
        queue.update(job.id, { phase: "finalize", progress_note: "saving results" });
      }
      const fin = await this.callServer(() => this.d.callbacks.finalize(job.id, { outputs: v.outputs, result: { ...run.result, ...rendered } }), controller.signal);
      logLine(`finalize ok: ${v.outputs.length} outputs`);
      return queue.finish(job.id, "done", { result: { ...run.result, outputs: v.outputs, ...fin } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logLine(`ERROR (${phase}): ${msg}`);
      if (reason === "shutdown") return undefined; // shutdown() re-queues the row (no attempt burnt) and releases the lease
      if (reason === "lease") return undefined; // someone else holds the lease now; their recover() decides this row
      if (reason === "cancel") return queue.finish(job.id, "cancelled", { error: "cancelled", error_kind: "cancelled" });
      if (reason === "timeout") {
        const min = perTypeValue(config.timeoutMin, job.type);
        return queue.finish(job.id, "failed", { error: `no result within ${min} min (configured timeout)`, error_kind: "timeout" });
      }
      const kind = e instanceof GenerationError ? e.kind : phase === "run" ? "cli_exit" : phase === "render" ? "render" : "validation";
      return queue.finish(job.id, "failed", { error: msg, error_kind: kind });
    } finally {
      clearInterval(hb);
      clearInterval(cancelPoll);
      if (timer) clearTimeout(timer);
      this.current = null;
      this.abortForShutdown = null;
    }
  }
}
