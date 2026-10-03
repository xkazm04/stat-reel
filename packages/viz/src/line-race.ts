/**
 * Line-race layout: several series drawn left to right up to data-time `t`, each with a head dot
 * and an end-of-line label. No React, no DOM, no clock: everything is a pure function of the
 * arguments, so any frame lays out alone (seek-stable, DESIGN.md §6.2).
 *
 * Reveal: a series shows every sample with time <= t plus a head interpolated linearly between the
 * surrounding samples, so the head sits exactly on the interpolated value and the path never jumps
 * when `t` crosses a sample. Past a series' last sample the head holds there (the line has ended).
 * Labels: heads are spread with the slopegraph `dodge` (order-preserving, >= `minLabelGap` apart).
 * Y domain: declared in config (never from the sample). With `growOnly` the declared domain is the
 * starting window and it only widens, to the running extent of everything revealed so far - the
 * chart never rescales backwards, and because the running extent is continuous in `t` there is no
 * step either (the DataRace axis follows the same rule).
 */
import { clamp, lerp, scaleLinear } from "./scales";
import { dodge } from "./slopegraph-layout";
import { estimateWidth, formatFixed } from "./text";
import { niceTicks } from "./ticks";

export type RacePoint = { t: number; v: number };
export type RaceSeries = {
  id: string;
  label: string;
  /** CSS colour; omitted -> a stable colour from the id (see `fallbackColor`) */
  color?: string;
  points: readonly RacePoint[];
};

export type RacePadding = { top: number; right: number; bottom: number; left: number };

export type LineRaceOptions = {
  series: readonly RaceSeries[];
  /** current data time */
  t: number;
  /** declared x range (data time) */
  xDomain: readonly [number, number];
  /** declared y range; with `growOnly` the window the race starts from */
  yDomain: readonly [number, number];
  width: number;
  height: number;
  /** `right` must hold the end labels (default 280) */
  padding?: Partial<RacePadding>;
  /** label font px (default 28, never below 28) */
  fontSize?: number;
  /** min distance between label centres (default fontSize * 1.3) */
  minLabelGap?: number;
  /** widen the y domain to the running extent so far, never shrink (default false) */
  growOnly?: boolean;
  /** extra room above/below the running extent when growing (default 1.05) */
  headroom?: number;
  valueDecimals?: number;
  tickCount?: number;
};

export type RaceHead = { x: number; y: number; t: number; v: number };

export type RaceSeriesLayout = {
  id: string;
  label: string;
  color: string;
  visible: boolean;
  /** SVG path data of the revealed line ("" when not visible) */
  path: string;
  /** revealed polyline in px, last point = head */
  points: { x: number; y: number }[];
  /** polyline length in px; non-decreasing in t at a fixed y domain */
  length: number;
  head: RaceHead | null;
  /** 1 = highest head value at t */
  rank: number | null;
  isLeader: boolean;
  /** end-label centre y after dodging */
  labelY: number | null;
  labelX: number;
  valueText: string;
  /** estimated label + value width exceeds the right padding */
  labelOverflow: boolean;
};

export type LineRaceLayout = {
  fontSize: number;
  minLabelGap: number;
  plot: { left: number; right: number; top: number; bottom: number };
  /** effective y domain at t */
  yDomain: [number, number];
  yTicks: { value: number; y: number; label: string }[];
  /** x px of data time t, clamped into the plot */
  xNow: number;
  leaderId: string | null;
  series: RaceSeriesLayout[];
  /** true when the visible labels cannot all keep `minLabelGap` inside the plot height */
  overflow: boolean;
};

/** Stable colour from the id: same id -> same hue on every frame and every render. */
export function fallbackColor(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `hsl(${h % 360} 62% 64%)`;
}

const cleanPoints = (pts: readonly RacePoint[]): RacePoint[] =>
  pts.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);

/** Head sample at `t`: linear between neighbours, held at the end; null before the first sample. */
export function headAt(points: readonly RacePoint[], t: number): RacePoint | null {
  const first = points[0];
  if (!first || t < first.t) return null;
  const last = points[points.length - 1] as RacePoint;
  if (t >= last.t) return last;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as RacePoint;
    const b = points[i + 1] as RacePoint;
    if (t >= a.t && t <= b.t) return b.t === a.t ? b : { t, v: lerp(a.v, b.v, (t - a.t) / (b.t - a.t)) };
  }
  return last;
}

export function lineRaceLayout(opts: LineRaceOptions): LineRaceLayout {
  const { t, xDomain, yDomain, width, height, growOnly = false, headroom = 1.05, valueDecimals = 0 } = opts;
  const fontSize = Math.max(28, opts.fontSize ?? 28);
  const minLabelGap = opts.minLabelGap ?? Math.round(fontSize * 1.3);
  const pad: RacePadding = { top: fontSize, right: 280, bottom: 0, left: 0, ...opts.padding };
  const plot = {
    left: pad.left,
    right: Math.max(pad.left, width - pad.right),
    top: pad.top,
    bottom: Math.max(pad.top, height - pad.bottom),
  };

  const cleaned = opts.series.map((s) => ({ s, pts: cleanPoints(s.points) }));
  const heads = cleaned.map(({ pts }) => headAt(pts, t));

  // effective y domain: declared, widened to the running extent when growOnly
  let lo = Math.min(yDomain[0], yDomain[1]);
  let hi = Math.max(yDomain[0], yDomain[1]);
  if (growOnly) {
    let peak = Number.NEGATIVE_INFINITY;
    let trough = Number.POSITIVE_INFINITY;
    cleaned.forEach(({ pts }, i) => {
      for (const p of pts) {
        if (p.t > t) break;
        peak = Math.max(peak, p.v);
        trough = Math.min(trough, p.v);
      }
      const h = heads[i];
      if (h) {
        peak = Math.max(peak, h.v);
        trough = Math.min(trough, h.v);
      }
    });
    if (Number.isFinite(peak)) hi = Math.max(hi, peak >= 0 ? peak * headroom : peak / headroom);
    if (Number.isFinite(trough)) lo = Math.min(lo, trough >= 0 ? trough / headroom : trough * headroom);
  }

  const sx = scaleLinear(xDomain, [plot.left, plot.right], { clamp: true });
  const sy = scaleLinear([lo, hi], [plot.bottom, plot.top], { clamp: true });

  const layouts: RaceSeriesLayout[] = cleaned.map(({ s, pts }, i) => {
    const head = heads[i] ?? null;
    const base = {
      id: s.id,
      label: s.label,
      color: s.color ?? fallbackColor(s.id),
      labelX: plot.right + 14,
      rank: null,
      isLeader: false,
      labelY: null,
      labelOverflow: false,
    };
    if (!head) {
      return { ...base, visible: false, path: "", points: [], length: 0, head: null, valueText: "" };
    }
    const shown = pts.filter((p) => p.t < head.t);
    const px = [...shown, head].map((p) => ({ x: sx(p.t), y: sy(p.v) }));
    let length = 0;
    for (let k = 1; k < px.length; k++) {
      const a = px[k - 1] as { x: number; y: number };
      const b = px[k] as { x: number; y: number };
      length += Math.hypot(b.x - a.x, b.y - a.y);
    }
    const path = px.map((p, k) => `${k === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
    const hp = px[px.length - 1] as { x: number; y: number };
    return {
      ...base,
      visible: true,
      path,
      points: px,
      length,
      head: { x: hp.x, y: hp.y, t: head.t, v: head.v },
      valueText: formatFixed(head.v, valueDecimals),
    };
  });

  // rank by head value (desc), ties by id so the order never depends on input order
  const vis = layouts.filter((l) => l.head);
  const ranked = [...vis].sort((a, b) => (b.head as RaceHead).v - (a.head as RaceHead).v || (a.id < b.id ? -1 : 1));
  ranked.forEach((l, k) => {
    l.rank = k + 1;
    l.isLeader = k === 0;
  });

  // end labels: dodge the head y's, then flag labels the right padding cannot hold
  const ys = vis.map((l) => (l.head as RaceHead).y);
  const labelYs = dodge(ys, minLabelGap, plot.top, plot.bottom);
  vis.forEach((l, k) => {
    l.labelY = labelYs[k] as number;
    l.labelOverflow = estimateWidth(`${l.label}  ${l.valueText}`, fontSize, "ui") > pad.right - 14;
  });
  const overflow = vis.length > 1 && (vis.length - 1) * minLabelGap > plot.bottom - plot.top + 1e-6;

  const yTicks = niceTicks(lo, hi, opts.tickCount ?? 4).map((value) => ({
    value,
    y: sy(value),
    label: formatFixed(value, valueDecimals),
  }));

  return {
    fontSize,
    minLabelGap,
    plot,
    yDomain: [lo, hi],
    yTicks,
    xNow: clamp(sx(t), plot.left, plot.right),
    leaderId: ranked[0]?.id ?? null,
    series: layouts,
    overflow,
  };
}
