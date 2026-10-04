/**
 * Pure studio helpers (compose screen): scene spans on the tracks ruler (measured timing, or an
 * honest even split while the draft has no audio), the scene under the playhead, captions CPS per
 * scene, ruler ticks and the "schedule in calendar" condition. No React, no DOM (unit-tested).
 */
import type { RenderJobResult } from "./api";

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

/**
 * Why Produce is disabled, or null when nothing blocks it: an unbuilt composition, or a co-pilot draft in
 * flight (a draft may store new props under the chain). A disabled Produce always carries its reason.
 */
export const produceBlockReason = (state: CompositionState, drafting = false): string | null =>
  state === "not-built"
    ? "No player for this use case yet; Produce needs a built composition."
    : drafting
      ? "The co-pilot is drafting; Produce once the draft ends."
      : null;

/** The control room and the gate page both offer "Schedule in Calendar": gate allows, nothing running, not on the calendar yet. */
export const scheduleOffered = (
  policy: { allow?: boolean } | null | undefined,
  busy: boolean,
  publications: readonly unknown[],
): boolean => canSchedule(policy, busy) && publications.length === 0;

export type VerdictWord = "PENDING" | "ALLOW" | "DENY" | "NO VERDICT";

/**
 * The gate verdict word. `ofRender` says the verdict is about one named render (the gate page shows
 * a render, maybe an older pinned one): a produce that is running will write a NEW render and never
 * touches that one, so its verdict stays true and is not overridden. Without it (the control room's
 * project-level gate) a running produce means a verdict is on its way, so PENDING.
 */
export function verdictView(
  policy: { allow: boolean } | null | undefined,
  producing: boolean,
  ofRender = false,
): { word: VerdictWord; status: "go" | "blocked" | null } {
  if (producing && !ofRender) return { word: "PENDING", status: null };
  if (!policy) return { word: "NO VERDICT", status: null };
  return policy.allow ? { word: "ALLOW", status: "go" } : { word: "DENY", status: "blocked" };
}

/**
 * Should the Remotion composition chunk (~286 KB) load? Only once the project has props and its use case has a
 * player at all: an empty project or an unbuilt composition never plays anything (ADR 012).
 */
export const compositionLoadWanted = (hasProps: boolean, compositionName: string | null | undefined): boolean =>
  hasProps && hasPlayer(compositionName);

/**
 * The load status the screen reports. Without a reason to load, nothing is in flight, so the monitor shows its
 * own "no props" empty state rather than a spinner that would never resolve.
 */
export const compositionLoadStatus = (
  wanted: boolean,
  status: "loading" | "ready" | "missing",
): "loading" | "ready" | "missing" => (wanted ? status : "ready");

/**
 * The earlier render a produce reused (skip-unchanged, pipeline.ts reuseRender), read from the result of the
 * job that wrote `render`; null for a fresh render, an unknown job or an unreadable result.
 */
export function reusedRenderOf(
  jobs: readonly { id: string; result_json: string | null }[],
  render: { job_id: string } | null | undefined,
): string | null {
  const job = render ? jobs.find((j) => j.id === render.job_id) : undefined;
  if (!job?.result_json) return null;
  try {
    const r = JSON.parse(job.result_json) as RenderJobResult | null;
    return typeof r?.reused === "string" && r.reused ? r.reused : null;
  } catch {
    return null;
  }
}

/** The sentence shown for a reused render. */
export const REUSED_RENDER_TEXT = "Reused the existing render (inputs unchanged)";

/** The props JSON editor's draft: the text being edited, the stored text it was opened on, and that version. */
export type PropsDraft = { text: string; base: string; version: number };

/**
 * Rebase the JSON draft onto the latest stored props (the co-pilot can store a version while the owner
 * types). An untouched draft follows the new props; an edited one is never replaced, and `stale` names the
 * version that landed underneath so the editor can say a save would supersede it.
 */
export function rebasePropsDraft(
  draft: PropsDraft,
  latest: { text: string; version: number },
): { draft: PropsDraft; stale: number | null } {
  if (latest.version === draft.version) return { draft, stale: null };
  if (draft.text === draft.base)
    return { draft: { text: latest.text, base: latest.text, version: latest.version }, stale: null };
  return { draft, stale: latest.version };
}
