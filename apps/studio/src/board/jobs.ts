/**
 * Pure logic for the generation badges (SPEC D.11): which badge a case shows for its derived stage, the
 * elapsed clock, the plain-words error kinds and the queue strip's summary. No React; covered by jobs.test.ts.
 * The stage itself is computed by the server with `caseStage` (packages/schemas), so the two cannot drift.
 */
import type { CaseStage } from "@statreel/schemas";
import type { GenerationOverview } from "../api";

export type OverviewCase = GenerationOverview["cases"][string];
export type JobRow = GenerationOverview["jobs"][number];
export type BadgeKind = "queued" | "running" | "ready" | "done" | "failed" | "cancelled" | "blocked" | "waiting";
export type BadgeAction = "retry" | "cancel" | "log" | "generate" | "sources" | "variants" | "video";
export type Badge = {
  kind: BadgeKind;
  /** the visible words; every state has a shape and a label, colour is never the only signal */
  label: string;
  /** secondary line: the gate's reason, "waiting for worker" ... */
  detail?: string;
  actions: BadgeAction[];
  /** the job the actions (retry, log) apply to */
  jobId?: string;
  /** "$0.42 · 17 turns" once the CLI reported a spend; absent when unknown */
  cost?: string;
};

export const ERROR_WORDS: Record<string, string> = {
  timeout: "timeout",
  cli_exit: "the CLI stopped",
  validation: "output did not validate",
  render: "render failed",
  data_gate: "data gate",
  interrupted: "interrupted by a restart",
  cancelled: "cancelled",
  budget: "budget reached",
};
/** Shown while a job is marked running but no worker holds the lease (ADR 010: the lease is reclaimed on restart). */
export const WORKER_OFFLINE_RUNNING = "worker offline - resumes or fails when it restarts";

/** Cancel is always available for a live job (ADR 010, caps off); finished jobs have nothing to cancel. */
export const canCancel = (job: Pick<JobRow, "status"> | null | undefined): boolean => job?.status === "queued" || job?.status === "running";

/**
 * "$0.42 · 17 turns" for a job's ledger columns. Unknown (null/undefined/NaN) gives null so nothing renders:
 * unmeasurable is not zero. A reported 0 (the fake engine) is shown as "$0.00".
 */
export function formatSpend(s: { cost_usd?: number | null; turns?: number | null } | null | undefined): string | null {
  const parts: string[] = [];
  if (typeof s?.cost_usd === "number" && Number.isFinite(s.cost_usd)) parts.push(`$${s.cost_usd.toFixed(2)}`);
  if (typeof s?.turns === "number" && Number.isFinite(s.turns)) parts.push(`${s.turns} turn${s.turns === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : null;
}

const withCost = (b: Badge, job: JobRow | undefined): Badge => {
  const cost = formatSpend(job);
  return cost ? { ...b, cost } : b;
};

export const errorWords = (kind: string | null | undefined): string => (kind ? (ERROR_WORDS[kind] ?? kind) : "error");

/** "03:12" (mm:ss), "1:02:03" past an hour; 0 before the job started. */
export function elapsed(startedAt: string | null | undefined, now: number): string {
  const t = startedAt ? Date.parse(startedAt) : Number.NaN;
  const s = Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 1000)) : 0;
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export type BadgeInput = {
  entry: OverviewCase;
  jobs: ReadonlyMap<string, JobRow>;
  workerOnline: boolean;
  now: number;
  /** pending variants of the case on the board (the "3 visuals ready" count); undefined = unknown, said without a number */
  pendingVariants?: number;
};

const jobBadge = (job: JobRow | undefined, workerOnline: boolean, now: number): Badge | null => {
  if (!job) return null;
  if (job.status === "queued") {
    return { kind: "queued", label: `Queued${job.queue_position ? ` · #${job.queue_position}` : ""}`, detail: workerOnline ? undefined : "waiting for worker", actions: ["cancel", "log"], jobId: job.id };
  }
  if (job.status === "running") {
    return { kind: "running", label: `Running · ${elapsed(job.started_at, now)}${job.last_tool ? ` · ${job.last_tool}` : ""}`, detail: workerOnline ? (job.progress_note ?? undefined) : WORKER_OFFLINE_RUNNING, actions: ["cancel", "log"], jobId: job.id };
  }
  if (job.status === "failed") return withCost({ kind: "failed", label: `Failed · ${errorWords(job.error_kind)}`, detail: job.error ?? undefined, actions: ["retry", "log"], jobId: job.id }, job);
  if (job.status === "cancelled") return withCost({ kind: "cancelled", label: "Cancelled", actions: ["retry"], jobId: job.id }, job);
  return null;
};

/** The badge of a case row (D.11), or null when the stage has nothing to say (proposed, rejected). */
export function badgeForCase(i: BadgeInput): Badge | null {
  const { entry } = i;
  const stage: CaseStage = entry.stage;
  const visual = entry.visual_job_id ? i.jobs.get(entry.visual_job_id) : undefined;
  const video = entry.video_job_id ? i.jobs.get(entry.video_job_id) : undefined;
  switch (stage) {
    case "proposed":
    case "rejected":
      return null;
    case "visuals_queued":
    case "visuals_running":
    case "visuals_failed":
      return jobBadge(visual, i.workerOnline, i.now) ?? { kind: "queued", label: "Visuals not started", actions: [] };
    case "visuals_ready": {
      if (entry.accepted_item_id) return withCost({ kind: "ready", label: "Design accepted", actions: ["generate", "variants"] }, visual);
      // the count comes from the board on the client; unknown (not loaded, or a cache older than the job) is not invented
      const n = i.pendingVariants;
      return withCost({ kind: "ready", label: n ? `${n} visual${n === 1 ? "" : "s"} ready` : "Visuals ready", actions: ["variants"] }, visual);
    }
    case "data_blocked":
      return { kind: "blocked", label: "Data blocked", detail: entry.gate?.reason, actions: ["sources", "generate"] };
    case "video_queued":
    case "video_running":
    case "video_failed":
      return jobBadge(video, i.workerOnline, i.now) ?? { kind: "queued", label: "Video not started", actions: [] };
    case "video_ready":
      return withCost({ kind: "done", label: "Video ready", actions: ["video"] }, video);
  }
}

/** True while any job is queued or running: the studio then polls every 10 s as a fallback to SSE. */
export const hasActiveJobs = (o: Pick<GenerationOverview, "jobs"> | undefined): boolean =>
  !!o?.jobs.some((j) => j.status === "queued" || j.status === "running");

export type StripState = { text: string; offline: boolean; active: boolean };

/** The queue strip in the Board header: "Generating: <case> · 2 queued", or a quiet idle line. */
export function stripState(o: GenerationOverview | undefined): StripState {
  if (!o) return { text: "", offline: false, active: false };
  const queued = o.worker.queued;
  const offline = !o.worker.online;
  if (o.running && offline) {
    // a dead worker must not read as live progress: say it, keep the title so the owner knows which job is stuck
    return { text: `${o.running.title}: ${WORKER_OFFLINE_RUNNING}${queued ? ` · ${queued} queued` : ""}`, offline, active: true };
  }
  if (o.running) {
    return { text: `Generating: ${o.running.title}${queued ? ` · ${queued} queued` : ""}`, offline, active: true };
  }
  if (queued) return { text: `${queued} queued${offline ? " · waiting for the worker" : ""}`, offline, active: true };
  return { text: offline ? "Generation worker offline" : "Generation idle", offline, active: false };
}
