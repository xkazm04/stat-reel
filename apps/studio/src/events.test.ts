import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { type ConnectionState, watchConnection } from "./events";

/** Just enough of EventSource: listeners, a readyState the test sets, and the CLOSED constant. */
class FakeEventSource {
  CLOSED = 2;
  readyState = 0;
  private fns = new Map<string, Set<() => void>>();
  addEventListener(t: string, f: () => void) {
    if (!this.fns.has(t)) this.fns.set(t, new Set());
    this.fns.get(t)?.add(f);
  }
  removeEventListener(t: string, f: () => void) {
    this.fns.get(t)?.delete(f);
  }
  fire(t: string) {
    for (const f of this.fns.get(t) ?? []) f();
  }
}

function setup() {
  const es = new FakeEventSource();
  const qc = new QueryClient();
  const inv = vi.spyOn(qc, "invalidateQueries");
  const states: ConnectionState[] = [];
  const off = watchConnection(es as unknown as EventSource, qc, (s) => states.push(s));
  return { es, inv, states, off };
}

describe("watchConnection", () => {
  it("does not invalidate on the first open", () => {
    const { es, inv, states } = setup();
    es.fire("open");
    expect(states).toEqual(["open"]);
    expect(inv).not.toHaveBeenCalled();
  });

  it("invalidates active queries once when the stream reopens after an error", () => {
    const { es, inv, states } = setup();
    es.fire("open");
    es.fire("error");
    expect(states.at(-1)).toBe("connecting");
    es.fire("open");
    expect(inv).toHaveBeenCalledTimes(1);
    expect(inv).toHaveBeenCalledWith({ refetchType: "active" });
    es.fire("open");
    expect(inv).toHaveBeenCalledTimes(1);
  });

  it("a flapping connection invalidates once per successful reopen, not per error", () => {
    const { es, inv } = setup();
    es.fire("open");
    es.fire("error");
    es.fire("error");
    es.fire("error");
    expect(inv).not.toHaveBeenCalled();
    es.fire("open");
    expect(inv).toHaveBeenCalledTimes(1);
    es.fire("error");
    es.fire("open");
    expect(inv).toHaveBeenCalledTimes(2);
  });

  it("reports a closed stream and stops after detach", () => {
    const { es, inv, states, off } = setup();
    es.readyState = 2;
    es.fire("error");
    expect(states).toEqual(["closed"]);
    off();
    es.fire("open");
    expect(inv).not.toHaveBeenCalled();
  });
});
