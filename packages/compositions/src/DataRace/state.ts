/**
 * Per-frame state of DataRace: a pure function of (props, frame). No clock, no randomness, no
 * state between frames, so any frame renders identically in any order (seek-stable).
 *
 * Timeline: hook [0, hook_end) -> data time [hook_end, timeline_end) -> fixed ending
 * (spotlight 60, like & subscribe 60, Powered by StatReel 90). Frame -> period goes through the
 * plan's monotone knots; ranks come from the plan's orders (moving average + hysteresis) and are
 * eased with a 12-frame kernel so every swap animates; bar lengths and numbers are raw values.
 */
import { DATA_RACE_LIMITS, ENDING_FRAMES, type DataRaceProps, type TimingPlan, eventSide } from "@statreel/schemas";
import { type TimeMap, makeTimeMap, periodAtFrame } from "../timing/index";
import { type RowChip, chipAt } from "./chips";
import { type ClockFrame, clockAt, motionCuesAt } from "./clock";
import { farPlaneAt } from "./leader";
import { type TickMark, ticksAt } from "./tick-fade";

export type DataRaceRenderProps = DataRaceProps & { timing_plan: TimingPlan };

export type Phase = "timeline" | "spotlight" | "like" | "powered";

export type RaceRow = {
  id: string;
  /** fractional rank, 0 = top row */
  pos: number;
  value: number;
  /** 0 while the entity is not in the data yet, fades in over its first period */
  presence: number;
  /** rank-change / NEW chip beside the row (timeline only), see chips.ts */
  chip: RowChip | null;
};

export type CardState = {
  id: string;
  /** index in start order; the side derives from it */
  index: number;
  side: "left" | "right";
  start: number;
  life: number;
  /** 0..1 side-reveal progress (eased) */
  enter: number;
  /** 0..1 fade-out progress over the last frames of the life */
  exit: number;
  /** presence used for the depth of older cards (fractional while entering/exiting) */
  vis: number;
  /** how many newer cards sit on top (fractional) */
  depth: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  brightness: number;
  opacity: number;
};

export type DataRaceState = {
  phase: Phase;
  /** frame within the current phase */
  phaseFrame: number;
  /** integer index of the period shown in the clock */
  period: number;
  /** fractional period (monotone cubic of the frame) */
  periodFloat: number;
  /** gridlines on screen with their fade (tick-fade.ts) */
  ticks: TickMark[];
  /** the clock: the label rolling from one period to the next (clock.ts) */
  clock: ClockFrame;
  /** the far plane colour: the sheet tinted toward the current leader (leader.ts) */
  farPlane: string;
  /** motion cues running this frame (chip pops + lead fade + clock roll), never more than CUE_BUDGET in the timeline */
  cues: number;
  axisMax: number;
  rows: RaceRow[];
  cards: CardState[];
  /** 0..1: the race (bars, clock, cards, title) is on screen */
  chartOpacity: number;
  /** 0..1: the hook overlay (question + equal logo tiles) */
  hookOpacity: number;
  winnerId: string;
};

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const easeOutCubic = (x: number): number => 1 - (1 - clamp01(x)) ** 3;
const easeInCubic = (x: number): number => clamp01(x) ** 3;

export const CARD = {
  enterFrames: 14,
  exitFrames: 12,
  /** push-back per depth (spec D.8 rule 6) */
  push: { x: 24, y: -62, scale: 0.06, brightness: 0.12 },
  maxDepth: 3,
} as const;
/** width of the rank-easing kernel, in frames */
const RANK_KERNEL = 12;

type PlanCache = { tm: TimeMap; ranks: Map<string, number>[]; hann: number[] };
const cache = new WeakMap<TimingPlan, PlanCache>();
function planCache(plan: TimingPlan): PlanCache {
  let c = cache.get(plan);
  if (!c) {
    const hann = Array.from({ length: RANK_KERNEL }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / RANK_KERNEL));
    const sum = hann.reduce((a, b) => a + b, 0);
    c = {
      tm: makeTimeMap(plan.knots),
      ranks: plan.orders.map((o) => new Map(o.map((id, r) => [id, r]))),
      hann: hann.map((w) => w / sum),
    };
    cache.set(plan, c);
  }
  return c;
}

/** Headroom above the leader so its bar never touches the end of the axis. */
export const AXIS_HEADROOM = 1.08;

const runMaxCache = new WeakMap<TimingPlan, { entities: unknown; max: number[] }>();
/** Running maximum of every entity's value over periods 0..i (nulls count as 0), per period. */
function runningMax(props: DataRaceRenderProps): number[] {
  const hit = runMaxCache.get(props.timing_plan);
  if (hit && hit.entities === props.entities) return hit.max;
  const max: number[] = [];
  let m = 0;
  for (let i = 0; i < props.timing_plan.periods.length; i++) {
    for (const e of props.entities) m = Math.max(m, e.values[i] ?? 0);
    max.push(m);
  }
  runMaxCache.set(props.timing_plan, { entities: props.entities, max });
  return max;
}

/**
 * The visual axis maximum: grow-only max-so-far. A fixed data-wide maximum left early bars as
 * slivers, and following the current leader made the chart rescale whenever the leader shrank.
 * Displayed values are piecewise linear between periods, so the maximum over every frame up to now
 * is exactly max(running max of the period values up to `i0`, the current peak): a pure function
 * of the frame (no render-accumulated state), continuous, and never shrinking. An explicit
 * `props.axis_max` is the owner override and stays fixed.
 */
export function axisMaxAt(props: DataRaceRenderProps, i0: number, currentPeak: number): number {
  if (props.axis_max !== undefined) return Math.max(props.axis_max, 1e-9);
  const before = runningMax(props)[Math.max(0, Math.min(i0, props.timing_plan.periods.length - 1))] ?? 0;
  return Math.max(Math.max(before, currentPeak) * AXIS_HEADROOM, 1e-9);
}

export const phaseAt = (plan: TimingPlan, frame: number): { phase: Phase; phaseFrame: number } => {
  const s = plan.sections;
  if (frame < s.timeline_end) return { phase: "timeline", phaseFrame: frame };
  if (frame < s.spotlight_end) return { phase: "spotlight", phaseFrame: frame - s.timeline_end };
  if (frame < s.like_end) return { phase: "like", phaseFrame: frame - s.spotlight_end };
  return { phase: "powered", phaseFrame: frame - s.like_end };
};

/** Card start order (ties keep the props order); the index fixes the side. */
export function orderedEvents(props: DataRaceRenderProps): { id: string; index: number }[] {
  return props.events
    .map((e, i) => ({ id: e.id, start: e.start_frame, i }))
    .sort((a, b) => a.start - b.start || a.i - b.i)
    .map((e, index) => ({ id: e.id, index }));
}

/** The two periods a frame sits between and how far (0..1) from the first to the second. */
function periodInterp(props: DataRaceRenderProps, frame: number): { periodFloat: number; i0: number; i1: number; frac: number } {
  const plan = props.timing_plan;
  const last = plan.periods.length - 1;
  const periodFloat = planCache(plan).tm.at(frame);
  const i0 = Math.min(last, Math.max(0, Math.floor(periodFloat)));
  const i1 = Math.min(last, i0 + 1);
  return { periodFloat, i0, i1, frac: i1 === i0 ? 0 : periodFloat - i0 };
}

/**
 * The axis maximum at any frame, on its own (no rows, no cards): what the tick fade needs to ask
 * "which gridlines did this frame have?" for the frames just before the one being drawn.
 */
export function axisMaxAtFrame(props: DataRaceRenderProps, frame: number): number {
  const { i0, i1, frac } = periodInterp(props, frame);
  let peak = 0;
  for (const e of props.entities) {
    const a = e.values[i0] ?? 0;
    const b = e.values[i1] ?? 0;
    peak = Math.max(peak, a + (b - a) * frac);
  }
  return axisMaxAt(props, i0, peak);
}

export function dataRaceState(props: DataRaceRenderProps, frame: number): DataRaceState {
  const plan = props.timing_plan;
  const { ranks, hann } = planCache(plan);
  const s = plan.sections;
  const { phase, phaseFrame } = phaseAt(plan, frame);
  const last = plan.periods.length - 1;
  const { periodFloat, i0, i1, frac } = periodInterp(props, frame);
  const period = periodAtFrame(plan.knots, frame);

  // rows
  const rows: RaceRow[] = props.entities.map((e) => {
    const a = e.values[i0] ?? null;
    const b = e.values[i1] ?? null;
    const va = a ?? 0;
    const vb = b ?? 0;
    const value = va + (vb - va) * frac;
    const presence = a !== null ? 1 : b !== null ? easeOutCubic(frac) : 0;
    // eased rank: a Hann-weighted average of the step-function rank over +-6 frames
    let pos = 0;
    for (let k = 0; k < RANK_KERNEL; k++) {
      const p = periodAtFrame(plan.knots, frame + k - RANK_KERNEL / 2 + 1);
      pos += (hann[k] as number) * (ranks[p]?.get(e.id) ?? props.entities.length - 1);
    }
    return { id: e.id, pos, value, presence, chip: phase === "timeline" ? chipAt(props, e.id, frame) : null };
  });
  const axisMax = axisMaxAt(props, i0, Math.max(0, ...rows.map((r) => r.value)));

  // cards
  const sorted = orderedEvents(props);
  const byId = new Map(props.events.map((e) => [e.id, e]));
  const raw = sorted.map(({ id, index }) => {
    const e = byId.get(id) as (typeof props.events)[number];
    const life = e.life_frames ?? DATA_RACE_LIMITS.lifeFramesDefault;
    // a card never outlives the timeline: the ending is its own scene
    const end = Math.min(e.start_frame + life, s.timeline_end);
    const enterT = frame - e.start_frame;
    const exitT = frame - (end - CARD.exitFrames);
    const enter = easeOutCubic(enterT / CARD.enterFrames);
    const exit = easeInCubic(exitT / CARD.exitFrames);
    const alive = frame >= e.start_frame && frame < end;
    const vis = alive ? clamp01(enterT / 6) * (1 - exit) : 0;
    return { id, index, side: eventSide(index), start: e.start_frame, life: end - e.start_frame, enter, exit, vis, alive };
  });
  const cards: CardState[] = [];
  raw.forEach((c, i) => {
    if (!c.alive) return;
    let depth = 0;
    for (let j = i + 1; j < raw.length; j++) depth += (raw[j] as (typeof raw)[number]).vis;
    if (depth >= CARD.maxDepth) return;
    cards.push({
      id: c.id,
      index: c.index,
      side: c.side,
      start: c.start,
      life: c.life,
      enter: c.enter,
      exit: c.exit,
      vis: c.vis,
      depth,
      offsetX: CARD.push.x * depth,
      offsetY: CARD.push.y * depth,
      scale: 1 - CARD.push.scale * depth,
      brightness: 1 - CARD.push.brightness * depth,
      // a card sinking from depth 2 to the cap fades with the newer card's entrance instead of vanishing
      opacity: clamp01(1 - c.exit) * clamp01((frame - c.start + 1) / 3) * clamp01(CARD.maxDepth - depth),
    });
  });

  // scene opacities. The hook holds, then fades out by hook_end while the chart fades in under it.
  // The default 60-frame hook fades the chart in over 24 -> 60 and the hook out over 36 -> 60; a
  // shorter hook (compute_timing_plan allows 0-300 frames) scales both windows into its own length,
  // so its question is still on screen at frame 0 and a hook of 0 opens straight on the chart.
  const h = s.hook_end;
  const chartIn = Math.min(24, (h * 2) / 5);
  const chartFull = Math.min(60, h);
  const hookOut = Math.min(36, (h * 3) / 5);
  let chartOpacity = chartFull > chartIn ? clamp01((frame - chartIn) / (chartFull - chartIn)) : 1;
  // the spotlight keeps the chart (others dim, winner scales) and fades it with the scene at its end
  if (phase === "spotlight") chartOpacity = clamp01((ENDING_FRAMES.spotlight - phaseFrame) / 8);
  if (phase === "like" || phase === "powered") chartOpacity = 0;
  const hookOpacity = frame < h ? 1 - clamp01((frame - hookOut) / (h - hookOut)) : 0;

  return {
    phase,
    phaseFrame,
    period,
    periodFloat,
    ticks: ticksAt(props, frame, (f) => axisMaxAtFrame(props, f)),
    clock: clockAt(props, frame),
    farPlane: farPlaneAt(props, frame, chartOpacity),
    cues: phase === "timeline" ? motionCuesAt(props, frame) : 0,
    axisMax,
    rows,
    cards,
    chartOpacity,
    hookOpacity,
    winnerId: plan.orders[last]?.[0] ?? props.entities[0]?.id ?? "",
  };
}

export const ENDING = ENDING_FRAMES;
