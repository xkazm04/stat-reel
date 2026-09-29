/**
 * Frame geometry per format. Every text-bearing region sits inside the critical box of the union
 * safe zone (DESIGN.md §6.5) and above the caption box of @statreel/captions.
 */
import { safeZoneLandscape, safeZoneVertical } from "@statreel/design-tokens";
import type { Format } from "@statreel/schemas";

export type Rect = { x: number; y: number; width: number; height: number };

export type FrameLayout = {
  width: number;
  height: number;
  /** the critical-content box */
  critical: Rect;
  meta: Rect;
  method: Rect;
  headline: Rect;
  chart: Rect;
  /** hook + close (reframe) sentence block */
  statement: Rect;
  callout: Rect;
  /** top of the caption box (captions draw below this line) */
  captionTop: number;
  metaFontSize: number;
  methodFontSize: number;
};

/** Inset from the critical box edge, so estimated text widths keep a margin. */
const INSET = 8;

export function criticalBox(format: Format): Rect {
  const z = format === "vertical" ? safeZoneVertical : safeZoneLandscape;
  return { x: z.left, y: z.top, width: z.width - z.left - z.right, height: z.height - z.top - z.bottom };
}

export function frameLayout(format: Format): FrameLayout {
  const c = criticalBox(format);
  const x = c.x + INSET;
  const w = c.width - 2 * INSET;
  if (format === "vertical") {
    // caption box (vertical): 2 x 76 px x 1.2 + 2 x 14 px padding, bottom edge at 1250 -> top ~1039.6
    const captionTop = 1040;
    return {
      width: safeZoneVertical.width,
      height: safeZoneVertical.height,
      critical: c,
      meta: { x, y: c.y + 2, width: w, height: 34 },
      method: { x, y: c.y + 44, width: w, height: 48 },
      headline: { x, y: 382, width: w, height: 56 },
      chart: { x, y: 448, width: w, height: captionTop - 8 - 448 },
      statement: { x, y: 390, width: w, height: captionTop - 30 - 390 },
      callout: { x, y: 448, width: w, height: captionTop - 8 - 448 },
      captionTop,
      metaFontSize: 22,
      methodFontSize: 19,
    };
  }
  // landscape: caption box 2 x 52 px x 1.2 + 2 x 10 px, bottom edge at 990 -> top ~845
  const captionTop = 845;
  const colGap = 64;
  const leftW = Math.round(w * 0.45);
  const chartX = x + leftW + colGap;
  return {
    width: safeZoneLandscape.width,
    height: safeZoneLandscape.height,
    critical: c,
    meta: { x, y: c.y + 2, width: w, height: 32 },
    method: { x, y: c.y + 42, width: w, height: 30 },
    headline: { x, y: 170, width: leftW, height: 220 },
    chart: { x: chartX, y: 160, width: x + w - chartX, height: captionTop - 16 - 160 },
    statement: { x, y: 170, width: Math.round(w * 0.62), height: captionTop - 30 - 170 },
    callout: { x, y: 170, width: leftW, height: captionTop - 16 - 170 },
    captionTop,
    metaFontSize: 22,
    methodFontSize: 20,
  };
}
