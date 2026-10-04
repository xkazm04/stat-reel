import { describe, expect, it, vi } from "vitest";
import { openDb } from "./db";
import { EventBus } from "./events";
import { JobRunner, Refusal } from "./jobs";

const setup = () => {
  const db = openDb(":memory:");
  const bus = new EventBus();
  const runner = new JobRunner(db, bus);
  return { db, bus, runner };
};

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe("JobRunner", () => {
  it("runs one job of a kind at a time and queues the rest", async () => {
    const { runner } = setup();
    let active = 0;
    let maxActive = 0;
    runner.register("render", async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await tick(20);
      active--;
      return { ok: true };
    });
    const ids = [runner.enqueue("render", {}), runner.enqueue("render", {}), runner.enqueue("render", {})];
    await runner.idle();
    expect(maxActive).toBe(1);
    expect(ids.map((id) => runner.get(id)?.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
  });

  it("runs different kinds concurrently", async () => {
    const { runner } = setup();
    const running = new Set<string>();
    let overlap = false;
    const slow = (k: string) => async () => {
      running.add(k);
      if (running.size > 1) overlap = true;
      await tick(20);
      running.delete(k);
      return {};
    };
    runner.register("render", slow("render"));
    runner.register("llm", slow("llm"));
    runner.enqueue("render", {});
    runner.enqueue("llm", {});
    await runner.idle();
    expect(overlap).toBe(true);
  });

  it("cancels a running job through its AbortSignal", async () => {
    const { runner } = setup();
    runner.register("render", async (_p, ctx) => {
      await new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("aborted"))));
      return {};
    });
    const id = runner.enqueue("render", {});
    await tick();
    runner.cancel(id);
    await runner.idle();
    expect(runner.get(id)?.status).toBe("cancelled");
  });

  it("records a refusal as its own labelled state, not a failure or an empty success", async () => {
    const { runner } = setup();
    runner.register("audio", async () => {
      throw new Refusal("elevenlabs", "content policy");
    });
    const id = runner.enqueue("audio", {});
    await runner.idle();
    const job = runner.get(id)!;
    expect(job.status).toBe("refused");
    expect(job.error).toContain("elevenlabs");
  });

  it("streams progress over the event bus", async () => {
    const { runner, bus } = setup();
    const seen: number[] = [];
    bus.subscribe((e) => e.type === "job.progress" && seen.push(e.progress as number));
    runner.register("render", async (_p, ctx) => {
      ctx.progress(0.5);
      ctx.progress(1);
      return {};
    });
    runner.enqueue("render", {});
    await runner.idle();
    expect(seen).toEqual([0.5, 1]);
  });

  it("resumes: a job left running by a crashed process is re-queued on start", async () => {
    const { db } = setup();
    const first = new JobRunner(db, new EventBus());
    first.register("render", () => new Promise(() => {})); // never finishes (process "dies")
    const id = first.enqueue("render", { project: "p1" });
    await tick();
    expect(first.get(id)?.status).toBe("running");

    const second = new JobRunner(db, new EventBus());
    let resumedWith: unknown;
    second.register("render", async (params) => {
      resumedWith = params;
      return {};
    });
    second.resume();
    await second.idle();
    expect(second.get(id)?.status).toBe("succeeded");
    expect(resumedWith).toEqual({ project: "p1" });
  });

  it("a kind registered after resume() (main.ts registers gen_render late) still runs its re-queued rows", async () => {
    const { db } = setup();
    const first = new JobRunner(db, new EventBus());
    first.register("gen_render", () => new Promise(() => {}), { lane: "render" }); // the process "dies" mid-render
    const id = first.enqueue("gen_render", { generation_job_id: "g1" });
    await tick();
    expect(first.get(id)?.status).toBe("running");

    const second = new JobRunner(db, new EventBus());
    second.register("render", async () => ({}));
    second.resume();
    second.register("gen_render", async () => ({ stills: ["a.png"] }), { lane: "render" });
    await vi.waitFor(() => expect(second.get(id)?.status).toBe("succeeded"), { timeout: 500 });
  });

  it("registering before resume() starts nothing: resume() runs the startup sweeps first", async () => {
    const { db } = setup();
    db.$client.prepare("insert into jobs (id, kind, status, params_json, created_at) values ('q1', 'render', 'queued', '{}', ?)").run(new Date().toISOString());
    const runner = new JobRunner(db, new EventBus());
    const order: string[] = [];
    runner.onStartup(() => order.push("sweep"));
    runner.register("render", async () => {
      order.push("job");
      return {};
    });
    await tick();
    expect(order).toEqual([]);
    runner.resume();
    await runner.idle();
    expect(order).toEqual(["sweep", "job"]);
  });

  it("runs startup sweeps before re-queuing, and a throwing sweep does not block the resume", async () => {
    const { db } = setup();
    const first = new JobRunner(db, new EventBus());
    first.register("render", () => new Promise(() => {}));
    const id = first.enqueue("render", {});
    await tick();

    const order: string[] = [];
    const second = new JobRunner(db, new EventBus());
    second.register("render", async () => {
      order.push("job");
      return {};
    });
    second.onStartup(() => {
      order.push("sweep-1");
      throw new Error("disk gone");
    });
    second.onStartup(() => order.push("sweep-2"));
    second.resume();
    await second.idle();
    expect(order).toEqual(["sweep-1", "sweep-2", "job"]);
    expect(second.get(id)?.status).toBe("succeeded");
  });

  it("a throwing bus listener neither breaks emit nor the job's completion", async () => {
    const { runner, bus } = setup();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    bus.subscribe(() => {
      throw new Error("listener bug");
    });
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(e.type));
    runner.register("render", async () => ({ ok: true }));
    const id = runner.enqueue("render", {});
    await runner.idle();
    expect(runner.get(id)?.status).toBe("succeeded");
    expect(seen).toContain("job.succeeded");
    expect(bus.dropped).toBeGreaterThan(0);
    log.mockRestore();
  });

  it("records the cancel cause (owner) and re-queues jobs interrupted by shutdown", async () => {
    const { runner, db } = setup();
    const hang = async (_p: unknown, ctx: { signal: AbortSignal }) => {
      await new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("aborted"))));
      return {};
    };
    runner.register("render", hang);
    const a = runner.enqueue("render", {});
    const queued = runner.enqueue("render", {});
    await tick();
    runner.cancel(queued);
    runner.cancel(a);
    await runner.idle();
    expect(runner.get(a)).toMatchObject({ status: "cancelled", error: "cancelled (cause: owner)" });
    expect(runner.get(queued)?.error).toContain("cause: owner");

    const b = runner.enqueue("render", {});
    await tick();
    const res = await runner.shutdown(1000);
    expect(res).toEqual({ aborted: 1, timedOut: false });
    expect(runner.get(b)).toMatchObject({ status: "queued", error: "interrupted by shutdown", progress: 0, started_at: null });
    // nothing starts after shutdown; the row stays queued for the next process
    const c = runner.enqueue("render", {});
    await tick();
    expect(runner.get(c)?.status).toBe("queued");
    // the next process resumes both interrupted and never-started rows
    const next = new JobRunner(db, new EventBus());
    next.register("render", async () => ({ ok: true }));
    next.resume();
    await next.idle();
    expect([b, c].map((id) => next.get(id)?.status)).toEqual(["succeeded", "succeeded"]);
  });

  it("shutdown gives up on a handler that ignores its signal", async () => {
    const { runner } = setup();
    runner.register("render", () => new Promise(() => {}));
    runner.enqueue("render", {});
    await tick();
    expect(await runner.shutdown(20)).toEqual({ aborted: 1, timedOut: true });
  });

  it("pump starts the oldest queued job across the kinds of a lane (no starvation)", async () => {
    const { runner } = setup();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    runner.register("render", async (p) => { order.push(`render${p.n}`); await gate; return {}; });
    runner.register("gen_render", async (p) => { order.push(`gen${p.n}`); await gate; return {}; }, { lane: "render" });
    runner.enqueue("render", { n: 0 }); // takes the slot
    runner.enqueue("render", { n: 1 });
    runner.enqueue("render", { n: 2 });
    runner.enqueue("gen_render", { n: 3 });
    await tick(3);
    release();
    await runner.idle();
    expect(order).toEqual(["render0", "render1", "render2", "gen3"]);
  });

  it("pump alternates kinds by age: a gen_render queued before a later render goes first", async () => {
    const { runner, db } = setup();
    const order: string[] = [];
    runner.register("render", async (p) => { order.push(`render${p.n}`); return {}; });
    runner.register("gen_render", async (p) => { order.push(`gen${p.n}`); return {}; }, { lane: "render" });
    const ins = (id: string, kind: string, at: string, n: number) =>
      db.$client.prepare("insert into jobs (id, kind, status, params_json, created_at) values (?, ?, 'queued', ?, ?)").run(id, kind, JSON.stringify({ n }), at);
    ins("a", "render", "2026-01-01T00:00:03Z", 3);
    ins("b", "gen_render", "2026-01-01T00:00:01Z", 1);
    ins("c", "render", "2026-01-01T00:00:02Z", 2);
    runner.resume();
    await runner.idle();
    expect(order).toEqual(["gen1", "render2", "render3"]);
  });

  it("list pushes ORDER BY / LIMIT into SQL and keeps the old signature", () => {
    const { runner } = setup();
    runner.register("render", async () => ({}));
    const ids = [1, 2, 3].map((n) => runner.enqueue("render", { n }, n === 3 ? "p2" : "p1"));
    expect(runner.list()).toHaveLength(3);
    expect(runner.list(undefined, 2)).toHaveLength(2);
    expect(runner.list("p1").map((j) => j.id).sort()).toEqual([ids[0], ids[1]].sort());
    expect(runner.list("p1", 1)).toHaveLength(1);
  });

  it("prune removes only old terminal rows", () => {
    const { runner, db } = setup();
    const old = "2020-01-01T00:00:00Z";
    const ins = (id: string, status: string, finished: string | null) =>
      db.$client.prepare("insert into jobs (id, kind, status, params_json, created_at, finished_at) values (?, 'render', ?, '{}', ?, ?)").run(id, status, old, finished);
    ins("old-ok", "succeeded", old);
    ins("old-failed", "failed", old);
    ins("old-queued", "queued", null);
    ins("old-running", "running", null);
    ins("fresh", "succeeded", new Date().toISOString());
    expect(runner.prune(30)).toBe(2);
    expect(runner.list().map((j) => j.id).sort()).toEqual(["fresh", "old-queued", "old-running"]);
  });

  it("the list / pump / project queries use the jobs indexes", () => {
    const { db } = setup();
    const plan = (sql: string) => (db.$client.prepare(`explain query plan ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join(" | ");
    expect(plan("select * from jobs where project_id = 'p' order by created_at desc")).toContain("jobs_project_created");
    expect(plan("select * from jobs where status = 'queued' and kind in ('a','b') order by created_at, rowid limit 1")).toContain("jobs_status_kind_created");
  });
});
