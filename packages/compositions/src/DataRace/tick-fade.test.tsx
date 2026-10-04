import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DataRacePropsSchema, resolveDataRaceRenderProps } from "@statreel/schemas";
import { niceTicks } from "@statreel/viz";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DataRaceFrame } from "./DataRaceFrame";
import { buildSampleDataRace } from "./fixture";
import { axisMaxAtFrame, type DataRaceRenderProps, dataRaceState } from "./state";
import { TICKS, tickDecimals, ticksAt, tickValues } from "./tick-fade";

vi.mock("remotion", async (orig) => {
  const { createElement } = await import("react");
  return { ...(await orig<typeof import("remotion")>()), Img: (p: Record<string, unknown>) => createElement("img", p) };
});

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..", "..", "..");
const sample = buildSampleDataRace();
const sampleProps = resolveDataRaceRenderProps(
  DataRacePropsSchema.parse(sample.props),
  sample.plan,
) as DataRaceRenderProps;
const e2eDir = path.join(repo, "e2e", "fixtures", "generation", "generate_video", "out");
const e2eProps = resolveDataRaceRenderProps(
  DataRacePropsSchema.parse(JSON.parse(readFileSync(path.join(e2eDir, "props.json"), "utf8"))),
  JSON.parse(readFileSync(path.join(e2eDir, "timing-plan.json"), "utf8")),
) as DataRaceRenderProps;
const FIXTURES = [
  ["sample fixture", sampleProps],
  ["e2e generate_video fixture", e2eProps],
] as const;

describe("DataRace uses the one niceTicks of packages/viz", () => {
  it("has no niceTicks of its own and imports the viz one", () => {
    expect(readFileSync(path.join(here, "state.ts"), "utf8")).not.toMatch(/function niceTicks|tickRank/);
    expect(readFileSync(path.join(here, "tick-fade.ts"), "utf8")).toContain(
      'import { niceTicks } from "@statreel/viz"',
    );
  });

  it("tickValues is niceTicks(0, max, 4) without the zero line: 2, 3 or 4 round gridlines, always", () => {
    for (let max = 0.05; max < 2e6; max *= 1.013) {
      const t = tickValues(max);
      expect(t.length, `max ${max}`).toBeGreaterThanOrEqual(2);
      expect(t.length, `max ${max}`).toBeLessThanOrEqual(4);
      expect(t, `max ${max}`).toEqual(niceTicks(0, max, TICKS.count).filter((v) => v > 0));
      expect(Math.max(...t)).toBeLessThanOrEqual(max);
    }
    expect(tickValues(0)).toEqual([]);
    expect(tickValues(-3)).toEqual([]);
  });

  it("pins the sets: steps are 1 / 2 / 2.5 / 5 x 10^n, the step is the nice one not below max / 4", () => {
    expect(tickValues(20.4)).toEqual([10, 20]); // raw 5.1 -> next nice step 10
    expect(tickValues(20)).toEqual([5, 10, 15, 20]);
    expect(tickValues(23)).toEqual([10, 20]);
    expect(tickValues(9.3)).toEqual([2.5, 5, 7.5]);
    expect(tickValues(1)).toEqual([0.25, 0.5, 0.75, 1]);
    expect(tickValues(0.7)).toEqual([0.2, 0.4, 0.6]);
    expect(tickValues(98)).toEqual([25, 50, 75]);
    expect(tickValues(1234)).toEqual([500, 1000]);
    expect(tickValues(250000)).toEqual([100000, 200000]);
  });

  it("a tick label shows its value exactly (0.25 is not rounded to 0.3)", () => {
    expect([5, 10, 2.5, 0.25, 0.75, 0.2, 1000].map(tickDecimals)).toEqual([0, 0, 1, 2, 2, 1, 0]);
  });
});

describe("ticks entering or leaving fade over a fixed window, pure in the frame", () => {
  for (const [name, props] of FIXTURES) {
    it(`${name}: alpha stays in [0, 1], moves by at most 0.13 per frame, and no tick pops`, () => {
      const total = props.timing_plan.sections.timeline_end;
      let prev = new Map<number, number>();
      let fading = 0;
      let setChanges = 0;
      let lastSet = "";
      for (let f = 0; f < total; f++) {
        const ticks = ticksAt(props, f, (g) => axisMaxAtFrame(props, g));
        const now = new Map(ticks.map((t) => [t.value, t.alpha]));
        for (const t of ticks) {
          expect(t.alpha, `frame ${f} tick ${t.value}`).toBeGreaterThan(0);
          expect(t.alpha).toBeLessThanOrEqual(1);
          if (t.alpha < 1) fading++;
        }
        if (f > 0) {
          for (const [v, a] of now)
            expect(Math.abs(a - (prev.get(v) ?? 0)), `frame ${f} tick ${v}`).toBeLessThanOrEqual(0.13);
          for (const [v, a] of prev)
            if (!now.has(v)) expect(a, `frame ${f} tick ${v} vanished`).toBeLessThanOrEqual(0.13);
        }
        const set = tickValues(axisMaxAtFrame(props, f)).join(",");
        if (f > 0 && set !== lastSet) setChanges++;
        lastSet = set;
        expect(ticks.length, `frame ${f}`).toBeLessThanOrEqual(8);
        prev = now;
      }
      // the race has tick-set changes, and each of them was faded (some ticks were mid-fade)
      expect(setChanges).toBeGreaterThan(0);
      expect(fading).toBeGreaterThan(0);
    });

    it(`${name}: a tick that enters starts near 0 and is fully there fadeFrames later (a pure function of the frame)`, () => {
      const total = props.timing_plan.sections.timeline_end;
      let checked = 0;
      for (let f = 1; f < total - TICKS.fadeFrames; f++) {
        const before = new Set(tickValues(axisMaxAtFrame(props, f - 1)));
        const entering = tickValues(axisMaxAtFrame(props, f)).filter(
          (v) => !before.has(v) && !tickValues(axisMaxAtFrame(props, Math.max(0, f - 5))).includes(v),
        );
        for (const v of entering) {
          const at = (g: number) =>
            ticksAt(props, g, (h) => axisMaxAtFrame(props, h)).find((t) => t.value === v)?.alpha ?? 0;
          expect(at(f), `${v} enters at ${f}`).toBeLessThanOrEqual(0.02);
          // the set can change again inside the window; only a tick that stays is asserted to arrive
          const stays = Array.from({ length: TICKS.fadeFrames }, (_, i) =>
            tickValues(axisMaxAtFrame(props, f + i)),
          ).every((s) => s.includes(v));
          if (stays) expect(at(f + TICKS.fadeFrames - 1)).toBeCloseTo(1, 6);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }

  it("is seek-stable: the same frame renders the same markup in any order, and ticks are positioned by the current axis", () => {
    const props = sampleProps;
    const plan = props.timing_plan;
    // find a frame in the middle of a tick fade
    let mid = -1;
    for (let f = plan.sections.hook_end + 40; f < plan.sections.timeline_end; f++) {
      if (dataRaceState(props, f).ticks.some((t) => t.alpha > 0.1 && t.alpha < 0.9)) {
        mid = f;
        break;
      }
    }
    expect(mid).toBeGreaterThan(0);
    const html = (f: number) => renderToStaticMarkup(<DataRaceFrame props={props} frame={f} />);
    const a = html(mid);
    html(mid + 50);
    html(5);
    expect(html(mid)).toBe(a);
    expect(a).toMatch(/data-tick-alpha="0\.\d{3}"/);
  });

  it("a fixed axis_max never fades: every gridline is steady", () => {
    const fixed = { ...sampleProps, axis_max: 200 };
    const plan = fixed.timing_plan;
    for (let f = 0; f < plan.sections.timeline_end; f += 7) {
      for (const t of ticksAt(fixed, f, (g) => axisMaxAtFrame(fixed, g))) expect(t.alpha).toBe(1);
    }
  });

  it("the doc comment of AxisTicks no longer says the axis is fixed", () => {
    const parts = readFileSync(path.join(here, "parts.tsx"), "utf8");
    expect(parts).not.toMatch(/grow-free|the axis is fixed/);
    expect(parts).toContain("fades in or out over a fixed frame window");
  });
});
