import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { videoTheme } from "@statreel/design-tokens";
import { DataRacePropsSchema, resolveDataRaceRenderProps } from "@statreel/schemas";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CHIP, CUE_BUDGET, raceChips } from "./chips";
import { CLOCK_ROLL, clockAt, clockRolls, motionCuesAt } from "./clock";
import { contrastRatio } from "./contrast";
import { DataRaceFrame } from "./DataRaceFrame";
import { buildSampleDataRace } from "./fixture";
import {
  FAR_PLANE_TEXT,
  farPlaneAt,
  LEAD,
  leadChanges,
  leaderColourAt,
  leadFadeActive,
  mixHex,
  tintStrength,
} from "./leader";
import { type DataRaceRenderProps, dataRaceState } from "./state";

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

const markup = (p: DataRaceRenderProps, frame: number) =>
  renderToStaticMarkup(<DataRaceFrame props={p} frame={frame} />);
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const minContrast = (plane: string): number => Math.min(...FAR_PLANE_TEXT.map((t) => contrastRatio(t, plane)));

describe("leader-adaptive far plane: every text stays >= 4.5:1", () => {
  it("the tint strength is capped per colour so ink, inkDim and inkFaint keep LEAD.minContrast on the plane", () => {
    const colours = ["#000000", "#ffffff", "#e0a100", "#0a1a40", "#4b0082", "#ff0000", "#00ff00", "#0000ff", "#12a3b4"];
    for (const c of colours) {
      const s = tintStrength(c);
      expect(s, c).toBeGreaterThanOrEqual(0);
      expect(s, c).toBeLessThanOrEqual(LEAD.maxStrength);
      expect(minContrast(mixHex(videoTheme.background, c, s)), c).toBeGreaterThanOrEqual(LEAD.minContrast);
    }
    // the cap binds where it must (a black entity cannot be tinted at the full share) and not where it need not
    expect(tintStrength("#000000")).toBeLessThan(LEAD.maxStrength);
    expect(tintStrength("#e0a100")).toBe(LEAD.maxStrength);
  });

  for (const [name, props] of FIXTURES) {
    it(`${name}: all entity colours, at full tint, keep >= 4.5:1 for every text colour (minimum reported)`, () => {
      let worst = Number.POSITIVE_INFINITY;
      for (const e of props.entities) {
        const plane = mixHex(videoTheme.background, e.color, tintStrength(e.color));
        worst = Math.min(worst, minContrast(plane));
      }
      // and between any two leaders, half way through a cross-fade
      for (const a of props.entities)
        for (const b of props.entities) {
          const mid = mixHex(a.color, b.color, 0.5);
          worst = Math.min(worst, minContrast(mixHex(videoTheme.background, mid, tintStrength(mid))));
        }
      expect(worst).toBeGreaterThanOrEqual(4.5);
      expect(worst).toBeGreaterThanOrEqual(LEAD.minContrast);
    });

    it(`${name}: on EVERY frame the far plane keeps ink, inkDim and inkFaint >= 4.5:1`, () => {
      const total = props.timing_plan.sections.total;
      let worst = Number.POSITIVE_INFINITY;
      for (let f = 0; f < total; f++) worst = Math.min(worst, minContrast(dataRaceState(props, f).farPlane));
      expect(worst).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: the plane is tinted toward the leader while the chart is up, and neutral under the hook and the ending`, () => {
      const plan = props.timing_plan;
      const mid = Math.round((plan.sections.hook_end + plan.sections.timeline_end) / 2);
      const st = dataRaceState(props, mid);
      expect(st.farPlane).not.toBe(videoTheme.background);
      expect(dataRaceState(props, 0).farPlane).toBe(videoTheme.background);
      expect(dataRaceState(props, plan.sections.like_end + 5).farPlane).toBe(videoTheme.background);
      expect(markup(props, mid)).toContain(`background:${st.farPlane}`);
    });
  }
});

describe("lead-change cross-fade is a counted, pure motion cue", () => {
  it("both fixtures contain lead changes, the colour is a pure function of the frame and moves over LEAD.frames", () => {
    for (const [name, props] of FIXTURES) {
      const changes = leadChanges(props);
      expect(changes.length, name).toBeGreaterThanOrEqual(1);
      const c = changes[0] as (typeof changes)[number];
      const before = leaderColourAt(props, c.start - 1);
      const after = leaderColourAt(props, c.start + LEAD.frames + 1);
      const middle = leaderColourAt(props, c.start + LEAD.frames / 2);
      expect(before, name).not.toBe(after);
      expect([before, after]).not.toContain(middle);
      expect(leaderColourAt(props, c.start + 5)).toBe(leaderColourAt(props, c.start + 5));
      expect(leadFadeActive(props, c.start), name).toBe(true);
      expect(leadFadeActive(props, c.start + LEAD.frames), name).toBe(false);
      // settled on the new leader's colour
      const leader = props.entities.find((e) => e.id === c.to);
      expect(leaderColourAt(props, c.start + LEAD.frames), name).toBe(leader?.color);
    }
  });

  for (const [name, props] of FIXTURES) {
    it(`${name}: never more than ${CUE_BUDGET} motion cues in one frame (chip pops + lead fade + clock roll)`, () => {
      const total = props.timing_plan.sections.timeline_end;
      let max = 0;
      for (let f = 0; f < total; f++) {
        const n = motionCuesAt(props, f);
        expect(n, `frame ${f}`).toBeLessThanOrEqual(CUE_BUDGET);
        max = Math.max(max, n);
        expect(dataRaceState(props, f).cues).toBe(n);
      }
      expect(max).toBeGreaterThanOrEqual(1);
    });
  }

  it("the lead fade takes its place in the budget: a chip that would be the third cue appears without the pop", () => {
    // stack the deck: chips whose entrance falls inside a lead fade together with another chip lose the pop
    const props = e2eProps;
    const chips = raceChips(props);
    const leads = leadChanges(props);
    const inFade = (g: number) => leads.some((l) => l.start <= g && g < l.start + LEAD.frames);
    for (const c of chips.filter((x) => x.cue)) {
      for (let g = c.start; g < c.start + CHIP.enter; g++) {
        const other = chips.filter((o) => o !== c && o.cue && o.start <= g && g < o.start + CHIP.enter).length;
        expect(other + 1 + (inFade(g) ? 1 : 0), `${c.id}@${g}`).toBeLessThanOrEqual(CUE_BUDGET);
      }
    }
    expect(chips.some((c) => !c.cue)).toBe(true);
    // without the lead fade in the budget some of those chips would have popped: at least one dropped pop sits inside a fade
    const dropped = chips.filter((c) => !c.cue);
    expect(dropped.some((c) => Array.from({ length: CHIP.enter }, (_, i) => c.start + i).some(inFade))).toBe(true);
  });
});

describe("the clock rolls between labels", () => {
  it("rolls over the period transition: out and in labels at >= 28 px, tabular figures, windows never overlap", () => {
    for (const [name, props] of FIXTURES) {
      const rolls = clockRolls(props);
      expect(rolls.length, name).toBeGreaterThan(0);
      expect(
        rolls.some((r) => r.cue),
        name,
      ).toBe(true);
      for (let i = 1; i < rolls.length; i++) {
        const prev = rolls[i - 1] as (typeof rolls)[number];
        expect(rolls[i]?.start, name).toBeGreaterThanOrEqual(prev.start + prev.frames);
      }
      for (const r of rolls) expect(r.frames, name).toBeLessThanOrEqual(CLOCK_ROLL.frames);
      const r = rolls.find((x) => x.cue) as (typeof rolls)[number];
      const f = r.start + Math.floor(r.frames / 2);
      const st = clockAt(props, f);
      expect(st.rolling).toBe(true);
      expect(st.from).toBe(props.periods[r.period - 1]);
      expect(st.to).toBe(props.periods[r.period]);
      const html = markup(props, f);
      expect(html).toContain('data-clock-rolling="1"');
      expect(html).toContain("data-clock-out");
      expect(html).toContain("data-clock-in");
      const clock = html.slice(html.indexOf("data-clock="), html.indexOf("data-clock=") + 1200);
      expect(Number(/font-size:(\d+)px/.exec(clock)?.[1])).toBeGreaterThanOrEqual(28);
      expect(clock).toContain("tabular-nums");
      // outside every window it shows the label of the current period, without a roll
      expect(clockAt(props, 0).rolling).toBe(false);
    }
  });

  it("continuity: the label before a roll is the old period, after it the new one; a no-cue transition switches at the knot", () => {
    for (const [name, props] of FIXTURES) {
      for (const r of clockRolls(props)) {
        const before = clockAt(props, r.start - 1);
        const after = clockAt(props, r.start + r.frames);
        const knot = Math.round(props.timing_plan.knots.find((k) => k[1] === r.period)?.[0] ?? 0);
        if (r.cue) {
          expect(before.rolling && before.to === props.periods[r.period], `${name} ${r.period} before`).toBe(false);
          // (a neighbouring transition may start right at the end of this window: then it rolls away from this label)
          expect(after.rolling ? after.from : after.to, `${name} ${r.period} after`).toBe(props.periods[r.period]);
        } else {
          expect(clockAt(props, knot - 1).to, `${name} ${r.period} pre-knot`).not.toBe(props.periods[r.period]);
          expect(clockAt(props, knot).to, `${name} ${r.period} knot`).toBe(props.periods[r.period]);
        }
      }
    }
  });
});

describe("seek stability of the leader plane and the clock roll", () => {
  it("frames inside a lead fade and inside clock rolls render identically in any order", () => {
    for (const [name, props] of FIXTURES) {
      const c = leadChanges(props)[0] as { start: number };
      const roll = clockRolls(props).find((r) => r.cue) as { start: number; frames: number };
      const frames = [
        c.start + 3,
        c.start + 9,
        roll.start + 1,
        roll.start + Math.floor(roll.frames / 2),
        c.start - 2,
        roll.start + roll.frames,
      ];
      const fwd = frames.map((f) => sha(markup(props, f)));
      const back = [...frames]
        .reverse()
        .map((f) => sha(markup(props, f)))
        .reverse();
      expect(back, name).toEqual(fwd);
      // asking for a frame twice, with other frames in between, gives the same plane colour
      const a = farPlaneAt(props, c.start + 7, 1);
      markup(props, 5);
      expect(farPlaneAt(props, c.start + 7, 1)).toBe(a);
    }
  });

  it("the new modules are pure: no clock, no randomness, no module state beyond per-props caches", () => {
    for (const f of ["leader.ts", "clock.ts"]) {
      const src = readFileSync(path.join(here, f), "utf8");
      expect(src, f).not.toMatch(/Date\.now|Math\.random|performance\.now|useCurrentFrame/);
    }
  });
});
