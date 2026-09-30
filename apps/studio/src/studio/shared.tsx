/**
 * Pieces the three studio screens share: the project context, the live job line, the gate verdict
 * (data-testid policy-verdict holds only the verdict word) and the publication status
 * (data-testid publication-status holds only the status, so "private" appears only once published).
 */
import type { UseCase } from "@statreel/schemas";
import { useParams } from "@tanstack/react-router";
import type { Job, ProjectDetail } from "../api";
import { StatusChip } from "../components/glyphs";
import { latestRender, renderPolicy, useHeatmap, useProject } from "../data";
import { useJobProgress } from "../events";
import { activeJob, pct } from "../onair";

export function useStudio() {
  const { projectId } = useParams({ from: "/studio/$projectId" });
  const q = useProject(projectId);
  const hm = useHeatmap();
  const usecase: UseCase | undefined = hm.data?.usecases.find((u) => u.id === q.data?.project.use_case_id);
  return { projectId, q, detail: q.data, usecase, heatmap: hm.data };
}

const PRODUCE = new Set(["audio", "render"]);
export const produceJob = (d: ProjectDetail | undefined): Job | null =>
  activeJob((d?.jobs ?? []).filter((j) => PRODUCE.has(j.kind)));
export const publishJob = (d: ProjectDetail | undefined): Job | null =>
  activeJob((d?.jobs ?? []).filter((j) => j.kind === "publish"));
export const lastJobOf = (d: ProjectDetail | undefined, kinds: string[]): Job | null =>
  [...(d?.jobs ?? [])]
    .filter((j) => kinds.includes(j.kind))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;

const JOB_WORD: Record<string, string> = {
  llm: "Co-pilot",
  audio: "Audio",
  render: "Render",
  publish: "Publish",
  metrics: "Metrics",
};

/** One job with its live SSE progress (falls back to the stored progress). */
export function JobLine({ job, projectId }: { job: Job; projectId: string }) {
  const live = useJobProgress(projectId).get(job.id);
  const p = live?.progress ?? job.progress;
  return (
    <div className="jobline" role="status">
      <span className="jobline__k">
        {JOB_WORD[job.kind] ?? job.kind} · {job.status}
      </span>
      <span className="bar-track">
        <span className="bar-fill" style={{ width: pct(p) }} />
      </span>
      <span className="mono">
        {pct(p)}
        {live?.note ? ` · ${live.note}` : ""}
      </span>
    </div>
  );
}

/** Latest failed/refused job of some kinds, error verbatim. */
export function JobError({ job }: { job: Job | null }) {
  if (!job || (job.status !== "failed" && job.status !== "refused" && job.status !== "cancelled")) return null;
  return (
    <p className={`joberr joberr--${job.status}`} role="alert">
      <StatusChip
        status={job.status === "refused" ? "ask" : "blocked"}
        size={13}
        label={`${(JOB_WORD[job.kind] ?? job.kind).toUpperCase()} ${job.status.toUpperCase()}`}
      />
      <span className="mono">{job.error ?? "no error text"}</span>
    </p>
  );
}

/** The gate verdict word. PENDING while a produce chain runs; NO VERDICT before any render. */
export function Verdict({ detail, size = "md" }: { detail: ProjectDetail; size?: "md" | "lg" }) {
  const render = latestRender(detail);
  const policy = renderPolicy(render);
  const running = produceJob(detail);
  const word = running ? "PENDING" : policy ? (policy.allow ? "ALLOW" : "DENY") : "NO VERDICT";
  const status = running || !policy ? null : policy.allow ? "go" : "blocked";
  return (
    <span className={`verdict-word verdict-word--${size} ${status ? `st--${status}` : "is-none"}`}>
      {status ? <StatusChip status={status} size={size === "lg" ? 26 : 16} label="" /> : null}
      <b data-testid="policy-verdict">{word}</b>
    </span>
  );
}

/** Publication status word: NOT SENT / UPLOADING / REFUSED / the stored visibility. */
export function PublicationStatus({ detail }: { detail: ProjectDetail }) {
  const pub = detail.publications[0];
  const job = publishJob(detail);
  const last = lastJobOf(detail, ["publish"]);
  const word = pub
    ? pub.status
    : job
      ? job.status === "queued"
        ? "queued"
        : "uploading"
      : last?.status === "refused"
        ? "refused"
        : last?.status === "failed"
          ? "failed"
          : "not sent";
  return (
    <span className={`pubstat ${pub ? "pubstat--on" : "pubstat--off"}`}>
      <i aria-hidden="true" />
      <b data-testid="publication-status">{word}</b>
      {pub ? (
        <span className="pubstat__m">
          {pub.platform}
          {pub.mode === "dry" ? " · dry run" : ""}
        </span>
      ) : null}
    </span>
  );
}
