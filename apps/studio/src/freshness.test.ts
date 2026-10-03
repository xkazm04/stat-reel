import { describe, expect, it, vi } from "vitest";
import { HIDDEN_REFRESH_MS, installFreshness, shouldRefreshOnVisible } from "./freshness";

describe("shouldRefreshOnVisible", () => {
  it("refreshes only after a long enough hidden spell", () => {
    expect(shouldRefreshOnVisible(null, 1_000_000)).toBe(false);
    expect(shouldRefreshOnVisible(1_000, 1_000 + HIDDEN_REFRESH_MS - 1)).toBe(false);
    expect(shouldRefreshOnVisible(1_000, 1_000 + HIDDEN_REFRESH_MS)).toBe(true);
    expect(shouldRefreshOnVisible(0, 5_000, 1_000)).toBe(true);
  });
});

function harness() {
  const listeners = new Map<string, Set<() => void>>();
  const mk = () => ({
    addEventListener: (t: string, f: () => void) => void (listeners.get(t) ?? listeners.set(t, new Set()).get(t))?.add(f),
    removeEventListener: (t: string, f: () => void) => void listeners.get(t)?.delete(f),
  });
  const doc = { visibilityState: "visible" as DocumentVisibilityState, ...mk() };
  const win = mk();
  let now = 0;
  const qc = { invalidateQueries: vi.fn(() => Promise.resolve()) };
  const off = installFreshness(qc, doc as never, win as never, () => now);
  const fire = (t: string) => {
    for (const f of listeners.get(t) ?? []) f();
  };
  const tick = (ms: number) => {
    now += ms;
  };
  return { doc, qc, off, fire, tick, listeners };
}

describe("installFreshness", () => {
  it("invalidates active queries when the tab returns after a long hide", () => {
    const h = harness();
    h.doc.visibilityState = "hidden";
    h.fire("visibilitychange");
    h.tick(HIDDEN_REFRESH_MS + 1);
    h.doc.visibilityState = "visible";
    h.fire("visibilitychange");
    expect(h.qc.invalidateQueries).toHaveBeenCalledWith({ refetchType: "active" });
  });
  it("ignores a short blur and repeated hidden events", () => {
    const h = harness();
    h.doc.visibilityState = "hidden";
    h.fire("visibilitychange");
    h.tick(10_000);
    h.fire("visibilitychange"); // still hidden: must not restart the clock
    h.tick(5_000);
    h.doc.visibilityState = "visible";
    h.fire("visibilitychange");
    expect(h.qc.invalidateQueries).not.toHaveBeenCalled();
  });
  it("counts from the first hidden event, not the last", () => {
    const h = harness();
    h.doc.visibilityState = "hidden";
    h.fire("visibilitychange");
    h.tick(20_000);
    h.fire("visibilitychange");
    h.tick(20_000);
    h.doc.visibilityState = "visible";
    h.fire("visibilitychange");
    expect(h.qc.invalidateQueries).toHaveBeenCalledTimes(1);
  });
  it("invalidates on online, and the cleanup detaches both listeners", () => {
    const h = harness();
    h.fire("online");
    expect(h.qc.invalidateQueries).toHaveBeenCalledTimes(1);
    h.off();
    h.fire("online");
    expect(h.qc.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(h.listeners.get("visibilitychange")?.size).toBe(0);
  });
});
