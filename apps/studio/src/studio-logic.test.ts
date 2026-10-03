import { describe, expect, it } from "vitest";
import { canCancelJob, canSchedule, cps, draftSpans, peakCueCps, rulerTicks, sceneSpans, spanAt, spanLabel } from "./studio-logic";

const scenes = [
  { id: "hook", kind: "hook" },
  { id: "reveal", kind: "reveal" },
  { id: "close", kind: "close" },
];

describe("scene spans", () => {
  it("splits a draft evenly and says it is not measured", () => {
    const s = draftSpans(scenes, 60);
    expect(s.map((x) => [x.start, x.end])).toEqual([
      [0, 20],
      [20, 40],
      [40, 60],
    ]);
    expect(s.every((x) => !x.measured)).toBe(true);
    expect(draftSpans(scenes, 0)).toEqual([]);
    expect(draftSpans([], 60)).toEqual([]);
  });
  it("uses measured timing when present, in time order", () => {
    const timing = {
      duration_s: 30,
      scenes: [
        { scene_id: "reveal", start_s: 10, end_s: 22 },
        { scene_id: "hook", start_s: 0, end_s: 10 },
        { scene_id: "close", start_s: 22, end_s: 30 },
      ],
    };
    const s = sceneSpans(scenes, timing, 99);
    expect(s.map((x) => x.id)).toEqual(["hook", "reveal", "close"]);
    expect(s.every((x) => x.measured)).toBe(true);
    expect(spanAt(s, 12)?.id).toBe("reveal");
    expect(spanAt(s, 30)?.id).toBe("close");
    expect(spanAt([], 3)).toBeNull();
  });
});

describe("cps and labels", () => {
  it("counts characters per second, null without duration", () => {
    expect(cps("abcd efgh", 0, 3)).toBeCloseTo(3);
    expect(cps("x", 2, 2)).toBeNull();
  });
  it("takes the peak cue cps inside a scene window", () => {
    const cues = [
      { lines: ["aaaa"], start_s: 0, end_s: 1 },
      { lines: ["bbbbbbbb"], start_s: 1, end_s: 2 },
      { lines: ["cc"], start_s: 5, end_s: 6 },
    ];
    expect(peakCueCps(cues, 0, 4)).toBe(8);
    expect(peakCueCps(cues, 10, 12)).toBeNull();
  });
  it("labels ranges and ticks the ruler", () => {
    expect(spanLabel(0, 6.62)).toBe("0:00.0–0:06.6");
    expect(spanLabel(61.25, 75)).toBe("1:01.3–1:15.0");
    expect(rulerTicks(12)).toEqual([0, 5, 10]);
    expect(rulerTicks(120).slice(0, 3)).toEqual([0, 10, 20]);
    expect(rulerTicks(0)).toEqual([]);
  });
  it("offers scheduling only when the gate allows and nothing runs", () => {
    expect(canSchedule({ allow: true }, false)).toBe(true);
    expect(canSchedule({ allow: true }, true)).toBe(false);
    expect(canSchedule({ allow: false }, false)).toBe(false);
    expect(canSchedule(null, false)).toBe(false);
  });
});

describe("canCancelJob", () => {
  it("offers Cancel only while the job is queued or running", () => {
    expect(canCancelJob({ status: "queued" })).toBe(true);
    expect(canCancelJob({ status: "running" })).toBe(true);
    for (const st of ["succeeded", "failed", "cancelled", "refused"]) expect(canCancelJob({ status: st })).toBe(false);
    expect(canCancelJob(null)).toBe(false);
  });
});
