/**
 * Co-pilot panel: "Draft with Claude" starts a session (POST /api/projects/:id/llm); the log streams
 * SSE llm.event (text, tool calls with name + input summary + result status, the final result, a
 * refusal as a labelled state); a follow-up continues the same session ({prompt, session}).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, type LlmEvent, type ProjectDetail, qk, serverError } from "../api";
import { StatusChip } from "../components/glyphs";
import { Failure } from "../components/ui";
import { useEvents } from "../events";
import { relTime, summarizeToolInput, toolResultStatus } from "../logic";
import { activeLlmJob, draftBlockReason, isNearBottom, mergeEvents, sessionJob, toRows } from "./copilot-log";

const shortTool = (t: string) => t.replace(/^mcp__statreel__/, "");

export function Copilot({ detail }: { detail: ProjectDetail }) {
  const pid = detail.project.id;
  const qc = useQueryClient();
  const sessions = useMemo(
    () => [...detail.sessions].sort((a, b) => b.started_at.localeCompare(a.started_at)),
    [detail.sessions],
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const session = chosen ?? sessions[0]?.id ?? null;
  const [prompt, setPrompt] = useState("");

  // live events for this project since mount (they may arrive before the POST returns)
  const live = useEvents((e) => e.type === "llm.event" && e.project_id === pid);
  const activeJob = activeLlmJob(detail.jobs);
  const running = !!activeJob;
  // a produce chain reads the latest props: no draft may store new ones under it (useProduce blocks the converse)
  const blocked = draftBlockReason(detail.jobs);
  // While a draft runs the persisted log is never trusted as fresh: coming back mid-draft refetches
  // on mount, so tool results that landed while the panel was away are present. Once the job ends the
  // log is final (events.ts also invalidates it at job end).
  const log = useQuery({
    queryKey: qk.llmEvents(session ?? "-"),
    queryFn: () => api.llmEvents(session as string).then((r) => r.events),
    enabled: !!session,
    staleTime: running ? 0 : Number.POSITIVE_INFINITY,
  });
  const events = useMemo<LlmEvent[]>(() => {
    const extra = live.filter((e) => e.session_id === session && e.event).map((e) => e.event as LlmEvent);
    return mergeEvents(log.data ?? [], extra);
  }, [log.data, live, session]);
  const rows = useMemo(() => toRows(events), [events]);

  // the chip speaks for the session on screen: its own newest job, not the project's newest draft
  const job = sessionJob(detail.jobs, session);
  const lastResult = [...events].reverse().find((e): e is Extract<LlmEvent, { type: "result" }> => e.type === "result");
  const refused = job?.status === "refused" || !!lastResult?.refusal;

  const start = useMutation({
    mutationFn: (body: { prompt?: string; session?: string }) => api.startLlm(pid, body),
    onSuccess: (r, body) => {
      if (!body.session) {
        qc.setQueryData(qk.llmEvents(r.session_id), [], { updatedAt: 0 });
        setChosen(r.session_id);
      }
      setPrompt("");
      void qc.invalidateQueries({ queryKey: qk.project(pid) });
    },
  });

  const stop = useMutation({
    mutationFn: (jobId: string) => api.cancelJob(jobId),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.project(pid) }),
  });

  const logRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const [stuck, setStuck] = useState(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new rows
  useEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [rows.length]);
  const jumpToLatest = () => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    stick.current = true;
    setStuck(true);
  };

  const state = running
    ? { s: "data-ready" as const, l: activeJob?.status === "queued" ? "QUEUED" : "DRAFTING" }
    : refused
      ? { s: "ask" as const, l: "REFUSED" }
      : job?.status === "failed"
        ? { s: "blocked" as const, l: "FAILED" }
        : job?.status === "succeeded"
          ? { s: "go" as const, l: "DONE" }
          : null;

  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !session || blocked) return;
    start.mutate({ prompt: prompt.trim(), session });
  };

  return (
    <section className="copilot panel-col" aria-labelledby="h-copilot">
      <div className="col-h">
        <h2 id="h-copilot" className="sec-h">
          <span>Co-pilot · claude-code</span>
          {/* the only live region of the panel: mounted once, its text changes are announced; the log
              itself is not live (every tool row would be read out) */}
          <span className="copilot__status" role="status">
            {state ? <StatusChip status={state.s} size={13} label={state.l} /> : <span className="label">idle</span>}
          </span>
        </h2>
        <div className="copilot__top">
          <button
            type="button"
            className="btn btn--primary btn--sm"
            data-testid="draft-with-claude"
            onClick={() => start.mutate({})}
            disabled={start.isPending || running || !!blocked}
            title={blocked ?? undefined}
          >
            {start.isPending
              ? "Starting"
              : running
                ? "Drafting"
                : sessions.length
                  ? "Draft again with Claude"
                  : "Draft with Claude"}
          </button>
          {activeJob ? (
            <button
              type="button"
              className="btn btn--sm"
              data-testid="stop-draft"
              onClick={() => stop.mutate(activeJob.id)}
              disabled={stop.isPending}
            >
              {stop.isPending ? "Stopping" : "Stop"}
            </button>
          ) : null}
          {sessions.length > 1 ? (
            <label className="copilot__sess">
              <span className="label">Session</span>
              <select value={session ?? ""} onChange={(e) => setChosen(e.target.value)}>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {relTime(s.started_at)} · {s.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <p className="copilot__note">
          Through MCP tools only: validated props, read-only SQL on llm.* views, the narration. Never composition code.
        </p>
        {blocked && !running ? (
          <p className="copilot__note" data-testid="draft-blocked">
            {blocked}
          </p>
        ) : null}
        {start.isError ? (
          <p className="joberr" title={errorText(start.error)}>
            Could not start: {serverError(start.error)}
          </p>
        ) : null}
        {stop.isError ? (
          <p className="joberr" title={errorText(stop.error)}>
            Could not stop: {serverError(stop.error)}
          </p>
        ) : null}
      </div>
      {log.isError ? (
        <div className="copilot__fail">
          <Failure error={log.error} what="The session log" onRetry={() => void log.refetch()} retrying={log.isFetching} />
        </div>
      ) : null}
      <div className="llm-log-wrap">
        <ol
          className="llm-log"
          data-testid="llm-log"
          ref={logRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const near = isNearBottom(el.scrollHeight, el.scrollTop, el.clientHeight);
            stick.current = near;
            setStuck(near);
          }}
        >
          {!session ? (
            <li className="llm-empty">
              No session yet. Draft with Claude reads the views, queries the warehouse, stores props and writes the
              script; every call appears here.
            </li>
          ) : !rows.length ? (
            <li className="llm-empty">
              {running || start.isPending
                ? "Waiting for the first event"
                : log.isLoading
                  ? "Reading the session log"
                  : log.isError
                    ? "The session log could not be read."
                    : "This session has no events."}
            </li>
          ) : (
            rows.map((r) => {
              if (r.k === "session")
                return (
                  <li key={r.key} className="llm-row llm-row--sys">
                    <span className="label">
                      session {r.id.slice(0, 8)} · {r.tools} tools
                    </span>
                  </li>
                );
              if (r.k === "text")
                return (
                  <li key={r.key} className="llm-row llm-row--text">
                    {r.text}
                  </li>
                );
              if (r.k === "stderr")
                return (
                  <li key={r.key} className="llm-row llm-row--err mono">
                    {r.text}
                  </li>
                );
              if (r.k === "result")
                return (
                  <li
                    key={r.key}
                    className={`llm-row llm-row--result${r.e.refusal ? " is-refusal" : r.e.ok ? "" : " is-fail"}`}
                  >
                    <StatusChip
                      status={r.e.refusal ? "ask" : r.e.ok ? "go" : "blocked"}
                      size={13}
                      label={r.e.refusal ? "REFUSAL" : r.e.ok ? "RESULT" : "ENDED WITHOUT SUCCESS"}
                    />
                    <span className="llm-result">{r.e.result}</span>
                    {typeof r.e.cost_usd === "number" || r.e.turns ? (
                      <span className="label">
                        {r.e.turns ? `${r.e.turns} turns` : ""}
                        {typeof r.e.cost_usd === "number" ? ` · $${r.e.cost_usd.toFixed(3)}` : ""}
                      </span>
                    ) : null}
                  </li>
                );
              const res = r.result ? toolResultStatus(r.result.content, r.result.is_error) : null;
              return (
                <li
                  key={r.key}
                  className={`llm-row llm-row--tool${res ? (res.ok ? " is-ok" : " is-err") : " is-wait"}`}
                >
                  <span className="llm-tool">
                    {/* a call in flight shows its name drawn (not as text): the log's text names only
                      tools that have returned, so "set_props" in the log means the props are stored */}
                    {res ? (
                      <b className="mono">{shortTool(r.tool)}</b>
                    ) : (
                      <b
                        className="mono llm-tool__pending"
                        data-tool={shortTool(r.tool)}
                        role="img"
                        aria-label={`${shortTool(r.tool)}, running`}
                      />
                    )}
                    {res ? (
                      <StatusChip status={res.ok ? "go" : "blocked"} size={12} label={res.ok ? "OK" : "ERROR"} />
                    ) : (
                      <span className="label">running</span>
                    )}
                  </span>
                  <span className="llm-in mono">{summarizeToolInput(shortTool(r.tool), r.input)}</span>
                  {res ? <span className="llm-out">{res.summary}</span> : null}
                </li>
              );
            })
          )}
        </ol>
        {!stuck ? (
          <button type="button" className="btn btn--sm llm-jump" data-testid="llm-jump" onClick={jumpToLatest}>
            Jump to latest
          </button>
        ) : null}
      </div>
      <form className="copilot__follow" onSubmit={send}>
        <label className="sr-only" htmlFor="follow">
          Follow-up to the co-pilot
        </label>
        <input
          id="follow"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={session ? "Follow up in this session" : "Draft first, then follow up"}
          disabled={!session || running}
        />
        <button
          type="submit"
          className="btn btn--sm"
          disabled={!session || running || !!blocked || !prompt.trim() || start.isPending}
        >
          Send
        </button>
      </form>
    </section>
  );
}
