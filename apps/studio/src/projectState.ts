/**
 * One project-state table for the Front and the Rundown: the word, the flag copy and the Front's
 * count bucket of every project status, and the words for a failed / refused job. The stage words
 * and mode words are logic.ts's (STAGE_LABEL, MODE_LABEL), imported, not copied; no raw
 * `${kind} ${status}` token reaches the owner (status-vocabulary: one vocabulary per concept).
 * No React, no DOM (unit-tested in projectState.test.ts).
 */
import type { ProjectStatus } from "@statreel/schemas";
import { JOB_LABEL, MODE_LABEL, STAGE_LABEL } from "./logic";

/** The Front's count buckets; they partition the projects, so the buckets always sum to the total. */
export type ProjectBucket = "published" | "refused" | "gated" | "notGated";

export type ProjectState = {
  /** the stage word (logic.ts STAGE_LABEL) */
  word: string;
  bucket: ProjectBucket;
  /** why the project is flagged by its status alone; null when the status itself is fine */
  flag: string | null;
};

export const PROJECT_STATE: Record<ProjectStatus, ProjectState> = {
  idea: { word: STAGE_LABEL.idea, bucket: "notGated", flag: null },
  "data-ready": { word: STAGE_LABEL["data-ready"], bucket: "notGated", flag: null },
  scripted: { word: STAGE_LABEL.scripted, bucket: "notGated", flag: null },
  // rendered but not gated through: the publish gate refused the render
  rendered: { word: STAGE_LABEL.rendered, bucket: "refused", flag: "rendered, but the publish gate did not allow it" },
  // the gate allowed it; only the owner's private upload is left
  gated: { word: STAGE_LABEL.gated, bucket: "gated", flag: null },
  published: { word: STAGE_LABEL.published, bucket: "published", flag: null },
};

/** A status the table does not know is a project that has not been through the gate. */
export const projectState = (status: string): ProjectState =>
  PROJECT_STATE[status as ProjectStatus] ?? { word: status, bucket: "notGated", flag: null };

/** Job kind -> the owner's word for it: logic.ts owns the one table (logic.ts also has the present-tense verbs). */
export { JOB_LABEL };

const JOB_OUTCOME: Record<string, string> = { failed: "failed", refused: "refused" };

/** Flag copy of a failed / refused job ("Render failed: ffmpeg died"); null for any other job state. */
export function jobFlag(job: { kind: string; status: string; error?: string | null }): string | null {
  const outcome = JOB_OUTCOME[job.status];
  if (!outcome) return null;
  return `${JOB_LABEL[job.kind as keyof typeof JOB_LABEL] ?? "A job"} ${outcome}${job.error ? `: ${job.error}` : ""}`;
}

export type ProjectBucketCounts = Record<ProjectBucket, number> & { total: number };

/** Count projects into the buckets; every project lands in exactly one, so the buckets sum to total. */
export function bucketCounts(projects: { status: string }[]): ProjectBucketCounts {
  const c: ProjectBucketCounts = { total: projects.length, published: 0, refused: 0, gated: 0, notGated: 0 };
  for (const p of projects) c[projectState(p.status).bucket] += 1;
  return c;
}

/** A project's mode in the owner's words (the list view's MODE_LABEL). */
export const modeWord = (mode: string): string => MODE_LABEL[mode as keyof typeof MODE_LABEL] ?? mode;
