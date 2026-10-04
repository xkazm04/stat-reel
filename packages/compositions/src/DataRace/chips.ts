/**
 * Rank-change chips of DataRace: "up N" when an entity overtakes N rows, "NEW" when it enters the
 * data. No React, no DOM; a pure function of the props, so the chip on any frame is seek-stable.
 *
 * Art direction ("rank chips >= 1.5 s, independent of the warp"; "motion cues per frame <= 2"):
 *  - a chip lives CHIP.frames FRAMES (not data time), so the time warp cannot shorten it;
 *  - the chip's ENTRANCE (a scale pop) is the only motion cue it contributes. The frame budget is
 *    CUE_BUDGET = 2 cues at once, shared with the lead-change cross-fade of the far plane (leader.ts)
 *    and the clock roll (clock.ts). A chip pops only if, over its whole entrance window, the cues
 *    already running (the lead fade, chips that popped earlier) leave room; otherwise it appears
 *    without the pop (`cue: false`). The decision is made once per chip from the props alone, so it
 *    never flips mid-entrance. The hold and the exit fade are not counted as cues.
 *  - ranks come from the plan's `orders` (the order the viewer sees, after smoothing + hysteresis).
 */
import { leadFadeActive } from "./leader";
import type { DataRaceRenderProps } from "./state";

export const CHIP = {
  /** total lifetime in frames: 1.6 s at 30 fps, never less than the 1.5 s rule */
  frames: 48,
  /** entrance pop length (the motion cue) */
  enter: 8,
  /** fade-out length at the end of the life */
  exit: 8,
  /** the eased rank swap is centred on the period's knot; the chip leads it by this many frames */
  lead: 6,
} as const;

/** Motion cues allowed in one frame (registry: motion-cue-budget): chip pops, the lead fade and the clock roll together. */
export const CUE_BUDGET = 2;

export type Chip = {
  id: string;
  kind: "up" | "new";
  /** "2" (rows gained, rendered after an up triangle) or "NEW" */
  text: string;
  /** first frame of the life */
  start: number;
  /** rows gained (Infinity for a newcomer): only used to read the data back in tests */
  jump: number;
  /** this chip plays the entrance pop (see the cue budget above) */
  cue: boolean;
};

/** A chip as the row sees it at one frame. */
export type RowChip = { kind: "up" | "new"; text: string; age: number; cue: boolean };

/** Every chip of the run, sorted by start then id. Chips that would be cut by the ending are dropped. */
export function raceChips(props: DataRaceRenderProps): Chip[] {
  const plan = props.timing_plan;
  const last = plan.periods.length - 1;
  const frameOf = (p: number): number => plan.knots[p]?.[0] ?? 0;
  const raw: Omit<Chip, "cue">[] = [];
  for (let p = 1; p <= last; p++) {
    const before = plan.orders[p - 1] ?? [];
    const after = plan.orders[p] ?? [];
    for (const e of props.entities) {
      const a = e.values[p - 1] ?? null;
      const b = e.values[p] ?? null;
      if (b === null) continue;
      if (a === null) {
        raw.push({ id: e.id, kind: "new", text: "NEW", start: Math.max(0, Math.round(frameOf(p - 1))), jump: Number.POSITIVE_INFINITY });
        continue;
      }
      const r0 = before.indexOf(e.id);
      const r1 = after.indexOf(e.id);
      if (r0 < 0 || r1 < 0 || r0 - r1 < 1) continue;
      raw.push({ id: e.id, kind: "up", text: String(r0 - r1), start: Math.max(0, Math.round(frameOf(p)) - CHIP.lead), jump: r0 - r1 });
    }
  }
  raw.sort((x, y) => x.start - y.start || x.id.localeCompare(y.id));
  const out: Chip[] = [];
  for (const c of raw) {
    if (c.start + CHIP.frames > plan.sections.timeline_end) continue;
    // cues running at frame g, before this chip: the lead fade and the earlier chips' entrances
    const running = (g: number): number =>
      (leadFadeActive(props, g) ? 1 : 0) + out.filter((o) => o.cue && o.start <= g && g < o.start + CHIP.enter).length;
    let room = true;
    for (let g = c.start; g < c.start + CHIP.enter && room; g++) room = running(g) < CUE_BUDGET;
    out.push({ ...c, cue: room });
  }
  return out;
}

const cache = new WeakMap<DataRaceRenderProps["timing_plan"], { entities: unknown; chips: Chip[] }>();
function chipsFor(props: DataRaceRenderProps): Chip[] {
  const hit = cache.get(props.timing_plan);
  if (hit && hit.entities === props.entities) return hit.chips;
  const chips = raceChips(props);
  cache.set(props.timing_plan, { entities: props.entities, chips });
  return chips;
}

/** The chip an entity wears at `frame`: the newest one whose life covers it. */
export function chipAt(props: DataRaceRenderProps, id: string, frame: number): RowChip | null {
  let found: Chip | null = null;
  for (const c of chipsFor(props)) {
    if (c.id === id && c.start <= frame && frame < c.start + CHIP.frames) found = c;
  }
  return found ? { kind: found.kind, text: found.text, age: frame - found.start, cue: found.cue } : null;
}

/** Chip entrance pops running at `frame` (each is one motion cue of the frame budget). */
export function chipCueCount(props: DataRaceRenderProps, frame: number): number {
  return chipsFor(props).filter((c) => c.cue && c.start <= frame && frame < c.start + CHIP.enter).length;
}
