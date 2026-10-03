import { videoTheme } from "@statreel/design-tokens";
import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "./contrast";

describe("contrast helpers", () => {
  it("matches the WCAG reference values", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 10);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    expect(contrastRatio("#ffffff", "#000000")).toBe(contrastRatio("#000000", "#ffffff"));
  });

  it("explains why entity colours are marks, never text: a yellow is ~2:1 on the sheet, the signal red as text needs accentInk", () => {
    expect(contrastRatio("#e0a100", videoTheme.background)).toBeLessThan(3);
    expect(contrastRatio(videoTheme.accent, videoTheme.background)).toBeLessThan(4.5);
    expect(contrastRatio(videoTheme.accentInk, videoTheme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(videoTheme.surface, videoTheme.accentInk)).toBeGreaterThanOrEqual(4.5);
  });
});
