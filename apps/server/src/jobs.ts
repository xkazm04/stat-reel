/**
 * Single-slot job runner (DESIGN §3): jobs persist in SQLite; one job per kind runs at a time
 * (one render, one LLM session); cancellable through an AbortSignal that handlers pass to child
 * processes; jobs a crashed process left `running` are re-queued by `resume()`; progress and state
 * changes stream over the event bus. A provider/LLM refusal is its own state (ADR 003).
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { JobKind, JobStatus } from "@statreel/schemas";
import { type Db, jobs, now } from "./db";
import type { EventBus } from "./events";

export class Refusal extends Error {
  constructor(readonly by: string, readonly reason: string) {
    super(`refused by ${by}: ${reason}`);
    this.name = "Refusal";
  }
}

/** Why a job was cancelled; recorded in the job's `error` text, the status stays `cancelled`. */
export type CancelCause = "owner" | "shutdown" | "timeout";
const CAUSES: readonly string[] = ["owner", "shutdown", "timeout"];

export type JobContext = { id: string; signal: AbortSignal; progress: (p: number, note?: string) => void };
export type Handler = (params: Record<string, unknown>, ctx: JobContext) => Promise<Record<string, unknown>>;
export type Job = typeof jobs.$inferSelect;

/** Terminal job rows (and the event rows of terminal sessions/generation jobs) older than this many days are pruned at startup and daily (STATREEL_JOB_RETENTION_DAYS, default 30). */
export function jobRetentionDays(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.STATREEL_JOB_RETENTION_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export class JobRunner {
  private handlers = new Map<string, Handler>();
  private active = new Map<string, { id: string; controller: AbortController; done: Promise<void> }>();
  private waiters: (() => void)[] = [];
  /** kinds that share a single slot (e.g. `gen_render` runs on the `render` lane); default lane = the kind */
  private lanes = new Map<string, string>();
  /** startup sweeps (partial run dirs, orphan job files): run by resume() before anything is re-queued */
  private startupHooks: (() => void)[] = [];
  /** set by shutdown(): nothing new starts; queued rows stay queued for the next process's resume() */
  private closing = false;

  constructor(private readonly db: Db, private readonly bus: EventBus) {}

  register(kind: JobKind, handler: Handler, opts: { lane?: string } = {}): void {
    this.handlers.set(kind, handler);
    if (opts.lane) this.lanes.set(kind, opts.lane);
  }

  private laneOf(kind: string): string {
    return this.lanes.get(kind) ?? kind;
  }

  enqueue(kind: JobKind, params: Record<string, unknown>, projectId?: string): string {
    const id = randomUUID();
    this.db.insert(jobs).values({ id, kind, project_id: projectId ?? null, status: "queued", params_json: JSON.stringify(params), created_at: now() }).run();
    this.bus.emit({ type: "job.queued", id, kind, project_id: projectId });
    this.pump(kind);
    return id;
  }

  get(id: string): Job | undefined {
    return this.db.select().from(jobs).where(eq(jobs.id, id)).get();
  }

  /** Newest first; ORDER BY / LIMIT run in SQL on jobs_project_created (project_id, created_at). */
  list(projectId?: string, limit?: number): Job[] {
    const q = this.db.select().from(jobs);
    const ordered = (projectId ? q.where(eq(jobs.project_id, projectId)) : q).orderBy(desc(jobs.created_at));
    return (limit === undefined ? ordered : ordered.limit(limit)).all();
  }

  /** Retention: drop terminal rows finished more than `days` ago (running/queued rows are never touched). */
  prune(days = jobRetentionDays()): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const stale = and(inArray(jobs.status, ["succeeded", "failed", "cancelled", "refused"]), or(lt(jobs.finished_at, cutoff), and(lt(jobs.created_at, cutoff), isNull(jobs.finished_at))));
    return this.db.delete(jobs).where(stale).run().changes;
  }

  /**
   * Retention for the append-only event tables: `llm_events` of sessions that ended, and
   * `generation_job_events` of generation jobs that reached a terminal status, both more than `days` ago.
   * The session / job rows stay (videos and board items reference them). The generation relay only reads
   * `id > max(id)` seen at start (AUTOINCREMENT ids never come back), and a terminal job's events were
   * relayed long before the cutoff, so pruning cannot lose or replay a relayed event.
   */
  pruneEvents(days = jobRetentionDays()): { llm: number; generation: number } {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const raw = this.db.$client;
    const llm = raw.prepare("delete from llm_events where session_id in (select id from llm_sessions where ended_at is not null and ended_at < ?)").run(cutoff).changes;
    const generation = raw
      .prepare(
        "delete from generation_job_events where job_id in (select id from generation_jobs where status in ('done','failed','cancelled') and coalesce(finished_at, updated_at) < ?)",
      )
      .run(cutoff).changes;
    return { llm, generation };
  }

  /** Both retention sweeps; a failure is logged, never thrown (it runs from a timer and from boot). */
  retain(days = jobRetentionDays()): void {
    try {
      this.prune(days);
      this.pruneEvents(days);
    } catch (err) {
      console.warn(`[jobs] retention sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  cancel(id: string, cause: CancelCause = "owner"): void {
    const job = this.get(id);
    if (!job) return;
    if (job.status === "queued") this.finish(id, "cancelled", null, `cancelled before start (cause: ${cause})`);
    for (const a of this.active.values()) if (a.id === id) a.controller.abort(cause);
  }

  /**
   * Graceful stop: no new job starts, running jobs are aborted with cause "shutdown" (rows go back to queued, like a crash) and awaited up to
   * `timeoutMs` (a handler that ignores its signal is abandoned; resume() re-queues its row next start).
   */
  async shutdown(timeoutMs = 10_000): Promise<{ aborted: number; timedOut: boolean }> {
    this.closing = true;
    const running = [...this.active.values()];
    for (const a of running) a.controller.abort("shutdown" satisfies CancelCause);
    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      Promise.all(running.map((a) => a.done)).then(() => false),
      new Promise<boolean>((r) => { timer = setTimeout(() => r(true), timeoutMs); }),
    ]);
    clearTimeout(timer);
    return { aborted: running.length, timedOut };
  }

  /** Shutdown is not an owner decision: put the row back as a crash would leave it, so resume() re-runs it. */
  private requeueInterrupted(id: string): void {
    this.db.update(jobs).set({ status: "queued", started_at: null, progress: 0, error: "interrupted by shutdown" }).where(eq(jobs.id, id)).run();
  }

  private settleAborted(id: string, signal: AbortSignal): void {
    if (signal.reason === "shutdown") this.requeueInterrupted(id);
    else this.finish(id, "cancelled", null, this.cancelError(signal));
  }

  private cancelError(signal: AbortSignal): string {
    const cause = typeof signal.reason === "string" && CAUSES.includes(signal.reason) ? signal.reason : "owner";
    return `cancelled (cause: ${cause})`;
  }

  /** Registers a sweep for what a crashed process left behind; a throwing hook never blocks the resume. */
  onStartup(hook: () => void): void {
    this.startupHooks.push(hook);
  }

  /** Run the startup sweeps, re-queue jobs a previous process left running, then start every kind's queue. */
  resume(): void {
    for (const hook of this.startupHooks) {
      try {
        hook();
      } catch (err) {
        console.warn(`[jobs] startup sweep failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.retain();
    this.db.update(jobs).set({ status: "queued", started_at: null, progress: 0 }).where(eq(jobs.status, "running")).run();
    const kinds = new Set(this.db.select({ kind: jobs.kind }).from(jobs).where(eq(jobs.status, "queued")).all().map((r) => r.kind));
    for (const k of kinds) this.pump(k);
  }

  /** Resolves when no job is queued or running for any registered kind. */
  async idle(): Promise<void> {
    while (true) {
      const pending = this.db.select({ id: jobs.id }).from(jobs)
        .where(and(inArray(jobs.status, ["queued", "running"]), inArray(jobs.kind, [...this.handlers.keys()]))).all();
      if (!pending.length && !this.active.size) return;
      await Promise.all([...this.active.values()].map((a) => a.done));
      if (![...this.active.values()].length) await new Promise((r) => setTimeout(r, 1));
    }
  }

  private pump(kind: string): void {
    const lane = this.laneOf(kind);
    if (this.closing || this.active.has(lane)) return;
    // FIFO across every kind that shares the lane, so a render backlog cannot starve gen_render
    const laneKinds = [...this.handlers.keys()].filter((k) => this.laneOf(k) === lane);
    if (!laneKinds.length) return;
    const next = this.db.select().from(jobs).where(and(inArray(jobs.kind, laneKinds), eq(jobs.status, "queued")))
      .orderBy(asc(jobs.created_at), sql`rowid`).limit(1).get();
    if (!next) return;
    kind = next.kind;
    const handler = this.handlers.get(kind);
    if (!handler) return;
    const controller = new AbortController();
    this.db.update(jobs).set({ status: "running", started_at: now() }).where(eq(jobs.id, next.id)).run();
    this.bus.emit({ type: "job.started", id: next.id, kind, project_id: next.project_id });
    const ctx: JobContext = {
      id: next.id,
      signal: controller.signal,
      progress: (p, note) => {
        this.db.update(jobs).set({ progress: p }).where(eq(jobs.id, next.id)).run();
        this.bus.emit({ type: "job.progress", id: next.id, kind, progress: p, note, project_id: next.project_id });
      },
    };
    const done = (async () => {
      try {
        const result = await handler(JSON.parse(next.params_json), ctx);
        if (controller.signal.aborted) this.settleAborted(next.id, controller.signal);
        else this.finish(next.id, "succeeded", result, null);
      } catch (err) {
        if (controller.signal.aborted) this.settleAborted(next.id, controller.signal);
        else if (err instanceof Refusal) this.finish(next.id, "refused", null, err.message);
        else this.finish(next.id, "failed", null, err instanceof Error ? err.message : String(err));
      } finally {
        this.active.delete(lane);
        for (const k of this.handlers.keys()) if (this.laneOf(k) === lane) this.pump(k);
      }
    })().catch((err) => {
      // finish()/pump() itself failed (e.g. the DB closed under us): `done` must never reject unhandled
      console.error(`[jobs] job ${next.id} bookkeeping failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    });
    this.active.set(lane, { id: next.id, controller, done });
  }

  private finish(id: string, status: JobStatus, result: Record<string, unknown> | null, error: string | null): void {
    this.db.update(jobs).set({ status, result_json: result ? JSON.stringify(result) : null, error, finished_at: now(), progress: status === "succeeded" ? 1 : undefined })
      .where(eq(jobs.id, id)).run();
    const job = this.get(id);
    this.bus.emit({ type: `job.${status}`, id, kind: job?.kind, project_id: job?.project_id, error, result });
  }
}

/** Daily retention sweep for a long-lived server (resume() only covers boot); the timer never keeps the process alive. */
export const RETENTION_INTERVAL_MS = 86_400_000;
export function startRetention(runner: JobRunner, everyMs = RETENTION_INTERVAL_MS): NodeJS.Timeout {
  const t = setInterval(() => runner.retain(), everyMs);
  t.unref();
  return t;
}
