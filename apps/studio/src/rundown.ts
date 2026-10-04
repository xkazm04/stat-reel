/**
 * Pure race-sheet helpers (Photo Finish rundown, A/3 studio level 1): where a project's marker
 * stands among the six gates, whether it is flagged (latest job failed / refused, or rendered but
 * the gate did not allow it), when it last moved, and the one status line. No React, no DOM.
 */
import { pct } from "./display";
import { type JobLike, nextAction, STAGES, stageIndex } from "./logic";
import { bucketCounts, JOB_LABEL, jobFlag, projectState } from "./projectState";

type JobRow = JobLike & { created_at: string; finished_at?: string | null; started_at?: string | null };
export type LaneProject = { id: string; status: string; created_at: string; jobs?: JobRow[] };

export type LaneState = {
  /** 0..5 gate index (idea .. published) */
  stage: number;
  /** marker position on the track, percent (centre of the gate column) */
  at: number;
  done: boolean;
  flagged: boolean;
  /** why it is flagged, verbatim where the server wrote it */
  flag: string | null;
};

export const GATE_POS = (i: number): number => ((i + 0.5) / STAGES.length) * 100;

export function laneState(p: LaneProject): LaneState {
  const stage = stageIndex(p.status);
  const last = p.jobs?.[0];
  // a failed / refused job in the owner's words, else what the status alone says (projectState.ts)
  const flag = (p.status !== "published" && last ? jobFlag(last) : null) ?? projectState(p.status).flag;
  return { stage, at: GATE_POS(stage), done: p.status === "published", flagged: !!flag, flag };
}

/** The newest moment anything happened to a project (job finished / started / created, or creation). */
export function lastUpdated(p: LaneProject): string {
  let t = p.created_at;
  for (const j of p.jobs ?? []) for (const x of [j.finished_at, j.started_at, j.created_at]) if (x && x > t) t = x;
  return t;
}

export const byUpdated = <T extends LaneProject>(ps: T[]): T[] =>
  [...ps].sort((a, b) => lastUpdated(b).localeCompare(lastUpdated(a)));

/** Counts for the sheet's eyebrow. */
export function sheetCounts(ps: LaneProject[]): { total: number; open: number; published: number; flagged: number } {
  const { published } = bucketCounts(ps);
  return { total: ps.length, open: ps.length - published, published, flagged: ps.filter((p) => laneState(p).flagged).length };
}

/**
 * The status line: the project closest to publishing that needs the owner, and any flagged one.
 * Returns plain parts so the view can bold the ids.
 */
export function sayLine(ordered: LaneProject[]): { lead: string; parts: { id: string; text: string }[] } {
  if (!ordered.length) return { lead: "No project yet.", parts: [] };
  const open = ordered.filter((p) => p.status !== "published");
  if (!open.length) return { lead: "Every project has crossed the line: published private.", parts: [] };
  const parts: { id: string; text: string }[] = [];
  const next = open.find((p) => {
    const n = nextAction(p.status, p.jobs?.[0]);
    return n.tone === "you";
  });
  if (next) {
    const n = nextAction(next.status, next.jobs?.[0]);
    const steps = STAGES.length - 1 - stageIndex(next.status);
    parts.push({
      id: next.id,
      text: `${steps === 1 ? "is one step from the line" : `is ${steps} steps from the line`}: ${n.verb.toLowerCase()}`,
    });
  }
  const flagged = open.find((p) => laneState(p).flagged && p !== next);
  if (flagged) {
    const f = laneState(flagged).flag ?? "";
    // the lane itself carries the full text verbatim; the status line keeps it short
    parts.push({ id: flagged.id, text: `is flagged: ${f.length > 90 ? `${f.slice(0, 89)}…` : f}` });
  }
  const waiting = open.filter((p) => nextAction(p.status, p.jobs?.[0]).tone === "wait").length;
  return {
    lead: waiting ? `${waiting} job${waiting === 1 ? "" : "s"} running. Closest to publishing first.` : "Closest to publishing first.",
    parts,
  };
}

/** The list view's Job cell: the running job in the owner's words (logic.ts JOB_LABEL) and its progress. */
export const jobCell = (job: { kind: string }, progress: number | null | undefined): string =>
  `${JOB_LABEL[job.kind as keyof typeof JOB_LABEL] ?? "A job"} ${pct(progress)}`;
