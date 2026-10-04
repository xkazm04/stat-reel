/**
 * Worker robustness (ADR 010): a clean shutdown aborts the running job, re-queues it without burning an
 * attempt and releases the lease; heartbeat timers never throw.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GenerationConfigSchema } from "@statreel/schemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../db";
import type { ServerCallbacks } from "./callbacks";
import type { GenerationEngine } from "./engine";
import { acquireLease, leaseStatus } from "./lease";
import { GenerationQueue } from "./queue";
import { CASE_A, insertCase, sleep, until } from "./testing";
import { GenerationWorker, type WorkerDeps } from "./worker";

let dir: string;
let db: Db;
let queue: GenerationQueue;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "statreel-gws-"));
  db = openDb(path.join(dir, "app.sqlite"));
  queue = new GenerationQueue(db);
  insertCase(db, CASE_A);
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const LEASE = { pid: 4242, host: "test-host", isAlive: () => true };
const callbacks: ServerCallbacks = {
  finalize: async () => ({}),
  render: async () => ({ render_job_id: "r" }),
  renderStatus: async () => ({ status: "succeeded" }),
};
function worker(o: Partial<WorkerDeps>) {
  acquireLease(db, LEASE);
  return new GenerationWorker({
    db,
    queue,
    config: GenerationConfigSchema.parse({ mode: "fake" }),
    callbacks,
    dataRoot: dir,
    engine: { name: "t", run: async () => ({}) },
    health: async () => true,
    kill: async () => {},
    heartbeatMs: 20,
    cancelPollMs: 15,
    lease: LEASE,
    ...o,
  });
}

/** blocks until aborted, like a claude child that is killed by the signal */
const blockingEngine = (onAbort: () => void = () => {}): GenerationEngine => ({
  name: "blocking",
  run: (ctx) =>
    new Promise((_, reject) => {
      ctx.signal.addEventListener(
        "abort",
        () => {
          onAbort();
          reject(new Error("killed"));
        },
        { once: true },
      );
    }),
});

describe("worker shutdown", () => {
  it("aborts the running job, re-queues it without burning an attempt, releases the lease", async () => {
    let aborted = false;
    const w = worker({
      engine: blockingEngine(() => {
        aborted = true;
      }),
    });
    const job = queue.enqueue({ type: "visual_options", case_id: CASE_A }).job;
    const ticking = w.tick();
    await until(() => queue.get(job.id)?.phase === "run");
    expect(queue.get(job.id)?.attempts).toBe(1);
    const r = await w.shutdown(2000);
    await ticking;
    expect(aborted).toBe(true);
    expect(r).toEqual({ requeued: job.id, timedOut: false });
    expect(queue.get(job.id)).toMatchObject({
      status: "queued",
      attempts: 0,
      pid: null,
      error: null,
      error_kind: null,
    });
    expect(queue.events(job.id).some((e) => e.type === "queued" && e.data.reason === "shutdown")).toBe(true);
    expect(leaseStatus(db, { host: "test-host", isAlive: () => true }).online).toBe(false);
  });

  it("is bounded: an engine that ignores the abort still ends in a re-queued row and a free lease", async () => {
    const hang: GenerationEngine = { name: "hang", run: () => new Promise(() => {}) };
    const w = worker({ engine: hang });
    const job = queue.enqueue({ type: "visual_options", case_id: CASE_A }).job;
    void w.tick();
    await until(() => queue.get(job.id)?.phase === "run");
    const t0 = Date.now();
    const r = await w.shutdown(150);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(r.timedOut).toBe(true);
    expect(queue.get(job.id)).toMatchObject({ status: "queued", attempts: 0 });
    expect(leaseStatus(db, { host: "test-host", isAlive: () => true }).online).toBe(false);
  });

  it("with no running job it just releases the lease", async () => {
    const w = worker({});
    expect(await w.shutdown(100)).toEqual({ requeued: null, timedOut: false });
    expect(leaseStatus(db, { host: "test-host", isAlive: () => true }).online).toBe(false);
  });

  it("a re-queued job runs again on the next worker with its full attempts", async () => {
    const w1 = worker({ engine: blockingEngine() });
    const job = queue.enqueue({ type: "visual_options", case_id: CASE_A }).job;
    void w1.tick();
    await until(() => queue.get(job.id)?.phase === "run");
    await w1.shutdown(2000);
    expect(queue.claim()?.attempts).toBe(1); // not 2
  });
});

describe("worker heartbeats", () => {
  it("never throw: a failing job/lease heartbeat is logged and the job still finishes", async () => {
    const logs: string[] = [];
    const real = queue.heartbeat.bind(queue);
    let failures = 0;
    queue.heartbeat = (id: string) => {
      if (failures++ < 3) throw new Error("SQLITE_BUSY: database is locked");
      return real(id);
    };
    const slow: GenerationEngine = {
      name: "slow",
      run: async () => {
        await sleep(150);
        return {};
      },
    };
    const w = worker({
      engine: slow,
      log: (m) => logs.push(m),
      validator: { validate: async () => ({ ok: true, errors: [], outputs: ["x"] }) },
    });
    const job = queue.enqueue({ type: "visual_options", case_id: CASE_A }).job;
    await w.tick();
    expect(logs.some((l) => /job heartbeat failed.*SQLITE_BUSY/.test(l))).toBe(true);
    expect(queue.get(job.id)?.status).toBe("done");
  });

  it("a throwing lease heartbeat timer is caught and logged", async () => {
    const logs: string[] = [];
    const w = worker({ log: (m) => logs.push(m), heartbeatMs: 10 });
    await w.start();
    db.$client.exec("alter table worker_lease rename to worker_lease_gone"); // heartbeat now throws "no such table"
    await until(() => logs.some((l) => /lease heartbeat failed/.test(l)), 2000);
    db.$client.exec("alter table worker_lease_gone rename to worker_lease");
    w.stop();
  });
});
