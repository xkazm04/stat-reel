/**
 * Archived view logic (entity-lifecycle: archive-restore-semantics). No React, no DOM: what an archived
 * design or idea shows as its reason, and the state a Restore returns it to. The server owns the rule
 * (apps/server board.ts statusBeforeArchive); this mirrors it only to LABEL the button before the click.
 */
import { DECISION_META, isDecision } from "./board";
import { CASE_DECISION_META } from "./library";

export type RestoredStatus = "pending" | "accepted" | "rejected";

/** accept -> accepted, any reject_* -> rejected, no decision or the `superseded` sibling marker -> pending. */
export function restoresTo(decision: string | null): RestoredStatus {
  if (decision === "accept") return "accepted";
  if (decision?.startsWith("reject")) return "rejected";
  return "pending";
}

export type ArchiveReason = {
  /** null = nothing was recorded */
  text: string | null;
  /** the reason came from `note` because the row was archived before archive_reason existed */
  legacy: boolean;
};

/**
 * The reason to show. Designs archived before the column existed carry it in `note` (archive overwrote the
 * owner's note); ideas archived before it carried it in `note` only when they were undecided. Anything else
 * with no archive_reason has none: the note there is the owner's own decision note and is never shown as a reason.
 */
export function archiveReason(
  row: { archive_reason: string | null; note: string | null; decision: string | null },
  kind: "item" | "idea",
): ArchiveReason {
  const own = row.archive_reason?.trim();
  if (own) return { text: own, legacy: false };
  const note = row.note?.trim();
  if (note && (kind === "item" || row.decision === null)) return { text: note, legacy: true };
  return { text: null, legacy: false };
}

export const isSuperseded = (decision: string | null): boolean => decision === "superseded";

/** The button label: where the click puts the row back. */
export function restoreLabel(decision: string | null): string {
  return `Restore · back to ${restoresTo(decision)}`;
}

/** What the undo of a restore archives it with again: its own reason, else a stated one (a reason is required). */
export function reArchiveReason(reason: ArchiveReason): string {
  return reason.text ?? "re-archived: restore undone";
}

/**
 * The kept decision in the words the rest of the Board uses ("Rejected · style", "Rejected · not interesting",
 * "Accepted"), never the stored enum; an unknown value is spelled out without underscores.
 */
export function decisionWords(kind: "item" | "idea", decision: string): string {
  if (decision === "accept") return "Accepted";
  if (kind === "item" && isDecision(decision)) return DECISION_META[decision].done;
  const meta =
    kind === "idea" ? (CASE_DECISION_META as Record<string, { label: string } | undefined>)[decision] : undefined;
  if (meta) return `Rejected · ${meta.label.toLowerCase()}`;
  return decision.replace(/_/g, " ");
}
