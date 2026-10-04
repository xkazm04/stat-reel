import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_RACE_LIMITS, ENDING_FRAMES } from "@statreel/schemas";
import { describe, expect, it } from "vitest";

/**
 * The generation agent learns the rules from prompts/generation/_rules.md ("binding; the validator rejects any
 * violation"); the validator enforces DATA_RACE_LIMITS / ENDING_FRAMES. A number the prompt states that the
 * validator does not hold costs a rejected props file and another paid turn, so every stated figure is checked here.
 */
const rules = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../prompts/generation/_rules.md"), "utf8");
const num = (re: RegExp): number[] => {
  const m = rules.match(re);
  if (!m) throw new Error(`_rules.md no longer states ${re}`);
  return m.slice(1).map(Number);
};

describe("_rules.md states the limits the generation validator enforces", () => {
  it("entity count", () => {
    expect(num(/min\((\d+), available\)/)).toEqual([DATA_RACE_LIMITS.maxEntities]);
  });

  it("video title length", () => {
    expect(num(/`title` is a single line of at most (\d+) characters/)).toEqual([DATA_RACE_LIMITS.titleMaxChars]);
  });

  it("event card title length", () => {
    expect(num(/Event card titles \(at most (\d+) characters/)).toEqual([DATA_RACE_LIMITS.eventTitleMaxChars]);
  });

  it("event card lifespan: default and allowed band", () => {
    expect(num(/`life_frames` defaults to (\d+) at 30 fps \(the validator allows (\d+)-(\d+)\)/)).toEqual([
      DATA_RACE_LIMITS.lifeFramesDefault,
      DATA_RACE_LIMITS.lifeFramesMin,
      DATA_RACE_LIMITS.lifeFramesMax,
    ]);
  });

  it("ending sequence frames", () => {
    expect(num(/winner spotlight:.*?\((\d+) frames\);.*?like & subscribe card \((\d+) frames\);.*?Powered by StatReel.*?\((\d+) frames\)/)).toEqual([
      ENDING_FRAMES.spotlight,
      ENDING_FRAMES.like,
      ENDING_FRAMES.powered,
    ]);
  });

  it("no text size under the 28 px floor (owner rule; the compositions test every readable text >= 28 px)", () => {
    const sizes = [...rules.matchAll(/(\d+) px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.filter((s) => s < 28)).toEqual([]);
  });
});
