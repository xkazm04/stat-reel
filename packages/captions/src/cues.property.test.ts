import type { Cue, Format, WordTiming } from "@statreel/schemas";
import { describe, expect, it } from "vitest";
import { buildCues, CUE_RULES } from "./index";

/**
 * Seeded property sweep over `buildCues` (DESIGN.md §6.5). The scenario tests in cues.test.ts pin
 * known shapes; this one throws random-but-realistic word timings at it and asserts the structural
 * invariants every cue list must keep: <= 2 lines, start < end, strictly ordered with the 2-frame
 * gap, every input word exactly once. mulberry32 keeps it deterministic with no dependency.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYLLABLES = ["ra", "ce", "lap", "pole", "fa", "ster", "grid", "ti", "tle", "dri", "ver", "ma", "ni", "ch"];
const ENDINGS = ["", "", "", "", ",", ".", "?", ";", "!", "…"];

function makeWords(seed: number): WordTiming[] {
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const n = int(1, 60);
  const words: WordTiming[] = [];
  let t = rnd() * 2;
  let scene = 0;
  for (let i = 0; i < n; i++) {
    if (rnd() < 0.08) scene++;
    // 1-4 syllables, occasionally a very long word (up to ~34 chars, past the line limit)
    const syl = rnd() < 0.05 ? int(10, 14) : int(1, 4);
    let text = "";
    for (let s = 0; s < syl; s++) text += SYLLABLES[int(0, SYLLABLES.length - 1)];
    const display = text + (ENDINGS[int(0, ENDINGS.length - 1)] ?? "");
    // aligner bursts: a few words crammed into a couple of frames
    const dur = rnd() < 0.1 ? 0.002 + rnd() * 0.02 : 0.08 + rnd() * 0.7;
    words.push({ scene_id: `s${scene}`, display, spoken: text, start_s: t, end_s: t + dur });
    // a standalone punctuation token glued to the word, as some aligners emit
    if (rnd() < 0.06) words.push({ scene_id: `s${scene}`, display: ",", spoken: "", start_s: t + dur, end_s: t + dur });
    // tight gaps (0 .. 1 frame) most of the time, a pause now and then
    t += dur + (rnd() < 0.15 ? rnd() * 1.2 : rnd() < 0.3 ? 0 : rnd() * 0.03);
  }
  return words;
}

function violations(cues: Cue[], words: WordTiming[], fps: number): string[] {
  const bad: string[] = [];
  const seen = new Map<WordTiming, number>();
  for (const c of cues) for (const w of c.words) seen.set(w, (seen.get(w) ?? 0) + 1);
  for (const w of words) if (seen.get(w) !== 1) bad.push(`word "${w.display}" appears ${seen.get(w) ?? 0}x`);
  if (seen.size !== words.length) bad.push("cues carry words that were not in the input");
  cues.forEach((c, i) => {
    if (c.lines.length < 1 || c.lines.length > CUE_RULES.maxLines) bad.push(`cue ${i}: ${c.lines.length} lines`);
    if (!(c.start_s < c.end_s)) bad.push(`cue ${i}: start ${c.start_s} >= end ${c.end_s}`);
    const prev = cues[i - 1];
    if (prev) {
      const gapF = Math.round((c.start_s - prev.end_s) * fps);
      if (gapF < CUE_RULES.minGapFrames) bad.push(`cue ${i}: gap ${gapF} frames after cue ${i - 1}`);
      if (!(c.start_s > prev.start_s)) bad.push(`cue ${i}: start not after cue ${i - 1}`);
    }
  });
  return bad;
}

const FORMATS: Format[] = ["vertical", "landscape"];
const FPS_SET = [24, 30, 60];

describe("buildCues invariants over seeded random words", () => {
  it("holds for 600 seeds across formats and frame rates", () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 600; seed++) {
      const words = makeWords(seed);
      const format = FORMATS[seed % 2] as Format;
      const fps = FPS_SET[seed % 3] as number;
      const cues = buildCues(words, { format, fps });
      for (const v of violations(cues, words, fps)) failures.push(`seed ${seed} (${format} ${fps}fps): ${v}`);
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });
});
