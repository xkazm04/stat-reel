/**
 * Gridlines of DataRace. The axis maximum only grows, so the set of nice tick values changes in
 * steps (a 5-step set {5, 10, 15, 20} becomes {10, 20, 30, 40} once the axis passes ~20) and lines
 * used to pop in and out. A tick that enters or leaves now fades over TICKS.fadeFrames frames.
 * No React, no DOM; a pure function of (props, frame): the fade is the share of the last
 * `fadeFrames` frames in which the value was a tick (a box filter, smoothed), so there is no state
 * between frames and any frame renders identically in any order (seek-stable).
 *
 * The values come from the one `niceTicks` of packages/viz, parametrised to 2-4 positive gridlines
 * (the density the 448 px axis has room for): the step is the nice step not below max / 4, which
 * never exceeds max / 2, so floor(max / step) is always 2, 3 or 4.
 */
import { niceTicks } from "@statreel/viz";
import type { DataRaceRenderProps } from "./state";

export const TICKS = {
  /** nominal number of intervals (the viz `count` argument): 2-4 positive gridlines result */
  count: 4,
  /** frames an entering or leaving gridline takes to fade */
  fadeFrames: 12,
} as const;

/** One gridline as drawn: its value, how visible it is (0..1) and how many decimals its label needs. */
export type TickMark = { value: number; alpha: number; decimals: number };

/** The gridline values (positive, ascending) for an axis from 0 to `axisMax`. */
export function tickValues(axisMax: number): number[] {
  if (!(axisMax > 0)) return [];
  return niceTicks(0, axisMax, TICKS.count).filter((v) => v > 0);
}

/** Decimals a tick label needs to show `value` exactly (0-3): 5 -> 0, 2.5 -> 1, 0.25 -> 2. */
export function tickDecimals(value: number): number {
  for (let d = 0; d < 3; d++)
    if (Math.abs(value - Number(value.toFixed(d))) < 1e-9 * Math.max(1, Math.abs(value))) return d;
  return 3;
}

const smooth = (x: number): number => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};

const cache = new WeakMap<
  DataRaceRenderProps["timing_plan"],
  { entities: unknown; fixedMax: number | undefined; sets: Map<number, number[]> }
>();
function setAt(props: DataRaceRenderProps, frame: number, axisAt: (frame: number) => number): number[] {
  let hit = cache.get(props.timing_plan);
  if (!hit || hit.entities !== props.entities || hit.fixedMax !== props.axis_max) {
    hit = { entities: props.entities, fixedMax: props.axis_max, sets: new Map() };
    cache.set(props.timing_plan, hit);
  }
  let set = hit.sets.get(frame);
  if (!set) {
    set = tickValues(axisAt(frame));
    hit.sets.set(frame, set);
  }
  return set;
}

/**
 * The gridlines at `frame`: every value that was a tick at any of the last `fadeFrames` frames,
 * with alpha = the smoothed share of those frames in which it was one. A value that has been a tick
 * for the whole window is 1; one that just entered or just left is near 0 and moves through the
 * window. Frames before 0 count as frame 0 (the first set is on screen from the start).
 * `axisAt` is the axis maximum of any frame (state.ts `axisMaxAtFrame`, passed in so the two modules
 * do not import each other).
 */
export function ticksAt(props: DataRaceRenderProps, frame: number, axisAt: (frame: number) => number): TickMark[] {
  const w = TICKS.fadeFrames;
  const frames = Array.from({ length: w }, (_, i) => setAt(props, Math.max(0, frame - i), axisAt));
  const values = [...new Set(frames.flat())].sort((a, b) => a - b);
  return values.map((value) => ({
    value,
    alpha: smooth(frames.filter((s) => s.includes(value)).length / w),
    decimals: tickDecimals(value),
  }));
}
