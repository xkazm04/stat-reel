/**
 * Scene timing and the per-frame visual state of EraAdjustedSlope. Pure functions of props and
 * `t` (seconds): the component renders any frame identically in any order.
 */
import type { EraAdjustedProps } from "@statreel/schemas";
import { interpolate } from "@statreel/viz";

export const DEFAULT_DURATION_S = 58;
export const DEFAULT_VOICE_LEAD_S = 0.5;
/** crossfade length between scenes, seconds */
export const XFADE_S = 0.4;

type Scene = EraAdjustedProps["scenes"][number];
type Timing = NonNullable<EraAdjustedProps["timing"]>;
/** Props as the composition receives them: zod defaults may not have been applied. */
export type TimingInput = {
  duration_s: number;
  scenes: Timing["scenes"];
  voice_lead_s?: number;
  music?: Timing["music"];
  cues?: Timing["cues"];
  words?: Timing["words"];
};

export type ResolvedScene = {
  id: string;
  kind: Scene["kind"];
  on_screen: string;
  focus: string[];
  index: number;
  /** picture window, seconds */
  start: number;
  end: number;
};

export const durationOf = (timing: { duration_s: number } | undefined | null): number =>
  timing?.duration_s ?? DEFAULT_DURATION_S;

/**
 * Picture windows for each scene. With a timeline, a scene's picture starts `voice_lead_s` after
 * its voice (audio leads picture at cuts, ADR 003 #9), except the hook, which starts at 0 s.
 * Without one (or if any scene is missing from it) the duration is split evenly.
 */
export function resolveScenes(
  scenes: readonly { id: string; kind: Scene["kind"]; on_screen: string; focus?: string[] }[],
  timing: TimingInput | undefined | null,
): ResolvedScene[] {
  const duration = durationOf(timing);
  const n = scenes.length;
  const lead = timing?.voice_lead_s ?? DEFAULT_VOICE_LEAD_S;
  const byId = new Map((timing?.scenes ?? []).map((s) => [s.scene_id, s]));
  const timed = n > 0 && scenes.every((s) => byId.has(s.id));
  const starts = scenes.map((s, i) => {
    if (i === 0) return 0;
    if (timed) return Math.min(duration, (byId.get(s.id)?.start_s ?? 0) + lead);
    return (duration * i) / n;
  });
  // keep windows monotonic
  for (let i = 1; i < n; i++) starts[i] = Math.max(starts[i] as number, starts[i - 1] as number);
  return scenes.map((s, i) => ({
    id: s.id,
    kind: s.kind,
    on_screen: s.on_screen,
    focus: s.focus ?? [],
    index: i,
    start: starts[i] as number,
    end: i + 1 < n ? (starts[i + 1] as number) : duration,
  }));
}

export const sceneAt = (scenes: readonly ResolvedScene[], t: number): ResolvedScene | undefined =>
  scenes.find((s) => t >= s.start && t < s.end) ?? scenes.at(-1);

export type FrameState = {
  scene: ResolvedScene | undefined;
  hookOpacity: number;
  closeOpacity: number;
  chartOpacity: number;
  leftProgress: number;
  lineProgress: number;
  dim: number;
  headlines: { id: string; text: string; opacity: number }[];
  callout: { opacity: number; t0: number };
  focus: string[];
};

/**
 * Visual state of the frame at `t`. Every value is a clamped interpolation of `t`.
 * Vertical: the payoff callout takes over the chart zone (the chart fades out after the field is
 * dimmed). Landscape: the callout sits beside the chart, which stays with the highlight lit.
 * Close: the chart leaves entirely, so the last frame matches the hook frame and the short loops.
 */
export function frameState(
  scenes: readonly ResolvedScene[],
  t: number,
  format: "vertical" | "landscape" = "vertical",
): FrameState {
  const first = (k: ResolvedScene["kind"]) => scenes.find((s) => s.kind === k);
  const all = (k: ResolvedScene["kind"]) => scenes.filter((s) => s.kind === k);
  const hook = first("hook");
  const context = first("context");
  const reveals = all("reveal");
  const payoff = first("payoff");
  const close = first("close");
  const end = scenes.at(-1)?.end ?? DEFAULT_DURATION_S;
  const scene = sceneAt(scenes, t);

  // hook: fully visible from frame 0, fades out into the next scene
  const hookOpacity = hook ? interpolate(t, [hook.end - XFADE_S, hook.end], [1, 0]) : 0;

  // chart: in with the context (or the first scene after the hook)
  const chartStart = context?.start ?? scenes[1]?.start ?? end;
  const ctxDur = context ? context.end - context.start : 2;
  let chartOpacity = interpolate(t, [chartStart, chartStart + XFADE_S], [0, 1]);
  const leftProgress = interpolate(t, [chartStart, chartStart + Math.min(2.4, Math.max(0.8, ctxDur * 0.5))], [0, 1]);

  // reveal: lines draw to the adjusted ranks, highlight last
  const revStart = reveals[0]?.start ?? payoff?.start ?? end;
  const revEnd = reveals.at(-1)?.end ?? revStart + 2;
  const drawDur = Math.max(1.5, (revEnd - revStart) * 0.72);
  const lineProgress = interpolate(t, [revStart + 0.2, revStart + 0.2 + drawDur], [0, 1]);

  // payoff: dim the field, call out the highlight
  const vertical = format === "vertical";
  const dim = payoff ? interpolate(t, [payoff.start, payoff.start + 0.5], [0, 1]) : 0;
  const calloutIn = payoff ? payoff.start + (vertical ? 0.75 : 0.15) : end;
  let calloutOpacity = payoff ? interpolate(t, [calloutIn, calloutIn + XFADE_S], [0, 1]) : 0;
  if (payoff && vertical) chartOpacity *= interpolate(t, [payoff.start + 0.5, payoff.start + 0.9], [1, 0]);

  // close: reframe line in the hook's place; the chart and callout leave
  const closeOpacity = close ? interpolate(t, [close.start, close.start + XFADE_S], [0, 1]) : 0;
  if (close) {
    chartOpacity *= interpolate(t, [close.start - XFADE_S * 0.5, close.start + XFADE_S * 0.5], [1, 0]);
    calloutOpacity *= interpolate(t, [close.start - XFADE_S * 0.5, close.start + XFADE_S * 0.5], [1, 0]);
  }

  const headlines = scenes
    .filter((s) => s.kind === "context" || s.kind === "reveal")
    .map((s) => ({
      id: s.id,
      text: s.on_screen,
      opacity: Math.min(
        interpolate(t, [s.start, s.start + XFADE_S], [0, 1]),
        interpolate(t, [s.end - XFADE_S * 0.5, s.end], [1, 0]),
      ),
    }))
    .filter((h) => h.opacity > 0);

  return {
    scene,
    hookOpacity,
    closeOpacity,
    chartOpacity,
    leftProgress,
    lineProgress,
    dim,
    headlines,
    callout: { opacity: calloutOpacity, t0: calloutIn + 0.15 },
    focus: scene?.focus ?? [],
  };
}
