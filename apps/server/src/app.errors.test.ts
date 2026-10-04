import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HTTPException } from "hono/http-exception";
import { type AppDeps, buildApp, mapError } from "./app";
import { EventBus, throttleProgress } from "./events";
import { FinalizeError } from "./generation/finalize";
import { QueueConflict } from "./generation/queue";
import { Refusal } from "./jobs";
import { StalePropsError } from "./projects";

// A route that throws whatever the test hands it, on an app built with only the deps the error paths touch.
function appThrowing(err: () => unknown, bus = new EventBus()) {
  const app = buildApp({
    bus,
    topics: {},
    projects: {
      list: () => {
        throw err();
      },
    },
    runner: { list: () => [] },
  } as unknown as AppDeps);
  return { app, bus };
}
// biome-ignore lint/suspicious/noExplicitAny: loosely typed JSON bodies in assertions
const body = async (r: Response) => (await r.json()) as Record<string, any>;

describe("app.onError / notFound", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  it("an unknown throw is a JSON 500 and the stack is logged", async () => {
    const { app } = appThrowing(() => new Error("kaboom"));
    const r = await app.request("/api/projects");
    expect(r.status).toBe(500);
    expect(r.headers.get("content-type")).toMatch(/json/);
    expect(await body(r)).toEqual({ error: "kaboom" });
    expect(String(spy.mock.calls[0]?.[0])).toContain("Error: kaboom");
  });

  it("maps the named errors to their status in the {error} shape", async () => {
    const stale = new StalePropsError(3, { issues: ["bad"] } as never);
    expect((await appThrowing(() => stale).app.request("/api/projects")).status).toBe(409);
    const conflict = await appThrowing(() => new QueueConflict("already queued")).app.request("/api/projects");
    expect(conflict.status).toBe(409);
    expect((await body(conflict)).error).toBe("already queued");
    const fin = await appThrowing(() => new FinalizeError("nope", 422)).app.request("/api/projects");
    expect(fin.status).toBe(422);
    expect((await appThrowing(() => new Refusal("claude", "policy")).app.request("/api/projects")).status).toBe(422);
    const http = await appThrowing(() => new HTTPException(403, { message: "forbidden" })).app.request("/api/projects");
    expect([http.status, (await body(http)).error]).toEqual([403, "forbidden"]);
  });

  it("a ZodError and bad JSON are 400, a database error is a logged 500", async () => {
    const { ZodError } = await import("zod");
    const z = new ZodError([{ code: "custom", path: ["target"], message: "required" }]);
    const r = await appThrowing(() => z).app.request("/api/projects");
    expect([r.status, (await body(r)).error]).toEqual([400, "target: required"]);
    expect(mapError(new SyntaxError("Unexpected token"), 500).status).toBe(400);
    const db = Object.assign(new Error("no such table"), { name: "SqliteError" });
    expect(mapError(db, 400).status).toBe(500);
    expect(mapError(new Error("bad input"), 400)).toEqual({ status: 400, body: { error: "bad input" } });
  });

  it("an unknown /api path is a JSON 404", async () => {
    const { app } = appThrowing(() => new Error("x"));
    const r = await app.request("/api/nope");
    expect([r.status, await body(r)]).toEqual([404, { error: "not found" }]);
  });
});

describe("throttleProgress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const progress = (id: string, p: number) => ({ type: "job.progress", id, progress: p });

  it("sends at most ~4/s per job and always delivers the last value", () => {
    const sent: number[] = [];
    const t = throttleProgress((e) => sent.push(e.progress as number), 250);
    for (let i = 1; i <= 10; i++) {
      t.push(progress("a", i / 10));
      vi.advanceTimersByTime(10);
    }
    expect(sent).toEqual([0.1]);
    vi.advanceTimersByTime(250);
    expect(sent).toEqual([0.1, 1]);
    t.dispose();
  });

  it("flushes a pending progress before the job's terminal event and keeps jobs independent", () => {
    const sent: string[] = [];
    const t = throttleProgress((e) => sent.push(`${e.type}:${e.id}:${e.progress ?? ""}`), 250);
    t.push(progress("a", 0.1));
    t.push(progress("b", 0.2));
    t.push(progress("a", 0.9));
    t.push({ type: "job.succeeded", id: "a" });
    expect(sent).toEqual(["job.progress:a:0.1", "job.progress:b:0.2", "job.progress:a:0.9", "job.succeeded:a:"]);
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(4);
    t.dispose();
  });
});

describe("/events", () => {
  it("unsubscribes the client when it goes away, so no listener leaks", async () => {
    const { app, bus } = appThrowing(() => new Error("x"));
    const ac = new AbortController();
    const res = await app.request("/events", { signal: ac.signal });
    const reader = res.body?.getReader();
    bus.emit({ type: "board.decided", id: "x" });
    const chunk = await reader?.read();
    expect(new TextDecoder().decode(chunk?.value)).toContain("board.decided");
    expect((bus as unknown as { listeners: Set<unknown> }).listeners.size).toBe(1);
    await reader?.cancel();
    await vi.waitFor(() => expect((bus as unknown as { listeners: Set<unknown> }).listeners.size).toBe(0));
  });
});

describe("HTTP doors validate like their tool twins", () => {
  // an app whose pipeline records what reached it
  function appWithPipeline() {
    const calls: unknown[][] = [];
    const app = buildApp({
      bus: new EventBus(),
      topics: {},
      runner: { list: () => [] },
      pipeline: {
        renderKeyframes: async (...a: unknown[]) => {
          calls.push(a);
          return { stills: [] };
        },
      },
    } as unknown as AppDeps);
    return { app, calls };
  }
  const post = (app: ReturnType<typeof appWithPipeline>["app"], body: unknown) =>
    app.request("/api/projects/p1/keyframes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("POST /keyframes refuses what render_keyframes refuses (over MAX_FRAMES, negative, missing) and never renders it", async () => {
    const { app, calls } = appWithPipeline();
    for (const bad of [{ frames_s: [0, 1, 2, 3, 4, 5, 6] }, { frames_s: [-1] }, {}, { frames_s: [] }]) {
      const r = await post(app, bad);
      expect(r.status).toBe(400);
      expect((await body(r)).error).toMatch(/frames_s/);
    }
    expect(calls).toEqual([]);
  });

  it("POST /keyframes passes a valid request through unchanged", async () => {
    const { app, calls } = appWithPipeline();
    const r = await post(app, { frames_s: [0, 4.5] });
    expect(r.status).toBe(200);
    expect(calls).toEqual([["p1", [0, 4.5]]]);
  });
});

describe("job lists are cut in SQL, not in JS", () => {
  it("GET /api/jobs and GET /api/projects pass their limit to runner.list (no full-table read per request)", async () => {
    const list = vi.fn((_p?: string, limit?: number) => Array.from({ length: limit ?? 60 }, (_, i) => ({ id: `j${i}` })));
    const app = buildApp({ bus: new EventBus(), topics: {}, runner: { list }, projects: { list: () => [{ id: "p1" }, { id: "p2" }] } } as unknown as AppDeps);
    expect((await body(await app.request("/api/jobs"))).jobs).toHaveLength(50);
    expect(list.mock.calls).toEqual([[undefined, 50]]);
    list.mockClear();
    const projects = (await body(await app.request("/api/projects"))).projects;
    expect(projects.map((p: { jobs: unknown[] }) => p.jobs.length)).toEqual([5, 5]);
    expect(list.mock.calls).toEqual([["p1", 5], ["p2", 5]]);
  });
});

describe("POST /api/projects reports through the shared error door", () => {
  const appCreating = (err: unknown) =>
    buildApp({ bus: new EventBus(), topics: {}, runner: { list: () => [] }, projects: { create: () => { throw err; } } } as unknown as AppDeps);
  const create = (app: ReturnType<typeof appCreating>) =>
    app.request("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });

  it("a database failure is a logged 500, bad input stays 400", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const db = await create(appCreating(Object.assign(new Error("database is locked"), { name: "SqliteError" })));
      expect([db.status, (await body(db)).error]).toEqual([500, "database error"]);
      expect(spy).toHaveBeenCalled();
      const bad = await create(appCreating(new Error("unknown use case x")));
      expect([bad.status, (await body(bad)).error]).toEqual([400, "unknown use case x"]);
    } finally {
      spy.mockRestore();
    }
  });
});
