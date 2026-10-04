/**
 * The DataRace clock rolls between period labels (an odometer: the old label slides up and fades, the
 * new one rises into place) instead of snapping. No React, no DOM; a pure function of (props, frame).
 *
 * Rolling digits are a motion cue (registry: motion-cue-budget), so the roll shares the frame budget
 * of CUE_BUDGET = 2 with the lead-change fade (leader.ts) and the chip pops (chips.ts). The roll has
 * the lowest priority: a transition whose window would exceed the budget does not roll, the label
 * just switches at the period's knot (`cue: false`). The decision is per transition, made from the
 * props alone, so it never flips mid-roll.
 *
 * Roll windows are centred on the period knot and never overlap: each is at most ROLL frames, and
 * at most half the gap to the neighbouring knots.
 */
import { CUE_BUDGET, chipCueCount } from "./chips";
import { leadFadeActive } from "./leader";
import type { DataRaceRenderProps } from "./state";

export const CLOCK_ROLL = {
  /** longest roll in frames (a third of a second): the roll shortens where periods are short */
  frames: 10,
} as const;

export type ClockRoll = {
  /** index of the period rolled to */
  period: number;
  /** first frame of the roll window */
  start: number;
  /** frames in the window (>= 1) */
  frames: number;
  /** the roll plays (true) or the label switches at the knot (false: the budget has no room) */
  cue: boolean;
};

const cache = new WeakMap<DataRaceRenderProps["timing_plan"], { entities: unknown; rolls: ClockRoll[] }>();

/** Every period transition of the timeline with its roll window and its cue decision, in frame order. */
export function clockRolls(props: DataRaceRenderProps): ClockRoll[] {
  const hit = cache.get(props.timing_plan);
  if (hit && hit.entities === props.entities) return hit.rolls;
  const plan = props.timing_plan;
  const knots = plan.knots;
  const frameOf = (k: number): number => Math.round(knots[k]?.[0] ?? 0);
  const rolls: ClockRoll[] = [];
  for (let k = 1; k < knots.length; k++) {
    const at = frameOf(k);
    if (at >= plan.sections.timeline_end) break;
    const gapPrev = at - frameOf(k - 1);
    const gapNext = k + 1 < knots.length ? frameOf(k + 1) - at : Number.POSITIVE_INFINITY;
    const half = Math.floor(Math.min(CLOCK_ROLL.frames / 2, gapPrev / 2, gapNext / 2));
    if (half < 1) {
      rolls.push({ period: knots[k]?.[1] ?? k, start: at, frames: 1, cue: false });
      continue;
    }
    const start = at - half;
    const frames = 2 * half;
    let room = true;
    for (let g = start; g < start + frames && room; g++) {
      room = (leadFadeActive(props, g) ? 1 : 0) + chipCueCount(props, g) < CUE_BUDGET;
    }
    rolls.push({ period: knots[k]?.[1] ?? k, start, frames, cue: room });
  }
  cache.set(props.timing_plan, { entities: props.entities, rolls });
  return rolls;
}

/** What the clock shows at `frame`: `from` -> `to` at progress `u` (0..1); `rolling` is false when it just shows `to`. */
export type ClockFrame = { from: string; to: string; u: number; rolling: boolean };

export function clockAt(props: DataRaceRenderProps, frame: number): ClockFrame {
  const plan = props.timing_plan;
  const labels = props.periods;
  const label = (p: number): string => labels[p] ?? "";
  for (const r of clockRolls(props)) {
    if (frame < r.start) break;
    if (!r.cue || frame >= r.start + r.frames) continue;
    const u = (frame - r.start) / r.frames;
    return { from: label(r.period - 1), to: label(r.period), u, rolling: true };
  }
  const period = (() => {
    let p = 0;
    for (const [f, idx] of plan.knots) {
      if (frame < Math.round(f)) break;
      p = idx;
    }
    return p;
  })();
  return { from: label(period), to: label(period), u: 1, rolling: false };
}

/** Motion cues running at `frame` in the timeline: chip pops + the lead fade + the clock roll (<= CUE_BUDGET). */
export function motionCuesAt(props: DataRaceRenderProps, frame: number): number {
  const rolling = clockRolls(props).some((r) => r.cue && r.start <= frame && frame < r.start + r.frames);
  return chipCueCount(props, frame) + (leadFadeActive(props, frame) ? 1 : 0) + (rolling ? 1 : 0);
}
