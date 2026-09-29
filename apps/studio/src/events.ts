/**
 * One EventSource('/events') for the whole app, shared through React context. The provider also
 * keeps TanStack Query honest: every job state change (job.* except progress), render.done and
 * co-pilot tool results invalidate the caches they can change.
 */
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { createContext, createElement, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { type LlmEvent, qk } from "./api";

export type AppEvent = {
  type: string;
  at?: string;
  id?: string;
  kind?: string;
  project_id?: string | null;
  progress?: number;
  note?: string;
  error?: string | null;
  result?: unknown;
  session_id?: string;
  event?: LlmEvent;
  render_id?: string;
  allow?: boolean;
  /** client receipt time (ms), stamped by the provider */
  receivedAt: number;
};

export type ConnectionState = "connecting" | "open" | "closed";
type Listener = (e: AppEvent) => void;
type Hub = { subscribe: (fn: Listener) => () => void; state: ConnectionState };

export const JOB_EVENTS = [
  "job.queued",
  "job.started",
  "job.progress",
  "job.succeeded",
  "job.failed",
  "job.cancelled",
  "job.refused",
] as const;
/** Named SSE events (the server writes `event: <type>`; EventSource needs one listener per name). */
const NAMED = [...JOB_EVENTS, "llm.event", "render.done", "heatmap.updated", "project.updated", "ping"];

const Ctx = createContext<Hub | null>(null);

function invalidate(qc: QueryClient, e: AppEvent): void {
  const pid = e.project_id ?? undefined;
  if (e.type.startsWith("job.") && e.type !== "job.progress") {
    void qc.invalidateQueries({ queryKey: qk.projects });
    void qc.invalidateQueries({ queryKey: qk.jobs });
    if (pid) void qc.invalidateQueries({ queryKey: qk.project(pid) });
    if (e.type === "job.succeeded" && (e.kind === "ingest" || e.kind === "transform")) {
      void qc.invalidateQueries({ queryKey: qk.heatmap });
      void qc.invalidateQueries({ queryKey: qk.sources });
    }
    // a finished co-pilot session: reload its authoritative event log
    if (e.kind === "llm" && e.type !== "job.queued" && e.type !== "job.started")
      void qc.invalidateQueries({ queryKey: ["llm-events"] });
  } else if (e.type === "render.done" || e.type === "project.updated") {
    if (pid) void qc.invalidateQueries({ queryKey: qk.project(pid) });
    void qc.invalidateQueries({ queryKey: qk.projects });
  } else if (e.type === "heatmap.updated") {
    void qc.invalidateQueries({ queryKey: qk.heatmap });
  } else if (e.type === "llm.event" && e.event?.type === "tool_result" && pid) {
    // set_props / write_script may have stored a new version
    void qc.invalidateQueries({ queryKey: qk.project(pid) });
    void qc.invalidateQueries({ queryKey: qk.projects });
  }
}

export function EventsProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const listeners = useRef(new Set<Listener>());
  const [state, setState] = useState<ConnectionState>("connecting");

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      setState("closed");
      return;
    }
    const es = new EventSource("/events");
    const onOpen = () => setState("open");
    const onError = () => setState(es.readyState === EventSource.CLOSED ? "closed" : "connecting");
    const handle = (msg: MessageEvent<string>) => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(msg.data) as Record<string, unknown>;
      } catch {
        return;
      }
      const e = { type: msg.type, ...data, receivedAt: Date.now() } as AppEvent;
      if (e.type === "ping") return;
      invalidate(qc, e);
      for (const fn of listeners.current) fn(e);
    };
    es.addEventListener("open", onOpen);
    es.addEventListener("error", onError);
    es.addEventListener("message", handle);
    for (const name of NAMED) es.addEventListener(name, handle as EventListener);
    return () => {
      for (const name of NAMED) es.removeEventListener(name, handle as EventListener);
      es.close();
    };
  }, [qc]);

  const hub = useMemo<Hub>(
    () => ({
      state,
      subscribe: (fn) => {
        listeners.current.add(fn);
        return () => void listeners.current.delete(fn);
      },
    }),
    [state],
  );
  return createElement(Ctx.Provider, { value: hub }, children);
}

export function useConnectionState(): ConnectionState {
  return useContext(Ctx)?.state ?? "closed";
}

/**
 * Events matching `filter` received since mount (bounded buffer, newest last). `onEvent` runs for
 * each matching event. The filter may change between renders; the latest one is used.
 */
export function useEvents(filter: (e: AppEvent) => boolean, onEvent?: (e: AppEvent) => void, limit = 400): AppEvent[] {
  const hub = useContext(Ctx);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const filterRef = useRef(filter);
  const onEventRef = useRef(onEvent);
  filterRef.current = filter;
  onEventRef.current = onEvent;
  useEffect(() => {
    if (!hub) return;
    return hub.subscribe((e) => {
      if (!filterRef.current(e)) return;
      onEventRef.current?.(e);
      setEvents((prev) => (prev.length >= limit ? [...prev.slice(prev.length - limit + 1), e] : [...prev, e]));
    });
  }, [hub, limit]);
  return events;
}

/** Latest live progress per job id (from job.progress events); `null` = every project. */
export function useJobProgress(projectId: string | null | undefined): Map<string, { progress: number; note?: string }> {
  const events = useEvents(
    (e) => e.type === "job.progress" && (projectId === null || (!!projectId && e.project_id === projectId)),
    undefined,
    200,
  );
  const map = new Map<string, { progress: number; note?: string }>();
  for (const e of events) if (e.id) map.set(e.id, { progress: e.progress ?? 0, note: e.note });
  return map;
}
