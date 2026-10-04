/**
 * DataRace text layout: one module that owns the geometry of the 1080 x 1920 frame and fits every
 * text slot with MEASURED widths (real advances from the OFL fonts, packages/viz `measureText`).
 * No React, no DOM; every function is pure in (props, strings), so it is seek-stable and runs
 * unchanged in Node tests.
 *
 * Rule for every slot: a string the schema allows (DATA_RACE_LIMITS) is shown whole at >= 28 px.
 * The order of preference is: the nominal size on one line, a measured shrink toward 28 px, then a
 * wrap (at most `maxLines`, a word wider than the column is cut at a character), and only when the
 * string still cannot fit does the last line end in an explicit "...". Nothing is clipped silently.
 */
import { ellipsize, type FaceKey, fitText, measureText, wrapText } from "@statreel/viz";

/** All geometry for the 1080 x 1920 vertical frame. Safe box: y 150-1580, nothing right of x ~965. */
export const L = {
  width: 1080,
  height: 1920,
  marginX: 60,
  titleY: 150,
  unitRowY: 236,
  orderLabelY: 304,
  barsTop: 352,
  rowH: 74,
  barH: 52,
  tile: 60,
  nameX: 132,
  /** name column: wide enough for ~16 mixed-case characters at 28 px on one line, two lines beyond that */
  nameW: 232,
  barX: 376,
  /** barX + barMaxW = 824 as before: the name column took 32 px from the bar, not from the value labels */
  barMaxW: 448,
  cardX: 60,
  cardW: 840,
  cardTop: 1250,
  /** the sample badge sits just above the footer; see `footerLayout` */
  badgeH: 42,
  footerBottom: 1580,
} as const;

/** Right edge of anything the end of a bar draws: the platform icon column starts at ~x 965. */
export const LABEL_RIGHT = 965;
/** Width of the text columns that span the frame (title, hook, spotlight): marginX to 1020. */
export const FULL_W = L.width - 2 * L.marginX;
/** The footer stops at x 965, the edge of the platform icon column. */
export const FOOTER_W = LABEL_RIGHT - L.marginX;

type Fit = { fontSize: number; lines: string[]; truncated: boolean };

const MIN = 28;

/** Cuts the last of `lines` to fit (adding "...") when the layout still has more text than `maxLines` lines. */
function clampLines(
  lines: string[],
  maxLines: number,
  width: number,
  size: number,
  face: FaceKey,
  weight: number,
  ls = 0,
): Fit {
  if (lines.length <= maxLines) return { fontSize: size, lines, truncated: false };
  const kept = lines.slice(0, maxLines - 1);
  const rest = lines.slice(maxLines - 1).join(" ");
  return { fontSize: size, lines: [...kept, ellipsize(rest, width, size, face, ls, weight)], truncated: true };
}

/**
 * Fits `text` in `width`: one line at the largest size in [min, max] (unless `oneLineFirst` is false: a
 * display block that wants the largest size in <= `maxLines` lines), else the largest size at which
 * it wraps into <= `maxLines` lines, else the min size with the last line ellipsized.
 */
export function fitSlot(
  text: string,
  o: {
    width: number;
    max: number;
    min?: number;
    maxLines?: number;
    oneLineFirst?: boolean;
    face: FaceKey;
    weight: number;
    letterSpacingEm?: number;
    lineHeight?: number;
    maxHeight?: number;
  },
): Fit {
  const min = o.min ?? MIN;
  const maxLines = o.maxLines ?? 1;
  const base = {
    maxWidth: o.width,
    min,
    max: o.max,
    face: o.face,
    weight: o.weight,
    letterSpacingEm: o.letterSpacingEm ?? 0,
    breakWords: true,
    lineHeight: o.lineHeight ?? 1,
    maxHeight: o.maxHeight,
  };
  const one = o.oneLineFirst === false ? null : fitText(text, { ...base, maxLines: 1 });
  if (one?.fits) return { fontSize: one.fontSize, lines: one.lines, truncated: false };
  if (maxLines > 1) {
    const many = fitText(text, { ...base, maxLines });
    if (many.fits) return { fontSize: many.fontSize, lines: many.lines, truncated: false };
    // words alone leave a ragged edge that needs more lines: fill the lines by character instead
    const dense = fitText(text, { ...base, maxLines, flow: true });
    if (dense.fits) return { fontSize: dense.fontSize, lines: dense.lines, truncated: false };
  }
  const ls = (o.letterSpacingEm ?? 0) * min;
  const lines = wrapText(text, o.width, min, o.face, ls, { weight: o.weight, breakWords: true, flow: true });
  return clampLines(lines, maxLines, o.width, min, o.face, o.weight, ls);
}

/** Entity name in the bar row: one line at 36 -> 28 px, else two lines at the largest size that fits the row. */
export function nameLayout(name: string): Fit {
  return fitSlot(name, {
    width: L.nameW,
    max: 36,
    maxLines: 2,
    face: "condensed",
    weight: 700,
    lineHeight: 1.1,
    maxHeight: L.rowH - 8,
  });
}

/** One-line title: 64 -> 28 px (a normal title stays >= 40; only a wide one goes below). */
export const titleLayout = (title: string): Fit =>
  fitSlot(title, { width: FULL_W, max: 64, face: "condensed", weight: 800 });

/** Hook question: <= 3 centred lines, 96 -> 28 px, inside the 312 px band above the logo tiles. */
export const hookLayout = (hook: string): Fit =>
  fitSlot(hook, {
    width: FULL_W,
    max: 96,
    maxLines: 3,
    oneLineFirst: false,
    face: "condensed",
    weight: 800,
    lineHeight: 1.08,
    maxHeight: 3 * 104,
  });

/** The hook's logo tiles: 5 per row, 180 px wide, name up to 3 lines at 32 -> 28 px. */
export const HOOK_TILE_W = 180;
export const hookTileNameLayout = (name: string): Fit =>
  fitSlot(name, { width: HOOK_TILE_W, max: 32, maxLines: 3, face: "condensed", weight: 700, lineHeight: 1.1 });

/** The clock: mono, 52 px unless the widest period label would take more than 420 px (then it shrinks, >= 28). */
export const CLOCK_MAX_W = 420;
export function clockLayout(periods: readonly string[]): { fontSize: number; width: number } {
  let size = 52;
  const widest = (s: number): number => Math.max(...periods.map((p) => measureText(p, s, "mono", 0, 700)));
  while (size > MIN && widest(size) > CLOCK_MAX_W) size -= 2;
  return { fontSize: size, width: Math.ceil(widest(size)) };
}

/** Unit label left of the clock: 32 -> 28 px, one or two lines in what the clock leaves. */
export const UNIT_GAP = 24;
export function unitLayout(label: string, clockWidth: number): Fit & { width: number } {
  const width = FULL_W - 60 - clockWidth - UNIT_GAP;
  return {
    ...fitSlot(label, { width, max: 32, maxLines: 2, face: "ui", weight: 600, lineHeight: 1.1, maxHeight: 64 }),
    width,
  };
}

/** The footer source line: Inter 500 at 28 px in <= 2 lines, bottom-anchored at y 1580 (safe box). */
export const FOOTER_LINE_H = 32;
export function footerLayout(source: string): {
  lines: string[];
  truncated: boolean;
  top: number;
  height: number;
  badgeY: number;
} {
  const fit = fitSlot(source, { width: FOOTER_W, max: 28, maxLines: 2, face: "ui", weight: 500 });
  const height = fit.lines.length * FOOTER_LINE_H;
  const top = L.footerBottom - height;
  return { lines: fit.lines, truncated: fit.truncated, top, height, badgeY: top - 6 - L.badgeH };
}

/** Event card: content width = card - 44 (left rule) - 28 (right padding). */
export const CARD_TEXT_W = L.cardW - 44 - 28;
export const CARD_FACT_LINE_H = 34;
export type CardLayout = { title: Fit; facts: Fit[]; height: number };
export function cardLayout(event: { title: string; facts: readonly { text: string }[] }): CardLayout {
  const title = fitSlot(event.title, { width: CARD_TEXT_W, max: 46, face: "condensed", weight: 700 });
  const facts = event.facts.map((f) =>
    fitSlot(f.text, { width: CARD_TEXT_W, max: 28, maxLines: 2, face: "ui", weight: 500 }),
  );
  const lines = facts.reduce((n, f) => n + f.lines.length, 0);
  // 22 padding + 34 date + 6 + 54 title + 8 + facts + 20 padding
  const height = 22 + 34 + 6 + 54 + 8 + lines * CARD_FACT_LINE_H + 20;
  return { title, facts, height };
}

/** One spotlight stat: label (Inter 500) and value (Barlow 700, tabular), side by side when they fit, else stacked. */
export type SpotlightFact = { mode: "row" | "stack"; label: Fit; value: Fit; height: number };
export function spotlightFactLayout(f: { label: string; value_text: string }): SpotlightFact {
  const gap = 18;
  const label = fitSlot(f.label, { width: FULL_W, max: 32, maxLines: 2, face: "ui", weight: 500 });
  const value = fitSlot(f.value_text, { width: FULL_W, max: 60, face: "condensed", weight: 700 });
  const lw = Math.max(...label.lines.map((l) => measureText(l, label.fontSize, "ui", 0, 500)));
  const vw = Math.max(...value.lines.map((l) => measureText(l, value.fontSize, "condensed", 0, 700)));
  if (label.lines.length === 1 && lw + gap + vw <= FULL_W)
    return { mode: "row", label, value, height: Math.max(label.fontSize, value.fontSize) + 8 };
  const lh = label.lines.length * (label.fontSize + 4);
  return { mode: "stack", label, value, height: lh + value.fontSize + 8 };
}

/**
 * Winner spotlight block: the stats stack under the winner row. Its top is nominally 40 px under the
 * last bar row, but never lower than the footer allows (a pure function of the props).
 */
export function spotlightLayout(
  rows: number,
  facts: readonly { label: string; value_text: string }[],
  source: string,
): { top: number; facts: SpotlightFact[]; height: number } {
  const laid = facts.map(spotlightFactLayout);
  // 44 header + 14 + 120 winner row + 28 + stats with 14 gaps
  const height = 44 + 14 + 120 + 28 + laid.reduce((h, f) => h + f.height, 0) + Math.max(0, laid.length - 1) * 14;
  const nominal = L.barsTop + L.rowH * rows + 40;
  const limit = footerLayout(source).top - 12 - height;
  return { top: Math.max(L.barsTop + L.rowH * rows + 8, Math.min(nominal, limit)), facts: laid, height };
}

/** Spotlight winner row: name (Barlow 800, <= 2 lines, 88 -> 28 px) beside a value that may shrink (84 -> 28 px). */
export function winnerLayout(name: string, valueText: string): { name: Fit; valueSize: number } {
  const tile = 120;
  const gaps = 24 + 24 + 14 + 14;
  const swatch = 14;
  let valueSize = 84;
  while (valueSize > MIN && measureText(valueText, valueSize, "mono", 0, 700) > 480) valueSize -= 2;
  const vw = Math.ceil(measureText(valueText, valueSize, "mono", 0, 700));
  const width = FULL_W - tile - gaps - swatch - vw;
  return {
    name: fitSlot(name, { width, max: 88, maxLines: 2, face: "condensed", weight: 800, lineHeight: 1, maxHeight: 86 }),
    valueSize,
  };
}
