/**
 * StatReel logo, concept C "Frame Stat" (a film frame with sprocket holes; four bars rise inside
 * like a growing chart). One geometry, three consumers: the studio icon (FrameStatMark), the
 * favicon and the video end card. Never redraw it elsewhere (ART-DIRECTION, "StatReel logo").
 * Plain TS, no React; the grid is 100 x 100 and `FRAME_STAT_VIEWBOX` crops to the frame.
 * Port of `frameStat` in the box prototype (statreel-logo.mjs), ADR 009 / spec section B.2.
 */

export type FrameStatRole = "frame" | "hole" | "window" | "bar";
export type FrameStatRect = { role: FrameStatRole; i: number; x: number; y: number; w: number; h: number; rx: number };

/** Crops the 100 x 100 grid to the frame bounds (x 6..94, y 14..86). */
export const FRAME_STAT_VIEWBOX = "6 14 88 72";
export const FRAME_STAT_BAR_HEIGHTS = [12, 20, 28, 36] as const;
const BAR_BASELINE = 67;

const ease = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
};
const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Every rect of the mark, back to front. `t` is the 0 -> 1 build-in: the bars grow with an ease-out,
 * staggered `t * 1.6 - i * 0.18`; a bar that has not started (height <= 0.2) is omitted.
 */
export function frameStatRects(t = 1): FrameStatRect[] {
  const out: FrameStatRect[] = [{ role: "frame", i: 0, x: 6, y: 14, w: 88, h: 72, rx: 9 }];
  for (let i = 0; i < 6; i++) {
    const x = 12 + i * 14;
    out.push({ role: "hole", i: i * 2, x, y: 19, w: 7, h: 6, rx: 1.6 });
    out.push({ role: "hole", i: i * 2 + 1, x, y: 75, w: 7, h: 6, rx: 1.6 });
  }
  out.push({ role: "window", i: 0, x: 12, y: 30, w: 76, h: 40, rx: 3 });
  FRAME_STAT_BAR_HEIGHTS.forEach((h, i) => {
    const hh = h * ease(t * 1.6 - i * 0.18);
    if (hh > 0.2) out.push({ role: "bar", i, x: 17 + i * 18, y: r2(BAR_BASELINE - hh), w: 12, h: r2(hh), rx: 2 });
  });
  return out;
}

/** Standalone SVG text of the mark (favicon, exports), filled from the given colours. */
export function frameStatSvg(c: { ink: string; paper: string; bars?: readonly [string, string, string, string] }, t = 1): string {
  const rects = frameStatRects(t)
    .map((r) => {
      const fill = r.role === "frame" ? c.ink : r.role === "bar" ? (c.bars?.[r.i] ?? c.ink) : c.paper;
      return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${r.rx}" fill="${fill}"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${FRAME_STAT_VIEWBOX}">${rects}</svg>`;
}
