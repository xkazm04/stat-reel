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

export type DataRaceRenderProps = DataRaceProps & { timing_plan: TimingPlan };

export type Phase = "timeline" | "spotlight" | "like" | "powered";

export type RaceRow = {
  id: string;
  /** fractional rank, 0 = top row */
  pos: number;
  value: number;
  /** 0 while the entity is not in the data yet, fades in over its first period */
  presence: number;
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

/**
 * The visual axis maximum. It used to follow the current leader (peak * 1.08), so the whole chart
 * rescaled when the leader shrank, while the plan scored motion against `strategy.axis_max` and
 * the renderer never read it. Now one value for the whole run: the explicit prop, else the plan's
 * axis (the largest value in the data). A pure function of the props, so it can never shrink
 * mid-run and any frame is still seek-stable.
 */
export function axisMaxFor(props: DataRaceRenderProps): number {
  return Math.max(props.axis_max ?? props.timing_plan.strategy.axis_max, 1e-9);
}

const tickRank = (n: number): number => (n === 4 ? 3 : n === 3 ? 2 : n === 2 ? 1 : 0);

/** "Nice" gridline values up to `max`: 3-4 ticks at 1/2/2.5/5 x 10^k where possible, else 2. */
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [];
  const e0 = Math.floor(Math.log10(max / 4));
  let best: number[] = [];
  for (const e of [e0 - 1, e0, e0 + 1]) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * 10 ** e;
      const n = Math.floor(max / step + 1e-9);
      if (n < 2 || n > 4) continue;
      if (tickRank(n) > tickRank(best.length)) best = Array.from({ length: n }, (_, i) => Number((step * (i + 1)).toPrecision(12)));
    }
  }
  return best;
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

export function dataRaceState(props: DataRaceRenderProps, frame: number): DataRaceState {
  const plan = props.timing_plan;
  const { tm, ranks, hann } = planCache(plan);
  const s = plan.sections;
  const { phase, phaseFrame } = phaseAt(plan, frame);
  const last = plan.periods.length - 1;
  const periodFloat = tm.at(frame);
  const period = periodAtFrame(plan.knots, frame);
  const i0 = Math.min(last, Math.max(0, Math.floor(periodFloat)));
  const i1 = Math.min(last, i0 + 1);
  const frac = i1 === i0 ? 0 : periodFloat - i0;

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
    return { id: e.id, pos, value, presence };
  });
  const axisMax = axisMaxFor(props);

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
      opacity: clamp01(1 - c.exit) * clamp01((frame - c.start + 1) / 3),
    });
  });

  // scene opacities
  let chartOpacity = clamp01((frame - 24) / 36);
  if (phase !== "timeline") chartOpacity = 1 - clamp01(phaseFrame / 14);
  if (phase === "like" || phase === "powered") chartOpacity = 0;
  const hookOpacity = frame < s.hook_end ? 1 - clamp01((frame - 36) / (s.hook_end - 36)) : 0;

  return {
    phase,
    phaseFrame,
    period,
    periodFloat,
    axisMax,
    rows,
    cards,
    chartOpacity,
    hookOpacity,
    winnerId: plan.orders[last]?.[0] ?? props.entities[0]?.id ?? "",
  };
}

export const ENDING = ENDING_FRAMES;
