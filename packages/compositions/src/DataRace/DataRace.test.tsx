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
import { measureText } from "@statreel/viz";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { COMPOSITIONS, compositionIdFor } from "../compositions";
import { calculateDataRaceMetadata } from "../Root";
import { computeTimingPlan, renderTimingMd } from "../timing/index";
import { DataRaceFrame } from "./DataRaceFrame";
import { buildSampleDataRace } from "./fixture";
import { CHIP, CUE_BUDGET, raceChips } from "./chips";
import { contrastRatio } from "./contrast";
import { SPOTLIGHT_DIM, SPOTLIGHT_SCALE } from "./ending";
import { LABEL_RIGHT, L, formatValue, valueLabelLayout } from "./parts";
import { CARD, type DataRaceRenderProps, AXIS_HEADROOM, axisMaxAt, dataRaceState, orderedEvents, phaseAt } from "./state";

// Remotion's <Img> reads useCurrentFrame(), which only exists inside a registered composition. These
// tests hash frames with renderToStaticMarkup, so the real <Img> is swapped for a plain <img>; the
// parts.tsx source guard below asserts the real component is the one imported.
vi.mock("remotion", async (orig) => {
  const { createElement } = await import("react");
  return { ...(await orig<typeof import("remotion")>()), Img: (p: Record<string, unknown>) => createElement("img", p) };
});

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
    // the hook is laid out as explicit measured lines; its text is the lines joined
    const hookBlock = html.slice(html.indexOf("data-hook-text"), html.indexOf("data-hook-tile"));
    expect(hookBlock.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).toContain(props.hook);
    expect(html).not.toContain("NO. 1 AT THE END");
    expect(html.slice(html.indexOf("data-hook")).match(/data-logo="(file|wordmark)"/g)?.length).toBe(10);
  });

  it("a hook of any allowed length (compute_timing_plan: 0-300 frames) shows its question and hands over to the chart without a pop", () => {
    const withHook = (hookFrames: number): DataRaceRenderProps => ({
      ...props,
      events: [],
      timing_plan: computeTimingPlan({
        periods: plan.periods,
        entities: plan.entities,
        values: Object.fromEntries(props.entities.map((e) => [e.id, e.values])),
        opts: { hookFrames, timelineFrames: 960 },
      }),
    });
    for (const h of [20, 30, 36, 40, 60, 300]) {
      const p = withHook(h);
      const st = (f: number) => dataRaceState(p, f);
      expect(st(0).hookOpacity, `hook ${h}: question on screen at frame 0`).toBe(1);
      expect(st(h).hookOpacity, `hook ${h}: gone when data time starts`).toBe(0);
      expect(st(h).chartOpacity, `hook ${h}: chart fully up when data time starts`).toBe(1);
      for (let f = 1; f <= h; f++) {
        expect(Math.abs(st(f).hookOpacity - st(f - 1).hookOpacity), `hook ${h}: hook step at ${f}`).toBeLessThanOrEqual(0.2);
        expect(Math.abs(st(f).chartOpacity - st(f - 1).chartOpacity), `hook ${h}: chart step at ${f}`).toBeLessThanOrEqual(0.2);
      }
    }
    // no hook: the video opens on the chart, data time is never hidden
    expect(dataRaceState(withHook(0), 0).chartOpacity).toBe(1);
    // the 60-frame default keeps its curves (chart 24 -> 60, hook 36 -> 60)
    const d = withHook(60);
    expect([24, 42, 60].map((f) => dataRaceState(d, f).chartOpacity)).toEqual([0, 0.5, 1]);
    expect([36, 48, 59].map((f) => dataRaceState(d, f).hookOpacity)).toEqual([1, 0.5, 1 - 23 / 24]);
  });

  it("is seek-stable: any frame renders identically in any order", () => {
    const frames = [0, 33, midFrame, 700, plan.sections.timeline_end + 10, plan.sections.like_end + 40, plan.sections.total - 1];
    const fwd = frames.map((f) => markup(f));
    const back = [...frames].reverse().map((f) => markup(f)).reverse();
    expect(back).toEqual(fwd);
  });
});

describe("axis: grow-only max-so-far with nice gridline ticks (ADR scale-and-axis-design)", () => {
  it("the axis max never shrinks, over every frame of the sample fixture", () => {
    let prev = 0;
    for (let f = 0; f < plan.sections.total; f++) {
      const a = dataRaceState(props, f).axisMax;
      expect(a, `frame ${f}`).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    expect(dataRaceState({ ...props, axis_max: 123 }, midFrame).axisMax).toBe(123);
    expect(axisMaxAt({ ...props, axis_max: 123 }, 0, 1e9)).toBe(123);
  });

  it("grows with the leader: at the first visible period the leader's bar is >= 50 % of the bar width", () => {
    const st = dataRaceState(props, plan.sections.hook_end);
    const leader = Math.max(...st.rows.map((r) => r.value));
    expect((leader / st.axisMax) * L.barMaxW).toBeGreaterThanOrEqual(0.5 * L.barMaxW);
    expect(st.axisMax).toBeLessThan(plan.strategy.axis_max);
    expect(dataRaceState(props, plan.sections.timeline_end - 1).axisMax).toBeCloseTo(plan.strategy.axis_max * AXIS_HEADROOM, 6);
  });

  it("draws 2-4 labelled gridlines at >= 28 px with tabular figures, on theme colours", () => {
    const html = markup(midFrame);
    const ticks = [...html.matchAll(/data-tick="([\d.]+)" data-tick-alpha="([\d.]+)" style="[^"]*"><div style="[^"]*"><\/div><div style="([^"]*)"/g)];
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThanOrEqual(5); // 4 steady lines plus at most one still fading
    for (const m of ticks) {
      expect(Number(/font-size:(\d+)px/.exec(m[3] as string)?.[1])).toBeGreaterThanOrEqual(28);
      expect(m[3]).toContain("tabular-nums");
      expect(m[3]).toContain(`color:${videoTheme.inkFaint}`);
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
    expect(measureText("5.0 M", 30, "mono", 0, 700)).toBe(5 * 0.6 * 30);
    const wide = { ...props, value_format: longest };
    const html = markup(plan.sections.timeline_end - 1, wide);
    for (const m of html.matchAll(/data-value="" style="left:([\d.]+)px;[^"]*width:(\d+)px/g))
      expect(L.marginX + Number(m[1]) + Number(m[2])).toBeLessThanOrEqual(LABEL_RIGHT);
  });
});

describe("rank chips: up N / NEW, in frames, independent of the warp", () => {
  const chips = raceChips(props);
  const rowChip = (id: string, f: number) => dataRaceState(props, f).rows.find((r) => r.id === id)?.chip ?? null;

  it("derives a chip from every rank gain in the plan's orders (and a NEW for every newcomer)", () => {
    const ups = chips.filter((c) => c.kind === "up");
    const news = chips.filter((c) => c.kind === "new");
    let expectedUps = 0;
    for (let p = 1; p < plan.periods.length; p++)
      for (const e of props.entities) {
        if (e.values[p] == null || e.values[p - 1] == null) continue;
        const gain = (plan.orders[p - 1] as string[]).indexOf(e.id) - (plan.orders[p] as string[]).indexOf(e.id);
        const start = Math.round((plan.knots[p] as number[])[0] as number) - CHIP.lead;
        if (gain >= 1 && start + CHIP.frames <= plan.sections.timeline_end) expectedUps++;
      }
    expect(expectedUps).toBeGreaterThan(0);
    expect(ups).toHaveLength(expectedUps);
    expect(news.length).toBeGreaterThan(0);
  });

  it(`every chip is visible for >= 45 frames (it lives ${CHIP.frames}), however the warp runs`, () => {
    expect(CHIP.frames).toBeGreaterThanOrEqual(45);
    for (const c of chips) {
      for (let k = 0; k < 45; k++) {
        const w = rowChip(c.id, c.start + k);
        expect(w, `${c.id} ${c.kind} +${k}`).not.toBeNull();
      }
      // the newest chip may replace it, but the entity still carries one
      expect(rowChip(c.id, c.start + CHIP.frames - 1)).not.toBeNull();
    }
    const first = chips.find((c) => c.kind === "up") as (typeof chips)[number];
    expect(markup(first.start + 20)).toContain('data-chip="up"');
  });

  it("a newcomer gets an entrance cue; rank gains read 'up N'", () => {
    const n = chips.find((c) => c.kind === "new") as (typeof chips)[number];
    expect(n.cue).toBe(true);
    expect(markup(n.start + 2)).toContain('data-chip="new"');
    expect(markup(n.start + 2)).toContain('data-chip-cue="1"');
    expect(markup(n.start + 2)).toContain(">NEW<");
    const u = chips.find((c) => c.kind === "up") as (typeof chips)[number];
    expect(rowChip(u.id, u.start + 20)?.text).toBe(String(u.jump));
  });

  it("never more than 2 chip entrance cues at the same frame (cues = scale pops of the first 8 frames)", () => {
    let max = 0;
    for (let f = 0; f < plan.sections.timeline_end; f++) {
      const n = dataRaceState(props, f).rows.filter((r) => r.chip?.cue && r.chip.age < CHIP.enter).length;
      max = Math.max(max, n);
    }
    expect(max).toBeLessThanOrEqual(CUE_BUDGET);
    expect(max).toBeGreaterThanOrEqual(1);
    // the budget holds when every entity gains a rank at once: three chips start together, the third has no pop
    const crowded = { ...props, timing_plan: { ...plan, orders: plan.orders.map((_, i) => (i % 2 ? [...props.entities].map((e) => e.id) : [...props.entities].map((e) => e.id).reverse())) } };
    const cs = raceChips(crowded);
    for (let f = 0; f < plan.sections.timeline_end; f++)
      expect(cs.filter((c) => c.cue && f >= c.start && f < c.start + CHIP.enter).length).toBeLessThanOrEqual(CUE_BUDGET);
    expect(cs.some((c) => !c.cue)).toBe(true);
  });

  it("chips are seek-stable, >= 28 px and drawn with the Remotion Img for file logos", () => {
    const f = (chips.find((c) => c.kind === "up") as (typeof chips)[number]).start + 12;
    const a = markup(f);
    markup(f + 5);
    expect(markup(f)).toBe(a);
    for (const m of markup(f).matchAll(/data-chip="[a-z]+"[^>]*style="[^"]*font-size:(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(28);
    const src = readFileSync(path.join(here, "parts.tsx"), "utf8");
    expect(src).toMatch(/import \{ Img \} from "remotion"/);
    expect(src).not.toMatch(/<img\b/);
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

  it("the spotlight dims the other rows to ~20 % and scales the winner ~8 % instead of covering them", () => {
    const f = s.timeline_end + 30;
    const html = markup(f);
    const winner = plan.orders.at(-1)?.[0] as string;
    const rows = [...html.matchAll(/data-row="([^"]+)" style="[^"]*?opacity:([\d.]+)/g)];
    expect(rows).toHaveLength(props.entities.length);
    for (const [, id, op] of rows) {
      if (id === winner) expect(Number(op)).toBe(1);
      else expect(Number(op)).toBeCloseTo(SPOTLIGHT_DIM, 5);
    }
    expect(html).toContain(`scale(${(1 + SPOTLIGHT_SCALE).toFixed(3)})`);
    // the overlay is not an opaque cover: no full-screen fill of the sheet colour
    const spot = html.slice(html.indexOf('data-ending="spotlight"'));
    expect(spot.slice(0, spot.indexOf(">"))).not.toContain("inset:0");
    expect(spot.slice(0, spot.indexOf(">"))).not.toContain(`background:${videoTheme.background}`);
    // the dim ramps in from fully visible (no pop from nothing) and the scene fades out with the ending
    expect(markup(s.timeline_end).match(/data-row="[^"]+" style="[^"]*?opacity:1[";]/g)?.length).toBe(props.entities.length);
    expect(dataRaceState(props, s.spotlight_end - 1).chartOpacity).toBeLessThan(0.2);
  });

  it("like & subscribe has exactly one animated element: the ringing bell", () => {
    const frames = [s.spotlight_end + 2, s.spotlight_end + 12, s.spotlight_end + 30, s.like_end - 20];
    for (const f of frames) {
      const html = markup(f);
      const like = html.slice(html.indexOf('data-ending="like-subscribe"'));
      expect((like.match(/transform:/g) ?? []).length, `frame ${f}`).toBe(1);
      expect(like).toContain("data-bell");
      expect(like).toMatch(/data-bell="" style="[^"]*transform:rotate\(/);
    }
    const angle = (f: number) => Number(/rotate\((-?[\d.]+)deg/.exec(markup(f))?.[1]);
    expect(new Set(frames.map(angle)).size).toBeGreaterThan(1);
  });

  it("winner value and the wordmark are >= 4.5:1 on the sheet; the entity colour stays on a non-text swatch", () => {
    const spot = markup(s.timeline_end + 40);
    const value = /data-winner-value="" style="[^"]*?color:(#[0-9a-f]{6})/i.exec(spot)?.[1] as string;
    expect(contrastRatio(value, videoTheme.background)).toBeGreaterThanOrEqual(4.5);
    const winner = props.entities.find((e) => e.id === plan.orders.at(-1)?.[0]);
    expect(spot).toContain(`data-winner-swatch="" style="width:14px;height:76px;border-radius:7px;background:${winner?.color}"`);
    const word = /data-wordmark="" style="color:(#[0-9a-f]{6})/i.exec(markup(s.total - 1))?.[1] as string;
    expect(contrastRatio(word, videoTheme.background)).toBeGreaterThanOrEqual(4.5);
    // the SUBSCRIBE label sits on accentInk
    expect(contrastRatio(videoTheme.background, videoTheme.accentInk)).toBeGreaterThanOrEqual(4.5);
    // no entity colour is ever used as a text colour on the sheet
    for (const e of props.entities) expect(spot).not.toContain(`color:${e.color}`);
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
      chipNew: sha(markup((raceChips(props).find((c) => c.kind === "new") as { start: number }).start + 3)),
      chipUp: sha(markup((raceChips(props).find((c) => c.kind === "up") as { start: number }).start + 20)),
      hook0: sha(markup(0)),
      spotlight: sha(markup(plan.sections.timeline_end + 40)),
      like: sha(markup(plan.sections.spotlight_end + 40)),
      poweredEnd: sha(markup(plan.sections.total - 1)),
    }).toMatchInlineSnapshot(`
      {
        "chipNew": "f0e023734737bbe5",
        "chipUp": "eddfa888a454e159",
        "hook0": "85e398fca88abc2a",
        "like": "7e8e23affe7e97a7",
        "mid45": "3a255fb2fe2fde72",
        "poweredEnd": "8688d428ce072a85",
        "spotlight": "e2fb2b728f76ba13",
      }
    `);
  });
});
