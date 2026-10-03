/**
 * What the Board's undo needs to know about background generation (SPEC D.1): is a job for this
 * item or case running (then undo is refused with 409), and cancel its queued jobs first.
 *
 * The generation queue (`generation_jobs`, T7) does not exist yet, so the default guard reports no
 * job. TODO(T7): implement this interface on top of `generation_jobs` (status queued | running,
 * keyed by board item id or case id) and pass it as `AppDeps.generation` in main.ts.
 */
export type GenerationTarget = { kind: "item" | "case"; id: string };
export interface GenerationGuard {
  /** a job for the target is running right now */
  hasRunning(target: GenerationTarget): boolean;
  /** cancel the target's queued jobs; returns how many were cancelled */
  cancelQueued(target: GenerationTarget): number;
}

export const noGenerationJobs: GenerationGuard = { hasRunning: () => false, cancelQueued: () => 0 };
