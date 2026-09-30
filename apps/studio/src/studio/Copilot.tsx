/**
 * Co-pilot panel: "Draft with Claude" starts a session (POST /api/projects/:id/llm); the log streams
 * SSE llm.event (text, tool calls with name + input summary + result status, the final result, a
 * refusal as a labelled state); a follow-up continues the same session ({prompt, session}).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, type LlmEvent, type ProjectDetail, qk } from "../api";
import { StatusChip } from "../components/glyphs";
import { type AppEvent, useEvents } from "../events";
import { relTime, summarizeToolInput, toolResultStatus } from "../logic";

type ToolRow = {
  k: "tool";
  id: string;
  tool: string;
  input: unknown;
  result?: { content: string; is_error?: boolean };
};
type Row =
  | { k: "session"; id: string; tools: number }
  | { k: "text"; text: string }
  | ToolRow
  | { k: "result"; e: Extract<LlmEvent, { type: "result" }> }
  | { k: "stderr"; text: string };

function toRows(events: LlmEvent[]): Row[] {
  const rows: Row[] = [];
  const tools = new Map<string, ToolRow>();
  for (const e of events) {
    if (e.type === "session") rows.push({ k: "session", id: e.session_id, tools: e.tools?.length ?? 0 });
    else if (e.type === "text") rows.push({ k: "text", text: e.text });
    else if (e.type === "tool_call") {
      const r: ToolRow = { k: "tool", id: e.id, tool: e.tool, input: e.input };
      tools.set(e.id, r);
      rows.push(r);
    } else if (e.type === "tool_result") {
      const t = tools.get(e.id);
      if (t) t.result = { content: e.content, is_error: e.is_error };
      else
        rows.push({
          k: "tool",
          id: e.id,
          tool: "(result)",
          input: {},
          result: { content: e.content, is_error: e.is_error },
        });
    } else if (e.type === "result") rows.push({ k: "result", e });
    else if (e.type === "stderr") rows.push({ k: "stderr", text: e.text });
  }
  return rows;
}

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
  const log = useQuery({
    queryKey: qk.llmEvents(session ?? "-"),
    queryFn: () => api.llmEvents(session as string).then((r) => r.events),
    enabled: !!session,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const fetchedAt = log.dataUpdatedAt;
  const events = useMemo<LlmEvent[]>(() => {
    const base = log.data ?? [];
    const extra = live
      .filter((e: AppEvent) => e.session_id === session && e.receivedAt > fetchedAt && e.event)
      .map((e) => e.event as LlmEvent);
    return [...base, ...extra];
  }, [log.data, live, session, fetchedAt]);
  const rows = useMemo(() => toRows(events), [events]);

  const job = detail.jobs.find((j) => j.kind === "llm");
  const running = !!job && (job.status === "queued" || job.status === "running");
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

  const logRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new rows
  useEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  const state = running
    ? { s: "data-ready" as const, l: job?.status === "queued" ? "QUEUED" : "DRAFTING" }
    : refused
      ? { s: "ask" as const, l: "REFUSED" }
      : job?.status === "failed"
        ? { s: "blocked" as const, l: "FAILED" }
        : job?.status === "succeeded"
          ? { s: "go" as const, l: "DONE" }
          : null;

  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !session) return;
    start.mutate({ prompt: prompt.trim(), session });
  };

  return (
    <section className="copilot panel-col" aria-labelledby="h-copilot">
      <div className="col-h">
        <h2 id="h-copilot" className="sec-h">
          <span>Co-pilot · claude-code</span>
          {state ? <StatusChip status={state.s} size={13} label={state.l} /> : <span className="label">idle</span>}
        </h2>
        <div className="copilot__top">
          <button
            type="button"
            className="btn btn--primary btn--sm"
            data-testid="draft-with-claude"
            onClick={() => start.mutate({})}
            disabled={start.isPending || running}
          >
            {start.isPending
              ? "Starting"
              : running
                ? "Drafting"
                : sessions.length
                  ? "Draft again with Claude"
                  : "Draft with Claude"}
          </button>
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
        {start.isError ? <p className="joberr">Could not start: {errorText(start.error)}</p> : null}
      </div>
      <ol
        className="llm-log"
        data-testid="llm-log"
        ref={logRef}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
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
                : "This session has no events."}
          </li>
        ) : (
          rows.map((r, i) => {
            if (r.k === "session")
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: log rows are append-only
                <li key={i} className="llm-row llm-row--sys">
                  <span className="label">
                    session {r.id.slice(0, 8)} · {r.tools} tools
                  </span>
                </li>
              );
            if (r.k === "text")
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: log rows are append-only
                <li key={i} className="llm-row llm-row--text">
                  {r.text}
                </li>
              );
            if (r.k === "stderr")
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: log rows are append-only
                <li key={i} className="llm-row llm-row--err mono">
                  {r.text}
                </li>
              );
            if (r.k === "result")
              return (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: log rows are append-only
                  key={i}
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
              // biome-ignore lint/suspicious/noArrayIndexKey: log rows are append-only
              <li key={i} className={`llm-row llm-row--tool${res ? (res.ok ? " is-ok" : " is-err") : " is-wait"}`}>
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
          disabled={!session || running || !prompt.trim() || start.isPending}
        >
          Send
        </button>
      </form>
    </section>
  );
}
