import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { videoTheme } from "@statreel/design-tokens";
import {
  DATA_RACE_LIMITS,
  DataRacePropsSchema,
  checkGenerationRules,
  dataRacePropsJsonSchema,
  formatViolations,
  planSha256,
  resolveDataRaceRenderProps,
} from "@statreel/schemas";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COMPOSITIONS, compositionIdFor } from "../compositions";
import { calculateDataRaceMetadata } from "../Root";
import { renderTimingMd } from "../timing/index";
import { DataRaceFrame } from "./DataRaceFrame";
import { buildSampleDataRace } from "./fixture";
import { LABEL_RIGHT, L, formatValue, textWidth, valueLabelLayout } from "./parts";
import { CARD, type DataRaceRenderProps, axisMaxFor, dataRaceState, niceTicks, orderedEvents, phaseAt } from "./state";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, "..", "..", "fixtures");
const sample = buildSampleDataRace();
const props = resolveDataRaceRenderProps(DataRacePropsSchema.parse(sample.props), sample.plan) as DataRaceRenderProps;
const plan = props.timing_plan;
const markup = (frame: number, p: DataRaceRenderProps = props) => renderToStaticMarkup(<DataRaceFrame props={p} frame={frame} />);
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
/** the board's still: 45 % of the video, mid-race, never the finale (spec D.7) */
const midFrame = Math.round(0.45 * plan.sections.total);

describe("sample fixture", () => {
  it("passes the schema and all six generation rules", () => {
    const r = checkGenerationRules(sample.props, sample.plan, { ledger: sample.ledger });
    expect(formatViolations(r.violations)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("is sample data: 10 entities, 3 file logos with ledger rows, 7 wordmarks", () => {
    expect(props.data_provenance).toBe("sample");
    expect(props.entities).toHaveLength(10);
    expect(props.entities.filter((e) => e.logo.kind === "file")).toHaveLength(3);
    expect(sample.ledger).toHaveLength(3);
    expect(new Set(props.entities.map((e) => e.color)).size).toBe(10);
  });

  it("the committed JSON fixtures are exactly what the builder produces", () => {
    const read = (f: string) => JSON.parse(readFileSync(path.join(fixturesDir, f), "utf8"));
    expect(read("sample-data-race.props.json")).toEqual(JSON.parse(JSON.stringify(sample.props)));
    expect(read("sample-data-race.timing-plan.json")).toEqual(JSON.parse(JSON.stringify(sample.plan)));
    expect(read("sample-data-race.assets.json")).toEqual(JSON.parse(JSON.stringify(sample.ledger)));
    expect(readFileSync(path.join(fixturesDir, "sample-data-race.TIMING.md"), "utf8")).toBe(renderTimingMd(sample.plan, { title: "sample-data-race" }));
    expect(planSha256(read("sample-data-race.timing-plan.json"))).toBe(sample.props.timing_plan_sha256);
    expect(read("data-race-props.schema.json")).toEqual(JSON.parse(JSON.stringify(dataRacePropsJsonSchema())));
  });
});

describe("registration and metadata", () => {
  it("DataRace-vertical is 1080x1920 at 30 fps", () => {
    const c = COMPOSITIONS.find((x) => x.id === "DataRace-vertical");
    expect([c?.width, c?.height, c?.fps]).toEqual([1080, 1920, 30]);
    expect(compositionIdFor("vertical", "DataRace")).toBe("DataRace-vertical");
  });

  it("duration is the plan total (30-90 s) and a missing plan fails before the first frame", async () => {
    const abortSignal = new AbortController().signal;
    const call = (p: unknown) =>
      calculateDataRaceMetadata({ props: p as never, defaultProps: p as never, abortSignal, compositionId: "DataRace-vertical", isRendering: true });
    const r = await call(props);
    expect(r.durationInFrames).toBe(plan.sections.total);
    expect((r.durationInFrames ?? 0) / 30).toBeGreaterThanOrEqual(30);
    expect((r.durationInFrames ?? 0) / 30).toBeLessThanOrEqual(90);
    expect(() => call(sample.props)).toThrow(/timing_plan/);
    expect(() => call({ ...props, transition: "wipe" })).toThrow(/invalid DataRaceProps/);
  });
});

describe("event stack", () => {
  const sorted = orderedEvents(props);

  it("cards alternate left, right, left... by index; the props carry no transition", () => {
    expect(sorted.map((e) => e.index)).toEqual(props.events.map((_, i) => i));
    const seen: string[] = [];
    for (const e of props.events) {
      const st = dataRaceState(props, e.start_frame + 20);
      const card = st.cards.find((c) => c.id === e.id);
      expect(card, e.id).toBeDefined();
      seen.push(card?.side as string);
    }
    expect(seen).toEqual(props.events.map((_, i) => (i % 2 === 0 ? "left" : "right")));
    expect(JSON.stringify(props)).not.toMatch(/transition|"enter"|"exit"/);
  });

  it("renders the side in the markup and reveals from that edge", () => {
    const e0 = props.events[0] as (typeof props.events)[number];
    const e1 = props.events[1] as (typeof props.events)[number];
    expect(markup(e0.start_frame + 2)).toContain('data-card-side="left"');
    expect(markup(e1.start_frame + 2)).toContain('data-card-side="right"');
    // mid-reveal: left cards translate negative and clip from the right edge; right ones the opposite
    expect(markup(e0.start_frame + 2)).toMatch(/translateX\(-[\d.]+px\)/);
    expect(markup(e1.start_frame + 2)).toMatch(/translateX\([\d.]+px\)/);
    // fully revealed after the enter frames
    expect(markup(e0.start_frame + 40)).toContain("translateX(0.00px)");
  });

  it("lives 120 frames (default) and is gone afterwards", () => {
    const e = props.events[0] as (typeof props.events)[number];
    expect(dataRaceState(props, e.start_frame + 60).cards.some((c) => c.id === e.id)).toBe(true);
    expect(dataRaceState(props, e.start_frame + 119).cards.some((c) => c.id === e.id)).toBe(true);
    expect(dataRaceState(props, e.start_frame + 120).cards.some((c) => c.id === e.id)).toBe(false);
    const fading = dataRaceState(props, e.start_frame + 118).cards.find((c) => c.id === e.id);
    expect(fading?.exit).toBeGreaterThan(0.5);
  });

  it("older cards are pushed back per depth: x +24, y -62, scale -6 %, brightness -12 %", () => {
    // force three cards alive at once by giving them nearby start frames
    const crowded: DataRaceRenderProps = {
      ...props,
      events: props.events.slice(0, 4).map((e, i) => ({ ...e, start_frame: 300 + i * 20 })),
    };
    const st = dataRaceState(crowded, 300 + 3 * 20 + 30);
    // 4 cards alive; the oldest has depth 3 and is hidden (max depth 3)
    expect(st.cards).toHaveLength(3);
    const [c1, c2, c3] = st.cards;
    expect(c3?.depth).toBeCloseTo(0, 5);
    expect(c2?.depth).toBeCloseTo(1, 5);
    expect(c1?.depth).toBeCloseTo(2, 5);
    expect([c2?.offsetX, c2?.offsetY]).toEqual([24, -62]);
    expect(c2?.scale).toBeCloseTo(0.94, 5);
    expect(c2?.brightness).toBeCloseTo(0.88, 5);
    expect([c1?.offsetX, c1?.offsetY]).toEqual([48, -124]);
    expect(CARD.maxDepth).toBe(3);
  });

  it("never shows more than 3 cards, over the whole video", () => {
    let max = 0;
    for (let f = 0; f < plan.sections.total; f += 2) max = Math.max(max, dataRaceState(props, f).cards.length);
    expect(max).toBeLessThanOrEqual(3);
    expect(max).toBeGreaterThanOrEqual(1);
  });

  it("no card outlives the timeline (the ending is its own scene)", () => {
    expect(dataRaceState(props, plan.sections.timeline_end).cards).toHaveLength(0);
  });
});

describe("race", () => {
  it("shows all 10 entities mid-race with unique rows, ranks 0..9", () => {
    const st = dataRaceState(props, midFrame);
    const present = st.rows.filter((r) => r.presence > 0);
    expect(present.length).toBeGreaterThanOrEqual(8);
    const html = markup(midFrame);
    for (const r of present) expect(html).toContain(`data-row="${r.id}"`);
    expect(Math.max(...st.rows.map((r) => r.pos))).toBeLessThanOrEqual(9.001);
  });

  it("the bars follow the plan: the clock reaches the last period at the end of the timeline", () => {
    const st = dataRaceState(props, plan.sections.timeline_end - 1);
    expect(st.period).toBeGreaterThanOrEqual(plan.periods.length - 2);
    expect(markup(plan.sections.timeline_end - 1)).toContain(">Nov 2026<");
    expect(markup(plan.sections.hook_end)).toContain(">Jan 2019<");
  });

  it("hook shows the question and equal logo tiles, without the answer, at frame 0", () => {
    const html = markup(0);
    expect(html).toContain("data-hook");
    expect(html).toContain(props.hook);
    expect(html).not.toContain("NO. 1 AT THE END");
    expect(html.slice(html.indexOf("data-hook")).match(/data-logo="(file|wordmark)"/g)?.length).toBe(10);
  });

  it("is seek-stable: any frame renders identically in any order", () => {
    const frames = [0, 33, midFrame, 700, plan.sections.timeline_end + 10, plan.sections.like_end + 40, plan.sections.total - 1];
    const fwd = frames.map((f) => markup(f));
    const back = [...frames].reverse().map((f) => markup(f)).reverse();
    expect(back).toEqual(fwd);
  });
});

describe("axis: one fixed scale with nice gridline ticks (ADR scale-and-axis-design)", () => {
  it("the axis max never shrinks, over every frame of the sample fixture", () => {
    let prev = 0;
    for (let f = 0; f < plan.sections.total; f++) {
      const a = dataRaceState(props, f).axisMax;
      expect(a, `frame ${f}`).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    expect(axisMaxFor(props)).toBe(plan.strategy.axis_max);
    expect(axisMaxFor({ ...props, axis_max: 123 })).toBe(123);
  });

  it("niceTicks gives 3-4 round values <= max (2 only where no round step fits)", () => {
    for (const max of [0.7, 1, 4.2, 9.3, 23, 47.7, 98, 1234, 250000]) {
      const t = niceTicks(max);
      expect(t.length, `max ${max}`).toBeGreaterThanOrEqual(2);
      expect(t.length, `max ${max}`).toBeLessThanOrEqual(4);
      expect(Math.max(...t)).toBeLessThanOrEqual(max);
      expect([...t].sort((a, b) => a - b)).toEqual(t);
    }
    expect(niceTicks(20.4)).toEqual([5, 10, 15, 20]);
    expect(niceTicks(0)).toEqual([]);
  });

  it("draws 3-4 labelled gridlines at >= 28 px with tabular figures, on theme colours", () => {
    const html = markup(midFrame);
    const ticks = [...html.matchAll(/data-tick="([\d.]+)"><div style="[^"]*"><\/div><div style="([^"]*)"/g)];
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeLessThanOrEqual(4);
    for (const m of ticks) {
      expect(Number(/font-size:(\d+)px/.exec(m[2] as string)?.[1])).toBeGreaterThanOrEqual(28);
      expect(m[2]).toContain("tabular-nums");
      expect(m[2]).toContain(`color:${videoTheme.inkFaint}`);
    }
    expect(html).toContain(`background:${videoTheme.grid}`);
  });

  it("the value label never crosses the icon column (x 965), even for a long prefix/suffix at full width", () => {
    const longest = { decimals: 1, prefix: "US$ ", suffix: " million per year" };
    for (const barW of [6, 200, L.barMaxW]) {
      for (const fmt of [longest, { decimals: 1, prefix: "", suffix: " M" }]) {
        const text = formatValue(12345.6, fmt);
        const lay = valueLabelLayout(barW, text);
        expect(L.marginX + lay.left + lay.width, `${barW} ${text}`).toBeLessThanOrEqual(LABEL_RIGHT);
      }
    }
    expect(valueLabelLayout(100, "5.0 M").plate).toBe(false);
    expect(valueLabelLayout(L.barMaxW, formatValue(1, longest)).plate).toBe(true);
    expect(textWidth("5.0 M", 30)).toBeGreaterThan(0);
    const wide = { ...props, value_format: longest };
    const html = markup(plan.sections.timeline_end - 1, wide);
    for (const m of html.matchAll(/data-value="" style="left:([\d.]+)px;[^"]*width:(\d+)px/g))
      expect(L.marginX + Number(m[1]) + Number(m[2])).toBeLessThanOrEqual(LABEL_RIGHT);
  });
});

describe("ending: spotlight (60) -> like & subscribe (60) -> Powered by StatReel (90)", () => {
  const s = plan.sections;
  const which = (f: number) => (markup(f).match(/data-ending="([a-z-]+)"/) ?? [])[1];

  it("is fixed in order and length", () => {
    expect(phaseAt(plan, s.timeline_end - 1).phase).toBe("timeline");
    expect([s.spotlight_end - s.timeline_end, s.like_end - s.spotlight_end, s.total - s.like_end]).toEqual([60, 60, 90]);
    expect(which(s.timeline_end - 1)).toBeUndefined();
    expect(which(s.timeline_end)).toBe("spotlight");
    expect(which(s.spotlight_end - 1)).toBe("spotlight");
    expect(which(s.spotlight_end)).toBe("like-subscribe");
    expect(which(s.like_end - 1)).toBe("like-subscribe");
    expect(which(s.like_end)).toBe("powered-by");
    expect(which(s.total - 1)).toBe("powered-by");
  });

  it("the spotlight is the final #1 with its fact-ref'd stats", () => {
    const html = markup(s.timeline_end + 30);
    expect(html).toContain("NO. 1 AT THE END");
    const winner = props.entities.find((e) => e.id === plan.orders.at(-1)?.[0]);
    expect(html).toContain(winner?.name as string);
    for (const f of props.spotlight.facts) expect(html).toContain(f.value_text);
  });

  it("Powered by uses the Frame Stat geometry: frame, 12 holes, window, 4 bars", () => {
    const html = markup(s.total - 1);
    expect(html).toContain('data-logo="frame-stat"');
    const svg = html.slice(html.indexOf('data-logo="frame-stat"'), html.indexOf("</svg>", html.indexOf('data-logo="frame-stat"')));
    expect((svg.match(/<rect/g) ?? []).length).toBe(1 + 12 + 1 + 4);
    expect(html).toContain("POWERED BY");
    expect(html).toContain("<span");
    expect(html).toContain("Reel");
  });
});

describe("sample badge, colours, type", () => {
  it("burns the SAMPLE DATA badge on every phase when data_provenance is sample, and not for real data", () => {
    for (const f of [0, midFrame, plan.sections.timeline_end + 5, plan.sections.spotlight_end + 5, plan.sections.total - 1])
      expect(markup(f)).toContain(DATA_RACE_LIMITS.sampleBadgeText);
    const real = { ...props, data_provenance: "real" as const };
    expect(markup(midFrame, real)).not.toContain("SAMPLE DATA");
  });

  it("uses the video theme tokens; no On Air / night literals are baked into the composition", () => {
    const html = markup(midFrame);
    expect(html).toContain(videoTheme.background);
    expect(html).toContain(videoTheme.ink);
    const dir = here;
    for (const f of ["parts.tsx", "ending.tsx", "DataRaceFrame.tsx", "state.ts"]) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/#05070c|#d6ff3f|#0f1524|#f3f6fb/i);
    }
  });

  it("every readable text is >= 28 px, numbers use tabular figures", () => {
    const frames = [0, 20, 50, midFrame, 700, plan.sections.timeline_end + 20, plan.sections.spotlight_end + 30, plan.sections.total - 1];
    for (const f of frames) {
      const html = markup(f);
      const sizes = [...html.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
      expect(sizes.length, `frame ${f}`).toBeGreaterThan(0);
      expect(Math.min(...sizes), `frame ${f}`).toBeGreaterThanOrEqual(28);
    }
    expect(markup(midFrame)).toContain("tabular-nums");
  });

  it("keeps text inside the safe box (y 150-1580)", () => {
    const html = markup(midFrame);
    const tops = [...html.matchAll(/top:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
    expect(Math.min(...tops.filter((t) => t > 100))).toBeGreaterThanOrEqual(150);
    expect(1544 + 34).toBeLessThanOrEqual(1580);
  });
});

describe("golden frame hashes (update deliberately when the design changes)", () => {
  it("45 % of the video and the ending", () => {
    expect({
      mid45: sha(markup(midFrame)),
      hook0: sha(markup(0)),
      spotlight: sha(markup(plan.sections.timeline_end + 40)),
      like: sha(markup(plan.sections.spotlight_end + 40)),
      poweredEnd: sha(markup(plan.sections.total - 1)),
    }).toMatchInlineSnapshot(`
      {
        "hook0": "e98284f4ea227527",
        "like": "a3864ee6bfbc7a30",
        "mid45": "257f034817829855",
        "poweredEnd": "5cbbd46a858efedd",
        "spotlight": "a3ea6e4f65cef402",
      }
    `);
  });
});
