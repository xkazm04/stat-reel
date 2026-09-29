import type { CharAlignment, ScriptScene } from "@statreel/schemas";
import { sampleScript } from "@statreel/schemas";
import { describe, expect, it } from "vitest";
import { wordsFromAlignment } from "./index";

/** One entry per character, each lasting `d` seconds, starting at `t0`. */
function alignmentFor(text: string, d = 0.05, t0 = 0): CharAlignment {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => t0 + i * d),
    character_end_times_seconds: characters.map((_, i) => t0 + (i + 1) * d),
  };
}

const hook = sampleScript.scenes[0] as ScriptScene;

describe("wordsFromAlignment", () => {
  it("maps each script token to its character span and shifts by the scene offset", () => {
    const text = "The most dominant driver won twenty-four races.";
    const words = wordsFromAlignment(hook, alignmentFor(text, 0.1), 10);
    expect(words).toHaveLength(hook.tokens.length);
    expect(words.map((w) => w.display)).toEqual(["The", "most", "dominant", "driver", "won", "24", "races."]);
    const tf = words[5];
    expect(tf?.spoken).toBe("twenty-four");
    const i = text.indexOf("twenty-four");
    expect(tf?.start_s).toBeCloseTo(10 + i * 0.1, 6);
    expect(tf?.end_s).toBeCloseTo(10 + (i + "twenty-four".length) * 0.1, 6);
    expect(words[0]).toMatchObject({ scene_id: "hook", display: "The", spoken: "The", start_s: 10 });
    expect(words[0]?.end_s).toBeCloseTo(10.3, 6);
  });

  it("treats a multi-word spoken phrase as one token span ('105' -> 'one hundred and five')", () => {
    const scene: ScriptScene = {
      scene_id: "reveal",
      tokens: [
        { display: "He", spoken: "He" },
        { display: "scored", spoken: "scored" },
        { display: "105", spoken: "one hundred and five", literal: "test" },
        { display: "points.", spoken: "points." },
      ],
    };
    const text = "He scored one hundred and five points.";
    const words = wordsFromAlignment(scene, alignmentFor(text, 0.05), 2);
    expect(words).toHaveLength(4);
    const w = words[2];
    expect(w).toMatchObject({ display: "105", spoken: "one hundred and five" });
    const i = text.indexOf("one");
    const j = text.indexOf("five") + 4;
    expect(w?.start_s).toBeCloseTo(2 + i * 0.05, 6);
    expect(w?.end_s).toBeCloseTo(2 + j * 0.05, 6);
    expect(words[3]?.start_s).toBeCloseTo(2 + text.indexOf("points") * 0.05, 6);
  });

  it("is robust to leading/trailing and doubled whitespace characters in the alignment", () => {
    const text = "  The most  dominant driver won twenty-four races. ";
    const words = wordsFromAlignment(hook, alignmentFor(text, 0.1), 0);
    expect(words[0]?.start_s).toBeCloseTo(0.2, 6);
    expect(words[2]?.display).toBe("dominant");
    expect(words[2]?.start_s).toBeCloseTo(text.indexOf("dominant") * 0.1, 6);
    expect(words[6]?.end_s).toBeCloseTo((text.indexOf("races.") + 6) * 0.1, 6);
  });

  it("throws a clear error when the alignment text differs from the spoken text", () => {
    expect(() => wordsFromAlignment(hook, alignmentFor("The most dominant driver won 24 races."), 0)).toThrow(
      /does not match spoken text.*hook/,
    );
  });

  it("throws when alignment arrays have different lengths", () => {
    const a = alignmentFor("The most dominant driver won twenty-four races.");
    a.character_end_times_seconds.pop();
    expect(() => wordsFromAlignment(hook, a, 0)).toThrow(/lengths/);
  });
});

describe("phrase-level tokens (a co-pilot may chunk several words into one token)", () => {
  it("splits a token into per-word timings when display and spoken have the same word count", () => {
    const scene = { scene_id: "s", tokens: [{ display: "Lewis Hamilton leads.", spoken: "Lewis Hamilton leads." }] };
    const text = "Lewis Hamilton leads.";
    const chars = [...text];
    const alignment = { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.1), character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.1) };
    const words = wordsFromAlignment(scene, alignment, 0);
    expect(words.map((w) => w.display)).toEqual(["Lewis", "Hamilton", "leads."]);
    expect(words[1]!.start_s).toBeCloseTo(0.6);
  });

  it("keeps a token atomic when display and spoken word counts differ (105 / one hundred and five)", () => {
    const scene = { scene_id: "s", tokens: [{ display: "105 wins", spoken: "one hundred and five wins" }] };
    const text = "one hundred and five wins";
    const chars = [...text];
    const alignment = { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.1), character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.1) };
    expect(wordsFromAlignment(scene, alignment, 0).map((w) => w.display)).toEqual(["105 wins"]);
  });
});
