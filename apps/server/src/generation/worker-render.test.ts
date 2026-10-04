/**
 * The render step inside the worker: server callbacks ride the same server-down retry as finalize, and a
 * failure there is classed "render", not "validation".
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GenerationConfigSchema } from "@statreel/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, openDb } from "../db";
import type { ServerCallbacks } from "./callbacks";
import { acquireLease } from "./lease";
import { GenerationQueue } from "./queue";
import { makeRenderStep } from "./render-steps";
import { CASE_A, insertCase } from "./testing";
import { GenerationWorker } from "./worker";

// the real plan needs a full timing-plan.json; the render step only reads sections.total from it
vi.mock("./validate-data-race", () => ({ readPlan: () => ({ sections: { total: 100 } }) }));

let dir: string;
let db: Db;
let queue: GenerationQueue;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "statreel-gwr-"));
  db = openDb(path.join(dir, "app.sqlite"));
  queue = new GenerationQueue(db);
  insertCase(db, CASE_A);
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const LEASE = { pid: 4242, host: "test-host", isAlive: () => true };
const down = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
function worker(cb: ServerCallbacks, logs: string[] = []) {
  acquireLease(db, LEASE);
  return new GenerationWorker({
    db, queue, config: GenerationConfigSchema.parse({ mode: "fake" }), callbacks: cb, dataRoot: dir,
    engine: { name: "t", run: async () => ({}) },
    validator: { validate: async () => ({ ok: true, errors: [], outputs: ["out/props.json"] }) },
    renderStep: makeRenderStep(cb, { pollMs: 5 }),
    health: async () => true, kill: async () => {}, heartbeatMs: 1000, cancelPollMs: 1000, lease: LEASE,
    callbackRetries: { tries: 6, baseMs: 5 }, log: (m) => logs.push(m),
  });
}
const enqueueVideo = () => queue.enqueue({ type: "generate_video", case_id: CASE_A }).job;

describe("render step in the worker", () => {
  it("survives the server being down mid-render and completes once it returns", async () => {
    let refusals = 0;
    let finalized = 0;
    const cb: ServerCallbacks = {
      finalize: async () => { finalized++; return {}; },
      render: async () => {
        if (refusals++ < 2) throw down(); // server restarting
        return { render_job_id: "r1" };
      },
      renderStatus: async () => {
        if (refusals++ < 4) throw down(); // and again while polling
        return { status: "succeeded", result: { stills: ["s.png"], output: "v.mp4" } };
      },
    };
    const logs: string[] = [];
    const job = enqueueVideo();
    await worker(cb, logs).tick();
    expect(queue.get(job.id)).toMatchObject({ status: "done", attempts: 1 });
    expect(finalized).toBe(1);
    expect(refusals).toBeGreaterThanOrEqual(4);
    expect(logs.some((l) => /server unreachable/.test(l))).toBe(true);
  });

  it("a failed render is error_kind render, even when it is not a GenerationError", async () => {
    const cb: ServerCallbacks = {
      finalize: async () => ({}),
      render: async () => { throw new Error("POST /render -> 500: boom"); }, // HTTP error: real, not retried
      renderStatus: async () => ({ status: "succeeded" }),
    };
    const job = enqueueVideo();
    await worker(cb).tick();
    expect(queue.get(job.id)).toMatchObject({ status: "failed", error_kind: "render" });
  });

  it("a render job that ends failed is error_kind render", async () => {
    const cb: ServerCallbacks = {
      finalize: async () => ({}),
      render: async () => ({ render_job_id: "r1" }),
      renderStatus: async () => ({ status: "failed", error: "ffmpeg died" }),
    };
    const job = enqueueVideo();
    await worker(cb).tick();
    expect(queue.get(job.id)).toMatchObject({ status: "failed", error_kind: "render" });
  });
});
