import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { videoTheme } from "@statreel/design-tokens";
import { type EraAdjustedProps, EraAdjustedPropsSchema, sampleEraProps } from "@statreel/schemas";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  audioCues,
  COMPOSITIONS,
  calculateEraMetadata,
  compositionIdFor,
  criticalBox,
  DISCLOSURE_TEXT,
  EraAdjustedFrame,
  type EraAdjustedInput,
  FONTS_USED,
  frameLayout,
  frameState,
  resolveScenes,
} from "./index";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const props = EraAdjustedPropsSchema.parse(sampleEraProps) as EraAdjustedProps;

const markup = (t: number, format: "vertical" | "landscape" = "vertical", p: EraAdjustedInput = props) =>
  renderToStaticMarkup(<EraAdjustedFrame props={p} t={t} format={format} theme={videoTheme} />);
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const timeline = {
  duration_s: 61.3,
  scenes: [
    { scene_id: "hook", start_s: 0, end_s: 4.2, voice_src: "file:///audio/hook.mp3" },
    { scene_id: "context", start_s: 4.2, end_s: 15, voice_src: "file:///audio/context.mp3" },
    { scene_id: "reveal", start_s: 15, end_s: 33 },
    { scene_id: "payoff", start_s: 33, end_s: 50, voice_src: "file:///audio/payoff.mp3" },
    { scene_id: "close", start_s: 50, end_s: 61.3, voice_src: "file:///audio/close.mp3" },
  ],
  words: [],
  cues: [
    {
      start_s: 0.2,
      end_s: 2.4,
      lines: ["Most points is not", "most dominant."],
      words: [
        { scene_id: "hook", display: "Most", spoken: "Most", start_s: 0.2, end_s: 0.5 },
        { scene_id: "hook", display: "points", spoken: "points", start_s: 0.5, end_s: 0.9 },
        { scene_id: "hook", display: "is", spoken: "is", start_s: 0.9, end_s: 1.1 },
        { scene_id: "hook", display: "not", spoken: "not", start_s: 1.1, end_s: 1.4 },
        { scene_id: "hook", display: "most", spoken: "most", start_s: 1.4, end_s: 1.8 },
        { scene_id: "hook", display: "dominant.", spoken: "dominant.", start_s: 1.8, end_s: 2.4 },
      ],
    },
  ],
  music: [{ src: "file:///audio/bed.mp3", start_s: 0, end_s: 61.3, gain_db: -6 }],
  voice_lead_s: 0.8,
};

describe("scene timing", () => {
  it("splits a 58 s default evenly without a timeline", () => {
    const s = resolveScenes(props.scenes, undefined);
    expect(s.map((x) => [x.kind, +x.start.toFixed(2), +x.end.toFixed(2)])).toEqual([
      ["hook", 0, 11.6],
      ["context", 11.6, 23.2],
      ["reveal", 23.2, 34.8],
      ["payoff", 34.8, 46.4],
      ["close", 46.4, 58],
    ]);
  });

  it("follows the timeline; picture cuts voice_lead_s after the voice, hook at 0", () => {
    const s = resolveScenes(props.scenes, timeline);
    expect(s[0]?.start).toBe(0);
    expect(s[1]?.start).toBeCloseTo(5.0);
    expect(s.at(-1)?.end).toBe(61.3);
  });

  it("hook fully visible at frame 0; chart and callout not yet", () => {
    const st = frameState(resolveScenes(props.scenes, undefined), 0);
    expect(st.hookOpacity).toBe(1);
    expect(st.chartOpacity).toBe(0);
    expect(st.callout.opacity).toBe(0);
  });

  it("ends on the reframe close with the chart gone (loops onto the hook frame)", () => {
    const st = frameState(resolveScenes(props.scenes, undefined), 57.9);
    expect(st.closeOpacity).toBe(1);
    expect(st.chartOpacity).toBe(0);
    expect(st.hookOpacity).toBe(0);
  });

  it("reveal draws the lines; payoff shows the callout", () => {
    const scenes = resolveScenes(props.scenes, undefined);
    expect(frameState(scenes, 23).lineProgress).toBe(0);
    expect(frameState(scenes, 34.5).lineProgress).toBe(1);
    expect(frameState(scenes, 40).callout.opacity).toBe(1);
  });
});

describe("audio", () => {
  it("places voice at each scene start and converts music gain from dB", () => {
    const cues = audioCues(timeline, 30);
    const voice = cues.filter((c) => c.key.startsWith("voice"));
    expect(voice.map((c) => [c.src, c.from])).toEqual([
      ["file:///audio/hook.mp3", 0],
      ["file:///audio/context.mp3", 126],
      ["file:///audio/payoff.mp3", 990],
      ["file:///audio/close.mp3", 1500],
    ]);
    const music = cues.find((c) => c.key.startsWith("music"));
    expect(music?.volume).toBeCloseTo(0.501, 3);
    expect(music?.durationInFrames).toBe(1839);
    expect(audioCues(undefined, 30)).toEqual([]);
  });
});

describe("metadata", () => {
  const abortSignal = new AbortController().signal;
  const call = (p: unknown, compositionId = "EraAdjustedSlope-vertical") =>
    calculateEraMetadata({
      props: p as never,
      defaultProps: p as never,
      abortSignal,
      compositionId,
      isRendering: true,
    });

  it("duration = ceil(duration_s * fps), 58 s default", async () => {
    expect((await call(sampleEraProps)).durationInFrames).toBe(1740);
    expect((await call({ ...sampleEraProps, timing: timeline })).durationInFrames).toBe(1839);
  });

  it("enforces the refined schema Remotion cannot take", () => {
    const noClose = { ...sampleEraProps, scenes: sampleEraProps.scenes.slice(0, 4) };
    expect(() => call(noClose)).toThrow(/reframe close/);
  });

  it("ids per format", () => {
    expect(compositionIdFor("vertical")).toBe("EraAdjustedSlope-vertical");
    expect(compositionIdFor("landscape")).toBe("EraAdjustedSlope-landscape");
    expect(COMPOSITIONS.map((c) => [c.width, c.height, c.fps])).toEqual([
      [1080, 1920, 30],
      [1920, 1080, 30],
    ]);
  });
});

describe("fonts", () => {
  it("uses only the three OFL families from fonts/, with manifest hashes", () => {
    expect([...new Set(FONTS_USED.map((f) => f.family))].sort()).toEqual([
      "Barlow Condensed",
      "Inter",
      "JetBrains Mono",
    ]);
    for (const f of FONTS_USED) {
      expect(f.license).toBe("OFL-1.1");
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.file.startsWith("fonts/")).toBe(true);
      expect(existsSync(path.join(repoRoot, f.file))).toBe(true);
    }
  });
});

describe("frame", () => {
  const inside = (r: { x: number; y: number; width: number; height: number }, box: typeof r) =>
    r.x >= box.x && r.y >= box.y && r.x + r.width <= box.x + box.width && r.y + r.height <= box.y + box.height;

  for (const format of ["vertical", "landscape"] as const) {
    it(`${format}: every text region sits inside the critical box and above the captions`, () => {
      const L = frameLayout(format);
      const c = criticalBox(format);
      for (const k of ["meta", "method", "headline", "chart", "statement", "callout"] as const) {
        expect(inside(L[k], c), `${k} inside critical box`).toBe(true);
        expect(L[k].y + L[k].height, `${k} above captions`).toBeLessThanOrEqual(L.captionTop);
      }
    });
  }

  it("the vertical critical box is 65..950 x 270..1250", () => {
    expect(criticalBox("vertical")).toEqual({ x: 65, y: 270, width: 885, height: 980 });
  });

  it("shows the hook sentence at t = 0 with disclosure, attribution and method note", () => {
    const html = markup(0);
    expect(html).toContain('data-statement="hook"');
    expect(html).toContain("MOST POINTS");
    expect(html).toContain(DISCLOSURE_TEXT.replace("·", "·"));
    expect(html).toContain("Data: F1DB (CC BY 4.0)");
    expect(html).toContain("Indy 500 excluded");
    expect(html).not.toContain("data-payoff");
  });

  it("payoff is rank-led and labelled era-adjusted", () => {
    const html = markup(40);
    expect(html).toContain("data-payoff");
    expect(html).toContain("43RD");
    expect(html).toContain("ERA-ADJUSTED RANK");
    expect(html).toContain("· ERA-ADJUSTED");
  });

  it("the accent is used for the highlight only", () => {
    const html = markup(33);
    const accents = html.match(new RegExp(videoTheme.accent, "gi")) ?? [];
    // highlight line, its two dots and its two label pairs (rank + name, left and right)
    expect(accents.length).toBeGreaterThan(0);
    expect(accents.length).toBeLessThanOrEqual(7);
  });

  it("slopegraph labels are at least 28 px at 1080 w", () => {
    const html = markup(34);
    const sizes = [...html.matchAll(/<text[^>]*font-family="[^"]*JetBrains Mono[^"]*"[^>]*font-size="([\d.]+)"/g)].map(
      (m) => Number(m[1]),
    );
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(28);
  });

  it("burns in the caption active at t", () => {
    const html = markup(1, "vertical", { ...props, timing: timeline });
    expect(html).toContain("data-captions");
    expect(html).toContain("dominant.");
  });

  it("safe-zone overlay only when asked", () => {
    expect(markup(10)).not.toContain("data-safe-zone");
    expect(markup(10, "vertical", { ...props, show_safe_zone: true })).toContain("data-safe-zone");
  });

  it("is seek-stable: any frame renders identically in any order", () => {
    const times = [0.1, 10, 30, 40, 55];
    const forward = times.map((t) => markup(t));
    const backward = [...times]
      .reverse()
      .map((t) => markup(t))
      .reverse();
    expect(backward).toEqual(forward);
    expect(markup(30, "landscape")).toBe(markup(30, "landscape"));
  });

  it("golden frame hashes (update deliberately when the design changes)", () => {
    expect({
      t0: sha(markup(0.1)),
      t30: sha(markup(30)),
      t40: sha(markup(40)),
      l30: sha(markup(30, "landscape")),
    }).toMatchInlineSnapshot(`
      {
        "l30": "6ddddfeaddc1e586",
        "t0": "0a5622feffcb9352",
        "t30": "641fd14bfe141315",
        "t40": "9aa85afca1161ede",
      }
    `);
  });
});

describe("props contract", () => {
  it("the sample fixture parses and reads the hook from scenes[0]", () => {
    expect(props.scenes[0]?.kind).toBe("hook");
    expect(readFileSync(path.join(here, "EraAdjustedFrame.tsx"), "utf8")).toContain("BurnedCaptions");
  });
});
