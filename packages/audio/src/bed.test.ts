import { describe, expect, it } from "vitest";
import { attachBedSources, type BedTimingPlan, bedLevelDbAt, planBedFromTimingPlan } from "./bed";
import { mixPlan } from "./mix";

const FPS = 30;
/** hook 3 s; ending = 60 + 60 + 90 frames */
function plan(totalS: number, eventFrames: number[]): BedTimingPlan {
  const total = totalS * FPS;
  const like_end = total - 90;
  const spotlight_end = like_end - 60;
  const timeline_end = spotlight_end - 60;
  return {
    sections: { hook_end: 90, timeline_end, spotlight_end, like_end, total },
    events: eventFrames.map((frame, i) => ({ id: `e${i}`, frame })),
  };
}

describe("planBedFromTimingPlan", () => {
  it("a 45 s plan fits one take, entering at the hook and covering the ending", () => {
    const p = plan(45, [300, 700]);
    const b = planBedFromTimingPlan(p, { fps: FPS, budgetS: 75 });
    expect(b.generation.strategy).toBe("single");
    expect(b.cues).toHaveLength(1);
    expect(b.generation.takes).toEqual([{ takeId: "bed", lengthMs: 44_500 }]);
    expect(b.generation.fitsBudget).toBe(true);
    expect(b.generation.retryFits).toBe(false); // honest: 2 x 44.5 s > 75 s
    expect(b.cues[0]?.start_s).toBe(0);
    expect(b.entry.start_s).toBe(0);
    expect(b.cues[0]?.end_s).toBeGreaterThan(p.sections.like_end / FPS); // under the Powered card
    expect(b.tail.start_s).toBeLessThan(p.sections.spotlight_end / FPS);
    expect(b.silences).toEqual([{ start_s: 44.5, end_s: 45, reason: "final rest" }]);
  });

  it("a 45 s plan becomes a loop when a retry must also fit", () => {
    const b = planBedFromTimingPlan(plan(45, []), { fps: FPS, budgetS: 75, reserveRetry: true });
    expect(b.generation.strategy).toBe("loop");
    expect(b.generation.retryFits).toBe(true);
  });

  it("a 90 s plan with a 75 s budget loops one short take, retry included", () => {
    const b = planBedFromTimingPlan(plan(90, [400, 1000, 1800]), { fps: FPS, budgetS: 75 });
    expect(b.generation.strategy).toBe("loop");
    expect(b.generation.takes).toHaveLength(1);
    expect(b.generation.withRetryS).toBeLessThanOrEqual(75);
    expect(b.generation.retryFits).toBe(true);
    expect(b.cues.length).toBeGreaterThan(1);
    expect(new Set(b.cues.map((c) => c.takeId)).size).toBe(1);
    // segments tile the bed: overlaps equal to the crossfade, no gaps
    for (let i = 1; i < b.cues.length; i++) {
      const prev = b.cues[i - 1];
      const c = b.cues[i];
      expect((prev?.end_s ?? 0) - (c?.start_s ?? 0)).toBeCloseTo(2, 5);
      expect(c?.fadeInS).toBe(2);
    }
    expect(b.cues[0]?.start_s).toBe(0);
    expect(b.cues.at(-1)?.end_s).toBe(89.5);
    // no placed segment is longer than its take
    for (const c of b.cues) expect(c.lengthMs).toBeLessThanOrEqual(b.generation.takes[0]?.lengthMs ?? 0);
    expect(b.cues.at(-1)?.fadeOutS).toBe(b.tail.fadeOutS);
  });

  it("lifts at event frames, leading the card and returning to base", () => {
    const b = planBedFromTimingPlan(plan(45, [300]), { fps: FPS, budgetS: 75 });
    expect(bedLevelDbAt(b.envelope, 10)).toBeCloseTo(2, 5); // at frame 300
    expect(bedLevelDbAt(b.envelope, 10 - 0.075)).toBeCloseTo(1, 5); // already rising before the card
    expect(bedLevelDbAt(b.envelope, 5)).toBe(0);
    expect(bedLevelDbAt(b.envelope, 10 + 0.8 + 0.6)).toBe(0);
    expect(b.envelope.some((e) => e.reason === "event e0")).toBe(true);
  });

  it("ducks under the Powered card and lifts the winner spotlight", () => {
    const p = plan(45, []);
    const b = planBedFromTimingPlan(p, { fps: FPS, budgetS: 75 });
    expect(bedLevelDbAt(b.envelope, p.sections.timeline_end / FPS)).toBeCloseTo(2, 5);
    expect(bedLevelDbAt(b.envelope, p.sections.like_end / FPS + 1)).toBe(-3);
  });

  it("holds the base level through the spotlight and like cards; the duck starts just before the Powered card", () => {
    const p = plan(45, []);
    const b = planBedFromTimingPlan(p, { fps: FPS, budgetS: 75 });
    const powered = p.sections.like_end / FPS; // 42 s
    const spotlightLiftEnd = p.sections.timeline_end / FPS + 0.8 + 0.6; // 39.4 s
    for (let t = spotlightLiftEnd; t <= powered - 0.15 + 1e-9; t += 0.05) expect(bedLevelDbAt(b.envelope, t)).toBe(0);
    expect(bedLevelDbAt(b.envelope, powered - 0.075)).toBeCloseTo(-1.5, 5); // sound leads the card
    expect(bedLevelDbAt(b.envelope, powered)).toBe(-3);
  });

  it("coverage adds up to the video length", () => {
    for (const s of [30, 45, 90]) {
      const b = planBedFromTimingPlan(plan(s, []), { fps: FPS, budgetS: 75 });
      expect(b.coverage.scoredS + b.coverage.silentS).toBeCloseTo(s, 6);
      const sil = b.silences.reduce((a, x) => a + x.end_s - x.start_s, 0);
      expect(sil).toBeCloseTo(b.coverage.silentS, 6);
    }
  });

  it("feeds mixPlan without scenes", () => {
    const b = planBedFromTimingPlan(plan(90, []), { fps: FPS, budgetS: 75 });
    const cues = attachBedSources(b.cues, { "bed-loop": "file:///bed.mp3" });
    const m = mixPlan({ scenes: [], cues });
    expect(m.timelineMusic).toHaveLength(cues.length);
    expect(m.timelineMusic[0]).toMatchObject({ src: "file:///bed.mp3", start_s: 0, gain_db: -6 });
    expect(() => attachBedSources(b.cues, {})).toThrow(/bed-loop/);
  });

  it("rejects loop options that leave gaps or no cues instead of planning them", () => {
    const p = plan(90, []);
    // a negative crossfade left 1 s holes between loop segments while coverage claimed them scored
    expect(() => planBedFromTimingPlan(p, { fps: FPS, budgetS: 75, crossfadeS: -1 })).toThrow(/crossfadeS/);
    // NaN loopS planned zero cues and a NaN-length take
    expect(() => planBedFromTimingPlan(p, { fps: FPS, budgetS: 75, loopS: Number.NaN })).toThrow(/loopS/);
  });

  it("rejects a crossfade as long as the loop take (it never advanced: an endless loop)", () => {
    const p = plan(90, []);
    expect(() => planBedFromTimingPlan(p, { fps: FPS, budgetS: 75, crossfadeS: 30 })).toThrow(/crossfadeS/);
    expect(() => planBedFromTimingPlan(p, { fps: FPS, budgetS: 75, loopS: 10, crossfadeS: 12 })).toThrow(/crossfadeS/);
    // the default crossfade on the smallest legal budget still plans
    expect(planBedFromTimingPlan(p, { fps: FPS, budgetS: 6 }).generation.strategy).toBe("loop");
  });

  it("rejects an impossible budget or disordered sections", () => {
    expect(() => planBedFromTimingPlan(plan(45, []), { fps: FPS, budgetS: 5 })).toThrow(RangeError);
    const bad = plan(45, []);
    bad.sections.hook_end = bad.sections.timeline_end;
    expect(() => planBedFromTimingPlan(bad, { fps: FPS, budgetS: 75 })).toThrow(/ordered/);
  });
});
