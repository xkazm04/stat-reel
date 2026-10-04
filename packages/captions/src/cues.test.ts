import type { Cue, WordTiming } from "@statreel/schemas";
import { describe, expect, it } from "vitest";
import { buildCues, CUE_RULES, cueCps, joinDisplay, layoutLines, maxCharsPerLine, maxCps } from "./index";

const FPS = 30;

/** Words of `text` spoken back-to-back at `cps` characters per second (spaces included), from `t0`. */
function spoken(scene_id: string, text: string, cps: number, t0 = 0): WordTiming[] {
  const out: WordTiming[] = [];
  let t = t0;
  for (const w of text.split(" ")) {
    const d = (w.length + 1) / cps;
    out.push({ scene_id, display: w, spoken: w, start_s: t, end_s: t + d });
    t += d;
  }
  return out;
}

const lastEnd = (ws: WordTiming[]) => ws.at(-1)?.end_s ?? 0;
const LONG =
  "Juan Manuel Fangio won five world titles in the fifties, and when you adjust for the era he still ranks first among every driver who ever raced.";

function checkInvariants(cues: Cue[], words: WordTiming[], lineMax: number) {
  expect(cues.flatMap((c) => c.words)).toEqual(words);
  for (const c of cues) {
    expect(c.lines.length).toBeGreaterThanOrEqual(1);
    expect(c.lines.length).toBeLessThanOrEqual(2);
    for (const l of c.lines) expect(l.length).toBeLessThanOrEqual(lineMax);
    // never split inside a word: the lines are exactly the cue's words, re-joined
    expect(c.lines.join(" ")).toBe(joinDisplay(c.words.map((w) => w.display)));
    expect(new Set(c.words.map((w) => w.scene_id)).size).toBe(1);
    expect(c.end_s - c.start_s).toBeLessThanOrEqual(CUE_RULES.maxDuration_s + 1e-9);
    expect(c.end_s).toBeGreaterThan(c.start_s);
    expect(Math.abs(c.start_s * FPS - Math.round(c.start_s * FPS))).toBeLessThan(1e-6);
    expect(Math.abs(c.end_s * FPS - Math.round(c.end_s * FPS))).toBeLessThan(1e-6);
  }
  for (let i = 1; i < cues.length; i++) {
    const gapFrames = ((cues[i]?.start_s ?? 0) - (cues[i - 1]?.end_s ?? 0)) * FPS;
    expect(gapFrames).toBeGreaterThanOrEqual(CUE_RULES.minGapFrames - 1e-6);
  }
}

describe("line limits", () => {
  it("vertical never exceeds 32 chars/line (and fits the caption box), landscape allows 42", () => {
    expect(maxCharsPerLine("vertical")).toBeLessThanOrEqual(32);
    expect(maxCharsPerLine("landscape")).toBe(42);
    const words = spoken("s1", LONG, 15);
    const v = buildCues(words, { format: "vertical", fps: FPS });
    const l = buildCues(words, { format: "landscape", fps: FPS });
    checkInvariants(v, words, maxCharsPerLine("vertical"));
    checkInvariants(l, words, 42);
    expect(l.length).toBeLessThan(v.length);
    expect(l.some((c) => c.lines.some((line) => line.length > 32))).toBe(true);
  });

  it("an explicit maxCharsPerLine of 32 is honoured for vertical", () => {
    const words = spoken("s1", LONG, 15);
    const v = buildCues(words, { format: "vertical", fps: FPS, maxCharsPerLine: 32 });
    checkInvariants(v, words, 32);
    expect(v.some((c) => c.lines.some((line) => line.length > 20))).toBe(true);
  });

  it("layoutLines applies the width predicate on top of the char cap; a lone unbreakable atom is exempt", () => {
    const narrow = (l: string) => l.length <= 6;
    expect(layoutLines(["ab", "cd", "ef"], 32)).toEqual(["ab cd ef"]);
    expect(layoutLines(["ab", "cd", "ef"], 32, narrow)).toEqual(["ab", "cd ef"]);
    expect(layoutLines(["abcdefghij", "cd"], 32, narrow)).toEqual(["abcdefghij", "cd"]);
    expect(layoutLines(["ab", "cd", "ef", "gh", "ij"], 32, narrow)).toBeNull();
  });

  it("balances two-line cues", () => {
    const words = spoken("s1", "The adjusted ranking puts him first by a margin nobody expected", 15);
    const [c] = buildCues(words, { format: "landscape", fps: FPS });
    expect(c?.lines).toHaveLength(2);
    expect(Math.abs((c?.lines[0]?.length ?? 0) - (c?.lines[1]?.length ?? 0))).toBeLessThanOrEqual(8);
  });
});

describe("segmentation preferences", () => {
  it("prefers breaking after punctuation", () => {
    const words = spoken("s1", "Fangio won five titles. Nobody else came close in that era.", 15);
    const cues = buildCues(words, { format: "vertical", fps: FPS });
    checkInvariants(cues, words, maxCharsPerLine("vertical"));
    expect(cues.some((c) => c.words.at(-1)?.display === "titles.")).toBe(true);
  });

  it("always breaks at scene boundaries", () => {
    const a = spoken("hook", "Fangio was", 15);
    const b = spoken("context", "the best.", 15, lastEnd(a));
    const cues = buildCues([...a, ...b], { format: "landscape", fps: FPS });
    expect(cues).toHaveLength(2);
    expect(cues.map((c) => c.lines[0])).toEqual(["Fangio was", "the best."]);
  });

  it("glues punctuation-only tokens to the previous word", () => {
    const words: WordTiming[] = [
      { scene_id: "s", display: "Wait", spoken: "Wait", start_s: 0, end_s: 0.4 },
      { scene_id: "s", display: "!", spoken: "!", start_s: 0.4, end_s: 0.45 },
      { scene_id: "s", display: "Really", spoken: "Really", start_s: 0.6, end_s: 1.1 },
    ];
    const [c] = buildCues(words, { format: "vertical", fps: FPS });
    expect(c?.lines).toEqual(["Wait! Really"]);
  });

  it("a token with a blank display form adds no text: no doubled spaces in lines or burn-in grouping", () => {
    const words: WordTiming[] = [
      { scene_id: "s", display: "Fangio", spoken: "Fangio", start_s: 0, end_s: 0.4 },
      { scene_id: "s", display: "", spoken: "uh", start_s: 0.4, end_s: 0.6 },
      { scene_id: "s", display: "won", spoken: "won", start_s: 0.6, end_s: 0.9 },
      { scene_id: "s", display: " ", spoken: "well", start_s: 0.9, end_s: 1.1 },
      { scene_id: "s", display: "again.", spoken: "again.", start_s: 1.1, end_s: 1.5 },
    ];
    const cues = buildCues(words, { format: "vertical", fps: FPS });
    expect(cues.flatMap((c) => c.lines)).toEqual(["Fangio won again."]);
    expect(cues.flatMap((c) => c.words)).toEqual(words);
    expect(joinDisplay(["Fangio", "", "won", " ", "again."])).toBe("Fangio won again.");
  });

  it("returns no cues for no words", () => {
    expect(buildCues([], { format: "vertical", fps: FPS })).toEqual([]);
  });
});

describe("timing rules", () => {
  it("keeps a minimum gap of 2 frames between contiguous cues (chained)", () => {
    const words = spoken("s1", LONG, 16);
    const cues = buildCues(words, { format: "vertical", fps: FPS });
    checkInvariants(cues, words, maxCharsPerLine("vertical"));
    const gaps = cues.slice(1).map((c, i) => Math.round((c.start_s - (cues[i]?.end_s ?? 0)) * FPS));
    expect(gaps.every((g) => g >= 2)).toBe(true);
    expect(gaps.filter((g) => g === 2).length).toBeGreaterThan(0);
  });

  it("extends a short cue to the 0.8 s minimum when there is room", () => {
    const words: WordTiming[] = [
      { scene_id: "a", display: "Go.", spoken: "Go.", start_s: 0, end_s: 0.2 },
      { scene_id: "b", display: "Next", spoken: "Next", start_s: 3, end_s: 3.4 },
    ];
    const cues = buildCues(words, { format: "vertical", fps: FPS });
    expect(cues[0]?.end_s).toBeGreaterThanOrEqual(0.8 - 1e-9);
    expect(cues[1]?.end_s).toBeGreaterThanOrEqual(3.8 - 1e-9);
  });

  it("closes small gaps (< 0.5 s) down to 2 frames to avoid flicker", () => {
    const a = spoken("a", "First scene ends here.", 15);
    const b = spoken("b", "Second begins.", 15, lastEnd(a) + 0.3);
    const cues = buildCues([...a, ...b], { format: "landscape", fps: FPS });
    expect(cues).toHaveLength(2);
    expect(Math.round(((cues[1]?.start_s ?? 0) - (cues[0]?.end_s ?? 0)) * FPS)).toBe(2);
  });

  it("caps cue duration at 7 s", () => {
    const words: WordTiming[] = [
      { scene_id: "a", display: "Sloooow", spoken: "Sloooow", start_s: 0, end_s: 9 },
      { scene_id: "a", display: "word", spoken: "word", start_s: 9, end_s: 9.5 },
    ];
    const cues = buildCues(words, { format: "landscape", fps: FPS });
    for (const c of cues) expect(c.end_s - c.start_s).toBeLessThanOrEqual(7 + 1e-9);
  });
});

describe("reading speed", () => {
  it("cueCps counts characters incl. spaces over duration; maxCps takes the max", () => {
    const c: Cue = { start_s: 0, end_s: 1, lines: ["abc def"], words: [] };
    const d: Cue = { start_s: 2, end_s: 4, lines: ["abc", "de"], words: [] };
    expect(cueCps(c)).toBeCloseTo(7, 6);
    expect(cueCps(d)).toBeCloseTo(3, 6);
    expect(maxCps([c, d])).toBeCloseTo(7, 6);
    expect(maxCps([])).toBe(0);
  });

  it("a fast passage followed by a pause is extended into the gap so no cue exceeds 20 CPS", () => {
    for (const [format, text] of [
      ["vertical", "Five titles, twenty-four wins."],
      ["landscape", "Five titles, twenty-four wins, and a record that stood for decades."],
    ] as const) {
      const fast = spoken("reveal", text, 26);
      const next = spoken("payoff", "Nobody came close.", 15, lastEnd(fast) + 3);
      const words = [...fast, ...next];
      const cues = buildCues(words, { format, fps: FPS });
      checkInvariants(cues, words, maxCharsPerLine(format));
      const naturalCps = joinDisplay(fast.map((w) => w.display)).length / (lastEnd(fast) - (fast[0]?.start_s ?? 0));
      expect(naturalCps).toBeGreaterThan(20);
      expect(maxCps(cues)).toBeLessThanOrEqual(CUE_RULES.maxCps + 1e-9);
    }
  });

  it("splits a fast passage at an internal pause so the extension fits under 20 CPS", () => {
    const a = spoken("reveal", "Five titles, twenty-four wins", 26);
    const b = spoken("reveal", "and a record that stood.", 26, lastEnd(a) + 1);
    const next = spoken("payoff", "Nobody came close.", 15, lastEnd(b) + 3);
    const words = [...a, ...b, ...next];
    const cues = buildCues(words, { format: "vertical", fps: FPS });
    checkInvariants(cues, words, maxCharsPerLine("vertical"));
    expect(cues.some((c) => c.words.at(-1)?.display === "wins")).toBe(true);
    expect(maxCps(cues)).toBeLessThanOrEqual(CUE_RULES.maxCps + 1e-9);
  });

  it("reports (does not hide) CPS above 20 when no gap allows extension", () => {
    const words = spoken("reveal", LONG, 32);
    const cues = buildCues(words, { format: "vertical", fps: FPS, endLimit_s: lastEnd(words) });
    checkInvariants(cues, words, maxCharsPerLine("vertical"));
    expect(maxCps(cues)).toBeGreaterThan(20);
  });

  it("targets <= 17 CPS where the gap allows", () => {
    const words = spoken("s", "Twenty-four wins.", 30);
    const cues = buildCues(words, { format: "vertical", fps: FPS });
    expect(maxCps(cues)).toBeLessThanOrEqual(CUE_RULES.targetCps + 0.5);
  });
});
