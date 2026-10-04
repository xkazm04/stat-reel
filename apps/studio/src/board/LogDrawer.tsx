/**
 * Log drawer of a generation job (D.11): the run log, live while the job runs. It reads the log in
 * increments (`GET /api/generation/jobs/:id/log?offset=`, header X-Next-Offset) every 2 s and stops once
 * the job is over and the log is read to its end.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, qk } from "../api";
import { formatSpend } from "./jobs";

export function LogDrawer({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const offset = useRef(0);
  const pre = useRef<HTMLPreElement>(null);
  const job = useQuery({ queryKey: [...qk.generation, "job", jobId], queryFn: () => api.generationJob(jobId), refetchInterval: (q) => (q.state.data?.job.status === "running" || q.state.data?.job.status === "queued" ? 2000 : false) });
  const live = job.data?.job.status === "running" || job.data?.job.status === "queued";

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pull = async () => {
      try {
        const r = await api.generationLog(jobId, offset.current);
        if (stop) return;
        if (r.text) setText((t) => t + r.text);
        offset.current = r.next;
      } catch {
        /* the next tick retries */
      }
      if (!stop) timer = setTimeout(pull, 2000);
    };
    void pull();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  // keep the newest line in view
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the text grows
  useEffect(() => {
    pre.current?.scrollTo({ top: pre.current.scrollHeight });
  }, [text]);

  const j = job.data?.job;
  const spend = formatSpend(j);
  return (
    <aside className="jlog" role="dialog" aria-label="Generation log" data-testid="job-log">
      <header className="jlog__head">
        <b className="mono">{jobId}</b>
        <span className="jlog__state">{j ? `${j.type} · ${j.status}${j.error_kind ? ` · ${j.error_kind}` : ""}` : "loading"}</span>
        {spend ? (
          <span className="jlog__state mono" data-testid="job-log-cost">
            {spend}
          </span>
        ) : null}
        {live ? <span className="jlog__live">live</span> : null}
        <button type="button" className="btn btn--sm" onClick={onClose} data-testid="job-log-close">
          Close
        </button>
      </header>
      {j?.error ? <p className="jlog__err">{j.error}</p> : null}
      <pre className="jlog__body mono" ref={pre}>
        {text || "No log lines yet."}
      </pre>
    </aside>
  );
}
