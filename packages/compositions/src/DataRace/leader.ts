/**
 * Leader-adaptive far plane of DataRace (registry: data-video-art-direction / leader-adaptive-theme).
 * The background belongs to whoever leads right now: a soft tint of the leader's entity colour that
 * cross-fades to the next leader's colour when the lead changes. No React, no DOM; everything is a
 * pure function of (props, frame), so the plane is seek-stable.
 *
 * Three guards keep it honest:
 *  - the tint strength is capped per colour so EVERY text colour of the video theme still reaches
 *    `LEAD.minContrast` (>= 4.5:1) on the tinted plane, whatever colour an entity brings;
 *  - the tint fades in with the chart (`chartOpacity`), so the hook never dresses an entity in a
 *    winner's world before the data crosses, and the like / powered scenes stay neutral;
 *  - the cross-fade is ONE motion cue of the frame's budget of two (chips.ts / cues.ts count it).
 */
import { videoTheme } from "@statreel/design-tokens";
import { contrastRatio } from "./contrast";
import type { DataRaceRenderProps } from "./state";

export const LEAD = {
  /** the cross-fade starts this many frames before the period knot (the rank swap is centred on the knot) */
  lead: 6,
  /** length of the cross-fade in frames: a few frames, not a wipe */
  frames: 16,
  /** the strongest tint: this share of the leader's colour mixed into the sheet */
  maxStrength: 0.14,
  /** contrast every theme text colour must keep on the tinted plane (WCAG AA 4.5 plus a margin) */
  minContrast: 4.6,
} as const;

/** The text colours that sit on the far plane (video-theme.test.ts holds each >= 4.5:1 on the sheet). */
export const FAR_PLANE_TEXT = [videoTheme.ink, videoTheme.inkDim, videoTheme.inkFaint] as const;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const smooth = (x: number): number => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

const rgb = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (c: readonly number[]): string =>
  `#${c
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** Linear sRGB-space blend of two #rrggbb colours: `t` = 0 -> a, 1 -> b. */
export function mixHex(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex([0, 1, 2].map((i) => (x[i] as number) + ((y[i] as number) - (x[i] as number)) * clamp01(t)));
}

/** The largest tint share (<= LEAD.maxStrength) of `colour` that keeps every theme text >= LEAD.minContrast. */
const strengths = new Map<string, number>();
export function tintStrength(colour: string): number {
  const known = strengths.get(colour);
  if (known !== undefined) return known;
  const found = searchStrength(colour);
  strengths.set(colour, found);
  return found;
}

function searchStrength(colour: string): number {
  for (let s = LEAD.maxStrength; s > 0; s -= 0.005) {
    const plane = mixHex(videoTheme.background, colour, s);
    if (FAR_PLANE_TEXT.every((t) => contrastRatio(t, plane) >= LEAD.minContrast)) return Number(s.toFixed(3));
  }
  return 0;
}

export type LeadChange = {
  /** period index whose order introduced the new leader */
  period: number;
  /** first frame of the cross-fade */
  start: number;
  /** entity id that leads from here on */
  to: string;
};

const cache = new WeakMap<DataRaceRenderProps["timing_plan"], { entities: unknown; changes: LeadChange[] }>();

/** Every lead change of the run, in frame order: the plan's order[0] differing from the period before. */
export function leadChanges(props: DataRaceRenderProps): LeadChange[] {
  const hit = cache.get(props.timing_plan);
  if (hit && hit.entities === props.entities) return hit.changes;
  const plan = props.timing_plan;
  const changes: LeadChange[] = [];
  for (let p = 1; p < plan.periods.length; p++) {
    const to = plan.orders[p]?.[0];
    if (to === undefined || to === plan.orders[p - 1]?.[0]) continue;
    changes.push({ period: p, start: Math.max(0, Math.round(plan.knots[p]?.[0] ?? 0) - LEAD.lead), to });
  }
  cache.set(props.timing_plan, { entities: props.entities, changes });
  return changes;
}

/** True while a lead-change cross-fade runs at `frame` (it counts as one motion cue). */
export const leadFadeActive = (props: DataRaceRenderProps, frame: number): boolean =>
  leadChanges(props).some((c) => c.start <= frame && frame < c.start + LEAD.frames);

/** Entity colour of the leader at `frame`, mid-way between two leaders during a cross-fade. */
export function leaderColourAt(props: DataRaceRenderProps, frame: number): string {
  const plan = props.timing_plan;
  const colour = (id: string | undefined): string =>
    props.entities.find((e) => e.id === id)?.color ?? videoTheme.accent;
  const changes = leadChanges(props);
  let from = colour(plan.orders[0]?.[0]);
  for (let k = 0; k < changes.length; k++) {
    const c = changes[k] as LeadChange;
    if (frame < c.start) break;
    const to = colour(c.to);
    const next = changes[k + 1];
    // a later change that starts before this fade ended takes over from wherever this one had got to
    if (next && frame >= next.start) from = mixHex(from, to, smooth((next.start - c.start) / LEAD.frames));
    else return mixHex(from, to, smooth((frame - c.start) / LEAD.frames));
  }
  return from;
}

/**
 * The far plane colour at `frame`: the sheet tinted toward the current leader, at the contrast-capped
 * strength, scaled by `chartOpacity` (0 while the hook is up and in the like / powered scenes).
 */
export function farPlaneAt(props: DataRaceRenderProps, frame: number, chartOpacity: number): string {
  const colour = leaderColourAt(props, frame);
  return mixHex(videoTheme.background, colour, tintStrength(colour) * clamp01(chartOpacity));
}
