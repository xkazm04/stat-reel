/**
 * One EventSource('/events') for the whole app, shared through React context. The provider also
 * keeps TanStack Query honest: every job state change (job.* except progress), render.done and
 * co-pilot tool results invalidate the caches they can change. Named listeners are registered for
 * job.queued/started/progress/succeeded/failed/cancelled/refused, llm.event and render.done.
 * Calendar slots follow their publish job, so job.* also invalidates the calendar.
 * board.decided (the owner's gate on a Board item) invalidates the board and the style library;
 * styles.updated (lock / retire / note) the style library; cases.decided the case ideas.
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
/** Generation queue events relayed from the worker process (ADR 010). */
export const GEN_EVENTS = ["gen.queued", "gen.started", "gen.progress", "gen.done", "gen.failed", "gen.cancelled"] as const;
/** Named SSE events (the server writes `event: <type>`; EventSource needs one listener per name). */
const NAMED = [
  ...JOB_EVENTS,
  "llm.event",
  "render.done",
  "heatmap.updated",
  "project.updated",
  "board.decided",
  "styles.updated",
  "cases.decided",
  ...GEN_EVENTS,
  "ping",
];

const Ctx = createContext<Hub | null>(null);

function invalidate(qc: QueryClient, e: AppEvent): void {
  const pid = e.project_id ?? undefined;
  if (e.type.startsWith("job.") && e.type !== "job.progress") {
    void qc.invalidateQueries({ queryKey: qk.projects });
    void qc.invalidateQueries({ queryKey: qk.jobs });
    // publish jobs move calendar slots; a finished render can make a video ready to schedule
    void qc.invalidateQueries({ queryKey: qk.calendar });
    if (pid) void qc.invalidateQueries({ queryKey: qk.project(pid) });
    if (e.kind === "publish" || e.kind === "metrics") void qc.invalidateQueries({ queryKey: qk.metrics });
    if (e.type === "job.succeeded" && (e.kind === "ingest" || e.kind === "transform")) {
      void qc.invalidateQueries({ queryKey: qk.heatmap });
      void qc.invalidateQueries({ queryKey: qk.sources });
    }
    // a finished co-pilot session: reload its authoritative event log
    if (e.kind === "llm" && e.type !== "job.queued" && e.type !== "job.started")
      void qc.invalidateQueries({ queryKey: ["llm-events"] });
  } else if (e.type === "render.done" || e.type === "project.updated") {
    // a finished render adds a video to the topic heatmap
    void qc.invalidateQueries({ queryKey: ["heatmap-topics"] });
    if (pid) void qc.invalidateQueries({ queryKey: qk.project(pid) });
    void qc.invalidateQueries({ queryKey: qk.projects });
    void qc.invalidateQueries({ queryKey: qk.calendar });
  } else if (e.type === "board.decided") {
    void qc.invalidateQueries({ queryKey: qk.board });
    // a decision moves a style's verdict
    void qc.invalidateQueries({ queryKey: qk.styles });
  } else if (e.type === "styles.updated") {
    void qc.invalidateQueries({ queryKey: qk.styles });
  } else if (e.type.startsWith("gen.")) {
    void qc.invalidateQueries({ queryKey: qk.generation });
    if (e.type !== "gen.progress") {
      // a finished job changed what the board shows: new tiles, a video on the heatmap, a case stage
      void qc.invalidateQueries({ queryKey: qk.board });
      void qc.invalidateQueries({ queryKey: qk.cases });
      void qc.invalidateQueries({ queryKey: qk.styles });
      void qc.invalidateQueries({ queryKey: ["heatmap-topics"] });
    }
  } else if (e.type === "cases.decided") {
    void qc.invalidateQueries({ queryKey: qk.cases });
    // an accepted case adds its topic row (and its count) to the topic heatmap
    void qc.invalidateQueries({ queryKey: ["heatmap-topics"] });
  } else if (e.type === "heatmap.updated") {
    void qc.invalidateQueries({ queryKey: qk.heatmap });
    void qc.invalidateQueries({ queryKey: ["heatmap-topics"] });
  } else if (e.type === "llm.event" && e.event?.type === "tool_result" && pid) {
    // set_props / write_script may have stored a new version
    void qc.invalidateQueries({ queryKey: qk.project(pid) });
    void qc.invalidateQueries({ queryKey: qk.projects });
  }
}

/**
 * Connection-state wiring of the one EventSource. /events has no replay, so events emitted while the stream
 * was down (every server restart, tsx watch included) are lost; the first open after an error therefore
 * refetches the active queries once. The first open never does (the pages just loaded) unless `missed`
 * says this stream replaces one that was lost (keepConnected), and a flapping
 * connection invalidates once per successful reopen, not per error. Returns the detach function.
 */
export function watchConnection(
  es: EventSource,
  qc: QueryClient,
  setState: (s: ConnectionState) => void,
  missed = false,
): () => void {
  let dropped = missed;
  const onOpen = () => {
    setState("open");
    if (!dropped) return;
    dropped = false;
    void qc.invalidateQueries({ refetchType: "active" });
  };
  const onError = () => {
    dropped = true;
    setState(es.readyState === es.CLOSED ? "closed" : "connecting");
  };
  es.addEventListener("open", onOpen);
  es.addEventListener("error", onError);
  return () => {
    es.removeEventListener("open", onOpen);
    es.removeEventListener("error", onError);
  };
}

/** Delay before re-opening a stream the browser gave up on: 1 s, 2 s, 4 s ... capped at 30 s. */
export const reopenDelay = (attempt: number): number => Math.min(30_000, 1_000 * 2 ** attempt);

type Schedule = (fn: () => void, ms: number) => () => void;
const timer: Schedule = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/**
 * Keep one stream alive. The browser retries a dropped stream by itself (readyState CONNECTING), but it
 * gives up for good (CLOSED) when a reconnect is answered with a non-200 or a non-SSE body - which is what
 * the Vite dev proxy returns (500 text/plain) while the API restarts. A CLOSED stream is therefore
 * replaced after `reopenDelay`, and the replacement's first open refetches the active queries (the gap
 * lost events). `attach` wires the listeners of each stream and returns their detach. Returns the stop.
 */
export function keepConnected(
  create: () => EventSource,
  qc: QueryClient,
  setState: (s: ConnectionState) => void,
  attach: (es: EventSource) => () => void,
  schedule: Schedule = timer,
): () => void {
  let attempt = 0;
  let stopped = false;
  let close: (() => void) | null = null;
  let cancel: (() => void) | null = null;
  const start = (missed: boolean) => {
    cancel = null;
    const es = create();
    const detach = attach(es);
    let unwatch = () => {};
    close = () => {
      close = null;
      unwatch();
      detach();
      es.close();
    };
    unwatch = watchConnection(
      es,
      qc,
      (s) => {
        setState(s);
        if (s === "open") attempt = 0;
        if (s !== "closed" || stopped) return;
        close?.();
        cancel = schedule(() => {
          setState("connecting");
          start(true);
        }, reopenDelay(attempt++));
      },
      missed,
    );
  };
  start(false);
  return () => {
    stopped = true;
    cancel?.();
    close?.();
  };
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
    return keepConnected(
      () => new EventSource("/events"),
      qc,
      setState,
      (es) => {
        es.addEventListener("message", handle);
        for (const name of NAMED) es.addEventListener(name, handle as EventListener);
        return () => {
          es.removeEventListener("message", handle);
          for (const name of NAMED) es.removeEventListener(name, handle as EventListener);
        };
      },
    );
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
