/**
 * What an accept DID, in words (ADR 010): the decision response carries the queued job or the data
 * gate's refusal, and the owner has usually left the view by then (the Pending filter drops the item,
 * the lightbox advances), so the undo toast says it. Also the 409 reading for undo.
 * No React, no DOM (unit-tested in outcome.test.ts).
 */

export type AcceptResponse = {
  job?: { id: string; type?: string; status?: string } | null;
  gate?: { ok: boolean; reason?: string } | null;
};

export type AcceptOutcome = {
  /** the whole toast message, e.g. "Accepted · video queued · <title>" */
  message: string;
  /** the job a later undo has to wait for (or cancel); absent when nothing was queued */
  jobId: string | null;
  /** the data gate refused: the toast links to Sources */
  blocked: boolean;
};

const JOB_WORDS: Record<string, string> = { generate_video: "video", visual_options: "visuals" };

/** "Accepted · video queued" / "Accepted · data blocked: <reason>" / plain "Accepted" when the server queued nothing. */
export function acceptOutcome(r: AcceptResponse, title: string): AcceptOutcome {
  if (r.gate && !r.gate.ok) {
    const why = r.gate.reason?.trim();
    return { message: `Accepted · data blocked${why ? `: ${why}` : ""} · ${title}`, jobId: null, blocked: true };
  }
  if (r.job) {
    const what = (r.job.type && JOB_WORDS[r.job.type]) || "generation";
    return { message: `Accepted · ${what} queued · ${title}`, jobId: r.job.id, blocked: false };
  }
  return { message: `Accepted · ${title}`, jobId: null, blocked: false };
}

/** An undo the server refused because the entry's generation job is still queued or running. */
export const isRunningConflict = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { status?: unknown }).status === 409;

export const CANCEL_FIRST = "Could not undo: the generation job is still running. Cancel it first, then undo.";
