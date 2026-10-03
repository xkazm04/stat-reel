/**
 * Real worker processes (ADR 010): the lease keeps a second worker out, and killing + restarting the
 * worker recovers a running job. Only processes spawned by this test are ever killed.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../db";
import { GenerationQueue } from "./queue";
import { CASE_A, insertCase, until } from "./testing";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let dir: string;
let db: Db;
let queue: GenerationQueue;
let api: Server;
let port: number;
const children: ChildProcess[] = [];

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "statreel-wproc-"));
  db = openDb(path.join(dir, "app.sqlite"));
  queue = new GenerationQueue(db);
  insertCase(db, CASE_A);
  api = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(req.url?.endsWith("/finalize") ? '{"recorded":1,"stub":true}' : '{"ok":true}');
  });
  await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
  port = (api.address() as AddressInfo).port;
});
afterEach(async () => {
  for (const c of children.splice(0)) if (c.exitCode === null) c.kill("SIGKILL");
  await new Promise<void>((r) => api.close(() => r()));
  db.$client.close();
  await new Promise((r) => setTimeout(r, 100));
  rmSync(dir, { recursive: true, force: true });
});

function spawnWorker(env: Record<string, string> = {}) {
  const child = spawn(process.execPath, ["--import", "tsx", "src/generation/worker-main.ts"], {
    cwd: serverDir, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, STATREEL_APP_DB: path.join(dir, "app.sqlite"), STATREEL_GEN_DATA: dir, GEN_MODE: "fake", STATREEL_PORT: String(port), STATREEL_GEN_WORKER: "on", STATREEL_GEN_ENABLED: "1", ...env },
  });
  children.push(child);
  let out = "";
  child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
  const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));
  return { child, output: () => out, exited };
}

describe("worker process", () => {
  it("a second worker exits because of the lease", async () => {
    const a = spawnWorker();
    await until(() => /generation worker ready/.test(a.output()), 30_000, 50);
    const b = spawnWorker();
    expect(await b.exited).toBe(0);
    expect(b.output()).toMatch(new RegExp(`already running \\(pid ${a.child.pid}\\)`));
    expect(a.child.exitCode).toBeNull(); // the first one is untouched
  }, 60_000);

  it("a fake-mode job runs queued -> running -> done through the real process", async () => {
    const a = spawnWorker({ GEN_FAKE_DELAY_MS: "100" });
    await until(() => /generation worker ready/.test(a.output()), 30_000, 50);
    const j = queue.enqueue({ type: "visual_options", case_id: CASE_A }).job;
    await until(() => queue.get(j.id)?.status === "done", 30_000, 50);
    expect(queue.events(j.id).map((e) => e.type)).toEqual(expect.arrayContaining(["queued", "started", "progress", "done"]));
    expect(JSON.parse(queue.get(j.id)?.result_json as string).outputs).toContain("out/variants/v3.props.json");
  }, 60_000);

  it("kill + restart re-queues the running job (attempts left), which then completes", async () => {
    const a = spawnWorker({ GEN_FAKE_DELAY_MS: "600000" });
    await until(() => /generation worker ready/.test(a.output()), 30_000, 50);
    const j = queue.enqueue({ type: "visual_options", case_id: CASE_A }).job;
    await until(() => queue.get(j.id)?.phase === "run", 30_000, 50);
    a.child.kill("SIGKILL");
    await a.exited;
    expect(queue.get(j.id)?.status).toBe("running"); // the dead worker left it running
    const b = spawnWorker({ GEN_FAKE_DELAY_MS: "100" });
    await until(() => /generation worker ready/.test(b.output()), 30_000, 50);
    expect(b.output()).toMatch(/requeued=1/);
    await until(() => queue.get(j.id)?.status === "done", 30_000, 50);
    expect(queue.get(j.id)?.attempts).toBe(2);
    expect(queue.events(j.id).some((e) => e.type === "queued" && e.data.requeued === true)).toBe(true);
  }, 90_000);

  it("kill + restart fails the job as interrupted when attempts are used up", async () => {
    const a = spawnWorker({ GEN_FAKE_DELAY_MS: "600000" });
    await until(() => /generation worker ready/.test(a.output()), 30_000, 50);
    const j = queue.enqueue({ type: "visual_options", case_id: CASE_A }).job;
    db.$client.prepare("update generation_jobs set max_attempts = 1 where id = ?").run(j.id);
    await until(() => queue.get(j.id)?.phase === "run", 30_000, 50);
    a.child.kill("SIGKILL");
    await a.exited;
    const b = spawnWorker();
    await until(() => /generation worker ready/.test(b.output()), 30_000, 50);
    expect(queue.get(j.id)).toMatchObject({ status: "failed", error_kind: "interrupted" });
  }, 90_000);

  it("STATREEL_GEN_WORKER=off idles without taking the lease", async () => {
    const a = spawnWorker({ STATREEL_GEN_WORKER: "off" });
    await until(() => /generation worker is off/.test(a.output()), 30_000, 50);
    expect(db.$client.prepare("select count(*) n from worker_lease").get()).toEqual({ n: 0 });
  }, 60_000);
});
