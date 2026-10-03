import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createUndoStore,
  expire,
  latest,
  nextExpiry,
  pop,
  push,
  removeEntry,
  UNDO_CAP,
  UNDO_MS,
  type UndoEntry,
} from "./undo-store";

const entry = (id: number, at = 0): UndoEntry => ({ id, message: `m${id}`, at, run: async () => {} });

describe("undo stack (pure)", () => {
  it("push keeps newest last and caps the stack, dropping the oldest", () => {
    let s: UndoEntry[] = [];
    for (let i = 1; i <= UNDO_CAP + 3; i++) s = push(s, entry(i));
    expect(s).toHaveLength(UNDO_CAP);
    expect(s[0]?.id).toBe(4);
    expect(latest(s)?.id).toBe(UNDO_CAP + 3);
    expect(push([entry(1), entry(2)], entry(3), 2).map((e) => e.id)).toEqual([2, 3]);
  });
  it("pop returns the latest and the rest", () => {
    const [top, rest] = pop([entry(1), entry(2)]);
    expect(top?.id).toBe(2);
    expect(rest.map((e) => e.id)).toEqual([1]);
    expect(pop([])).toEqual([null, []]);
  });
  it("removeEntry drops one by id", () => {
    expect(removeEntry([entry(1), entry(2), entry(3)], 2).map((e) => e.id)).toEqual([1, 3]);
  });
  it("expire drops entries older than the ttl", () => {
    const s = [entry(1, 0), entry(2, 5000), entry(3, 9000)];
    expect(expire(s, UNDO_MS, UNDO_MS).map((e) => e.id)).toEqual([2, 3]);
    expect(expire(s, 20_000, UNDO_MS)).toEqual([]);
  });
  it("nextExpiry is the remaining time of the oldest entry", () => {
    expect(nextExpiry([], 0)).toBeNull();
    expect(nextExpiry([entry(1, 1000), entry(2, 4000)], 3000, UNDO_MS)).toBe(8000);
    expect(nextExpiry([entry(1, 0)], 99_999, UNDO_MS)).toBe(0);
  });
});

describe("undo store", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const clock = { t: 0 };
  const make = () => {
    clock.t = 0;
    return createUndoStore({ now: () => clock.t, describeError: (e) => (e as Error).message });
  };

  it("keeps earlier entries when a new one arrives and undoes newest first", async () => {
    const s = make();
    const done: string[] = [];
    s.show("one", async () => void done.push("one"));
    s.show("two", async () => void done.push("two"));
    expect(s.getState().stack).toHaveLength(2);
    expect(await s.undoLatest()).toBe(true);
    expect(await s.undoLatest()).toBe(true);
    expect(done).toEqual(["two", "one"]);
    expect(s.getState().stack).toEqual([]);
    expect(await s.undoLatest()).toBe(false);
  });
  it("a refused undo (409) keeps the entry and says why", async () => {
    const s = make();
    let refuse = true;
    s.show("Rejected · style · A", async () => {
      if (refuse) throw new Error("generation running");
    });
    expect(await s.undoLatest()).toBe(false);
    expect(s.getState().stack).toHaveLength(1);
    expect(s.getState().notice).toBe("Could not undo: generation running");
    refuse = false;
    expect(await s.undoLatest()).toBe(true);
    expect(s.getState().notice).toBeNull();
  });
  it("ignores a second undo while one is in flight", async () => {
    const s = make();
    let release = () => {};
    s.show(
      "slow",
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    const first = s.undoLatest();
    expect(await s.undoLatest()).toBe(false);
    release();
    expect(await first).toBe(true);
  });
  it("entries expire on their own", () => {
    const s = make();
    s.show("old", async () => {});
    clock.t = UNDO_MS - 1;
    s.show("new", async () => {});
    clock.t = UNDO_MS + 5;
    vi.advanceTimersByTime(UNDO_MS + 5);
    expect(s.getState().stack.map((e) => e.message)).toEqual(["new"]);
  });
  it("caps at UNDO_CAP and the live-region text changes on every event", () => {
    const s = make();
    for (let i = 0; i < UNDO_CAP + 2; i++) s.show("same", async () => {});
    expect(s.getState().stack).toHaveLength(UNDO_CAP);
    const before = s.getState().said;
    s.show("same", async () => {});
    expect(s.getState().said).not.toBe(before);
  });
  it("reset drops everything", () => {
    const s = make();
    s.show("x", async () => {});
    s.reset();
    expect(s.getState()).toMatchObject({ stack: [], notice: null, said: "" });
  });
});
