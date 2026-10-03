/**
 * Derived pipeline stage of a case idea (SPEC D.2). `case_ideas`/`board_items` stay authoritative;
 * the stage is computed, never stored, and the server and the studio share this one function.
 */
export type CaseStage =
  | "proposed" | "rejected"
  | "visuals_queued" | "visuals_running" | "visuals_failed" | "visuals_ready"
  | "data_blocked"
  | "video_queued" | "video_running" | "video_failed" | "video_ready";

export type StageIdea = { status: string };
export type StageItem = { status: string; case_idea_id?: string | null };
export type StageJob = { type: string; status: string; created_at: string };
export type StageContext = {
  /** number of `videos` rows for the case */
  videos?: number;
  /** result of the data gate (D.6) for the accepted visual; undefined = not evaluated */
  gateOk?: boolean;
};

const latest = (jobs: StageJob[], type: string) =>
  jobs.filter((j) => j.type === type).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

/** `items` are the board items with `case_idea_id = idea.id` (archived siblings may be included). */
export function caseStage(idea: StageIdea, items: StageItem[], jobs: StageJob[], ctx: StageContext = {}): CaseStage {
  if (idea.status === "rejected") return "rejected";
  if (idea.status !== "accepted") return "proposed";
  if ((ctx.videos ?? 0) > 0) return "video_ready";
  const video = latest(jobs, "generate_video");
  if (video?.status === "queued") return "video_queued";
  if (video?.status === "running") return "video_running";
  const accepted = items.some((i) => i.status === "accepted");
  const pending = items.some((i) => i.status === "pending");
  if (accepted && video && (video.status === "failed" || video.status === "cancelled")) return "video_failed";
  if (accepted && ctx.gateOk === false) return "data_blocked";
  // an accepted variant with no job yet and no failed gate waits on the generate step
  if (accepted) return "visuals_ready";
  if (pending) return "visuals_ready";
  const visuals = latest(jobs, "visual_options");
  if (visuals?.status === "queued") return "visuals_queued";
  if (visuals?.status === "running") return "visuals_running";
  if (visuals) return "visuals_failed"; // failed, cancelled, or done without producing a variant
  // accepted idea whose visuals job is done but produced nothing, or was never enqueued
  return "visuals_queued";
}
