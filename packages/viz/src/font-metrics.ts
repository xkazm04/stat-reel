/**
 * The generated advance-width table (font-metrics.generated.ts, from scripts/font-metrics.mjs) as
 * number arrays. No React, no DOM.
 */
import { FONT_ADVANCES_CSV, FONT_METRIC_CODES_CSV } from "./font-metrics.generated";

const nums = (csv: string): readonly number[] => csv.split(",").map(Number);

/** Codepoints the rows are indexed by: Latin-1 (U+0020-00FF) plus common punctuation and arrows. */
export const FONT_METRIC_CODES: readonly number[] = nums(FONT_METRIC_CODES_CSV);
/** "<face>-<weight>" -> advance in 1/1000 em per codepoint of `FONT_METRIC_CODES` (0 = glyph missing). */
export const FONT_ADVANCES: Readonly<Record<string, readonly number[]>> = Object.fromEntries(
  Object.entries(FONT_ADVANCES_CSV).map(([k, v]) => [k, nums(v)]),
);
