/**
 * The produce chain as a stepper: audio -> render -> checks -> manifest -> gate, each done / active /
 * pending, derived from a job row (kind + progress, which the server stores) so it is right when the
 * page opens mid-job; the latest SSE progress note only refines it. The progress marks mirror
 * apps/server/src/pipeline.ts: the render job reports 0.05-0.85 while the worker renders frames,
 * "mastering" at 0.87 (still the render stage), "checks" at 0.92 (checks run, then the manifest is
 * built, with no mark of its own, so both are active together), "gate" at 0.97; a reused render jumps
 * straight to 0.97 ("reused render <id>"). Also the one-line announcement of how a produce ended.
 * No React, no DOM (unit-tested).
 */

export type StageId = "audio" | "render" | "checks" | "manifest" | "gate";
export type StageState = "done" | "active" | "pending";
export type Stage = { id: StageId; label: string; state: StageState };

const ORDER: { id: StageId; label: string }[] = [
  { id: "audio", label: "Audio" },
  { id: "render", label: "Render" },
  { id: "checks", label: "Checks" },
  { id: "manifest", label: "Manifest" },
  { id: "gate", label: "Gate" },
];

/** pipeline.ts progress marks: checks start at 0.92, the gate at 0.97. */
const CHECKS_AT = 0.92;
const GATE_AT = 0.97;

const index = (id: StageId) => ORDER.findIndex((s) => s.id === id);

/** First and last active stage index (the checks window has two). */
function activeRange(job: { kind: string; progress: number }, note: string | null | undefined): [number, number] {
  if (job.kind === "audio") return [0, 0];
  const n = note ?? "";
  const byNote = /^reused render\b/.test(n) || n === "gate" ? GATE_AT : n === "checks" ? CHECKS_AT : 0;
  const p = Math.max(job.progress, byNote);
  if (p >= GATE_AT) return [index("gate"), index("gate")];
  if (p >= CHECKS_AT) return [index("checks"), index("manifest")];
  return [index("render"), index("render")];
}

/**
 * Stage states for a produce job (audio or render). Anything else, or no job, is all pending.
 * A reused render marks render, checks and manifest done (they were not rerun, the gate was).
 */
export function produceStages(
  job: { kind: string; status: string; progress: number } | null | undefined,
  note?: string | null,
): Stage[] {
  const pending = ORDER.map((s) => ({ ...s, state: "pending" as StageState }));
  if (!job || (job.kind !== "audio" && job.kind !== "render")) return pending;
  if (job.status === "succeeded") return ORDER.map((s) => ({ ...s, state: "done" as StageState }));
  const [from, to] = activeRange(job, note);
  return ORDER.map((s, i) => ({ ...s, state: i < from ? "done" : i <= to ? "active" : "pending" }));
}

/** The stage label a screen reader hears for the bar ("Render", "Checks and manifest"). */
export function activeStageText(stages: Stage[]): string {
  const active = stages.filter((s) => s.state === "active").map((s, i) => (i ? s.label.toLowerCase() : s.label));
  return active.join(" and ");
}

type JobLike = { id: string; kind: string; status: string; created_at: string; error: string | null };
type RenderLike = { job_id: string; policy_json: string | null };

/**
 * How the latest produce job ended, as a sentence for the live region; null while it is not an end
 * (a succeeded audio job hands over to the render, so it announces nothing).
 */
export function produceOutcome(jobs: readonly JobLike[], renders: readonly RenderLike[]): string | null {
  const last = jobs
    .filter((j) => j.kind === "audio" || j.kind === "render")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!last) return null;
  if (last.status === "failed") return `Produce failed: ${last.error ?? "no error text"}`;
  if (last.status === "refused") return `Produce refused: ${last.error ?? "no error text"}`;
  if (last.status === "cancelled") return "Produce cancelled";
  if (last.status !== "succeeded" || last.kind !== "render") return null;
  const row = renders.find((r) => r.job_id === last.id);
  let allow: boolean | null = null;
  try {
    const v = row?.policy_json ? (JSON.parse(row.policy_json) as { allow?: unknown }) : null;
    if (v && typeof v.allow === "boolean") allow = v.allow;
  } catch {
    allow = null;
  }
  return `Produce finished: ${allow === null ? "no verdict" : allow ? "ALLOW" : "DENY"}`;
}
