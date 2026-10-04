/**
 * Slopegraph layout: raw rank on the left axis, adjusted rank on the right. Pure geometry, no
 * React. Adjusted metrics are estimates, so the chart is rank-led (ADR 003 #3): positions come
 * from rank order, never from a fine value axis.
 */
import { clamp, scaleLinear, scaleRank } from "./scales";
import { CHAR_EM, estimateWidth, surname, wrapText } from "./text";
import type { VizFormat } from "./types";

export type SlopeRow = {
  id: string;
  name: string;
  /** rank on the left axis (e.g. raw rank) */
  left: number;
  /** rank on the right axis (e.g. era-adjusted rank) */
  right: number;
};

export type Padding = { top: number; right: number; bottom: number; left: number };

export type SlopegraphTitles = { left: string; right: string; leftSub?: string; rightSub?: string };

export type SlopegraphLayoutOptions = {
  width: number;
  height: number;
  format: VizFormat;
  padding?: Partial<Padding>;
  /** "ordinal": rows take evenly spaced slots by rank order (default); "linear": y follows the rank value */
  scale?: "ordinal" | "linear";
  /** minimum vertical distance between label centres, px (DESIGN: 44 px at 1080 w) */
  minLabelGap?: number;
  /** label font size bounds, px; the size follows the row spacing within these bounds */
  minFontSize?: number;
  maxFontSize?: number;
  /** cap on the ordinal row step so short lists stay compact */
  maxStep?: number;
  nameStyle?: "surname" | "full";
  titles?: SlopegraphTitles;
};

export type AxisAnchor = {
  rank: number;
  slot: number;
  /** the line endpoint */
  x: number;
  y: number;
  /** label centre line (equal to y unless dodged) */
  labelY: number;
  /** rank number anchor (text-anchor "end" on the left, "start" on the right) */
  rankX: number;
  /** name anchor (same text-anchor as rankX) */
  nameX: number;
};

export type SlopeRowLayout = { id: string; name: string; label: string; left: AxisAnchor; right: AxisAnchor };

export type SlopegraphLayout = {
  width: number;
  height: number;
  format: VizFormat;
  fontSize: number;
  titleFontSize: number;
  subFontSize: number;
  /** vertical distance between adjacent label centres (the minimum over both axes) */
  spacing: number;
  minLabelGap: number;
  /** true when the rows could not be fitted at minLabelGap inside the height, or the names leave the
   * slopes less than the minimum span (26 % of the width) even at the smallest font */
  overflow: boolean;
  plot: { top: number; bottom: number; leftX: number; rightX: number };
  header: {
    titleY: number;
    subY: number;
    subLineHeight: number;
    leftX: number;
    rightX: number;
    leftSub: string[];
    rightSub: string[];
    height: number;
  };
  rows: SlopeRowLayout[];
};

const DEFAULTS = {
  vertical: { minFontSize: 28, maxFontSize: 40, titleFontSize: 28, subFontSize: 28 },
  landscape: { minFontSize: 28, maxFontSize: 34, titleFontSize: 28, subFontSize: 28 },
} as const;

/**
 * Order-preserving label dodge: clusters of overlapping labels are spread `gap` apart around the
 * mean of their targets, then the whole set is kept inside [lo, hi]. Returns positions in input order.
 */
export function dodge(ys: readonly number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((_, i) => i).sort((a, b) => (ys[a] as number) - (ys[b] as number) || a - b);
  type Cluster = { first: number; size: number; sum: number; top: number };
  let clusters: Cluster[] = order.map((i, k) => ({ first: k, size: 1, sum: ys[i] as number, top: ys[i] as number }));
  const place = (c: Cluster) => {
    const mean = c.sum / c.size;
    c.top = mean - ((c.size - 1) * gap) / 2;
  };
  let merged = true;
  while (merged) {
    merged = false;
    const next: Cluster[] = [];
    for (const c of clusters) {
      place(c);
      const prev = next.at(-1);
      if (prev && prev.top + (prev.size - 1) * gap + gap > c.top + 1e-9) {
        prev.size += c.size;
        prev.sum += c.sum;
        place(prev);
        merged = true;
      } else next.push(c);
    }
    clusters = next;
  }
  const sorted: number[] = [];
  for (const c of clusters) for (let k = 0; k < c.size; k++) sorted.push(c.top + k * gap);
  // keep inside [lo, hi]: shift down from the top, then up from the bottom
  for (let k = 0; k < sorted.length; k++) {
    const min = k === 0 ? lo : (sorted[k - 1] as number) + gap;
    if ((sorted[k] as number) < min) sorted[k] = min;
  }
  for (let k = sorted.length - 1; k >= 0; k--) {
    const max = k === sorted.length - 1 ? hi : (sorted[k + 1] as number) - gap;
    if ((sorted[k] as number) > max) sorted[k] = max;
  }
  const out = new Array<number>(ys.length);
  order.forEach((i, k) => {
    out[i] = sorted[k] as number;
  });
  return out;
}

const slotsBy = (rows: readonly SlopeRow[], key: "left" | "right", other: "left" | "right"): Map<string, number> => {
  const sorted = [...rows].sort((a, b) => a[key] - b[key] || a[other] - b[other] || (a.id < b.id ? -1 : 1));
  return new Map(sorted.map((r, i) => [r.id, i]));
};

export function slopegraphLayout(rows: readonly SlopeRow[], opts: SlopegraphLayoutOptions): SlopegraphLayout {
  const { width, height, format } = opts;
  const d = DEFAULTS[format];
  const pad: Padding = { top: 0, right: 0, bottom: 0, left: 0, ...opts.padding };
  const minLabelGap = opts.minLabelGap ?? 44;
  const minFont = opts.minFontSize ?? d.minFontSize;
  const maxFont = opts.maxFontSize ?? d.maxFontSize;
  const scale = opts.scale ?? "ordinal";
  const n = rows.length;

  // header: axis titles + wrapped metric sub-titles, one column per axis
  const titleFontSize = d.titleFontSize;
  const subFontSize = d.subFontSize;
  const subLineHeight = Math.round(subFontSize * 1.25);
  const colW = (width - pad.left - pad.right) / 2 - 12;
  const leftSub = opts.titles?.leftSub ? wrapText(opts.titles.leftSub, colW, subFontSize, "ui") : [];
  const rightSub = opts.titles?.rightSub ? wrapText(opts.titles.rightSub, colW, subFontSize, "ui") : [];
  const subLines = Math.max(leftSub.length, rightSub.length);
  const hasTitles = Boolean(opts.titles);
  const titleY = pad.top + titleFontSize * 0.85;
  const subY = titleY + 8 + subFontSize;
  const headerHeight = hasTitles ? titleFontSize + (subLines ? 8 + subLines * subLineHeight : 0) + 10 : 0;

  // vertical extent of the label centres
  const plotTopRaw = pad.top + headerHeight;
  const plotBottomRaw = height - pad.bottom;
  const provisionalStep = n > 1 ? (plotBottomRaw - plotTopRaw - maxFont) / (n - 1) : maxFont * 2;
  const step0 = Math.min(provisionalStep, opts.maxStep ?? Infinity);
  let fontSize = Math.round(clamp(step0 * 0.62, minFont, maxFont));
  const plotTop = plotTopRaw + fontSize * 0.4;
  const plotBottom = plotBottomRaw - fontSize * 0.4;

  const leftSlots = slotsBy(rows, "left", "right");
  const rightSlots = slotsBy(rows, "right", "left");
  let leftY: number[];
  let rightY: number[];
  if (scale === "ordinal") {
    const s = scaleRank(n, [plotTop, plotBottom], { maxStep: opts.maxStep ?? Infinity });
    leftY = rows.map((r) => s(leftSlots.get(r.id) ?? 0));
    rightY = rows.map((r) => s(rightSlots.get(r.id) ?? 0));
  } else {
    const ranks = rows.flatMap((r) => [r.left, r.right]);
    const s = scaleLinear([Math.min(...ranks), Math.max(...ranks)], [plotTop, plotBottom]);
    leftY = rows.map((r) => s(r.left));
    rightY = rows.map((r) => s(r.right));
  }
  const leftLabelY = dodge(leftY, minLabelGap, plotTop, plotBottom);
  const rightLabelY = dodge(rightY, minLabelGap, plotTop, plotBottom);

  const gapsOf = (ys: number[]) => {
    const s = [...ys].sort((a, b) => a - b);
    let m = Infinity;
    for (let i = 1; i < s.length; i++) m = Math.min(m, (s[i] as number) - (s[i - 1] as number));
    return m;
  };
  const spacing = n > 1 ? Math.min(gapsOf(leftLabelY), gapsOf(rightLabelY)) : Infinity;

  // horizontal: [name][rank]•——•[rank][name]; shrink the font, then shorten names, to keep the slope span
  const minSpan = width * 0.26;
  let nameStyle = opts.nameStyle ?? "surname";
  const labelOf = (r: SlopeRow) => (nameStyle === "surname" ? surname(r.name) : r.name).toUpperCase();
  const measure = (fs: number) => {
    const rankDigits = Math.max(...rows.flatMap((r) => [String(r.left).length, String(r.right).length]));
    const rankW = rankDigits * CHAR_EM.mono * fs;
    const nameW = Math.max(...rows.map((r) => estimateWidth(labelOf(r), fs, "mono")));
    const gapNR = Math.round(fs * 0.45);
    const gapRD = Math.round(fs * 0.55);
    const block = nameW + gapNR + rankW + gapRD;
    return { rankW, gapNR, gapRD, block, span: width - pad.left - pad.right - 2 * block };
  };
  let m = measure(fontSize);
  while (m.span < minSpan && fontSize > minFont) {
    // the fitted size can be odd (29, 31 ...): step down by 2 but never past the floor
    fontSize = Math.max(minFont, fontSize - 2);
    m = measure(fontSize);
  }
  if (m.span < minSpan && nameStyle === "full") {
    nameStyle = "surname";
    m = measure(fontSize);
  }
  const leftX = pad.left + m.block;
  const rightX = width - pad.right - m.block;

  const out: SlopeRowLayout[] = rows.map((r, i) => {
    const lRankX = leftX - m.gapRD;
    const rRankX = rightX + m.gapRD;
    return {
      id: r.id,
      name: r.name,
      label: labelOf(r),
      left: {
        rank: r.left,
        slot: leftSlots.get(r.id) ?? 0,
        x: leftX,
        y: leftY[i] as number,
        labelY: leftLabelY[i] as number,
        rankX: lRankX,
        nameX: lRankX - m.rankW - m.gapNR,
      },
      right: {
        rank: r.right,
        slot: rightSlots.get(r.id) ?? 0,
        x: rightX,
        y: rightY[i] as number,
        labelY: rightLabelY[i] as number,
        rankX: rRankX,
        nameX: rRankX + m.rankW + m.gapNR,
      },
    };
  });

  const all = [...leftLabelY, ...rightLabelY];
  const outside = Math.min(...all) < plotTop - 1e-6 || Math.max(...all) > plotBottom + 1e-6;
  return {
    width,
    height,
    format,
    fontSize,
    titleFontSize,
    subFontSize,
    spacing,
    minLabelGap,
    overflow: spacing < minLabelGap - 1e-6 || outside || m.span < minSpan,
    plot: { top: plotTop, bottom: plotBottom, leftX, rightX },
    header: {
      titleY,
      subY,
      subLineHeight,
      leftX: pad.left,
      rightX: width - pad.right,
      leftSub,
      rightSub,
      height: headerHeight,
    },
    rows: out,
  };
}
