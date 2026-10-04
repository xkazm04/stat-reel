import { TimingPlanSchema, planSha256 } from "@statreel/schemas";
import { describe, expect, it } from "vitest";
import { buildSampleDataRace, sampleDataRaceValues } from "../DataRace/fixture";
import { computeTimingPlan, makeTimeMap, movingAverage, periodAtFrame, renderTimingMd, stickyOrders } from "./index";

const { plan } = buildSampleDataRace();

describe("computeTimingPlan", () => {
  it("emits a schema-valid, JSON-stable plan", () => {
    expect(TimingPlanSchema.safeParse(plan).success).toBe(true);
    const again = JSON.parse(JSON.stringify(plan));
    expect(planSha256(again)).toBe(planSha256(plan));
    expect(planSha256(buildSampleDataRace().plan)).toBe(planSha256(plan));
  });

  it("knots are strictly monotone and span the timeline budget", () => {
    for (let i = 1; i < plan.knots.length; i++) {
      expect(plan.knots[i]?.[0]).toBeGreaterThan(plan.knots[i - 1]?.[0] as number);
      expect(plan.knots[i]?.[1]).toBe(i);
    }
    expect(plan.knots[0]).toEqual([60, 0]);
    expect(plan.knots.at(-1)?.[0]).toBeCloseTo(plan.sections.timeline_end, 1);
  });

  it("sections: fixed ending of 60 + 60 + 90 frames, total 30-90 s", () => {
    const s = plan.sections;
    expect([s.spotlight_end - s.timeline_end, s.like_end - s.spotlight_end, s.total - s.like_end]).toEqual([60, 60, 90]);
    expect(s.total / 30).toBeGreaterThanOrEqual(30);
    expect(s.total / 30).toBeLessThanOrEqual(90);
  });

  it("event cards start where their period is reached", () => {
    const tm = makeTimeMap(plan.knots);
    for (const e of plan.events) expect(Math.abs(tm.at(e.frame) - e.period)).toBeLessThan(0.05);
    expect(plan.events.map((e) => e.frame)).toEqual([...plan.events.map((e) => e.frame)].sort((a, b) => a - b));
  });

  it("time map is monotone and hits every knot", () => {
    const tm = makeTimeMap(plan.knots);
    let prev = -1;
    for (let f = 0; f <= plan.sections.total; f += 3) {
      const v = tm.at(f);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    for (const [fr, p] of plan.knots) expect(tm.at(fr)).toBeCloseTo(p, 6);
    expect(periodAtFrame(plan.knots, 0)).toBe(0);
    expect(periodAtFrame(plan.knots, plan.sections.total)).toBe(plan.periods.length - 1);
  });

  it("evens out the change rate: warped CV is below uniform CV", () => {
    expect(plan.evenness.cv_warped_ex_dwell).toBeLessThan(plan.evenness.cv_uniform);
  });

  it("the final order has the invented winner first", () => {
    expect(plan.orders.at(-1)?.[0]).toBe("prism");
  });

  it("rejects an event outside the periods and a mismatched series", () => {
    const v = sampleDataRaceValues();
    const base = { periods: plan.periods, entities: plan.entities, values: v };
    expect(() => computeTimingPlan({ ...base, events: [{ id: "x", period: 999, label: "x" }] })).toThrow(/outside/);
    expect(() => computeTimingPlan({ ...base, values: { ...v, lumen: [1, 2] } })).toThrow(/needs/);
  });
});

describe("ordering: moving average and hysteresis", () => {
  it("centred moving average, edges shrink", () => {
    expect(movingAverage([0, 3, 6, 9], 1)).toEqual([1.5, 3, 6, 7.5]);
    expect(movingAverage([1, 2], 0)).toEqual([1, 2]);
  });

  it("hysteresis removes flip-flops between near-equal entities", () => {
    const wobble = (e: string, i: number) => (e === "a" ? 10 : 10 + (i % 2 === 0 ? 0.2 : -0.2));
    const raw = stickyOrders(8, ["a", "b"], wobble, { rel: 0, abs: 0 });
    const sticky = stickyOrders(8, ["a", "b"], wobble, { rel: 0.06, abs: 0.01 });
    const swaps = (o: string[][]) => o.filter((x, i) => i > 0 && x[0] !== (o[i - 1] as string[])[0]).length;
    expect(swaps(raw)).toBeGreaterThan(3);
    expect(swaps(sticky)).toBe(0);
    // a real lead is followed
    const real = stickyOrders(6, ["a", "b"], (e, i) => (e === "a" ? 10 : i < 3 ? 5 : 20), { rel: 0.06, abs: 0.01 });
    expect(real[0]?.[0]).toBe("a");
    expect(real[5]?.[0]).toBe("b");
  });

  it("the race ends on the truth: the last period's #1 has the largest final value, whatever the smoothing held", () => {
    // a title decided in the final period by less than the 6 % hysteresis margin: the ending crowns
    // orders.at(-1)[0] ("NO. 1 AT THE END"), so a sticky order would crown the runner-up
    const values = { a: [100, 140, 180, 220, 230], b: [90, 130, 170, 215, 236], c: [80, 120, 160, 200, 210] };
    const periods = ["r1", "r2", "r3", "r4", "r5"];
    const champion = "b";
    for (const opts of [{}, { rankSmooth: 1 }, { hysteresis: { rel: 0.2, abs: 0 } }, { hysteresis: null }]) {
      const p = computeTimingPlan({ periods, entities: Object.keys(values), values, opts });
      expect(p.orders.at(-1)?.[0], JSON.stringify(opts)).toBe(champion);
      // only the crown moves; the rest of the final order keeps its relative order
      expect(p.orders.at(-1)?.filter((e) => e !== champion), JSON.stringify(opts)).toEqual(p.orders.at(-2)?.filter((e) => e !== champion));
    }
    // a tie at the end keeps the order the viewer already sees (no gratuitous swap)
    const tie = computeTimingPlan({ periods, entities: ["a", "b"], values: { a: [5, 6, 7, 8, 9], b: [1, 2, 3, 4, 9] } });
    expect(tie.orders.at(-1)?.[0]).toBe("a");
  });
});

describe("TIMING.md", () => {
  it("renders strategy, sections, groups and events with the plan sha", () => {
    const md = renderTimingMd(plan, { title: "sample" });
    expect(md).toContain(`sha256 \`${planSha256(plan)}\``);
    expect(md).toContain("## Sections (30 fps, 1230 frames = 41.0 s)");
    expect(md).toContain(`| Winner spotlight | ${plan.sections.timeline_end}-${plan.sections.spotlight_end} |`);
    expect(md).toContain("Powered by StatReel (Frame Stat)");
    for (const e of plan.events) expect(md).toContain(`\`${e.id}\``);
    expect(md).toContain('"ORDER: 3-MO AVG"');
  });
});
