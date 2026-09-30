/**
 * Typed client for the StatReel server (apps/server/src/app.ts is the spec). Same-origin paths:
 * Vite proxies /api, /events, /files and /mcp to 127.0.0.1:8787; `pnpm start` serves both.
 */
import type {
  EraAdjustedProps,
  Format,
  HeatmapCell,
  Mode,
  PolicyResult,
  ProjectStatus,
  PublishTarget,
  Script,
  Source,
  UseCase,
} from "@statreel/schemas";
import type { Capability } from "./logic";

export type Job = {
  id: string;
  kind: string;
  project_id: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "refused";
  progress: number;
  params_json: string;
  result_json: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type Project = {
  id: string;
  title: string;
  use_case_id: string;
  sport: string;
  format: Format | string;
  mode: Mode | string;
  status: ProjectStatus;
  created_at: string;
};
export type ProjectWithJobs = Project & { jobs: Job[] };

export type RenderRow = {
  id: string;
  project_id: string;
  job_id: string;
  format: string;
  path: string;
  manifest_path: string;
  checks_json: string;
  policy_json: string | null;
  created_at: string;
  /** absolute http URL of the video (pipeline.renders) */
  url?: string;
  dir_url?: string;
};

export type Publication = {
  id: string;
  render_id: string;
  platform: string;
  external_id: string | null;
  visibility: string;
  url: string | null;
  published_at: string | null;
  status: string;
  /** "dry" | "live" (PUBLISH_MODE at publish time) */
  mode: string;
};

export type LlmSession = {
  id: string;
  engine: string;
  external_session_id: string | null;
  project_id: string | null;
  started_at: string;
  ended_at: string | null;
  fixture_path: string | null;
};

/** Mirrors @statreel/llm LlmEvent (the studio does not depend on that server package). */
export type LlmEvent =
  | { type: "session"; session_id: string; tools?: string[] }
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; tool: string; input: unknown }
  | { type: "tool_result"; id: string; content: string; is_error?: boolean }
  | {
      type: "result";
      ok: boolean;
      result: string;
      session_id: string;
      cost_usd?: number;
      turns?: number;
      refusal?: boolean;
    }
  | { type: "stderr"; text: string };

export type ProjectDetail = {
  project: Project;
  props: { version: number; props: EraAdjustedProps; created_by: string } | null;
  props_history: { version: number; created_by: string; created_at: string }[];
  script: { version: number; script: Script } | null;
  jobs: Job[];
  sessions: LlmSession[];
  renders: RenderRow[];
  publications: Publication[];
};

export type HeatmapResponse = {
  cells: HeatmapCell[];
  usecases: UseCase[];
  trend: { at: string; go: Record<string, number> }[];
};
export type SourcesResponse = { sources: Source[]; capabilities: Capability[] };
export type NewProject = { title: string; use_case_id: string; sport: string; format: string; mode: string };
export type PublishBody = { platform: "youtube"; title: string; description: string; tags: string[] };

/** GET /api/metrics (apps/server/src/metrics.ts): unavailable fields stay null; dry runs say so. */
export type MetricsPublication = {
  publication_id: string;
  project_id: string;
  title: string;
  use_case_id: string;
  sport: string;
  platform: string;
  external_id: string | null;
  visibility: string;
  url: string | null;
  published_at: string | null;
  mode: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  watch_time_s: number | null;
  subs_delta: number | null;
  avg_view_duration_s: number | null;
  daily: { date: string; views: number | null; likes: number | null; avg_view_duration_s: number | null }[];
  data: string;
};
export type MetricsGroup = { key: string; publications: number; views: number | null };
export type MetricsResponse = {
  publications: MetricsPublication[];
  by_use_case: MetricsGroup[];
  by_sport: MetricsGroup[];
};
export type PolicyVerdict = PolicyResult & { target?: PublishTarget };

/** GET /api/calendar (apps/server/src/calendar.ts, ADR 006). */
export type ChannelStatus = "live" | "dry" | "not_wired";
export type Channel = {
  id: string;
  platform: string;
  name: string;
  status: ChannelStatus | string;
  note: string | null;
  created_at: string;
};
export type SlotStatus = "scheduled" | "publishing" | "published" | "failed" | "cancelled";
export type CalendarSlot = {
  id: string;
  project_id: string;
  render_id: string;
  channel_id: string;
  publish_at: string;
  status: SlotStatus | string;
  title: string | null;
  description: string | null;
  tags_json: string | null;
  job_id: string | null;
  publication_id: string | null;
  error: string | null;
  created_at: string;
  project: Project | null;
};
/** A composed video: its latest render passed the gate and it is not on the calendar yet. */
export type ReadyVideo = {
  project_id: string;
  title: string;
  use_case_id: string;
  sport: string;
  format: string;
  mode: string;
  render_id: string;
  rendered_at: string;
};
export type CalendarResponse = { channels: Channel[]; ready: ReadyVideo[]; slots: CalendarSlot[]; now: string };
export type ScheduleBody = {
  project_id: string;
  channel_id: string;
  publish_at: string;
  title?: string;
  description?: string;
  tags?: string[];
};
/** Produce target as sent: the server defaults visibility to "private". */
export type ProduceTarget = Omit<PublishTarget, "visibility"> & { visibility?: PublishTarget["visibility"] };

/** GET /api/board (apps/server/src/board.ts, ADR 006): design outputs behind the owner's gate. */
export const BOARD_DECISIONS = ["accept", "reject_style", "reject_case", "reject_both"] as const;
export type BoardDecision = (typeof BOARD_DECISIONS)[number];
export type BoardStatus = "pending" | "accepted" | "rejected";
export type BoardStyle = { id: string; name: string; notes?: string };
export type BoardProposedCase = { name: string; pitch: string; requires?: string[] };
export type BoardItem = {
  id: string;
  /** path under data/board (e.g. items/loop-001-A1.png) */
  image: string;
  /** same-origin URL of the shot (/files/board/<image>) */
  image_url: string;
  width: number | null;
  height: number | null;
  title: string;
  summary: string | null;
  use_case_id: string | null;
  proposed_case: BoardProposedCase | null;
  style: BoardStyle | null;
  /** provenance: skill, loop, contest, seat, variant, facts ([fact_key#column]) */
  source: Record<string, unknown> | null;
  status: BoardStatus | string;
  decision: BoardDecision | null;
  note: string | null;
  decided_at: string | null;
  created_at: string;
};
export type BoardResponse = { items: BoardItem[]; decisions: BoardDecision[] };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers:
      body === undefined
        ? { accept: "application/json" }
        : { "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // keep the raw text (e.g. a proxy error page)
  }
  if (!res.ok) {
    const msg =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, parsed, `${method} ${path}: ${msg}`);
  }
  return parsed as T;
}

const enc = encodeURIComponent;

export const api = {
  health: () => request<{ ok: boolean; at: string }>("GET", "/api/health"),
  heatmap: () => request<HeatmapResponse>("GET", "/api/heatmap"),
  recomputeHeatmap: () => request<{ cells: HeatmapCell[] }>("POST", "/api/heatmap/recompute"),
  sources: () => request<SourcesResponse>("GET", "/api/sources"),
  projects: () => request<{ projects: ProjectWithJobs[] }>("GET", "/api/projects"),
  createProject: (p: NewProject) => request<Project>("POST", "/api/projects", p),
  project: (id: string) => request<ProjectDetail>("GET", `/api/projects/${enc(id)}`),
  setProps: (id: string, props: unknown) =>
    request<{ version: number | null; errors: string[] }>("POST", `/api/projects/${enc(id)}/props`, props),
  startLlm: (id: string, body: { prompt?: string; session?: string } = {}) =>
    request<{ session_id: string; job_id: string }>("POST", `/api/projects/${enc(id)}/llm`, body),
  llmEvents: (session: string) => request<{ events: LlmEvent[] }>("GET", `/api/llm/${enc(session)}/events`),
  produce: (id: string, target: ProduceTarget) =>
    request<{ job_id: string }>("POST", `/api/projects/${enc(id)}/produce`, { target }),
  publish: (id: string, body: PublishBody) =>
    request<{ job_id: string }>("POST", `/api/projects/${enc(id)}/publish`, body),
  /** Read-only gate evaluation: the latest manifest plus one extra source (nothing is stored). */
  policyProbe: (
    id: string,
    target: ProduceTarget,
    with_source: { id: string; license_class: string; verdict: string },
  ) => request<PolicyResult>("POST", `/api/projects/${enc(id)}/policy-probe`, { target, with_source }),
  metrics: () => request<MetricsResponse>("GET", "/api/metrics"),
  refreshMetrics: () => request<{ job_id: string }>("POST", "/api/metrics/refresh"),
  jobs: () => request<{ jobs: Job[] }>("GET", "/api/jobs"),
  cancelJob: (id: string) => request<{ ok: boolean }>("POST", `/api/jobs/${enc(id)}/cancel`),
  calendar: () => request<CalendarResponse>("GET", "/api/calendar"),
  /** Schedule a ready video on a wired channel; publish_at = now means "publish now". */
  schedule: (b: ScheduleBody) => request<CalendarSlot>("POST", "/api/calendar", b),
  reschedule: (id: string, publish_at: string) =>
    request<CalendarSlot>("PATCH", `/api/calendar/${enc(id)}`, { publish_at }),
  cancelSlot: (id: string) => request<CalendarSlot>("DELETE", `/api/calendar/${enc(id)}`),
  /** The Board: every item, newest first (optionally one status). */
  board: (status?: BoardStatus) =>
    request<BoardResponse>("GET", status ? `/api/board?status=${enc(status)}` : "/api/board"),
  boardItem: (id: string) => request<BoardItem>("GET", `/api/board/${enc(id)}`),
  /** The owner's gate: accept | reject_style | reject_case | reject_both, with an optional note (the reply has no image_url). */
  decideBoard: (id: string, decision: BoardDecision, note?: string) =>
    request<Omit<BoardItem, "image_url">>("POST", `/api/board/${enc(id)}/decision`, {
      decision,
      note: note?.trim() || undefined,
    }),
  /** A JSON file the server exposes under /files (e.g. a render's manifest.json). */
  file: <T>(path: string) => request<T>("GET", path),
};

/** Query keys, shared by pages and the SSE invalidation in events.ts. */
export const qk = {
  heatmap: ["heatmap"] as const,
  sources: ["sources"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  llmEvents: (session: string) => ["llm-events", session] as const,
  jobs: ["jobs"] as const,
  metrics: ["metrics"] as const,
  calendar: ["calendar"] as const,
  board: ["board"] as const,
  file: (path: string) => ["file", path] as const,
  health: ["health"] as const,
};

export function parseJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The server's own error text (`{error}` body) verbatim, else the transport message. */
export function serverError(e: unknown): string {
  if (e instanceof ApiError && e.body && typeof e.body === "object" && "error" in e.body)
    return String((e.body as { error: unknown }).error);
  return errorText(e);
}
