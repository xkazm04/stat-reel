/**
 * Pieces the studio screens share: the project context, the live job line, the gate verdict
 * (data-testid policy-verdict holds only the verdict word) and a read-only publication line
 * (data-testid publication-status holds only the status, so "private" appears only once published).
 */
import type { UseCase } from "@statreel/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api, type Job, type ProjectDetail, qk, type RenderRow } from "../api";
import { StatusChip } from "../components/glyphs";
import { latestRender, renderPolicy, useHeatmap, useProject } from "../data";
import { activeJob, pct } from "../display";
import { useJobProgress } from "../events";
import { compositionState, produceBlockReason, verdictView } from "../studio-logic";
import { denyHint } from "./deny-hints";
import { activeStageText, produceOutcome, produceStages } from "./produce-stages";

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

/**
 * One job with its live SSE progress (falls back to the stored progress). A produce job (audio or
 * render) also shows the stage stepper, derived from the job row so it is right when the page opens
 * mid-job; SSE notes only refine it. Not a live region: ticks every second or so would flood a screen
 * reader, so the finish is announced once by ProduceAnnouncer instead.
 */
export function JobLine({ job, projectId }: { job: Job; projectId: string }) {
  const live = useJobProgress(projectId).get(job.id);
  const p = live?.progress ?? job.progress;
  const produce = PRODUCE.has(job.kind);
  const stages = produce ? produceStages({ ...job, progress: p }, live?.note) : [];
  const stageText = activeStageText(stages);
  const now = Math.round(Math.max(0, Math.min(1, p ?? 0)) * 100);
  return (
    <div className={`jobline${produce ? " jobline--steps" : ""}`}>
      <span className="jobline__k">
        {JOB_WORD[job.kind] ?? job.kind} · {job.status}
      </span>
      <span
        className="bar-track"
        role="progressbar"
        aria-label={`${JOB_WORD[job.kind] ?? job.kind} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={now}
        aria-valuetext={stageText ? `${stageText}, ${now} %` : `${now} %`}
      >
        <span className="bar-fill" style={{ width: pct(p) }} />
      </span>
      <span className="mono">
        {pct(p)}
        {live?.note ? ` · ${live.note}` : ""}
      </span>
      {produce ? (
        <ol className="stepper" aria-label="Produce stages">
          {stages.map((s) => (
            <li
              key={s.id}
              className={`stepper__s stepper__s--${s.state}`}
              aria-current={s.state === "active" ? "step" : undefined}
            >
              {s.label}
              <span className="sr-only"> ({s.state})</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/**
 * The one persistent polite live region for a produce: empty while it runs (no per-tick chatter), then one
 * sentence when it ends ("Produce finished: ALLOW" / "DENY", or the failure). It stays mounted when the job
 * row disappears, which is why the old role=status on the job line never announced the finish.
 */
export function ProduceAnnouncer({ detail }: { detail: ProjectDetail | undefined }) {
  const running = !!produceJob(detail);
  const was = useRef(running);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (running) setMsg("");
    else if (was.current) setMsg(produceOutcome(detail?.jobs ?? [], detail?.renders ?? []) ?? "");
    was.current = running;
  }, [running, detail]);
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="produce-announcer">
      {msg}
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

/**
 * The gate verdict word. Without `render` it is the project's gate: PENDING while a produce chain
 * runs, NO VERDICT before any render. With `render` (the gate page's shown render) it is that
 * render's own verdict and a running produce does not override it (see verdictView).
 */
export function Verdict({
  detail,
  render: shown,
  size = "md",
}: {
  detail: ProjectDetail;
  render?: RenderRow | null;
  size?: "md" | "lg";
}) {
  const named = shown !== undefined;
  const policy = renderPolicy(named ? shown : latestRender(detail));
  const { word, status } = verdictView(policy, !!produceJob(detail), named);
  return (
    <span className={`verdict-word verdict-word--${size} ${status ? `st--${status}` : "is-none"}`}>
      {status ? <StatusChip status={status} size={size === "lg" ? 26 : 16} label="" /> : null}
      <b data-testid="policy-verdict">{word}</b>
    </span>
  );
}

/** One OPA deny reason, verbatim, and under it a one-line fix hint when the reason is a known rule. */
export function DenyReason({ reason }: { reason: string }) {
  const hint = denyHint(reason);
  return (
    <>
      <span className="mono">{reason}</span>
      {hint ? <span className="reason-hint">{hint}</span> : null}
    </>
  );
}

/**
 * The Produce action both the control room and the gate page offer: one mutation, one set of guards
 * (props and a script exist, nothing running, no co-pilot session, the use case has a built composition).
 * The composition block depends only on the use case's name, so the gate page need not load the chunk.
 */
export function useProduce(detail: ProjectDetail | undefined, usecaseComposition: string | null | undefined) {
  const qc = useQueryClient();
  const pid = detail?.project.id ?? "";
  const mutation = useMutation({
    mutationFn: () =>
      api.produce(pid, { platform: "youtube", monetized: detail?.project.mode === "monetized", ai_disclosure: true }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.project(pid) }),
  });
  const running = produceJob(detail);
  const llm = detail?.jobs.find((j) => j.kind === "llm" && (j.status === "queued" || j.status === "running"));
  const blockReason = produceBlockReason(compositionState(usecaseComposition, "ready"));
  const canProduce = !!detail?.props?.props && !!detail.script && !running && !llm && !blockReason;
  return { mutation, running, blockReason, canProduce };
}

/**
 * Read-only publication line (publishing itself happens in the Calendar): the stored visibility
 * of the newest publication, its platform and whether it was a dry run; links to the Calendar.
 */
export function PublicationStatus({ detail }: { detail: ProjectDetail }) {
  const pub = detail.publications[0];
  const job = publishJob(detail);
  const word = pub ? pub.status : job ? (job.status === "queued" ? "queued" : "uploading") : "not on the calendar";
  return (
    <Link to="/calendar" className={`pubstat ${pub ? "pubstat--on" : "pubstat--off"}`}>
      <i aria-hidden="true" />
      <b data-testid="publication-status">{word}</b>
      {pub ? (
        <span className="pubstat__m">
          {pub.platform}
          {pub.mode === "dry" ? " · dry run" : ""}
        </span>
      ) : null}
      <span className="pubstat__m pubstat__cal">· calendar</span>
    </Link>
  );
}
