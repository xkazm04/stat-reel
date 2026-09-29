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
export type PolicyVerdict = PolicyResult & { target?: PublishTarget };
/** Produce target as sent: the server defaults visibility to "private". */
export type ProduceTarget = Omit<PublishTarget, "visibility"> & { visibility?: PublishTarget["visibility"] };

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

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
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
  jobs: () => request<{ jobs: Job[] }>("GET", "/api/jobs"),
  cancelJob: (id: string) => request<{ ok: boolean }>("POST", `/api/jobs/${enc(id)}/cancel`),
};

/** Query keys, shared by pages and the SSE invalidation in events.ts. */
export const qk = {
  heatmap: ["heatmap"] as const,
  sources: ["sources"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  llmEvents: (session: string) => ["llm-events", session] as const,
  jobs: ["jobs"] as const,
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
