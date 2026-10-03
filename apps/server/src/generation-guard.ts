/**
 * What the Board's undo needs to know about background generation (SPEC D.1): is a job for this
 * item or case running (then undo is refused with 409), and cancel its queued jobs first.
 *
 * `queueGuard` implements it on top of `generation_jobs`; the default guard reports no job
 * (apps built without the queue).
 */
export type GenerationTarget = { kind: "item" | "case"; id: string };
export interface GenerationGuard {
  /** a job for the target is running right now */
  hasRunning(target: GenerationTarget): boolean;
  /** cancel the target's queued jobs; returns how many were cancelled */
  cancelQueued(target: GenerationTarget): number;
}

export const noGenerationJobs: GenerationGuard = { hasRunning: () => false, cancelQueued: () => 0 };

import type { GenerationQueue } from "./generation/queue";

/** The Board-undo guard over the real queue (ADR 010): a running job blocks undo, queued jobs are cancelled first. */
export function queueGuard(queue: GenerationQueue): GenerationGuard {
  const jobsOf = (t: GenerationTarget, status: string) =>
    queue.list({ status, limit: 500 }).filter((j) => (t.kind === "case" ? j.case_id === t.id : j.board_item_id === t.id));
  return {
    hasRunning: (t) => jobsOf(t, "running").length > 0,
    cancelQueued: (t) => jobsOf(t, "queued").filter((j) => queue.cancel(j.id)).length,
  };
}
