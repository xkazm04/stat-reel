import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { GenerationQueue } from "./generation/queue";
import { queueGuard } from "./generation-guard";

describe("queueGuard (Board undo over the real queue)", () => {
  const setup = () => {
    const queue = new GenerationQueue(openDb(":memory:"));
    return { queue, guard: queueGuard(queue) };
  };
  it("a running job blocks undo for its case and its item, and nothing else", () => {
    const { queue, guard } = setup();
    queue.enqueue({ type: "generate_video", case_id: "ci-aaaaaaaa", board_item_id: "bd-bbbbbbbb" });
    expect(guard.hasRunning({ kind: "case", id: "ci-aaaaaaaa" })).toBe(false); // queued, not running
    queue.claim();
    expect(guard.hasRunning({ kind: "case", id: "ci-aaaaaaaa" })).toBe(true);
    expect(guard.hasRunning({ kind: "item", id: "bd-bbbbbbbb" })).toBe(true);
    expect(guard.hasRunning({ kind: "case", id: "ci-cccccccc" })).toBe(false);
  });
  it("cancelQueued cancels only the target's queued jobs", () => {
    const { queue, guard } = setup();
    const a = queue.enqueue({ type: "visual_options", case_id: "ci-aaaaaaaa" }).job;
    const b = queue.enqueue({ type: "visual_options", case_id: "ci-dddddddd" }).job;
    expect(guard.cancelQueued({ kind: "case", id: "ci-aaaaaaaa" })).toBe(1);
    expect(queue.get(a.id)?.status).toBe("cancelled");
    expect(queue.get(b.id)?.status).toBe("queued");
  });
});
