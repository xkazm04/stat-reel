/**
 * Log drawer of a generation job (D.11): the run log, live while the job runs. It reads the log in
 * increments (`GET /api/generation/jobs/:id/log?offset=`, header X-Next-Offset) every 2 s and stops once
 * the job is over and the log is read to its end.
 *
 * Not modal (the page stays readable behind it) but it owns the keyboard while open: it takes focus, Esc
 * closes it and hands focus back to the opener, and `data-keys-block` switches the Board's decision and undo
 * keys off (keys.ts), so a stray A/S/C/B/Z while reading cannot decide or undo anything.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, qk, serverError } from "../api";
import { formatSpend } from "./jobs";
import { tailLog } from "./logtail";

export function LogDrawer({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [readError, setReadError] = useState<unknown | null>(null);
  const pre = useRef<HTMLPreElement>(null);
  const root = useRef<HTMLElement>(null);
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const close = useRef(onClose);
  close.current = onClose;
  const job = useQuery({
    queryKey: [...qk.generation, "job", jobId],
    queryFn: () => api.generationJob(jobId),
    refetchInterval: (q) =>
      q.state.data?.job.status === "running" || q.state.data?.job.status === "queued" ? 2000 : false,
  });
  const live = job.data?.job.status === "running" || job.data?.job.status === "queued";
  const statusRef = useRef<string | undefined>(undefined);
  statusRef.current = job.data?.job.status;

  // read in increments until the job is over and its log is read to the end (logtail.ts)
  useEffect(
    () =>
      tailLog({
        read: (at) => api.generationLog(jobId, at),
        status: () => statusRef.current,
        onText: (t) => setText((x) => x + t),
        onError: setReadError,
        every: 2000,
      }),
    [jobId],
  );

  // focus in on open, back to the opener on close
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [opener]);

  // Esc closes it, wherever focus is; capture so a lightbox behind it does not take the same Esc.
  // A dialog opened on top (the cancel confirm) keeps its own Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]:not(.bd-lb)")) return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  // keep the newest line in view
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the text grows
  useEffect(() => {
    pre.current?.scrollTo({ top: pre.current.scrollHeight });
  }, [text]);

  const j = job.data?.job;
  const spend = formatSpend(j);
  return (
    <aside
      className="jlog"
      role="dialog"
      aria-label="Generation log"
      data-testid="job-log"
      data-keys-block=""
      tabIndex={-1}
      ref={root}
    >
      <header className="jlog__head">
        <b className="mono">{jobId}</b>
        <span className="jlog__state">
          {j ? `${j.type} · ${j.status}${j.error_kind ? ` · ${j.error_kind}` : ""}` : "loading"}
        </span>
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
      {readError ? (
        <p className="jlog__err" role="alert" data-testid="job-log-read-error">
          Could not read the log: {serverError(readError)}. Retrying every 2 s.
        </p>
      ) : null}
      <pre className="jlog__body mono" ref={pre}>
        {text || "No log lines yet."}
      </pre>
    </aside>
  );
}
