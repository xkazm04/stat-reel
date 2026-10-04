/**
 * StatReel timing strategy (spec D.8 rule 2). Port of the box prototype `timing.mjs` +
 * `make-plan-v3.mjs`. Pure TS, no deps, deterministic: runs in Node (the MCP `compute_timing_plan`
 * tool) and inside the Remotion bundle.
 *
 * Goal: the on-screen change rate (rank swaps + visible value motion + entries/exits) stays roughly
 * constant per second, instead of constant periods per second. Steps:
 *  1. score every period transition i-1 -> i: weighted pairwise rank inversions inside the visible
 *     top-N, plus entries/exits, plus visible |delta value| / axis max, plus a base so quiet periods
 *     still move;
 *  2. frames_i proportional to score_i, clamped to [minFrames, maxFrames] per period;
 *  3. Gaussian-smooth the frame counts (no speed jerks) and renormalise to the frame budget;
 *  4. add event dwell (a Gaussian bump around each event period) so cards can be read;
 *  5. emit knots [frame, period] (cumulative) for the monotone-cubic frame -> period map.
 *
 * Rank ordering uses a centred moving average (optional) plus hysteresis: an entity overtakes its
 * neighbour only when ahead by `rel` of the value + `abs`. The plan's change score uses the same
 * order the viewer sees (`plan.orders`).
 */
import {
  DATA_RACE_FPS,
  ENDING_FRAMES,
  type TimingPlan,
} from "@statreel/schemas";

export type TimingEventInput = {
  id: string;
  /** index into `periods` */
  period: number;
  label: string;
  /** extra frames held around the event (default 40) */
  dwell?: number;
  /** Gaussian spread of the dwell bump, in periods (default 1.5) */
  spread?: number;
};

export type TimingOptions = {
  /** unit word for TIMING.md, e.g. "month" (default "period") */
  unit?: string;
  /** hook section length in frames (default 60) */
  hookFrames?: number;
  /** length of the data-time section in frames (default clamp(4 x periods, 660, 1500)) */
  timelineFrames?: number;
  /** half-width of the centred moving average used for ordering; 1 = 3-period average (default 0) */
  rankSmooth?: number;
  /** hysteresis of the order; `null` disables it. Default { rel: 0.06, abs: 0.0017 x axisMax } */
  hysteresis?: { rel: number; abs: number } | null;
  /** rows scored (default 10) */
  topN?: number;
  /** axis maximum used to scale value motion (default: the largest value) */
  axisMax?: number;
  /** per-period frame clamp (default 0.25 x and 2.6 x the average) */
  minFrames?: number;
  maxFrames?: number;
  /** Gaussian smoothing of frames per period, in periods (default 1.5) */
  sigma?: number;
  weights?: { rank: number; value: number; base: number; entry: number };
  /** label shown on screen when the order is smoothed, e.g. "ORDER: 3-MO AVG" */
  orderLabel?: string | null;
  /** group periods for the evenness report (default: the first 4-digit year in the label, else the label) */
  groupOf?: (period: string) => string;
};

export type TimingPlanInput = {
  /** display labels, one per period */
  periods: string[];
  /** entity ids */
  entities: string[];
  /** entity id -> one value per period (null = absent; counted as 0) */
  values: Record<string, (number | null)[]>;
  events?: TimingEventInput[];
  opts?: TimingOptions;
};

const num = (a: readonly number[] | undefined, i: number): number => a?.[i] ?? 0;
const round = (x: number, d: number): number => {
  const m = 10 ** d;
  return Math.round(x * m) / m;
};

/** Centred moving average of half-width `w` (the window shrinks at the edges). */
export function movingAverage(series: readonly number[], w: number): number[] {
  if (!w) return series.slice();
  return series.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let j = i - w; j <= i + w; j++)
      if (j >= 0 && j < series.length) {
        s += num(series, j);
        n++;
      }
    return s / n;
  });
}

/** Entities sorted by value, best first (ties keep input order). */
export function rankOrder(values: Record<string, number>, entities: readonly string[]): string[] {
  return [...entities].sort((a, b) => (values[b] ?? 0) - (values[a] ?? 0));
}

/**
 * Sticky ordering: an entity only overtakes its neighbour when it leads by rel x value + abs
 * (hysteresis). Removes period-to-period flip-flops between near-equal entities; deterministic,
 * returns the full order per period.
 */
export function stickyOrders(
  periodCount: number,
  entities: readonly string[],
  ordValue: (entity: string, i: number) => number,
  { rel = 0.06, abs = 0.01 }: { rel?: number; abs?: number } = {},
): string[][] {
  const at = (i: number) => Object.fromEntries(entities.map((e) => [e, ordValue(e, i)])) as Record<string, number>;
  let order = rankOrder(at(0), entities);
  const out: string[][] = [order.slice()];
  for (let i = 1; i < periodCount; i++) {
    order = order.slice();
    const v = at(i);
    for (let pass = 0; pass < entities.length; pass++) {
      let swapped = false;
      for (let r = order.length - 1; r > 0; r--) {
        const a = order[r - 1] as string;
        const b = order[r] as string;
        if ((v[b] ?? 0) > (v[a] ?? 0) * (1 + rel) + abs) {
          order[r - 1] = b;
          order[r] = a;
          swapped = true;
        }
      }
      if (!swapped) break;
    }
    out.push(order.slice());
  }
  return out;
}

const cv = (a: number[]): number => {
  if (!a.length) return 0;
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return m === 0 ? 0 : Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) / m;
};

const defaultGroup = (p: string): string => /\d{4}/.exec(p)?.[0] ?? p;

/**
 * Computes the timing plan. Throws on malformed input (unknown event period, series length mismatch).
 * The result is JSON-serialisable and has no timestamp, so its sha256 is stable.
 */
export function computeTimingPlan(input: TimingPlanInput): TimingPlan {
  const { periods, entities, values } = input;
  const o = input.opts ?? {};
  const P = periods.length;
  if (P < 2) throw new Error("computeTimingPlan: need at least 2 periods");
  for (const e of entities) {
    if (values[e]?.length !== P) throw new Error(`computeTimingPlan: entity '${e}' needs ${P} values`);
  }
  const events = input.events ?? [];
  for (const ev of events)
    if (!Number.isInteger(ev.period) || ev.period < 0 || ev.period >= P)
      throw new Error(`computeTimingPlan: event '${ev.id}' period ${ev.period} is outside 0..${P - 1}`);

  const value = (e: string, i: number): number => values[e]?.[i] ?? 0;
  const topN = o.topN ?? 10;
  const rankSmooth = o.rankSmooth ?? 0;
  let maxValue = 0;
  for (const e of entities) for (let i = 0; i < P; i++) maxValue = Math.max(maxValue, value(e, i));
  const axisMax = o.axisMax ?? (maxValue > 0 ? maxValue : 1);
  const hysteresis = o.hysteresis === undefined ? { rel: 0.06, abs: 0.0017 * axisMax } : o.hysteresis;
  const weights = o.weights ?? { rank: 1, value: 1, base: 0.1, entry: 1.5 };
  const sigma = o.sigma ?? 1.5;
  const hookEnd = o.hookFrames ?? 60;
  const timelineFrames = o.timelineFrames ?? Math.min(1500, Math.max(660, P * 4));
  const startFrame = hookEnd;
  const endFrame = hookEnd + timelineFrames;
  const avg = timelineFrames / (P - 1);
  const minFrames = o.minFrames ?? Math.max(0.5, avg * 0.25);
  const maxFrames = o.maxFrames ?? Math.max(minFrames * 2, avg * 2.6);
  const rowWeight = (r: number) => 1 / (1 + 0.18 * r);

  // ordering series (optionally smoothed)
  const ord: Record<string, number[]> = {};
  for (const e of entities)
    ord[e] = movingAverage(
      periods.map((_, i) => value(e, i)),
      rankSmooth,
    );
  const ordAt = (e: string, i: number) => num(ord[e], i);
  const orders = hysteresis
    ? stickyOrders(P, entities, ordAt, hysteresis)
    : periods.map((_, i) => rankOrder(Object.fromEntries(entities.map((e) => [e, ordAt(e, i)])), entities));
  // The race ends on the truth. The moving average and the hysteresis can hold an entity on top while
  // another has the larger final value (a title decided in the last period by less than the margin),
  // and the ending crowns orders[last][0] ("NO. 1 AT THE END"). So the last period's #1 is the
  // largest raw final value; a tie keeps the order the viewer already sees, and the rest is untouched.
  const lastOrder = orders[P - 1] as string[];
  const champion = rankOrder(Object.fromEntries(entities.map((e) => [e, value(e, P - 1)])), lastOrder)[0];
  if (champion !== undefined && champion !== lastOrder[0]) orders[P - 1] = [champion, ...lastOrder.filter((e) => e !== champion)];
  const orderAt = (i: number) => (orders[i] as string[]).slice(0, topN);

  const raw: number[] = [0];
  const detail: TimingPlan["detail"] = [{ period: periods[0] as string, rank: 0, value: 0, entries: 0 }];
  let prev = orderAt(0);
  for (let i = 1; i < P; i++) {
    const cur = orderAt(i);
    const pp = new Map(prev.map((e, r) => [e, r]));
    let rank = 0;
    for (let a = 0; a < cur.length; a++)
      for (let b = a + 1; b < cur.length; b++) {
        const pa = pp.get(cur[a] as string);
        const pb = pp.get(cur[b] as string);
        if (pa !== undefined && pb !== undefined && pa > pb) rank += rowWeight(Math.min(a, b));
      }
    const entries = cur.filter((e) => !pp.has(e)).length;
    let val = 0;
    for (const e of cur) val += Math.abs(value(e, i) - value(e, i - 1)) / axisMax;
    raw.push(weights.rank * rank + weights.entry * entries + weights.value * val + weights.base);
    detail.push({ period: periods[i] as string, rank: round(rank, 3), value: round(val, 3), entries });
    prev = cur;
  }

  const dwellOf = (e: TimingEventInput) => e.dwell ?? 40;
  const dwellTotal = events.reduce((s, e) => s + dwellOf(e), 0);
  const budget = endFrame - startFrame - dwellTotal;
  if (budget <= 0) throw new Error("computeTimingPlan: event dwell exceeds the timeline budget");

  // proportional frames, clamp, smooth, renormalise (iterate so clamps roughly hold)
  const sumR = raw.reduce((a, b) => a + b, 0);
  let f = raw.map((r, i) => (i === 0 ? 0 : (r / sumR) * budget));
  const R = Math.ceil(sigma * 3);
  const K: number[] = [];
  for (let k = -R; k <= R; k++) K.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  for (let it = 0; it < 6; it++) {
    f = f.map((x, i) => (i === 0 ? 0 : Math.min(maxFrames, Math.max(minFrames, x))));
    const src = f;
    f = src.map((_, i) => {
      if (i === 0) return 0;
      let s = 0;
      let w = 0;
      K.forEach((k, j) => {
        const ii = i + j - R;
        if (ii >= 1 && ii < P) {
          s += num(src, ii) * k;
          w += k;
        }
      });
      return s / w;
    });
    const s = f.reduce((a, b) => a + b, 0);
    f = f.map((x) => (x / s) * budget);
  }
  const fBase = f.slice(); // before dwell (evenness report: dwell is an intentional hold)
  for (const ev of events) {
    const sd = ev.spread ?? 1.5;
    const bump = f.map((_, i) => (i === 0 ? 0 : Math.exp(-((i - ev.period) ** 2) / (2 * sd * sd))));
    // period 0 carries no frames, so a narrow bump around it can underflow to all zeros (0 / 0 = NaN
    // knots); the dwell then lands whole on the first period that has frames
    if (!(bump.reduce((a, b) => a + b, 0) > 0)) bump[Math.max(1, ev.period)] = 1;
    const bs = bump.reduce((a, b) => a + b, 0);
    f = f.map((x, i) => x + (num(bump, i) / bs) * dwellOf(ev));
  }

  const knots: [number, number][] = [[startFrame, 0]];
  let acc = startFrame;
  for (let i = 1; i < P; i++) {
    acc += num(f, i);
    knots.push([round(acc, 3), i]);
  }

  // evenness report: changes per second, uniform vs warped, per calendar group
  const fps = DATA_RACE_FPS;
  const uniform = (endFrame - startFrame) / (P - 1);
  const groupOf = o.groupOf ?? defaultGroup;
  const groups = new Map<string, { changes: number; warped: number; base: number; uniform: number }>();
  for (let i = 1; i < P; i++) {
    const g = groupOf(periods[i] as string);
    const v = groups.get(g) ?? { changes: 0, warped: 0, base: 0, uniform: 0 };
    v.changes += num(raw, i) - weights.base;
    v.warped += num(f, i);
    v.base += num(fBase, i);
    v.uniform += uniform;
    groups.set(g, v);
  }
  const per = (c: number, fr: number) => (fr > 0 ? c / (fr / fps) : 0);
  const per_group = [...groups].map(([group, v]) => ({
    group,
    change_score: round(v.changes, 2),
    seconds: round(v.warped / fps, 2),
    changes_per_sec_warped: round(per(v.changes, v.warped), 2),
    changes_per_sec_ex_dwell: round(per(v.changes, v.base), 2),
    changes_per_sec_uniform: round(per(v.changes, v.uniform), 2),
  }));
  const tm = makeTimeMap(knots);
  const planEvents = events.map((e) => ({
    id: e.id,
    period: e.period,
    label: e.label,
    dwell: dwellOf(e),
    frame: Math.round(tm.frameOf(e.period)),
  }));

  return {
    version: 1,
    fps: DATA_RACE_FPS,
    sections: {
      hook_end: hookEnd,
      timeline_end: endFrame,
      spotlight_end: endFrame + ENDING_FRAMES.spotlight,
      like_end: endFrame + ENDING_FRAMES.spotlight + ENDING_FRAMES.like,
      total: endFrame + ENDING_FRAMES.spotlight + ENDING_FRAMES.like + ENDING_FRAMES.powered,
    },
    strategy: {
      unit: o.unit ?? "period",
      order: hysteresis
        ? `${rankSmooth ? `${2 * rankSmooth + 1}-period centred moving average + ` : ""}hysteresis (an entity overtakes only when ahead by ${round(hysteresis.rel * 100, 1)}% of the value + ${round(hysteresis.abs, 4)})`
        : rankSmooth
          ? `${2 * rankSmooth + 1}-period centred moving average`
          : "raw values",
      order_label: o.orderLabel === undefined ? (rankSmooth ? `ORDER: ${2 * rankSmooth + 1}-PERIOD AVG` : null) : o.orderLabel,
      rank_smooth: rankSmooth,
      hysteresis: hysteresis ?? null,
      top_n: topN,
      axis_max: axisMax,
      min_frames: round(minFrames, 3),
      max_frames: round(maxFrames, 3),
      sigma,
      weights,
    },
    periods: [...periods],
    entities: [...entities],
    knots,
    orders,
    events: planEvents,
    frames_per_period: f.map((x) => round(x, 3)),
    detail,
    per_group,
    evenness: {
      cv_uniform: round(cv(per_group.map((g) => g.changes_per_sec_uniform)), 3),
      cv_warped_ex_dwell: round(cv(per_group.map((g) => g.changes_per_sec_ex_dwell)), 3),
      cv_warped_incl_dwell: round(cv(per_group.map((g) => g.changes_per_sec_warped)), 3),
    },
  };
}

export type TimeMap = {
  /** fractional period at a frame (clamped to the first/last knot) */
  at: (frame: number) => number;
  /** frame at which a (fractional) period is reached */
  frameOf: (period: number) => number;
};

/** Monotone cubic (Fritsch-Carlson) frame -> period map from knots; speed never jumps, never runs backwards. */
export function makeTimeMap(knots: readonly (readonly [number, number])[]): TimeMap {
  const n = knots.length;
  const fr = (i: number) => (knots[i] as readonly [number, number])[0];
  const pe = (i: number) => (knots[i] as readonly [number, number])[1];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((pe(i + 1) - pe(i)) / (fr(i + 1) - fr(i)));
  const m: number[] = [num(d, 0)];
  for (let i = 1; i < n - 1; i++) m.push(num(d, i - 1) * num(d, i) <= 0 ? 0 : (num(d, i - 1) + num(d, i)) / 2);
  m.push(num(d, n - 2));
  for (let i = 0; i < n - 1; i++) {
    const di = num(d, i);
    if (di === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = num(m, i) / di;
    const b = num(m, i + 1) / di;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * di;
      m[i + 1] = t * b * di;
    }
  }
  const at = (x: number): number => {
    if (x <= fr(0)) return pe(0);
    if (x >= fr(n - 1)) return pe(n - 1);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (fr(mid) <= x) lo = mid;
      else hi = mid;
    }
    const h = fr(lo + 1) - fr(lo);
    const t = (x - fr(lo)) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * pe(lo) +
      (t3 - 2 * t2 + t) * h * num(m, lo) +
      (-2 * t3 + 3 * t2) * pe(lo + 1) +
      (t3 - t2) * h * num(m, lo + 1)
    );
  };
  const frameOf = (period: number): number => {
    let lo = fr(0);
    let hi = fr(n - 1);
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (at(mid) < period) lo = mid;
      else hi = mid;
    }
    return hi;
  };
  return { at, frameOf };
}

/** The period whose knot is the latest one at or before `frame` (integer; 0 before the first knot). */
export function periodAtFrame(knots: readonly (readonly [number, number])[], frame: number): number {
  let lo = 0;
  let hi = knots.length - 1;
  if (frame < (knots[0] as readonly [number, number])[0]) return 0;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((knots[mid] as readonly [number, number])[0] <= frame) lo = mid;
    else hi = mid;
  }
  return frame >= (knots[hi] as readonly [number, number])[0] ? (knots[hi] as readonly [number, number])[1] : (knots[lo] as readonly [number, number])[1];
}
