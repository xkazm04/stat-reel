import { describe, expect, it } from "vitest";
import { canCancelJob, canSchedule, compositionLoadStatus, compositionLoadWanted, compositionState, cps, draftSpans, hasPlayer, peakCueCps, produceBlockReason, REUSED_RENDER_TEXT, reusedRenderOf, rulerTicks, sceneSpans, scheduleOffered, spanAt, spanLabel, verdictView } from "./studio-logic";

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

describe("compositionState", () => {
  it("not-built for any composition but EraAdjustedSlope, whatever the load status", () => {
    for (const load of ["loading", "ready", "missing"] as const) {
      expect(compositionState("BarRace", load)).toBe("not-built");
      expect(compositionState(null, load)).toBe("not-built");
    }
  });
  it("follows the load status for the built composition (undefined = default)", () => {
    expect(hasPlayer(undefined)).toBe(true);
    expect(compositionState(undefined, "loading")).toBe("loading");
    expect(compositionState("EraAdjustedSlope", "ready")).toBe("built");
    expect(compositionState("EraAdjustedSlope", "missing")).toBe("unavailable");
  });
  it("gives Produce a reason only when not built", () => {
    expect(produceBlockReason("not-built")).toMatch(/No player/);
    for (const s of ["built", "loading", "unavailable"] as const) expect(produceBlockReason(s)).toBeNull();
  });
});

describe("scheduleOffered", () => {
  it("needs an allowing gate, an idle project and no publication", () => {
    expect(scheduleOffered({ allow: true }, false, [])).toBe(true);
    expect(scheduleOffered({ allow: true }, true, [])).toBe(false);
    expect(scheduleOffered({ allow: true }, false, [{}])).toBe(false);
    expect(scheduleOffered({ allow: false }, false, [])).toBe(false);
    expect(scheduleOffered(null, false, [])).toBe(false);
  });
});

describe("verdictView", () => {
  it("is PENDING for the project gate while a produce runs", () => {
    expect(verdictView({ allow: true }, true)).toEqual({ word: "PENDING", status: null });
    expect(verdictView(null, true).word).toBe("PENDING");
  });
  it("keeps the verdict of a named render while a produce runs (the produce writes a new render)", () => {
    expect(verdictView({ allow: false }, true, true)).toEqual({ word: "DENY", status: "blocked" });
    expect(verdictView({ allow: true }, true, true)).toEqual({ word: "ALLOW", status: "go" });
  });
  it("says NO VERDICT without a policy and the plain verdict otherwise", () => {
    expect(verdictView(null, false).word).toBe("NO VERDICT");
    expect(verdictView({ allow: true }, false)).toEqual({ word: "ALLOW", status: "go" });
    expect(verdictView({ allow: false }, false, true)).toEqual({ word: "DENY", status: "blocked" });
  });
});

describe("compositionLoadWanted", () => {
  it("loads the composition chunk only once props exist and the use case has a player", () => {
    expect(compositionLoadWanted(false, "EraAdjustedSlope")).toBe(false);
    expect(compositionLoadWanted(false, undefined)).toBe(false);
    expect(compositionLoadWanted(true, "EraAdjustedSlope")).toBe(true);
    expect(compositionLoadWanted(true, undefined)).toBe(true);
    expect(compositionLoadWanted(true, "DataRace")).toBe(false);
  });
  it("reports ready, not a spinner, while nothing is wanted", () => {
    expect(compositionLoadStatus(false, "loading")).toBe("ready");
    expect(compositionLoadStatus(true, "loading")).toBe("loading");
    expect(compositionLoadStatus(true, "missing")).toBe("missing");
    expect(compositionState("EraAdjustedSlope", compositionLoadStatus(false, "loading"))).toBe("built");
  });
});

describe("reusedRenderOf", () => {
  const jobs = [
    { id: "fresh", result_json: JSON.stringify({ render_id: "r1", video: "x" }) },
    { id: "reuse", result_json: JSON.stringify({ render_id: "r2", reused: "r1", note: "reused render r1" }) },
    { id: "broken", result_json: "{nope" },
    { id: "none", result_json: null },
  ];
  it("names the render a produce reused", () => {
    expect(reusedRenderOf(jobs, { job_id: "reuse" })).toBe("r1");
  });
  it("is null for a fresh, unreadable, missing or unknown result", () => {
    expect(reusedRenderOf(jobs, { job_id: "fresh" })).toBeNull();
    expect(reusedRenderOf(jobs, { job_id: "broken" })).toBeNull();
    expect(reusedRenderOf(jobs, { job_id: "none" })).toBeNull();
    expect(reusedRenderOf(jobs, { job_id: "gone" })).toBeNull();
    expect(reusedRenderOf(jobs, null)).toBeNull();
  });
  it("has the sentence the screens show", () => {
    expect(REUSED_RENDER_TEXT).toBe("Reused the existing render (inputs unchanged)");
  });
});
