import { describe, expect, it, vi } from "vitest";
import { makeShutdown, installProcessHandlers } from "./shutdown";

describe("shutdown", () => {
  it("stops, aborts jobs, then closes the db - once, even when called twice", async () => {
    const order: string[] = [];
    const sd = makeShutdown({
      stoppers: [() => order.push("stopper")],
      closeServer: async () => { order.push("server"); },
      stopJobs: async () => { order.push("jobs"); },
      closeDb: () => { order.push("db"); },
      log: () => {},
    });
    await Promise.all([sd(), sd()]);
    expect(order).toEqual(["stopper", "server", "jobs", "db"]);
  });

  it("a failing step is logged and does not skip the db close; SSE-held server close is bounded", async () => {
    const closeDb = vi.fn();
    const sd = makeShutdown({
      closeServer: () => new Promise(() => {}),
      stopJobs: async () => { throw new Error("boom"); },
      closeDb,
      log: () => {},
      serverGraceMs: 10,
    });
    await sd();
    expect(closeDb).toHaveBeenCalled();
  });

  it("unhandledRejection keeps serving; uncaughtException shuts down then exits 1; SIGTERM exits 0", async () => {
    const handlers = new Map<string, (...a: never[]) => void>();
    const exit = vi.fn();
    const shutdown = vi.fn(async () => {});
    installProcessHandlers(shutdown, { proc: { on: ((e: string, f: never) => { handlers.set(e, f); return process; }) as never }, exit, log: () => {} });
    (handlers.get("unhandledRejection") as (r: unknown) => void)(new Error("x"));
    expect(shutdown).not.toHaveBeenCalled();
    (handlers.get("uncaughtException") as (e: Error) => void)(new Error("y"));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    (handlers.get("SIGTERM") as () => void)();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });
  it("a second SIGINT/SIGTERM while the graceful stop is still running exits at once (non-zero)", async () => {
    const handlers = new Map<string, () => void>();
    const exit = vi.fn();
    const shutdown = vi.fn(() => new Promise<void>(() => {})); // a stop that hangs (a handler ignoring its signal)
    installProcessHandlers(shutdown, { proc: { on: ((e: string, f: never) => { handlers.set(e, f); return process; }) as never }, exit, log: () => {} });
    handlers.get("SIGINT")?.();
    await new Promise((r) => setTimeout(r, 5));
    expect(exit).not.toHaveBeenCalled();
    handlers.get("SIGINT")?.();
    expect(exit).toHaveBeenCalledWith(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
