/**
 * Typed client for the StatReel server (apps/server/src/app.ts is the spec). Same-origin paths:
 * Vite proxies /api, /events, /files and /mcp to 127.0.0.1:8787; `pnpm start` serves both.
 */
import type {
  CaseStage,
  EraAdjustedProps,
  Format,
  GenerationJob,
  HeatmapCell,
  JobRow,
  Mode,
  PolicyResult,
  ProjectStatus,
  PublishTarget,
  Script,
  Source,
  Topic,
  TopicHeatmap,
  UseCase,
} from "@statreel/schemas";
import type { Capability } from "./logic";

/** The `jobs` row as the API returns it: one definition, owned by @statreel/schemas. */
export type Job = JobRow;

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
/**
 * One per-use-case / per-sport group (apps/server/src/metrics.ts). `views` sums only the measured members, so with
 * `unmeasured > 0` (`lower_bound`) it is a lower bound, and null when none was measured: unmeasurable is not zero.
 */
export type MetricsGroup = {
  key: string;
  publications: number;
  views: number | null;
  /** publications with a lifetime snapshot */
  measured: number;
  /** dry runs and not-yet-pulled publications */
  unmeasured: number;
  lower_bound: boolean;
};
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
/** Every schedule status the server writes (apps/server/src/calendar.ts header: transitions); pinned in calendar.test.ts. */
export const SLOT_STATUSES = ["scheduled", "publishing", "published", "failed", "cancelled", "missed"] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];
/** Why a still-scheduled slot will not fire (apps/server/src/calendar.ts SlotView.drift). */
export type SlotDrift = "superseded_render" | "gate_denied";
export type CalendarSlot = {
  id: string;
  project_id: string;
  render_id: string;
  channel_id: string;
  publish_at: string;
  status: SlotStatus;
  title: string | null;
  description: string | null;
  tags_json: string | null;
  job_id: string | null;
  publication_id: string | null;
  error: string | null;
  created_at: string;
  /** when the tick found the slot overdue past the missed-run window; null otherwise */
  missed_at: string | null;
  drift: SlotDrift | null;
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
/** POST /api/board/:id/decision: the item, the siblings an accepted variant archived, the video job or the data gate's refusal (D.9). */
export type BoardDecided = {
  item: BoardItem;
  archived_ids?: string[];
  restored_ids?: string[];
  job?: GenerationJob;
  gate?: { ok: boolean; reason?: string };
};
export type BoardItem = {
  id: string;
  /** the case idea a generated design belongs to (ADR 010); null for registry designs */
  case_idea_id?: string | null;
  /** path under data/board (e.g. items/loop-001-A1.png) */
  image: string;
  /** same-origin URL of the shot (/files/board/<image>); for a clip this is its poster frame */
  image_url: string;
  /** 5-10 s clip (MP4) rendered frame by frame through the artboard's seek(t); null for stills */
  video: string | null;
  video_url: string | null;
  duration_s: number | null;
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
  /** why the item was archived (triage, or "superseded by <id>"); null while live, and for rows archived before the column existed */
  archive_reason: string | null;
  decided_at: string | null;
  created_at: string;
};
export type BoardResponse = { items: BoardItem[]; decisions: BoardDecision[] };

/** GET /api/styles (apps/server/src/library.ts, ADR 008): every style on the Board, verdict + owner management. */
export type StyleOverride = "locked" | "retired";
export type StyleStatus = "accepted" | "rejected" | "open" | StyleOverride;
export type StyleEntry = {
  id: string;
  name: string;
  notes: string | null;
  verdict: "accepted" | "rejected" | "open";
  status: StyleStatus;
  owner_note: string | null;
  hero_item_id: string | null;
  accepts: number;
  /** reject_style + reject_both */
  style_rejects: number;
  /** the two kinds of style reject, counted apart */
  reject_style: number;
  reject_both: number;
  /** the newest decision is a style reject yet the verdict is not "rejected": one click from flipping */
  at_risk?: true;
  pending: number;
  total: number;
  item_ids: string[];
  cases: string[];
  updated_at: string | null;
};
export type StylePatch = { status?: StyleOverride | null; note?: string | null; hero_item_id?: string | null };

/** GET /api/cases (ADR 008): use cases proposed as text by the case loop, behind the owner's gate. */
export const CASE_DECISIONS = ["accept", "reject_not_interesting", "reject_short", "reject_no_insight", "reject_no_data", "reject_duplicate"] as const;
export type CaseDecision = (typeof CASE_DECISIONS)[number];
export type CaseDomain = "f1" | "sports" | "games" | "geoeconomy" | "music" | "culture" | "science" | "other";
export type CaseSource = {
  name: string;
  url: string;
  license: string;
  coverage?: string;
  registry_id?: string | null;
  class?: string;
  confidence?: "high" | "medium" | "low";
};
export type CaseIdea = {
  id: string;
  title: string;
  pitch: string;
  domain: CaseDomain;
  arc: string;
  insight: string;
  why_lasts: string;
  tension: { expectation: string; reality: string; strength: "strong" | "moderate" | "weak"; counter?: { provenance: "found" | "constructed" | "absent"; case: string; searched?: string } };
  unknowns: string[];
  /** dated turns of the story (>= 4) */
  beats: { at: string; what: string }[];
  cast?: { name: string; known: boolean }[] | null;
  series?: { template: string; instances: string[] } | null;
  timeline: { unit: string; from: number; to: number; years_from: number; years_to: number };
  span_years: number;
  chart_ideas: string[];
  requires: string[];
  sources: CaseSource[];
  evidence: string[];
  /** staged = data in the warehouse; registry = source approved, not ingested; new-source = needs approval; guess = brainstormed, unverified */
  data_status: "staged" | "registry" | "new-source" | "guess";
  /** observed | what-if (a computed scenario, labelled a simulation) | influence (key persons vs success over time) */
  kind: "observed" | "what-if" | "influence";
  method: string | null;
  data_guess: string | null;
  feasibility: "likely" | "possible" | "hard" | null;
  /** topics.key (ADR 011); null until picked or implied by an unambiguous domain */
  topic: string | null;
  source: Record<string, unknown> | null;
  status: "pending" | "accepted" | "rejected" | string;
  decision: CaseDecision | null;
  note: string | null;
  /** why the owner archived the idea; null while it is not archived */
  archive_reason: string | null;
  decided_at: string | null;
  created_at: string;
};
export type CasesResponse = { ideas: CaseIdea[]; decisions: CaseDecision[]; min_span_years: number };

/** GET /api/generation/overview: the worker, the recent jobs and the derived stage of every accepted case (D.2, D.11). */
export type GenerationOverview = {
  worker: { online: boolean; pid: number | null; heartbeat_at: string | null; queued: number; running: number };
  jobs: (GenerationJob & { queue_position?: number })[];
  cases: Record<
    string,
    {
      title: string;
      stage: CaseStage;
      gate: { ok: boolean; reason?: string } | null;
      visual_job_id: string | null;
      video_job_id: string | null;
      accepted_item_id: string | null;
      videos: number;
    }
  >;
  running: { job: GenerationJob; title: string } | null;
};

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
  /** topic x video ordinal (ADR 011); `all` also lists every active topic of the controlled list */
  heatmapTopics: (all: boolean) => request<TopicHeatmap>("GET", `/api/heatmap/topics?include_empty=${all ? "all" : "1"}`),
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
    request<BoardDecided>("POST", `/api/board/${enc(id)}/decision`, {
      decision,
      note: note?.trim() || undefined,
    }),
  /** Undo the owner's decision on an item: back to pending, its archived siblings restored (409 while a generation job runs for it). */
  undoBoardDecision: (id: string) =>
    request<Omit<BoardItem, "image_url"> & { restored_ids?: string[] }>("DELETE", `/api/board/${enc(id)}/decision`),
  /** Archived designs, with their reason (the Archived tab; the default list hides them). */
  boardArchived: () => request<BoardResponse>("GET", "/api/board?status=archived"),
  /** Archive items with a reason (the Archived tab's undo of a restore). */
  archiveBoard: (ids: string[], reason: string) => request<{ archived: number }>("POST", "/api/board/archive", { ids, reason }),
  /** Back to the state the item left (decision kept; a superseded sibling returns to pending). 409 when it is not archived. */
  restoreBoardItem: (id: string) => request<BoardItem>("POST", `/api/board/${enc(id)}/restore`),
  /** Generation queue (ADR 010): one call for every badge, plus the log, retry, cancel and manual enqueue. */
  generationOverview: () => request<GenerationOverview>("GET", "/api/generation/overview"),
  generationJob: (id: string) => request<{ job: GenerationJob; stage: string | null; log_tail: string[] }>("GET", `/api/generation/jobs/${enc(id)}`),
  retryGeneration: (id: string) => request<{ job: GenerationJob }>("POST", `/api/generation/jobs/${enc(id)}/retry`),
  cancelGeneration: (id: string) => request<{ job: GenerationJob }>("POST", `/api/generation/jobs/${enc(id)}/cancel`),
  /** The manual "Generate video" button: runs the same data gate (409 `{gate}` when it fails). */
  generateVideo: (case_id: string, board_item_id: string) =>
    request<{ job: GenerationJob; existing?: boolean }>("POST", "/api/generation/jobs", { type: "generate_video", case_id, board_item_id }),
  /** The log from `offset` on, and the offset to continue from (header X-Next-Offset). */
  generationLog: async (id: string, offset: number): Promise<{ text: string; next: number }> => {
    const res = await fetch(`/api/generation/jobs/${enc(id)}/log?offset=${offset}`);
    if (!res.ok) throw new ApiError(res.status, null, `GET log: ${res.status}`);
    return { text: await res.text(), next: Number(res.headers.get("x-next-offset") ?? offset) };
  },
  /** The style library: every style on the Board with its verdict and the owner's management. */
  styles: () => request<{ styles: StyleEntry[] }>("GET", "/api/styles"),
  /** Lock / retire (null clears), the owner's note, the hero item. */
  updateStyle: (id: string, patch: StylePatch) => request<StyleEntry>("PATCH", `/api/styles/${enc(id)}`, patch),
  /** Case ideas from the case loop (text only, no art style). */
  cases: () => request<CasesResponse>("GET", "/api/cases"),
  decideCase: (id: string, decision: CaseDecision, note?: string) =>
    request<{ idea: CaseIdea; job?: GenerationJob; existing?: boolean }>("POST", `/api/cases/${enc(id)}/decision`, { decision, note: note?.trim() || undefined }),
  /** Undo the owner's decision on a case idea: back to pending (409 while a generation job runs for it). */
  undoCaseDecision: (id: string) => request<CaseIdea>("DELETE", `/api/cases/${enc(id)}/decision`),
  /** Archived case ideas, with their reason. */
  casesArchived: () => request<CasesResponse>("GET", "/api/cases?status=archived"),
  archiveCases: (ids: string[], reason: string) => request<{ archived: number }>("POST", "/api/cases/archive", { ids, reason }),
  /** Back to the state the idea left (decision kept). 409 when it is not archived. */
  restoreCase: (id: string) => request<CaseIdea>("POST", `/api/cases/${enc(id)}/restore`),
  /** The controlled topic list (active topics). */
  topics: () => request<{ topics: Topic[] }>("GET", "/api/topics"),
  /** Pick (or with null clear) the topic of a case idea. */
  setCaseTopic: (id: string, topic: string | null) => request<CaseIdea>("PATCH", `/api/cases/${enc(id)}`, { topic }),
  /** A JSON file the server exposes under /files (e.g. a render's manifest.json). */
  file: <T>(path: string) => request<T>("GET", path),
};

/** Query keys, shared by pages and the SSE invalidation in events.ts. */
export const qk = {
  heatmap: ["heatmap"] as const,
  heatmapTopics: (all: boolean) => ["heatmap-topics", all] as const,
  sources: ["sources"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  llmEvents: (session: string) => ["llm-events", session] as const,
  jobs: ["jobs"] as const,
  metrics: ["metrics"] as const,
  calendar: ["calendar"] as const,
  board: ["board"] as const,
  /** under the board / cases prefixes, so every invalidation of those refreshes the archive too */
  boardArchived: ["board", "archived"] as const,
  casesArchived: ["cases", "archived"] as const,
  styles: ["styles"] as const,
  cases: ["cases"] as const,
  generation: ["generation"] as const,
  topics: ["topics"] as const,
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

/**
 * Did the StatReel API itself answer? Its errors are JSON `{error}` (app.onError); a thrown fetch or a
 * proxy's own page (the Vite dev proxy answers 500 text/plain while the API is down) is not an answer.
 */
export const serverAnswered = (e: unknown): e is ApiError =>
  e instanceof ApiError && !!e.body && typeof e.body === "object" && "error" in e.body;

/** The server's own error text (`{error}` body) verbatim, else the transport message. */
export function serverError(e: unknown): string {
  if (serverAnswered(e)) return String((e.body as { error: unknown }).error);
  return errorText(e);
}

/**
 * A render job's `result_json` (pipeline.ts renderRun / reuseRender). `reused` is the id of the earlier render a
 * skip-unchanged produce built its new row over; absent on a fresh render.
 */
export type RenderJobResult = {
  render_id?: string;
  reused?: string;
  note?: string;
};
