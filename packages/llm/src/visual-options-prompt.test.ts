import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataRacePropsJsonSchema } from "@statreel/schemas";
import { describe, expect, it } from "vitest";

/**
 * The visual_options prompt may only ask the model to vary what DataRaceProps can carry (strict schema:
 * an unknown key is a rejected file and another paid turn). Registry data-video-art-direction/case-native-chart-form:
 * the chart form follows the story's move, and where the composition cannot change form the prompt must say so
 * and ask the model to report the mismatch instead of faking a variation.
 */
const prompt = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../prompts/generation/visual-options.md"),
  "utf8",
);
const keys = Object.keys((dataRacePropsJsonSchema().properties ?? {}) as Record<string, unknown>).join(" ");
const varyClause = (prompt.match(/Vary the look[^\n]*/) ?? [""])[0];

describe("visual-options.md varies only what the props carry", () => {
  it("does not ask for a chart form or a background the schema has no field for", () => {
    expect(varyClause).not.toBe("");
    expect(keys).not.toMatch(/chart|form\b|background/);
    expect(varyClause).not.toMatch(/palette, chart form|background treatment/);
    expect(varyClause).toMatch(/chart form is fixed/);
  });

  it("asks each rationale for the story's move and a form-fit verdict", () => {
    expect(prompt).toMatch(/story's move in one line/);
    expect(prompt).toMatch(/shows that move at its event moment or hides it/);
  });
});
