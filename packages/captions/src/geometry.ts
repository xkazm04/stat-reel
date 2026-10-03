import { safeZoneLandscape, safeZoneVertical } from "@statreel/design-tokens";
import type { Cue, Format } from "@statreel/schemas";

/** Burn-in type spec per format (DESIGN.md §6.5): Inter bold, white on the theme-driven sheet plate (ADR 009; colours come from the theme, not from this table). */
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

/** Conservative average advance width of Inter Bold, in em (mixed case, digits, spaces). */
export const AVG_CHAR_EM = 0.56;

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

/** Estimated pixel width of one caption line at the burn-in font size. */
export const estimateLineWidth = (line: string, format: Format): number =>
  line.length * AVG_CHAR_EM * CAPTION_STYLE[format].fontSize;

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
