import { safeZoneLandscape, safeZoneVertical } from "@statreel/design-tokens";
import type { Cue, Format } from "@statreel/schemas";
import { measureText } from "@statreel/viz";

/** Burn-in type spec per format (DESIGN.md §6.5): Inter bold, graphite ink on the translucent sheet plate (ADR 009; colours come from the theme, not from this table). */
export const CAPTION_STYLE = {
  vertical: { fontSize: 76, lineHeight: 1.2, padX: 24, padY: 14, radius: 12, bottom: 1250 },
  landscape: {
    fontSize: 52,
    lineHeight: 1.2,
    padX: 20,
    padY: 10,
    radius: 10,
    bottom: safeZoneLandscape.height - safeZoneLandscape.bottom,
  },
} as const;

/**
 * Average advance width of Inter Bold in em (mixed case, digits, spaces). Only the character-count
 * proxy behind `fitCharsPerLine`; whether a line fits is decided by `estimateLineWidth`, which
 * measures real advances (upper case runs ~0.65 em, so this average under-measures it).
 */
export const AVG_CHAR_EM = 0.56;

/** CSS weight the burn-in style sets (BurnedCaptions `fontWeight`), so lines are measured at it. */
export const CAPTION_WEIGHT = 700;

export type CaptionBox = { x: number; y: number; width: number; maxHeight: number };

/**
 * Outer geometry the caption box may occupy (in frame pixels): horizontally the full safe zone,
 * vertically two lines plus padding, bottom edge at y=1250 (vertical) or above the landscape
 * bottom margin. The rendered box shrinks to its content and stays inside this rectangle.
 */
export function captionBox(format: Format): CaptionBox {
  const s = CAPTION_STYLE[format];
  const zone = format === "vertical" ? safeZoneVertical : safeZoneLandscape;
  const maxHeight = 2 * s.fontSize * s.lineHeight + 2 * s.padY;
  return {
    x: zone.left,
    y: s.bottom - maxHeight,
    width: zone.width - zone.left - zone.right,
    maxHeight,
  };
}

/**
 * Pixel width of one caption line at the burn-in size and weight: the sum of real Inter advances
 * from the OFL font table in @statreel/viz (kerning ignored, so an upper bound), the same
 * measurement DataRace text fit uses (DESIGN.md §6.2).
 */
export const estimateLineWidth = (line: string, format: Format): number =>
  measureText(line, CAPTION_STYLE[format].fontSize, "ui", 0, CAPTION_WEIGHT);

/** Inner text width available inside the caption box. */
export const captionTextWidth = (format: Format): number => captionBox(format).width - 2 * CAPTION_STYLE[format].padX;

/** Characters per line that fit the caption box at the burn-in size (conservative estimate). */
export const fitCharsPerLine = (format: Format): number =>
  Math.floor(captionTextWidth(format) / (AVG_CHAR_EM * CAPTION_STYLE[format].fontSize));

/** Number of cues with more than two lines or a line estimated wider than the caption box. */
export function captionSafeZoneViolations(cues: Cue[], format: Format): number {
  const maxW = captionTextWidth(format);
  return cues.filter((c) => c.lines.length > 2 || c.lines.some((l) => estimateLineWidth(l, format) > maxW)).length;
}
