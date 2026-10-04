/**
 * Co-pilot transcript model. No React, no DOM.
 * The persisted event log (GET /api/llm/:session/events) and the live SSE buffer overlap whenever
 * the panel mounts, refetches or reconnects mid-draft; the events carry no seq, so the merge matches
 * the persisted tail against the live head instead of trusting timestamps. Row keys are derived from
 * identity (tool call id, or the ordinal within the row kind) because the log is append-only.
 */
import type { LlmEvent } from "../api";

export type ToolRow = {
  k: "tool";
  id: string;
  tool: string;
  input: unknown;
  result?: { content: string; is_error?: boolean };
};
export type Row = (
  | { k: "session"; id: string; tools: number }
  | { k: "text"; text: string }
  | ToolRow
  | { k: "result"; e: Extract<LlmEvent, { type: "result" }> }
  | { k: "stderr"; text: string }
) & { key: string };

const same = (a: LlmEvent, b: LlmEvent) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Persisted events followed by the live ones the persisted log does not yet hold. The longest
 * overlap between the end of `base` and the start of `live` is dropped from `live`, so a refetch
 * that already includes some live events neither duplicates nor reorders them.
 */
export function mergeEvents(base: readonly LlmEvent[], live: readonly LlmEvent[]): LlmEvent[] {
  const max = Math.min(base.length, live.length);
  for (let k = max; k > 0; k--) {
    let ok = true;
    for (let i = 0; i < k && ok; i++) ok = same(base[base.length - k + i] as LlmEvent, live[i] as LlmEvent);
    if (ok) return [...base, ...live.slice(k)];
  }
  return [...base, ...live];
}

export function toRows(events: readonly LlmEvent[]): Row[] {
  const rows: Row[] = [];
  const tools = new Map<string, ToolRow & { key: string }>();
  const seen = new Map<string, number>();
  const nth = (kind: string) => {
    const n = seen.get(kind) ?? 0;
    seen.set(kind, n + 1);
    return n;
  };
  for (const e of events) {
    if (e.type === "session")
      rows.push({ k: "session", id: e.session_id, tools: e.tools?.length ?? 0, key: `session:${nth("session")}` });
    else if (e.type === "text") rows.push({ k: "text", text: e.text, key: `text:${nth("text")}` });
    else if (e.type === "tool_call") {
      const r = { k: "tool" as const, id: e.id, tool: e.tool, input: e.input, key: `tool:${e.id}` };
      tools.set(e.id, r);
      rows.push(r);
    } else if (e.type === "tool_result") {
      const t = tools.get(e.id);
      if (t) t.result = { content: e.content, is_error: e.is_error };
      else {
        const r = {
          k: "tool" as const,
          id: e.id,
          tool: "(result)",
          input: {},
          result: { content: e.content, is_error: e.is_error },
          key: `tool:${e.id}`,
        };
        tools.set(e.id, r);
        rows.push(r);
      }
    } else if (e.type === "result") rows.push({ k: "result", e, key: `result:${nth("result")}` });
    else if (e.type === "stderr") rows.push({ k: "stderr", text: e.text, key: `stderr:${nth("stderr")}` });
  }
  return rows;
}

/** True when the scroll position is within `slack` px of the bottom (the log follows new rows). */
export const isNearBottom = (scrollHeight: number, scrollTop: number, clientHeight: number, slack = 40): boolean =>
  scrollHeight - scrollTop - clientHeight < slack;

/** The newest llm job of a project's job list that is still queued or running, else null. */
export function activeLlmJob<J extends { kind: string; status: string }>(jobs: readonly J[]): J | null {
  return jobs.find((j) => j.kind === "llm" && (j.status === "queued" || j.status === "running")) ?? null;
}

/**
 * Why the co-pilot may not start or continue a draft now, or null. A produce chain reads the latest props
 * at each step: props a draft stores between the audio and the render carry no timing, so the render
 * fails. useProduce already blocks a produce while a draft runs; this is the converse half of that rule.
 */
export function draftBlockReason(jobs: readonly { kind: string; status: string }[]): string | null {
  const producing = jobs.some(
    (j) => (j.kind === "audio" || j.kind === "render") && (j.status === "queued" || j.status === "running"),
  );
  return producing
    ? "A produce is running; draft once it ends (new props would leave the render without timing)."
    : null;
}
