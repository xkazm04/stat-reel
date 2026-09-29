/**
 * Right rack: the LLM co-pilot. "Draft with Claude" starts a session; the log streams SSE
 * `llm.event`s (text, compact tool rows paired with their results, final result, refusal as a
 * labelled state); a follow-up prompt continues the same session.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, type Job, type LlmEvent, type ProjectDetail, qk } from "../api";
import { Led } from "../components/glyphs";
import { Module } from "../components/ui";
import { type AppEvent, useEvents } from "../events";
import { relTime, summarizeToolInput, toolResultStatus } from "../logic";

type Row =
  | { k: "session"; id: string }
  | { k: "text"; text: string }
  | { k: "tool"; id: string; tool: string; input: unknown; result?: { content: string; is_error?: boolean } }
  | { k: "result"; e: Extract<LlmEvent, { type: "result" }> }
  | { k: "stderr"; text: string };

function toRows(events: LlmEvent[]): Row[] {
  const rows: Row[] = [];
  const tools = new Map<string, Extract<Row, { k: "tool" }>>();
  for (const e of events) {
    if (e.type === "session") rows.push({ k: "session", id: e.session_id });
    else if (e.type === "text") rows.push({ k: "text", text: e.text });
    else if (e.type === "tool_call") {
      const r: Extract<Row, { k: "tool" }> = { k: "tool", id: e.id, tool: e.tool, input: e.input };
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

export function CopilotPanel({ detail }: { detail: ProjectDetail }) {
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
    queryFn: () => api.llmEvents(session!).then((r) => r.events),
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

  const llmJobs = detail.jobs.filter((j) => j.kind === "llm");
  const job: Job | undefined = llmJobs[0];
  const running = !!job && (job.status === "queued" || job.status === "running");
  const lastResult = [...events].reverse().find((e) => e.type === "result") as
    | Extract<LlmEvent, { type: "result" }>
    | undefined;
  const refused = job?.status === "refused" || !!lastResult?.refusal;

  const start = useMutation({
    mutationFn: (body: { prompt?: string; session?: string }) => api.startLlm(pid, body),
    onSuccess: (r, body) => {
      if (!body.session) {
        // a fresh session: nothing fetched yet, every live event after "0" belongs to the log
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

  const statusLed = running ? (
    <Led status="running" label={job?.status === "queued" ? "QUEUED" : "RUNNING"} />
  ) : refused ? (
    <Led status="refuse" label="REFUSED" />
  ) : job?.status === "failed" ? (
    <Led status="fail" label="FAILED" />
  ) : job?.status === "succeeded" ? (
    <Led status="pass" label="DONE" />
  ) : (
    <Led status="idle" label="IDLE" />
  );

  return (
    <Module
      id="m-copilot"
      title="Co-pilot"
      tag="claude-code · MCP tools only"
      className="mod copilot-mod"
      actions={statusLed}
    >
      <div className="copilot-top">
        <button
          type="button"
          className="key primary"
          onClick={() => start.mutate({})}
          disabled={start.isPending || running}
          data-testid="draft-with-claude"
        >
          {start.isPending
            ? "Starting…"
            : running
              ? "Drafting…"
              : sessions.length
                ? "Draft again with Claude"
                : "Draft with Claude"}
        </button>
        {sessions.length > 1 ? (
          <label className="sess-pick">
            <span className="legend">Session</span>
            <select value={session ?? ""} onChange={(e) => setChosen(e.target.value)}>
              {sessions.map((s, i) => (
                <option key={s.id} value={s.id}>
                  {i === 0 ? "latest · " : ""}
                  {relTime(s.started_at)} · {s.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {start.isError ? (
        <div className="errbox" role="alert">
          <Led status="blocked" label="ERROR" />
          <span className="mono">{errorText(start.error)}</span>
        </div>
      ) : null}
      <ol
        className="display llm-log"
        ref={logRef}
        data-testid="llm-log"
        aria-live="polite"
        aria-label="Co-pilot session log"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {!session ? (
          <li className="log-empty">
            No session yet. The co-pilot works only through StatReel's MCP tools: it reads llm.* views, stores validated
            props and a fact-bound script. It never writes composition code.
          </li>
        ) : log.isLoading ? (
          <li className="log-empty">Loading session log…</li>
        ) : !rows.length ? (
          <li className="log-empty">{running ? "Waiting for the first event…" : "This session has no events."}</li>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the log is append-only; position is identity
          rows.map((r, i) => <LogRow key={`${r.k}-${i}`} r={r} />)
        )}
        {refused && job?.error ? (
          <li className="log-refusal" data-testid="llm-refusal">
            <Led status="refuse" label="REFUSED" />
            <span>{job.error}</span>
          </li>
        ) : job?.status === "failed" && job.error ? (
          <li className="log-refusal">
            <Led status="fail" label="FAILED" />
            <span>{job.error}</span>
          </li>
        ) : null}
      </ol>
      <form
        className="followup"
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim() && session) start.mutate({ prompt: prompt.trim(), session });
        }}
      >
        <label className="legend" htmlFor="llm-followup">
          Follow-up · continues this session
        </label>
        <textarea
          id="llm-followup"
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={session ? "e.g. Make the hook payoff-first and tighten the close." : "Start a draft first."}
          disabled={!session}
          data-testid="llm-followup"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit();
          }}
        />
        <button
          type="submit"
          className="key small"
          disabled={!session || !prompt.trim() || running || start.isPending}
          data-testid="llm-send"
        >
          Send · Ctrl+Enter
        </button>
      </form>
    </Module>
  );
}

function LogRow({ r }: { r: Row }) {
  switch (r.k) {
    case "session":
      return (
        <li className="log-sys">
          <span className="legend">session</span> <span className="mono">{r.id}</span>
        </li>
      );
    case "text":
      return <li className="log-text">{r.text}</li>;
    case "stderr":
      return <li className="log-err mono">{r.text}</li>;
    case "tool": {
      const res = r.result ? toolResultStatus(r.result.content, r.result.is_error) : null;
      return (
        <li className="log-tool">
          <span className="tool-name mono">{r.tool}</span>
          <span className="tool-in mono">{summarizeToolInput(r.tool, r.input)}</span>
          {res ? (
            <Led status={res.ok ? "pass" : "fail"} label={res.ok ? "OK" : "ERROR"} />
          ) : (
            <Led status="running" label="…" />
          )}
          {res ? <span className="tool-out mono">{res.summary}</span> : null}
        </li>
      );
    }
    case "result":
      return (
        <li className={`log-result${r.e.refusal ? " refused" : r.e.ok ? " ok" : " bad"}`}>
          {r.e.refusal ? (
            <Led status="refuse" label="REFUSED" />
          ) : r.e.ok ? (
            <Led status="pass" label="RESULT" />
          ) : (
            <Led status="fail" label="FAILED" />
          )}
          <span className="res-text">{r.e.result}</span>
          <span className="mono res-meta">
            {r.e.turns !== undefined ? `${r.e.turns} turns` : ""}
            {r.e.cost_usd !== undefined ? ` · $${r.e.cost_usd.toFixed(4)}` : ""}
          </span>
        </li>
      );
  }
}
