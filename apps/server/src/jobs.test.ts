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

  it("records the cancel cause: owner by default, shutdown from shutdown()", async () => {
    const { runner } = setup();
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
    expect(runner.get(b)).toMatchObject({ status: "cancelled", error: "cancelled (cause: shutdown)" });
    // nothing starts after shutdown; the row stays queued for the next process
    const c = runner.enqueue("render", {});
    await tick();
    expect(runner.get(c)?.status).toBe("queued");
  });

  it("shutdown gives up on a handler that ignores its signal", async () => {
    const { runner } = setup();
    runner.register("render", () => new Promise(() => {}));
    runner.enqueue("render", {});
    await tick();
    expect(await runner.shutdown(20)).toEqual({ aborted: 1, timedOut: true });
  });
});
