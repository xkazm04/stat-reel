import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tailLog } from "./logtail";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A log endpoint: `chunks` are returned in order (then empty reads), `status` is what the job query says now. */
function fake(chunks: string[]) {
  let i = 0;
  const reads: number[] = [];
  const read = vi.fn(async (offset: number) => {
    reads.push(offset);
    const text = chunks[i++] ?? "";
    return { text, next: offset + text.length };
  });
  return { read, reads };
}

describe("tailLog", () => {
  it("keeps reading while the job is live", async () => {
    const f = fake(["a", "", ""]);
    const stop = tailLog({ read: f.read, status: () => "running", onText: () => {}, every: 2000 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.read.mock.calls.length).toBeGreaterThanOrEqual(5);
    stop();
  });

  it("stops once the job is over and a read comes back empty (the log is read to its end)", async () => {
    const f = fake(["head", "tail"]);
    let text = "";
    const stop = tailLog({ read: f.read, status: () => "done", onText: (t) => (text += t), every: 2000 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(text).toBe("headtail");
    expect(f.read).toHaveBeenCalledTimes(3); // head, tail, the empty read that proves the end
    stop();
  });

  it("an unknown status (job not loaded yet) is not the end", async () => {
    const f = fake([]);
    const stop = tailLog({ read: f.read, status: () => undefined, onText: () => {}, every: 2000 });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(f.read.mock.calls.length).toBeGreaterThanOrEqual(3);
    stop();
  });

  it("stop() ends the loop", async () => {
    const f = fake([]);
    const stop = tailLog({ read: f.read, status: () => "running", onText: () => {}, every: 2000 });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    const n = f.read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.read.mock.calls.length).toBe(n);
  });
});
