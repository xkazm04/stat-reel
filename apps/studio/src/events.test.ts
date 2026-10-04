import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { type ConnectionState, keepConnected, reopenDelay, watchConnection } from "./events";

/** Just enough of EventSource: listeners, a readyState the test sets, and the CLOSED constant. */
class FakeEventSource {
  CLOSED = 2;
  readyState = 0;
  closed = false;
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  listeners() {
    let n = 0;
    for (const s of this.fns.values()) n += s.size;
    return n;
  }
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

  it("a stream opened to replace a lost one refetches on its first open", () => {
    const es = new FakeEventSource();
    const qc = new QueryClient();
    const inv = vi.spyOn(qc, "invalidateQueries");
    watchConnection(es as unknown as EventSource, qc, () => {}, true);
    es.fire("open");
    expect(inv).toHaveBeenCalledTimes(1);
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

/** A stream factory and a manual clock: each create() hands out a new fake; due timers run on advance(). */
function keeper() {
  const made: FakeEventSource[] = [];
  const qc = new QueryClient();
  const inv = vi.spyOn(qc, "invalidateQueries");
  const states: ConnectionState[] = [];
  const delays: number[] = [];
  let pending: { fn: () => void; at: number } | null = null;
  let now = 0;
  const stop = keepConnected(
    () => {
      const es = new FakeEventSource();
      made.push(es);
      return es as unknown as EventSource;
    },
    qc,
    (s) => states.push(s),
    (es) => {
      const f = () => {};
      es.addEventListener("job.queued", f);
      return () => es.removeEventListener("job.queued", f);
    },
    (fn, ms) => {
      delays.push(ms);
      pending = { fn, at: now + ms };
      return () => {
        pending = null;
      };
    },
  );
  const advance = (ms: number) => {
    now += ms;
    const p = pending;
    if (p && p.at <= now) {
      pending = null;
      p.fn();
    }
  };
  const giveUp = (es: FakeEventSource) => {
    es.readyState = 2;
    es.fire("error");
  };
  return { made, inv, states, delays, stop, advance, giveUp, hasPending: () => pending !== null };
}

describe("keepConnected", () => {
  it("replaces a stream the browser gave up on, and the replacement refetches once it opens", () => {
    const k = keeper();
    const first = k.made[0] as FakeEventSource;
    first.fire("open");
    k.giveUp(first);
    expect(k.states.at(-1)).toBe("closed");
    expect(first.closed).toBe(true);
    expect(first.listeners()).toBe(0);
    k.advance(reopenDelay(0));
    expect(k.made).toHaveLength(2);
    expect(k.states.at(-1)).toBe("connecting");
    (k.made[1] as FakeEventSource).fire("open");
    expect(k.states.at(-1)).toBe("open");
    expect(k.inv).toHaveBeenCalledTimes(1);
    expect(k.inv).toHaveBeenCalledWith({ refetchType: "active" });
  });

  it("backs off while the API stays down and starts over after an open", () => {
    const k = keeper();
    k.giveUp(k.made[0] as FakeEventSource);
    k.advance(1_000);
    k.giveUp(k.made[1] as FakeEventSource);
    k.advance(2_000);
    k.giveUp(k.made[2] as FakeEventSource);
    expect(k.delays).toEqual([1_000, 2_000, 4_000]);
    k.advance(4_000);
    (k.made[3] as FakeEventSource).fire("open");
    k.giveUp(k.made[3] as FakeEventSource);
    expect(k.delays.at(-1)).toBe(1_000);
    expect(reopenDelay(10)).toBe(30_000);
  });

  it("a stream the browser is still retrying is left to the browser", () => {
    const k = keeper();
    (k.made[0] as FakeEventSource).fire("error");
    expect(k.states).toEqual(["connecting"]);
    expect(k.hasPending()).toBe(false);
    expect(k.made).toHaveLength(1);
  });

  it("stop closes the live stream and cancels a pending reopen", () => {
    const k = keeper();
    k.giveUp(k.made[0] as FakeEventSource);
    expect(k.hasPending()).toBe(true);
    k.stop();
    expect(k.hasPending()).toBe(false);
    k.advance(60_000);
    expect(k.made).toHaveLength(1);
    const k2 = keeper();
    k2.stop();
    expect((k2.made[0] as FakeEventSource).closed).toBe(true);
    expect((k2.made[0] as FakeEventSource).listeners()).toBe(0);
  });
});
