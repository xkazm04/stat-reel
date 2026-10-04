import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../db";
import { EventBus } from "../events";
import { JobRunner } from "../jobs";
import { httpCallbacks } from "./callbacks";
import { acquireLease } from "./lease";
import { jobPaths } from "./paths";
import { GenerationQueue } from "./queue";
import { registerGenerationRoutes } from "./routes";
import { CASE_A, CASE_B, insertCase, until } from "./testing";

let dir: string;
let db: Db;
let queue: GenerationQueue;
let app: Hono<{ Bindings: HttpBindings }>;
let runner: JobRunner;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "statreel-routes-"));
  db = openDb(path.join(dir, "app.sqlite"));
  queue = new GenerationQueue(db);
  insertCase(db, CASE_A);
  insertCase(db, CASE_B);
  app = new Hono<{ Bindings: HttpBindings }>();
  runner = new JobRunner(db, new EventBus());
  runner.register("gen_render", async () => ({}), { lane: "render" });
  registerGenerationRoutes(app, { db, queue, bus: new EventBus(), runner, dataRoot: dir });
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (url: string, body?: unknown) => app.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
// biome-ignore lint/suspicious/noExplicitAny: loosely typed JSON bodies in assertions
type Json = Record<string, any>;
const json = async (r: Response) => (await r.json()) as Json;
const enqueue = (case_id = CASE_A, extra: object = {}) => post("/api/generation/jobs", { type: "visual_options", case_id, ...extra });

describe("/api/generation", () => {
  it("posting twice gives one row: 201 then 200 existing", async () => {
    const a = await enqueue();
    const b = await enqueue();
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    const [ja, jb] = [await json(a), await json(b)];
    expect(jb.existing).toBe(true);
    expect(jb.job.id).toBe(ja.job.id);
    expect(queue.list()).toHaveLength(1);
  });

  it("validates ids and the case", async () => {
    expect((await enqueue("../x")).status).toBe(400);
    expect((await enqueue("ci-deadbeef")).status).toBe(404);
    expect((await post("/api/generation/jobs", { type: "nope", case_id: CASE_A })).status).toBe(400);
  });

  it("generate_video fails closed until the data gate exists", async () => {
    const r = await post("/api/generation/jobs", { type: "generate_video", case_id: CASE_A });
    expect(r.status).toBe(409);
    expect((await json(r)).gate.ok).toBe(false);
    expect(queue.list()).toHaveLength(0);
  });

  it("a done job conflicts (409) unless force", async () => {
    const { job } = await json(await enqueue());
    queue.claim();
    queue.finish(job.id, "done", { result: {} });
    expect((await enqueue()).status).toBe(409);
    expect((await enqueue(CASE_A, { force: true })).status).toBe(201);
  });

  it("retry and cancel status codes", async () => {
    const { job } = await json(await enqueue());
    expect((await post(`/api/generation/jobs/${job.id}/retry`)).status).toBe(409); // queued
    expect((await post("/api/generation/jobs/gj-00000000/retry")).status).toBe(404);
    const c = await post(`/api/generation/jobs/${job.id}/cancel`);
    expect(c.status).toBe(200);
    expect((await json(c)).job.status).toBe("cancelled");
    const again = await post(`/api/generation/jobs/${job.id}/retry`);
    expect(again.status).toBe(200);
    expect((await json(again)).job.status).toBe("queued");
    queue.claim();
    expect((await post(`/api/generation/jobs/${job.id}/retry`)).status).toBe(409); // running
    const cr = await json(await post(`/api/generation/jobs/${job.id}/cancel`));
    expect(cr.job.status).toBe("running");
    expect(cr.job.cancel_requested_at).toBeTruthy();
    expect((await post("/api/generation/jobs/gj-00000000/cancel")).status).toBe(404);
  });

  it("detail returns the job, its derived stage and the log tail", async () => {
    const { job } = await json(await enqueue());
    const p = jobPaths(job.id, dir);
    mkdirSync(p.dir, { recursive: true });
    writeFileSync(p.runLog, Array.from({ length: 250 }, (_, i) => `line ${i}`).join("\n"));
    const d = await json(await app.request(`/api/generation/jobs/${job.id}`));
    expect(d.stage).toBe("visuals_queued");
    expect(d.log_tail).toHaveLength(200);
    expect(d.log_tail.at(-1)).toBe("line 249");
    expect((await app.request("/api/generation/jobs/gj-00000000")).status).toBe(404);
  });

  it("incremental log with X-Next-Offset", async () => {
    const { job } = await json(await enqueue());
    const p = jobPaths(job.id, dir);
    mkdirSync(p.dir, { recursive: true });
    writeFileSync(p.runLog, "abc\ndef\n");
    const r1 = await app.request(`/api/generation/jobs/${job.id}/log?offset=0`);
    expect(await r1.text()).toBe("abc\ndef\n");
    expect(r1.headers.get("x-next-offset")).toBe("8");
    const r2 = await app.request(`/api/generation/jobs/${job.id}/log?offset=8`);
    expect(await r2.text()).toBe("");
    expect(r2.headers.get("x-next-offset")).toBe("8");
  });

  it("list filters and worker status / config", async () => {
    await enqueue(CASE_A);
    await enqueue(CASE_B);
    expect((await json(await app.request(`/api/generation/jobs?case_id=${CASE_B}`))).jobs).toHaveLength(1);
    expect((await json(await app.request("/api/generation/jobs?status=queued"))).jobs).toHaveLength(2);
    expect(await json(await app.request("/api/generation/worker"))).toMatchObject({ online: false, queued: 2, running: 0 });
    acquireLease(db, { pid: process.pid });
    expect((await json(await app.request("/api/generation/worker"))).online).toBe(true);
    const cfg = await json(await app.request("/api/generation/config"));
    expect(cfg.config.budgetUsd).toBeNull();
    expect(cfg.sources.model).toBeTruthy();
  });

  it("render and finalize callbacks reject unknown and non-running jobs", async () => {
    expect((await post("/api/generation/jobs/gj-00000000/finalize", { outputs: [] })).status).toBe(404);
    expect((await post("/api/generation/jobs/gj-00000000/render", { kind: "stills", props_path: "out/p.json" })).status).toBe(404);
    const { job } = await json(await enqueue());
    expect((await post(`/api/generation/jobs/${job.id}/finalize`, { outputs: [] })).status).toBe(409); // queued
    queue.claim();
    const f = await post(`/api/generation/jobs/${job.id}/finalize`, { outputs: ["out/a.json"] });
    expect(f.status).toBe(200);
    expect(await json(f)).toMatchObject({ recorded: 1 });
    const r = await post(`/api/generation/jobs/${job.id}/render`, { kind: "stills", props_path: "out/variants/v1.props.json", frames: [10] });
    expect(r.status).toBe(200);
    expect((await json(r)).render_job_id).toBeTruthy();
    expect((await post(`/api/generation/jobs/${job.id}/render`, { kind: "stills", props_path: "../../../etc/passwd" })).status).toBe(400);
    expect((await post(`/api/generation/jobs/${job.id}/finalize`, { nope: 1 })).status).toBe(400);
  });

  it("the worker reads its render job by id, however many jobs were created after it", async () => {
    // the server's job list, exactly as app.ts serves it: the newest 50 of every kind
    app.get("/api/jobs", (c) => c.json({ jobs: runner.list(undefined, 50) }));
    const cb = httpCallbacks("http://t", ((url: string, init?: RequestInit) => app.request(url.replace("http://t", ""), init)) as typeof fetch);
    const { job } = await json(await enqueue());
    queue.claim();
    const { render_job_id } = await cb.render(job.id, { kind: "stills", props_path: "out/variants/v1.props.json", frames: [10] });
    await until(() => runner.get(render_job_id)?.status === "succeeded");
    for (let i = 0; i < 60; i++) runner.enqueue("gen_render", { generation_job_id: job.id, kind: "stills", props_path: "x", frames: [] });
    await expect(cb.renderStatus(render_job_id)).resolves.toMatchObject({ status: "succeeded" });
    expect((await app.request("/api/generation/renders/nope")).status).toBe(404);
    await until(() => runner.list().every((j) => j.status === "succeeded"));
  });
});
