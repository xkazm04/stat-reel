/**
 * JobBadge (SPEC D.11): the state of a case's background generation, on every case row, on generated
 * tiles and in the lightbox. Every state is a shape plus words, never colour alone: queued, running (clock
 * and current tool, with an indeterminate bar), "3 visuals ready", "Video ready", failed (Retry, View log),
 * data blocked (the gate's reason and a link to Sources) and cancelled (Retry).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, type BoardItem, qk, serverError } from "../api";
import { type Badge, type BadgeKind, badgeForCase } from "./jobs";
import { LogDrawer } from "./LogDrawer";
import { useBoard } from "./shared";
import { useOverview } from "./useGeneration";
import "./jobs.css";

const GLYPH: Record<BadgeKind, string> = { queued: "◔", running: "◐", ready: "●", done: "✓", failed: "✕", cancelled: "–", blocked: "⊘", waiting: "◔" };

function useBadgeActions() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.generation });
  const retry = useMutation({ mutationFn: (id: string) => api.retryGeneration(id), onSuccess: refresh });
  const generate = useMutation({ mutationFn: (v: { caseId: string; itemId: string }) => api.generateVideo(v.caseId, v.itemId), onSuccess: refresh });
  return { retry, generate };
}

export function JobBadge({ caseId, compact = false, pendingVariants }: { caseId: string; compact?: boolean; pendingVariants?: number }) {
  const ov = useOverview();
  const board = useBoard();
  const [log, setLog] = useState<string | null>(null);
  const { retry, generate } = useBadgeActions();
  const pending = pendingVariants ?? (board.data?.items ?? []).filter((i) => i.case_idea_id === caseId && i.status === "pending").length;
  const entry = ov.data?.cases[caseId];
  if (!entry) return null;
  const badge: Badge | null = badgeForCase({ entry, jobs: ov.jobs, workerOnline: ov.workerOnline, now: ov.now, pendingVariants: pending || undefined });
  if (!badge) return null;
  const error = retry.isError ? serverError(retry.error) : generate.isError ? serverError(generate.error) : null;
  const has = (a: Badge["actions"][number]) => badge.actions.includes(a);
  return (
    <span className={`jb jb--${badge.kind} ${compact ? "jb--compact" : ""}`} data-testid={`job-badge-${caseId}`} data-state={entry.stage} data-kind={badge.kind}>
      <span className="jb__main">
        <span className="jb__glyph" aria-hidden="true">
          {GLYPH[badge.kind]}
        </span>
        <b className="jb__label">{badge.label}</b>
        {badge.kind === "running" ? <span className="jb__bar" aria-hidden="true" /> : null}
      </span>
      {badge.detail && !compact ? (
        <span className="jb__detail" data-testid={`job-detail-${caseId}`}>
          {badge.detail}
        </span>
      ) : null}
      {!compact ? (
        <span className="jb__actions">
          {has("retry") && badge.jobId ? (
            <button type="button" className="bd-linkbtn" data-testid={`job-retry-${caseId}`} disabled={retry.isPending} onClick={() => retry.mutate(badge.jobId as string)}>
              Retry
            </button>
          ) : null}
          {has("log") && badge.jobId ? (
            <button type="button" className="bd-linkbtn" data-testid={`job-viewlog-${caseId}`} onClick={() => setLog(badge.jobId as string)}>
              View log
            </button>
          ) : null}
          {has("generate") && entry.accepted_item_id ? (
            <button
              type="button"
              className="bd-linkbtn"
              data-testid={`generate-video-${caseId}`}
              disabled={generate.isPending}
              onClick={() => generate.mutate({ caseId, itemId: entry.accepted_item_id as string })}
            >
              Generate video
            </button>
          ) : null}
          {has("sources") ? (
            <Link to="/sources" className="bd-link" data-testid={`job-sources-${caseId}`}>
              Sources
            </Link>
          ) : null}
          {has("video") ? (
            <Link to="/heatmap" className="bd-link" data-testid={`job-video-${caseId}`}>
              Open on the heatmap
            </Link>
          ) : null}
        </span>
      ) : null}
      {error ? (
        <span className="jb__err" role="alert">
          {error}
        </span>
      ) : null}
      {log ? <LogDrawer jobId={log} onClose={() => setLog(null)} /> : null}
    </span>
  );
}

/** The label of a generated design: "Generated · v2 · SAMPLE DATA" (sample data is always said in words). */
export function GenMark({ item, className = "" }: { item: BoardItem; className?: string }) {
  const s = item.source ?? {};
  if (s.skill !== "generation") return null;
  const sample = s.data_provenance === "sample";
  return (
    <span className={`gm ${sample ? "gm--sample" : ""} ${className}`} data-testid={`gen-mark-${item.id}`}>
      Generated{typeof s.variant === "number" ? ` · v${s.variant}` : ""}
      {sample ? <b data-testid={`sample-label-${item.id}`}> · SAMPLE DATA</b> : null}
    </span>
  );
}

/** The badge of the case behind a design, plus the Generate video button on an accepted legacy design. */
export function ItemJob({ item, compact = false }: { item: BoardItem; compact?: boolean }) {
  if (item.case_idea_id) return item.status === "accepted" ? <JobBadge caseId={item.case_idea_id} compact={compact} /> : null;
  if (item.status !== "accepted" || compact) return null;
  return (
    <button type="button" className="btn btn--sm" disabled title="Videos are generated per case: this design has no case idea behind it" data-testid={`generate-video-${item.id}`}>
      Generate video (needs a case)
    </button>
  );
}
