/**
 * The generation queue over `generation_jobs` (SPEC D.3/D.4/D.10). Plain SQL on the better-sqlite3
 * handle: the server enqueues, cancels and retries; the worker process claims, heartbeats and
 * finishes. Every state change appends a `generation_job_events` row, which the server relays as SSE.
 */
import { randomUUID } from "node:crypto";
import type { EnqueueGeneration, GenerationErrorKind, GenerationEventType, GenerationJob, GenerationJobStatus } from "@statreel/schemas";
import { type Db, now } from "../db";
import { assertIds } from "./paths";

export class QueueConflict extends Error {
  constructor(message: string, readonly job?: GenerationJob) {
    super(message);
    this.name = "QueueConflict";
  }
}

export type QueueOptions = { clock?: () => string; maxAttempts?: number };
export type EnqueueResult = { job: GenerationJob; existing: boolean };
export type JobUpdate = { phase?: string | null; progress_note?: string | null; last_tool?: string | null };

/** What one CLI run reported in its `result` event; null = not reported (unmeasurable is not zero). */
export type RunSpend = { cost_usd: number | null; turns: number | null };

/** The spend an engine error carries (failed, budget and cancelled runs still cost money); null when none was reported. */
export function spendOf(e: unknown): RunSpend | null {
  const s = (e as { spend?: Partial<RunSpend> } | null)?.spend;
  if (!s) return null;
  return { cost_usd: typeof s.cost_usd === "number" ? s.cost_usd : null, turns: typeof s.turns === "number" ? s.turns : null };
}

export const dedupeKey = (type: string, caseId: string, boardItemId?: string | null) => `${type}|${caseId}|${boardItemId ?? "-"}`;

export class GenerationQueue {
  private readonly clock: () => string;
  private readonly maxAttempts: number;
  constructor(private readonly db: Db, o: QueueOptions = {}) {
    this.clock = o.clock ?? now;
    this.maxAttempts = o.maxAttempts ?? 2;
  }

  private get c() {
    return this.db.$client;
  }

  get(id: string): GenerationJob | undefined {
    return this.c.prepare("select * from generation_jobs where id = ?").get(id) as GenerationJob | undefined;
  }

  /** Newest first; queued rows carry their 1-based FIFO position. */
  list(f: { status?: string; case_id?: string; limit?: number } = {}): (GenerationJob & { queue_position?: number })[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (f.status) { where.push("status = ?"); args.push(f.status); }
    if (f.case_id) { where.push("case_id = ?"); args.push(f.case_id); }
    const rows = this.c.prepare(`select * from generation_jobs ${where.length ? `where ${where.join(" and ")}` : ""} order by created_at desc, rowid desc limit ?`)
      .all(...args, Math.min(Math.max(f.limit ?? 50, 1), 500)) as GenerationJob[];
    const queued = (this.c.prepare("select id from generation_jobs where status = 'queued' order by created_at, rowid").all() as { id: string }[]).map((r) => r.id);
    return rows.map((r) => (r.status === "queued" ? { ...r, queue_position: queued.indexOf(r.id) + 1 } : r));
  }

  counts(): { queued: number; running: number } {
    const rows = this.c.prepare("select status, count(*) n from generation_jobs where status in ('queued','running') group by status").all() as { status: string; n: number }[];
    return { queued: rows.find((r) => r.status === "queued")?.n ?? 0, running: rows.find((r) => r.status === "running")?.n ?? 0 };
  }

  /**
   * Idempotent: a second enqueue for the same (type, case, item) while one is queued or running returns
   * that row (the partial unique index decides, so racing requests yield one row). A finished job for
   * the same key conflicts unless `force`.
   */
  enqueue(req: EnqueueGeneration, extra: { params?: Record<string, unknown> } = {}): EnqueueResult {
    assertIds(req);
    const key = dedupeKey(req.type, req.case_id, req.board_item_id);
    const tx = this.c.transaction((): EnqueueResult => {
      const active = this.c.prepare("select * from generation_jobs where dedupe_key = ? and status in ('queued','running')").get(key) as GenerationJob | undefined;
      if (active) return { job: active, existing: true };
      if (!req.force) {
        const done = this.c.prepare("select * from generation_jobs where dedupe_key = ? and status = 'done' limit 1").get(key) as GenerationJob | undefined;
        if (done) throw new QueueConflict("already generated for this case; pass force to generate again", done);
      }
      const id = `gj-${randomUUID().slice(0, 8)}`;
      const at = this.clock();
      const res = this.c.prepare(
        `insert into generation_jobs (id, type, case_id, board_item_id, dedupe_key, status, attempts, max_attempts, params_json, log_path, output_dir, created_at, updated_at)
         values (?,?,?,?,?, 'queued', 0, ?, ?, ?, ?, ?, ?)
         on conflict(dedupe_key) where status in ('queued','running') do nothing`,
      ).run(id, req.type, req.case_id, req.board_item_id ?? null, key, this.maxAttempts, JSON.stringify(extra.params ?? {}), `generation/${id}/run.log`, `generation/${id}`, at, at);
      if (res.changes === 0) {
        const row = this.c.prepare("select * from generation_jobs where dedupe_key = ? and status in ('queued','running')").get(key) as GenerationJob;
        return { job: row, existing: true };
      }
      this.event(id, "queued", { type: req.type, case_id: req.case_id });
      return { job: this.get(id) as GenerationJob, existing: false };
    });
    return tx.immediate();
  }

  /** Claim the oldest queued job (FIFO). One atomic statement. `pid` stays null until the CLI child exists. */
  claim(): GenerationJob | undefined {
    const at = this.clock();
    const row = this.c.prepare(
      `update generation_jobs set status = 'running', attempts = attempts + 1, started_at = ?, pid = null, phase = 'prepare', progress_note = null, last_tool = null,
         error = null, error_kind = null, cancel_requested_at = null, heartbeat_at = ?, updated_at = ?
       where id = (select id from generation_jobs where status = 'queued' order by created_at, rowid limit 1) returning *`,
    ).get(at, at, at) as GenerationJob | undefined;
    if (row) this.event(row.id, "started", { attempt: row.attempts });
    return row;
  }

  setPid(id: string, pid: number | null): void {
    this.c.prepare("update generation_jobs set pid = ?, updated_at = ? where id = ? and status = 'running'").run(pid, this.clock(), id);
  }

  setParams(id: string, params: Record<string, unknown>): void {
    this.c.prepare("update generation_jobs set params_json = ?, updated_at = ? where id = ?").run(JSON.stringify(params), this.clock(), id);
  }

  /** Phase / note / last tool on the row, plus a `progress` event for the SSE relay. */
  update(id: string, u: JobUpdate): void {
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const k of ["phase", "progress_note", "last_tool"] as const) if (u[k] !== undefined) { sets.push(`${k} = ?`); args.push(u[k]); }
    if (!sets.length) return;
    const res = this.c.prepare(`update generation_jobs set ${sets.join(", ")}, updated_at = ? where id = ? and status = 'running'`).run(...args, this.clock(), id);
    if (res.changes) this.event(id, "progress", { ...u });
  }

  heartbeat(id: string): boolean {
    const at = this.clock();
    return this.c.prepare("update generation_jobs set heartbeat_at = ?, updated_at = ? where id = ? and status = 'running'").run(at, at, id).changes === 1;
  }

  /**
   * Add one run's spend to the job's total (cost ledger). The `cost_usd` / `turns` columns survive `retry` and a
   * restart re-queue, so every attempt adds to the total and none replaces it. A null part adds nothing and
   * leaves an unknown total unknown.
   */
  addSpend(id: string, s: RunSpend | null | undefined): void {
    if (!s || (s.cost_usd === null && s.turns === null)) return;
    this.c.prepare(
      `update generation_jobs set cost_usd = case when ? is null then cost_usd else coalesce(cost_usd, 0) + ? end,
         turns = case when ? is null then turns else coalesce(turns, 0) + ? end where id = ?`,
    ).run(s.cost_usd, s.cost_usd, s.turns, s.turns, id);
  }

  /** The job's total spend so far, `null` parts when no attempt ever reported one. */
  spend(id: string): RunSpend {
    const r = this.c.prepare("select cost_usd, turns from generation_jobs where id = ?").get(id) as RunSpend | undefined;
    return { cost_usd: r?.cost_usd ?? null, turns: r?.turns ?? null };
  }

  /** running -> done | failed | cancelled (or queued -> cancelled). Returns the updated row, or undefined when the state did not allow it. */
  finish(id: string, status: Extract<GenerationJobStatus, "done" | "failed" | "cancelled">, o: { result?: unknown; error?: string | null; error_kind?: GenerationErrorKind | null } = {}): GenerationJob | undefined {
    const at = this.clock();
    const from = status === "cancelled" ? "('running','queued')" : "('running')";
    const res = this.c.prepare(
      `update generation_jobs set status = ?, result_json = ?, error = ?, error_kind = ?, pid = null, finished_at = ?, updated_at = ?
       where id = ? and status in ${from}`,
    ).run(status, o.result === undefined ? null : JSON.stringify(o.result), o.error ? o.error.slice(0, 500) : null, o.error_kind ?? null, at, at, id);
    if (!res.changes) return undefined;
    this.event(id, status, { error_kind: o.error_kind ?? null, error: o.error ? o.error.slice(0, 200) : null });
    return this.get(id);
  }

  /** queued -> cancelled at once; running -> `cancel_requested_at` (the worker kills the tree and finishes it). */
  cancel(id: string): GenerationJob | undefined {
    const job = this.get(id);
    if (!job) return undefined;
    if (job.status === "queued") return this.finish(id, "cancelled", { error: "cancelled before start", error_kind: "cancelled" }) ?? this.get(id);
    if (job.status === "running" && !job.cancel_requested_at) {
      this.c.prepare("update generation_jobs set cancel_requested_at = ?, updated_at = ? where id = ?").run(this.clock(), this.clock(), id);
      this.event(id, "progress", { cancel_requested: true });
    }
    return this.get(id);
  }

  /** failed | cancelled -> queued again on the same row (attempts kept, error cleared). */
  retry(id: string): GenerationJob {
    const job = this.get(id);
    if (!job) throw new QueueConflict("no such job");
    if (job.status !== "failed" && job.status !== "cancelled") throw new QueueConflict(`job is ${job.status}; only failed or cancelled jobs can be retried`, job);
    try {
      const at = this.clock();
      this.c.prepare(
        `update generation_jobs set status = 'queued', error = null, error_kind = null, result_json = null, pid = null, phase = null, progress_note = null,
           last_tool = null, cancel_requested_at = null, started_at = null, finished_at = null, max_attempts = max(max_attempts, attempts + 1), updated_at = ? where id = ?`,
      ).run(at, id);
    } catch (e) {
      if (/UNIQUE/i.test(String(e))) throw new QueueConflict("another job for this case is already queued or running", this.c.prepare("select * from generation_jobs where dedupe_key = ? and status in ('queued','running')").get(job.dedupe_key) as GenerationJob);
      throw e;
    }
    this.event(id, "queued", { retry: true });
    return this.get(id) as GenerationJob;
  }

  /**
   * Startup recovery (only the lease holder calls this, so every `running` row is stale): kill the
   * recorded CLI tree, then re-queue while attempts remain, else fail as interrupted.
   */
  async recover(kill: (job: GenerationJob) => Promise<unknown>): Promise<{ requeued: string[]; failed: string[] }> {
    const out = { requeued: [] as string[], failed: [] as string[] };
    const stale = this.c.prepare("select * from generation_jobs where status = 'running' order by created_at, rowid").all() as GenerationJob[];
    for (const job of stale) {
      if (job.pid) {
        try { await kill(job); } catch { /* the process is gone or not ours */ }
      }
      const at = this.clock();
      if (job.cancel_requested_at) {
        this.finish(job.id, "cancelled", { error: "cancelled", error_kind: "cancelled" });
      } else if (job.attempts < job.max_attempts) {
        this.c.prepare("update generation_jobs set status = 'queued', error = ?, error_kind = 'interrupted', pid = null, phase = null, started_at = null, updated_at = ? where id = ?")
          .run("interrupted by a worker restart; queued again", at, job.id);
        this.event(job.id, "queued", { requeued: true, reason: "interrupted" });
        out.requeued.push(job.id);
      } else {
        this.finish(job.id, "failed", { error: "interrupted by a worker restart and out of attempts", error_kind: "interrupted" });
        out.failed.push(job.id);
      }
    }
    return out;
  }

  event(jobId: string, type: GenerationEventType, data: Record<string, unknown> = {}): void {
    this.c.prepare("insert into generation_job_events (job_id, at, type, data_json) values (?,?,?,?)").run(jobId, this.clock(), type, JSON.stringify(data));
  }

  events(jobId: string): { id: number; type: string; at: string; data: Record<string, unknown> }[] {
    return (this.c.prepare("select * from generation_job_events where job_id = ? order by id").all(jobId) as { id: number; type: string; at: string; data_json: string }[])
      .map((r) => ({ id: r.id, type: r.type, at: r.at, data: JSON.parse(r.data_json) as Record<string, unknown> }));
  }
}
