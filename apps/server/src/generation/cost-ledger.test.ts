import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GenerationConfigSchema } from "@statreel/schemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../db";
import type { ServerCallbacks } from "./callbacks";
import { CostedGenerationError } from "./claude";
import { type GenerationEngine, GenerationError } from "./engine";
import { acquireLease } from "./lease";
import { GenerationQueue } from "./queue";
import { CASE_A, insertCase } from "./testing";
import { GenerationWorker } from "./worker";

let dir: string;
let db: Db;
let queue: GenerationQueue;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "statreel-cost-"));
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
const worker = (engine: GenerationEngine) => {
  acquireLease(db, LEASE);
  return new GenerationWorker({
    db,
    queue,
    config: GenerationConfigSchema.parse({ mode: "fake" }),
    engine,
    callbacks,
    dataRoot: dir,
    health: async () => true,
    kill: async () => {},
    heartbeatMs: 20,
    cancelPollMs: 15,
    lease: LEASE,
  });
};
const failing = (
  kind: "budget" | "cli_exit" | "cancelled",
  spend: { cost_usd: number | null; turns: number | null },
): GenerationEngine => ({
  name: "test",
  async run() {
    throw new CostedGenerationError(kind, `${kind} stop`, spend);
  },
});
const enqueue = () => queue.enqueue({ type: "visual_options", case_id: CASE_A }).job;
const cols = (id: string) =>
  db.$client.prepare("select cost_usd, turns, status, error_kind from generation_jobs where id = ?").get(id) as {
    cost_usd: number | null;
    turns: number | null;
    status: string;
    error_kind: string | null;
  };

describe("generation cost ledger", () => {
  it("a budget-capped failure keeps the result event's cost and turns", async () => {
    const j = enqueue();
    await worker(failing("budget", { cost_usd: 3, turns: 31 })).tick();
    expect(cols(j.id)).toMatchObject({ status: "failed", error_kind: "budget", cost_usd: 3, turns: 31 });
  });

  it("a cancelled run keeps its cost; an error without a result event adds nothing and a fresh job stays unknown", async () => {
    const a = enqueue();
    await worker(failing("cancelled", { cost_usd: 0.5, turns: 4 })).tick();
    expect(cols(a.id)).toMatchObject({ cost_usd: 0.5, turns: 4 });
    queue.retry(a.id);
    const plain: GenerationEngine = {
      name: "t",
      async run() {
        throw new GenerationError("cli_exit", "no result");
      },
    };
    await worker(plain).tick();
    expect(cols(a.id)).toMatchObject({ status: "failed", cost_usd: 0.5 }); // nothing added, nothing replaced
    const b = queue.enqueue({ type: "visual_options", case_id: CASE_A }).job;
    expect(queue.spend(b.id)).toEqual({ cost_usd: null, turns: null }); // unmeasurable is not zero
  });

  it("sums cost across a retry: the second attempt adds to the first", async () => {
    const j = enqueue();
    await worker(failing("cli_exit", { cost_usd: 0.4, turns: 10 })).tick();
    expect(cols(j.id).cost_usd).toBeCloseTo(0.4, 6);
    queue.retry(j.id); // resets the row but not the ledger columns
    expect(cols(j.id)).toMatchObject({ status: "queued", turns: 10 });
    await worker(failing("cli_exit", { cost_usd: 0.25, turns: 5 })).tick();
    const row = cols(j.id);
    expect(row.cost_usd).toBeCloseTo(0.65, 6);
    expect(row.turns).toBe(15);
  });

  it("a successful run adds its cost to the total of earlier attempts", async () => {
    const j = enqueue();
    await worker(failing("budget", { cost_usd: 1, turns: 9 })).tick();
    queue.retry(j.id);
    const ok: GenerationEngine = {
      name: "t",
      async run() {
        return { result: { cost_usd: 0.5, turns: 3 } };
      },
    };
    expect(await worker(ok).tick()).toBe("ran");
    expect(queue.spend(j.id).cost_usd).toBeCloseTo(1.5, 6);
    expect(queue.spend(j.id).turns).toBe(12);
  });
});
