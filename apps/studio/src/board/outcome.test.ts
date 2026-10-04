import { describe, expect, it } from "vitest";
import { acceptOutcome, isRunningConflict } from "./outcome";

describe("acceptOutcome", () => {
  it("names a queued video and carries the job", () => {
    const o = acceptOutcome({ job: { id: "gj-1", type: "generate_video" } }, "Race");
    expect(o).toEqual({ message: "Accepted · video queued · Race", jobId: "gj-1", blocked: false });
  });
  it("names queued visuals for a case accept", () => {
    expect(acceptOutcome({ job: { id: "gj-2", type: "visual_options" } }, "Idea").message).toBe(
      "Accepted · visuals queued · Idea",
    );
  });
  it("falls back to a neutral word for an unknown job type", () => {
    expect(acceptOutcome({ job: { id: "gj-3" } }, "X").message).toBe("Accepted · generation queued · X");
  });
  it("says why the data gate refused, with no job to wait for", () => {
    const o = acceptOutcome({ gate: { ok: false, reason: "no staged source" } }, "Race");
    expect(o).toEqual({ message: "Accepted · data blocked: no staged source · Race", jobId: null, blocked: true });
  });
  it("still says blocked when the gate gives no reason", () => {
    expect(acceptOutcome({ gate: { ok: false } }, "R").message).toBe("Accepted · data blocked · R");
  });
  it("a passing gate with no job is just Accepted", () => {
    expect(acceptOutcome({ gate: { ok: true } }, "R")).toEqual({
      message: "Accepted · R",
      jobId: null,
      blocked: false,
    });
  });
});

describe("isRunningConflict", () => {
  it("is true only for a 409", () => {
    expect(isRunningConflict({ status: 409 })).toBe(true);
    expect(isRunningConflict({ status: 500 })).toBe(false);
    expect(isRunningConflict(new Error("x"))).toBe(false);
    expect(isRunningConflict(null)).toBe(false);
  });
});
