import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GenerationConfigSchema, type GenerationConfig, type GenerationJob } from "@statreel/schemas";
import { type Db, openDb } from "../db";
import { EventBus } from "../events";
import { JobRunner } from "../jobs";
import type { ServerCallbacks } from "./callbacks";
import { type GenerationEngine, GenerationError } from "./engine";
import { acquireLease, heartbeatLease, leaseStatus, releaseLease } from "./lease";
import { jobPaths } from "./paths";
import { GenerationQueue, QueueConflict } from "./queue";
import { CASE_A, CASE_B, CASE_C, insertCase, sleep, until } from "./testing";
import { armTimeout, GenerationWorker, type WorkerDeps } from "./worker";

let dir: string;
let db: Db;
let queue: GenerationQueue;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "statreel-gen-"));
  db = openDb(path.join(dir, "app.sqlite"));
  queue = new GenerationQueue(db);
  for (const c of [CASE_A, CASE_B, CASE_C]) insertCase(db, c);
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const vo = (case_id: string, extra: object = {}) => ({ type: "visual_options" as const, case_id, ...extra });

const goodCallbacks: ServerCallbacks = {
  finalize: async () => ({ recorded: 1 }),
  render: async () => ({ render_job_id: "r" }),
  renderStatus: async () => ({ status: "succeeded" }),
};
const okEngine: GenerationEngine = {
  name: "test",
  async run(ctx) {
    // contracted outputs, so the stub validator passes
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(path.join(ctx.paths.out, "variants"), { recursive: true });
    for (const n of [1, 2, 3]) {
      writeFileSync(path.join(ctx.paths.out, "variants", `v${n}.props.json`), "{}");
      writeFileSync(path.join(ctx.paths.out, "variants", `v${n}.md`), "x");
    }
    writeFileSync(path.join(ctx.paths.out, "timing-plan.json"), "{}");
    writeFileSync(path.join(ctx.paths.out, "assets.json"), "[]");
    return { result: { cost_usd: 0 } };
  },
};

const LEASE = { pid: 4242, host: "test-host", isAlive: () => true };
function worker(o: Partial<WorkerDeps> & { configPatch?: Partial<GenerationConfig>; takeLease?: boolean } = {}) {
  const { configPatch, takeLease = true, ...rest } = o;
  if (takeLease) acquireLease(db, rest.lease ?? LEASE); // a run heartbeats the lease, so a worker without one aborts
  return new GenerationWorker({
    db, queue, config: GenerationConfigSchema.parse({ mode: "fake", ...configPatch }), engine: okEngine, callbacks: goodCallbacks, dataRoot: dir,
    health: async () => true, kill: async () => {}, heartbeatMs: 20, cancelPollMs: 15, lease: LEASE,
    ...rest,
  });
}

describe("queue: enqueue, FIFO, dedupe", () => {
  it("claims strictly FIFO and never the same row twice", () => {
    const a = queue.enqueue(vo(CASE_A)).job;
    const b = queue.enqueue(vo(CASE_B)).job;
    const c = queue.enqueue(vo(CASE_C)).job;
    expect([queue.claim()?.id, queue.claim()?.id, queue.claim()?.id, queue.claim()?.id]).toEqual([a.id, b.id, c.id, undefined]);
    expect(queue.get(a.id)).toMatchObject({ status: "running", attempts: 1, pid: null, phase: "prepare" });
  });

  it("queue positions follow FIFO", () => {
    const a = queue.enqueue(vo(CASE_A)).job;
    const b = queue.enqueue(vo(CASE_B)).job;
    const list = queue.list();
    expect(list.find((j) => j.id === a.id)?.queue_position).toBe(1);
    expect(list.find((j) => j.id === b.id)?.queue_position).toBe(2);
  });

  it("two enqueues give one row; the second reports existing", () => {
    const first = queue.enqueue(vo(CASE_A));
    const second = queue.enqueue(vo(CASE_A));
    expect(first.existing).toBe(false);
    expect(second.existing).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect(queue.list()).toHaveLength(1);
  });

  it("a racing second connection cannot create a duplicate", () => {
    const other = new Database(path.join(dir, "app.sqlite"));
    other.pragma("busy_timeout = 5000");
    const q2 = new GenerationQueue({ $client: other } as unknown as Db);
    const r1 = queue.enqueue(vo(CASE_A));
    const r2 = q2.enqueue(vo(CASE_A));
    expect(r2.existing).toBe(true);
    expect(r2.job.id).toBe(r1.job.id);
    // and the index itself refuses a raw duplicate
    expect(() => other.prepare("insert into generation_jobs (id,type,case_id,dedupe_key,status,created_at,updated_at) values ('gj-deadbeef','visual_options',?,?, 'queued','x','x')").run(CASE_A, r1.job.dedupe_key)).toThrow(/UNIQUE/);
    other.close();
  });

  it("different item or type is a different key", () => {
    queue.enqueue(vo(CASE_A));
    queue.enqueue({ type: "generate_video", case_id: CASE_A, board_item_id: "bd-00000001" });
    queue.enqueue({ type: "generate_video", case_id: CASE_A, board_item_id: "bd-00000002" });
    expect(queue.list()).toHaveLength(3);
  });

  it("a done job conflicts unless forced", () => {
    const j = queue.enqueue(vo(CASE_A)).job;
    queue.claim();
    queue.finish(j.id, "done", { result: {} });
    expect(() => queue.enqueue(vo(CASE_A))).toThrow(QueueConflict);
    const forced = queue.enqueue(vo(CASE_A, { force: true }));
    expect(forced.existing).toBe(false);
    expect(forced.job.id).not.toBe(j.id);
  });

  it("rejects ids that are not what the server generates", () => {
    expect(() => queue.enqueue(vo("../../etc"))).toThrow(/invalid case id/);
    expect(() => queue.enqueue({ type: "generate_video", case_id: CASE_A, board_item_id: "x" })).toThrow(/invalid board item id/);
    expect(() => jobPaths("gj-../x", dir)).toThrow();
  });

  it("every transition appends an event", () => {
    const j = queue.enqueue(vo(CASE_A)).job;
    queue.claim();
    queue.update(j.id, { phase: "run", last_tool: "Write" });
    queue.finish(j.id, "done", { result: {} });
    expect(queue.events(j.id).map((e) => e.type)).toEqual(["queued", "started", "progress", "done"]);
  });
});

describe("queue: cancel, retry, recover", () => {
  it("cancel while queued finishes at once", () => {
    const j = queue.enqueue(vo(CASE_A)).job;
    expect(queue.cancel(j.id)).toMatchObject({ status: "cancelled", error_kind: "cancelled" });
    expect(queue.claim()).toBeUndefined();
  });

  it("cancel while running only requests it (the worker kills the tree)", () => {
    const j = queue.enqueue(vo(CASE_A)).job;
    queue.claim();
    const r = queue.cancel(j.id);
    expect(r?.status).toBe("running");
    expect(r?.cancel_requested_at).toBeTruthy();
  });

  it("retry re-queues a failed job on the same row, but not queued, running or done", () => {
    const j = queue.enqueue(vo(CASE_A)).job;
    expect(() => queue.retry(j.id)).toThrow(QueueConflict);
    queue.claim();
    queue.finish(j.id, "failed", { error: "boom", error_kind: "cli_exit" });
    const again = queue.retry(j.id);
    expect(again).toMatchObject({ status: "queued", error: null, attempts: 1 });
    queue.claim();
    queue.finish(j.id, "done", { result: {} });
    expect(() => queue.retry(j.id)).toThrow(QueueConflict);
  });

  it("recover re-queues running rows below max attempts and fails them at max", async () => {
    const a = queue.enqueue(vo(CASE_A)).job; // attempts 1 of 2 after claim
    const b = queue.enqueue(vo(CASE_B)).job;
    queue.claim();
    queue.claim();
    db.$client.prepare("update generation_jobs set attempts = 2 where id = ?").run(b.id); // out of attempts
    queue.setPid(a.id, 111);
    const killed: number[] = [];
    const r = await queue.recover(async (job) => void killed.push(job.pid as number));
    expect(r).toEqual({ requeued: [a.id], failed: [b.id] });
    expect(killed).toEqual([111]); // only rows with a recorded pid are killed, and only by the injected killer
    expect(queue.get(a.id)).toMatchObject({ status: "queued", error_kind: "interrupted", pid: null });
    expect(queue.get(b.id)).toMatchObject({ status: "failed", error_kind: "interrupted" });
    // the re-queued job runs again, FIFO
    expect(queue.claim()?.id).toBe(a.id);
  });

  it("recover finishes a running job whose cancel was requested as cancelled", async () => {
    const a = queue.enqueue(vo(CASE_A)).job;
    queue.claim();
    queue.cancel(a.id);
    await queue.recover(async () => {});
    expect(queue.get(a.id)?.status).toBe("cancelled");
  });
});

describe("lease: one worker, stale and dead takeover", () => {
  const A = { pid: 1001, host: "h", isAlive: () => true };
  const B = { pid: 1002, host: "h", isAlive: () => true };

  it("a second worker is refused while the first is alive and fresh", () => {
    expect(acquireLease(db, A).ok).toBe(true);
    const second = acquireLease(db, B);
    expect(second).toMatchObject({ ok: false, pid: 1001 });
  });

  it("takes over a stale lease", () => {
    acquireLease(db, { ...A, clock: () => 1_000_000 });
    expect(acquireLease(db, { ...B, clock: () => 1_000_000 + 61_000 }).ok).toBe(true);
    expect(leaseStatus(db, { clock: () => 1_000_000 + 61_000 }).pid).toBe(1002);
  });

  it("takes over at once when the holder's pid is dead on this host", () => {
    acquireLease(db, A);
    expect(acquireLease(db, { ...B, isAlive: () => false }).ok).toBe(true);
  });

  it("does not take over a live holder on another host", () => {
    acquireLease(db, A);
    expect(acquireLease(db, { ...B, host: "other", isAlive: () => false }).ok).toBe(false);
  });

  it("heartbeat reports a lost lease; release frees it", () => {
    acquireLease(db, A);
    expect(heartbeatLease(db, A)).toBe(true);
    expect(heartbeatLease(db, B)).toBe(false);
    releaseLease(db, A);
    expect(leaseStatus(db).online).toBe(false);
    expect(acquireLease(db, B).ok).toBe(true);
  });
});

describe("worker", () => {
  it("runs a job queued -> running -> done and writes data/generation/<id>/", async () => {
    const j = queue.enqueue(vo(CASE_A)).job;
    const w = worker();
    expect(await w.tick()).toBe("ran");
    const done = queue.get(j.id) as GenerationJob;
    expect(done).toMatchObject({ status: "done", error: null });
    expect(JSON.parse(done.result_json as string).outputs).toContain("out/timing-plan.json");
    const p = jobPaths(j.id, dir);
    expect(JSON.parse(readFileSync(p.caseJson, "utf8")).title).toBe(`Case ${CASE_A}`);
    expect(readFileSync(p.runLog, "utf8")).toContain("finalize ok");
    expect(JSON.parse(done.params_json)).toMatchObject({ mode: "fake", model: "sonnet", timeoutMin: null, budgetUsd: null });
    expect(await w.tick()).toBe("idle");
  });

  it("runs one job at a time even for overlapping ticks", async () => {
    queue.enqueue(vo(CASE_A));
    queue.enqueue(vo(CASE_B));
    let active = 0;
    let max = 0;
    const slow: GenerationEngine = { name: "slow", run: async (ctx) => { active++; max = Math.max(max, active); await sleep(40); active--; return okEngine.run(ctx); } };
    const w = worker({ engine: slow });
    await Promise.all([w.tick(), w.tick(), w.tick()]);
    await w.tick();
    expect(max).toBe(1);
    expect(queue.list({ status: "done" })).toHaveLength(2);
  });

  it("heartbeats the job row while it runs", async () => {
    const j = queue.enqueue(vo(CASE_A)).job;
    const slow: GenerationEngine = { name: "slow", run: async (ctx) => { await sleep(120); return okEngine.run(ctx); } };
    const w = worker({ engine: slow });
    const run = w.tick();
    await until(() => !!queue.get(j.id)?.heartbeat_at);
    const first = queue.get(j.id)?.heartbeat_at;
    await until(() => queue.get(j.id)?.heartbeat_at !== first);
    await run;
  });

  it("cancel via cancel_requested_at aborts the run and finishes cancelled", async () => {
    const j = queue.enqueue(vo(CASE_A)).job;
    const waiting: GenerationEngine = { name: "wait", run: (ctx) => new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(new GenerationError("cancelled", "aborted")))) };
    const w = worker({ engine: waiting });
    const run = w.tick();
    await until(() => queue.get(j.id)?.phase === "run");
    queue.cancel(j.id);
    await run;
    expect(queue.get(j.id)).toMatchObject({ status: "cancelled", error_kind: "cancelled" });
  });

  it("with timeoutMin unset no timer is armed; with it set the run fails as timeout", async () => {
    const unset = GenerationConfigSchema.parse({});
    let fired = 0;
    expect(armTimeout(unset, "visual_options", () => fired++, (() => { throw new Error("must not arm"); }) as never)).toBeNull();
    const perType = GenerationConfigSchema.parse({ timeoutMin: { generate_video: 5 } });
    expect(armTimeout(perType, "visual_options", () => {})).toBeNull();
    const armed = armTimeout(perType, "generate_video", () => {});
    expect(armed).not.toBeNull();
    clearTimeout(armed as NodeJS.Timeout);

    const j = queue.enqueue(vo(CASE_A)).job;
    const waiting: GenerationEngine = { name: "wait", run: (ctx) => new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("killed")))) };
    const w = worker({ engine: waiting, configPatch: { timeoutMin: 0.0005 } }); // 30 ms
    await w.tick();
    expect(queue.get(j.id)).toMatchObject({ status: "failed", error_kind: "timeout" });
    expect(fired).toBe(0);
  });

  it("invalid outputs fail as validation", async () => {
    const j = queue.enqueue(vo(CASE_A)).job;
    const w = worker({ engine: { name: "empty", run: async () => ({}) } });
    await w.tick();
    expect(queue.get(j.id)).toMatchObject({ status: "failed", error_kind: "validation" });
    expect(queue.get(j.id)?.error).toMatch(/missing output/);
  });

  it("a failing CLI is cli_exit, an unknown case is validation", async () => {
    const a = queue.enqueue(vo(CASE_A)).job;
    await worker({ engine: { name: "bad", run: async () => { throw new Error("exit 1"); } } }).tick();
    expect(queue.get(a.id)).toMatchObject({ status: "failed", error_kind: "cli_exit" });
    const ghost = queue.enqueue(vo("ci-deadbeef")).job;
    await worker().tick();
    expect(queue.get(ghost.id)).toMatchObject({ status: "failed", error_kind: "validation" });
  });

  it("a server restart (network errors) does not fail a finishing job", async () => {
    const j = queue.enqueue(vo(CASE_A)).job;
    let calls = 0;
    const flaky: ServerCallbacks = { ...goodCallbacks, finalize: async () => { if (++calls < 3) throw new TypeError("fetch failed"); return { recorded: 1 }; } };
    await worker({ callbacks: flaky, callbackRetries: { tries: 5, baseMs: 5 } }).tick();
    expect(calls).toBe(3);
    expect(queue.get(j.id)?.status).toBe("done");
  });

  it("an HTTP error from the server is a real failure, not retried", async () => {
    const j = queue.enqueue(vo(CASE_A)).job;
    let calls = 0;
    const bad: ServerCallbacks = { ...goodCallbacks, finalize: async () => { calls++; throw new Error("POST finalize -> 409: job is cancelled"); } };
    await worker({ callbacks: bad, callbackRetries: { tries: 5, baseMs: 5 } }).tick();
    expect(calls).toBe(1);
    expect(queue.get(j.id)).toMatchObject({ status: "failed", error_kind: "validation" });
  });

  it("while the server is down the job stays queued and the worker backs off", async () => {
    const j = queue.enqueue(vo(CASE_A)).job;
    const w = worker({ health: async () => false, backoffMs: { start: 10, max: 40 } });
    expect(await w.tick()).toBe("server-down");
    expect(queue.get(j.id)?.status).toBe("queued");
  });

  it("STATREEL_GEN_WORKER=off claims nothing", async () => {
    const j = queue.enqueue(vo(CASE_A)).job;
    expect(await worker({ configPatch: { worker: "off" } }).tick()).toBe("off");
    expect(queue.get(j.id)?.status).toBe("queued");
  });

  it("start() takes the lease and recovers; a second worker is refused", async () => {
    const j = queue.enqueue(vo(CASE_A)).job;
    queue.claim();
    const w1 = worker();
    const s1 = await w1.start();
    expect(s1).toMatchObject({ ok: true, requeued: [j.id] });
    const w2 = worker({ takeLease: false, lease: { pid: 9999, host: "test-host", isAlive: () => true } });
    expect(await w2.start()).toMatchObject({ ok: false, pid: 4242 });
    w1.release();
  });

  it("the co-pilot never waits for generation (no shared slot)", async () => {
    queue.enqueue(vo(CASE_A));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const blocking: GenerationEngine = { name: "block", run: async (ctx) => { await gate; return okEngine.run(ctx); } };
    const w = worker({ engine: blocking });
    const gen = w.tick();
    await until(() => queue.counts().running === 1);
    const runner = new JobRunner(db, new EventBus());
    let started = 0;
    runner.register("llm", async () => { started = Date.now(); return {}; });
    const t0 = Date.now();
    runner.enqueue("llm", {});
    await until(() => started > 0, 500, 1);
    expect(started - t0).toBeLessThan(200);
    expect(queue.counts().running).toBe(1); // generation is still blocked while the llm job ran
    release();
    await gen;
  });
});

describe("JobRunner lanes", () => {
  it("kinds sharing a lane run one at a time; other kinds stay concurrent", async () => {
    const runner = new JobRunner(db, new EventBus());
    let active = 0;
    let max = 0;
    const h = async () => { active++; max = Math.max(max, active); await sleep(20); active--; return {}; };
    runner.register("render", h);
    runner.register("gen_render", h, { lane: "render" });
    runner.enqueue("render", {});
    runner.enqueue("gen_render", {});
    runner.enqueue("gen_render", {});
    await runner.idle();
    expect(max).toBe(1);
    expect(runner.list().every((j) => j.status === "succeeded")).toBe(true);
  });
});
