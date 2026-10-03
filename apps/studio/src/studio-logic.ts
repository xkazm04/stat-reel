/**
 * Pure studio helpers (compose screen): scene spans on the tracks ruler (measured timing, or an
 * honest even split while the draft has no audio), the scene under the playhead, captions CPS per
 * scene, ruler ticks and the "schedule in calendar" condition. No React, no DOM (unit-tested).
 */

export type SceneSpan = { id: string; kind?: string; start: number; end: number; measured: boolean };

/** Even split of `duration` seconds over the scene ids (draft: no voice measured yet). */
export function draftSpans(scenes: { id: string; kind?: string }[], duration: number): SceneSpan[] {
  if (!scenes.length || !(duration > 0)) return [];
  const step = duration / scenes.length;
  return scenes.map((s, i) => ({
    id: s.id,
    kind: s.kind,
    start: +(i * step).toFixed(3),
    end: +((i + 1) * step).toFixed(3),
    measured: false,
  }));
}

type TimingLike = { duration_s: number; scenes: { scene_id: string; start_s: number; end_s: number }[] };

/**
 * Scene spans for the ruler: measured timing when the audio stage has run, else a draft split of
 * `draftDuration`. Scenes missing from the timing keep their draft place so none disappears.
 */
export function sceneSpans(
  scenes: { id: string; kind?: string }[],
  timing: TimingLike | null | undefined,
  draftDuration: number,
): SceneSpan[] {
  if (!timing) return draftSpans(scenes, draftDuration);
  const by = new Map(timing.scenes.map((t) => [t.scene_id, t]));
  const out: SceneSpan[] = [];
  for (const s of scenes) {
    const t = by.get(s.id);
    if (t) out.push({ id: s.id, kind: s.kind, start: t.start_s, end: t.end_s, measured: true });
  }
  // timing scenes the props do not list (should not happen) still show, labelled by id
  for (const t of timing.scenes)
    if (!scenes.some((s) => s.id === t.scene_id))
      out.push({ id: t.scene_id, start: t.start_s, end: t.end_s, measured: true });
  return out.sort((a, b) => a.start - b.start);
}

/** The span under time `t` (seconds); the last span keeps its end frame. */
export function spanAt(spans: SceneSpan[], t: number): SceneSpan | null {
  const last = spans.at(-1);
  if (!last) return null;
  if (t >= last.end) return last;
  return spans.find((s) => t >= s.start && t < s.end) ?? null;
}

/** Characters per second of a text over a span; null without a positive duration. */
export function cps(text: string, start: number, end: number): number | null {
  const d = end - start;
  if (!(d > 0)) return null;
  return text.replace(/\s+/g, " ").trim().length / d;
}

/** Peak caption CPS among cues of one scene window (timing cues carry lines + start/end). */
export function peakCueCps(cues: { lines: string[]; start_s: number; end_s: number }[], start: number, end: number): number | null {
  let peak: number | null = null;
  for (const c of cues) {
    if (c.start_s < start - 1e-6 || c.start_s >= end) continue;
    const v = cps(c.lines.join(" "), c.start_s, c.end_s);
    if (v !== null && (peak === null || v > peak)) peak = v;
  }
  return peak;
}

/** Ruler ticks every 5 s (every 10 s past 90 s), 0 included. */
export function rulerTicks(duration: number): number[] {
  if (!(duration > 0)) return [];
  const step = duration > 90 ? 10 : 5;
  const out: number[] = [];
  for (let s = 0; s <= duration + 1e-9; s += step) out.push(s);
  return out;
}

/** "0:06.6" style range label for a span. */
export function spanLabel(start: number, end: number): string {
  const f = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
  return `${f(start)}–${f(end)}`;
}

/** Scheduling in the Calendar is offered only when the latest render's gate allows. */
export const canSchedule = (policy: { allow?: boolean } | null | undefined, busy: boolean): boolean =>
  !!policy?.allow && !busy;

/** A produce job can be stopped only while it is queued or running (JobRunner.cancel is a no-op after). */
export const canCancelJob = (job: { status: string } | null | undefined): boolean =>
  !!job && (job.status === "queued" || job.status === "running");

/** Only EraAdjustedSlope has a player; an undefined name (no use case resolved yet) means the default. */
export const hasPlayer = (compositionName: string | null | undefined): boolean =>
  compositionName === undefined || compositionName === "EraAdjustedSlope";

export type CompositionState = "built" | "not-built" | "loading" | "unavailable";

/**
 * What the player can honestly say: "not-built" (the use case's composition has no player; it never
 * will load, so no spinner), "loading" (chunk in flight), "unavailable" (the chunk failed to load),
 * else "built".
 */
export function compositionState(
  compositionName: string | null | undefined,
  load: "loading" | "ready" | "missing",
): CompositionState {
  if (!hasPlayer(compositionName)) return "not-built";
  return load === "ready" ? "built" : load === "missing" ? "unavailable" : "loading";
}

/** Why Produce is disabled by the composition, or null when it is not. */
export const produceBlockReason = (state: CompositionState): string | null =>
  state === "not-built" ? "No player for this use case yet; Produce needs a built composition." : null;
