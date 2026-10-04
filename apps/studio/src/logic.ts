/**
 * Pure studio helpers: mode vocabulary, stage logic, the heatmap decision aid, file URLs and log
 * summaries. No React, no DOM: unit-tested in logic.test.ts.
 */
import type { CellStatus, HeatmapCell, JobKind, LicenseClass, Mode, ProjectStatus, Sport } from "@statreel/schemas";

// ------------------------------------------------------------------ vocabulary

export const SPORTS: Sport[] = ["F1", "NBA", "NHL", "Soccer"];
export const MODE_LABEL: Record<Mode, string> = { monetized: "Monetized", non_commercial: "Non-commercial" };
export const ALLOWED: Record<Mode, LicenseClass[]> = {
  monetized: ["legal"],
  non_commercial: ["legal", "non_commercial"],
};
export const allowedIn = (mode: Mode, cls: string | null | undefined): boolean =>
  !!cls && (ALLOWED[mode] as string[]).includes(cls);

// ------------------------------------------------------------------ heatmap

export function countStatuses(cells: HeatmapCell[], mode: Mode): Record<CellStatus, number> {
  const c: Record<CellStatus, number> = { go: 0, "data-ready": 0, ask: 0, blocked: 0 };
  for (const cell of cells) if (cell.mode === mode) c[cell.status]++;
  return c;
}

export const cellOf = (cells: HeatmapCell[], usecase: string, sport: string, mode: Mode): HeatmapCell | undefined =>
  cells.find((c) => c.usecase === usecase && c.sport === sport && c.mode === mode);

/** Required kinds of a cell that have no passing source allowed in the cell's mode. */
export function failingKinds(cell: HeatmapCell): string[] {
  return cell.kinds.filter((k) => !allowedIn(cell.mode, k.best)).map((k) => k.kind);
}

export type AidCandidate = { id: string; license_class: LicenseClass; status: string };
export type AidEntry = {
  kind: string;
  sport: Sport;
  /** ASK/BLOCKED cells for which this kind x sport is the ONLY missing piece */
  flips: HeatmapCell[];
  /** cells where this kind x sport is one of several missing pieces */
  alsoHelps: number;
  /** what each flipped cell would become */
  becomes: Record<CellStatus, number>;
  /** legal sources already in the registry for this bus that do not pass yet (test or fix them) */
  candidates: AidCandidate[];
};

/**
 * Decision aid: which single legal source for one kind x sport would flip the most ASK/BLOCKED
 * cells in this mode. A cell counts as flipped only if that kind is its sole failing kind; the
 * flipped status is GO when the composition exists, else READY.
 */
export function decisionAid(cells: HeatmapCell[], mode: Mode): AidEntry[] {
  const map = new Map<string, AidEntry>();
  const entry = (kind: string, sport: Sport): AidEntry => {
    const key = `${kind}|${sport}`;
    let e = map.get(key);
    if (!e) {
      e = {
        kind,
        sport,
        flips: [],
        alsoHelps: 0,
        becomes: { go: 0, "data-ready": 0, ask: 0, blocked: 0 },
        candidates: [],
      };
      map.set(key, e);
    }
    return e;
  };
  for (const cell of cells) {
    if (cell.mode !== mode || (cell.status !== "ask" && cell.status !== "blocked")) continue;
    const failing = failingKinds(cell);
    for (const kind of failing) {
      const e = entry(kind, cell.sport);
      if (failing.length === 1) {
        e.flips.push(cell);
        e.becomes[cell.composition_implemented ? "go" : "data-ready"]++;
      } else e.alsoHelps++;
      const k = cell.kinds.find((x) => x.kind === kind);
      for (const s of k?.sources ?? []) {
        if (s.license_class !== "legal" || s.status === "pass") continue;
        if (!e.candidates.some((c) => c.id === s.id))
          e.candidates.push({ id: s.id, license_class: s.license_class, status: s.status });
      }
    }
  }
  return [...map.values()]
    .filter((e) => e.flips.length > 0)
    .sort(
      (a, b) =>
        b.flips.length - a.flips.length ||
        b.alsoHelps - a.alsoHelps ||
        a.kind.localeCompare(b.kind) ||
        a.sport.localeCompare(b.sport),
    );
}

export type Capability = {
  sport: string;
  kind: string;
  source_id: string;
  license_class: string;
  status: string;
  coverage_from: number | null;
  coverage_to: number | null;
  rows: number;
  detail: string;
};

/** Per use case x mode: GO count across snapshots (oldest -> newest). */
export function trendSeries(
  trend: { at: string; go: Record<string, number> }[],
  usecase: string,
  mode: Mode,
): number[] {
  return trend.map((t) => t.go[`${usecase}|${mode}`] ?? 0);
}

// ------------------------------------------------------------------ stages

export const STAGES: ProjectStatus[] = ["idea", "data-ready", "scripted", "rendered", "gated", "published"];
export const STAGE_LABEL: Record<ProjectStatus, string> = {
  idea: "Idea",
  "data-ready": "Data ready",
  scripted: "Scripted",
  rendered: "Rendered",
  gated: "Gated",
  published: "Published",
};
export const stageIndex = (status: string): number => Math.max(0, STAGES.indexOf(status as ProjectStatus));

export type JobLike = { kind: string; status: string; progress?: number | null; error?: string | null };
export type NextAction = { verb: string; hint: string; tone: "you" | "wait" | "done" | "blocked" };

const ACTIVE = new Set(["queued", "running"]);
const JOB_VERB: Record<JobKind, string> = {
  llm: "Co-pilot drafting",
  audio: "Generating audio",
  render: "Rendering",
  publish: "Publishing",
  ingest: "Ingesting",
  transform: "Transforming",
  metrics: "Pulling metrics",
  gen_render: "Rendering a design",
};

/**
 * Job kind -> the owner's noun for it, and a job status -> its phrase. ONE table: projectState.ts
 * (jobFlag) reads this one, and the JobKind key type makes a new kind without words a type error.
 * No raw `${kind} ${status}` token reaches the owner (status-vocabulary).
 */
export const JOB_LABEL: Record<JobKind, string> = {
  llm: "Co-pilot draft",
  audio: "Audio",
  render: "Render",
  publish: "Publish",
  ingest: "Ingest",
  transform: "Transform",
  metrics: "Metrics pull",
  gen_render: "Design render",
};
const ACTIVE_PHRASE: Record<string, string> = { queued: "waiting in the queue", running: "running" };

/**
 * The next action for a project. A running job wins ("wait"); a failed/refused latest job asks
 * the owner to look; otherwise the stage decides.
 */
export function nextAction(status: string, latestJob?: JobLike | null): NextAction {
  if (latestJob && ACTIVE.has(latestJob.status)) {
    const pct =
      typeof latestJob.progress === "number" && latestJob.progress > 0
        ? ` · ${Math.round(latestJob.progress * 100)} %`
        : "";
    return {
      verb: JOB_VERB[latestJob.kind as JobKind] ?? "Working",
      hint: `${ACTIVE_PHRASE[latestJob.status] ?? "working"}${pct}`,
      tone: "wait",
    };
  }
  if (latestJob && (latestJob.status === "failed" || latestJob.status === "refused") && status !== "published") {
    return {
      verb: latestJob.status === "refused" ? "Review refusal" : "Fix failed job",
      hint: `${JOB_LABEL[latestJob.kind as JobKind] ?? "A job"} ${latestJob.status}${latestJob.error ? `: ${latestJob.error}` : ""}`,
      tone: "blocked",
    };
  }
  switch (status as ProjectStatus) {
    case "idea":
      return { verb: "Draft with Claude", hint: "no props yet: the co-pilot drafts props and script", tone: "you" };
    case "data-ready":
      return { verb: "Write script", hint: "props are stored; the narration script is missing", tone: "you" };
    case "scripted":
      return { verb: "Produce", hint: "audio -> render -> checks -> gate", tone: "you" };
    case "rendered":
      return { verb: "Review gate", hint: "rendered, but the publish gate did not allow it", tone: "blocked" };
    case "gated":
      return { verb: "Publish private", hint: "gate allows; v1 uploads private only", tone: "you" };
    case "published":
      return { verb: "Published", hint: "private upload done; the owner flips visibility", tone: "done" };
    default:
      return { verb: "Open", hint: status, tone: "you" };
  }
}

export const needsYou = (status: string, latestJob?: JobLike | null): boolean => {
  const t = nextAction(status, latestJob).tone;
  return t === "you" || t === "blocked";
};

// ------------------------------------------------------------------ files, time, summaries

/**
 * A browser URL for a server file: absolute `http://host/files/...` URLs become same-origin
 * `/files/...` (proxied), and absolute disk paths under `data/` map onto the /files route.
 */
export function fileUrl(p: string | null | undefined): string | null {
  if (!p) return null;
  const m = /^https?:\/\/[^/]+(\/files\/.*)$/.exec(p);
  if (m) return m[1] ?? null;
  if (p.startsWith("/files/")) return p;
  const norm = p.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/data/");
  if (i >= 0)
    return `/files/${norm
      .slice(i + "/data/".length)
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  if (/^(renders|audio)\//.test(norm)) return `/files/${norm}`;
  return null;
}

export function timecode(frame: number, fps: number): string {
  const f = Math.max(0, Math.round(frame));
  const mm = Math.floor(f / (fps * 60));
  const ss = Math.floor(f / fps) % 60;
  const ff = f % fps;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}:${String(ff).padStart(2, "0")}`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One-line, human summary of an MCP tool call input for the co-pilot log. */
export function summarizeToolInput(tool: string, input: unknown): string {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  switch (tool) {
    case "query":
      return clip(
        String(o.sql ?? "")
          .replace(/\s+/g, " ")
          .trim(),
        110,
      );
    case "describe_views":
      return o.sport ? `sport ${String(o.sport)}` : "all sports";
    case "get_props_schema":
      return `use case ${String(o.use_case ?? "?")}`;
    case "set_props": {
      const p = (o.props ?? {}) as { rows?: unknown[]; scenes?: unknown[]; title?: string };
      return [
        `project ${String(o.project ?? "?")}`,
        p.title ? `"${clip(p.title, 40)}"` : null,
        `${p.rows?.length ?? 0} rows`,
        `${p.scenes?.length ?? 0} scenes`,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "write_script": {
      const s = (o.script ?? o) as { scenes?: unknown[] };
      return `project ${String(o.project ?? "?")} · ${s.scenes?.length ?? 0} scenes`;
    }
    case "render_keyframes":
      return `frames ${Array.isArray(o.frames_s) ? o.frames_s.join(", ") : "?"} s`;
    case "policy_check": {
      const t = (o.target ?? {}) as { platform?: string; monetized?: boolean };
      return `${t.platform ?? "?"} · ${t.monetized ? "monetized" : "non-commercial"}`;
    }
    default: {
      const keys = Object.keys(o);
      return keys.length
        ? clip(keys.map((k) => `${k}=${typeof o[k] === "object" ? "…" : String(o[k])}`).join(" "), 110)
        : "no input";
    }
  }
}

/** Tool result verdict: an error flag, or a JSON body with non-empty `errors` / an `error`. */
export function toolResultStatus(content: string, isError?: boolean): { ok: boolean; summary: string } {
  if (isError) return { ok: false, summary: clip(content, 160) };
  try {
    const j = JSON.parse(content) as Record<string, unknown>;
    if (typeof j.error === "string") return { ok: false, summary: clip(j.error, 160) };
    if (Array.isArray(j.errors) && j.errors.length)
      return { ok: false, summary: clip(j.errors.map(String).join("; "), 160) };
    if (Array.isArray(j.rows)) return { ok: true, summary: `${j.rows.length} rows` };
    if (typeof j.version === "number") return { ok: true, summary: `stored v${j.version}` };
  } catch {
    // not JSON: fall through
  }
  return { ok: true, summary: clip(content.replace(/\s+/g, " "), 160) };
}

/** Split fact refs into a shared `<fact_key>` prefix and their `#column`s when they share one. */
export function factGroup(keys: string[]): { prefix: string | null; columns: string[] } {
  const parts = keys.map((k) => {
    const i = k.lastIndexOf("#");
    return i < 0 ? { p: k, c: "" } : { p: k.slice(0, i), c: k.slice(i + 1) };
  });
  const first = parts[0]?.p;
  if (first && parts.every((x) => x.p === first)) return { prefix: first, columns: parts.map((x) => x.c) };
  return { prefix: null, columns: keys };
}

export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const d = (now - new Date(iso).getTime()) / 1000;
  if (Number.isNaN(d)) return iso;
  if (d < 60) return `${Math.max(0, Math.round(d))} s ago`;
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return `${Math.round(d / 86400)} d ago`;
}

// ------------------------------------------------------------------ render checks

export type CheckRow = { key: string; label: string; value: string; target: string | null; ok: boolean | null };

/**
 * Post-render checks (DESIGN §6.3) as rows with their target; `ok` is null where no rule applies.
 * Unknown keys are listed verbatim so nothing the server reports is hidden.
 */
export function checkRows(
  checks: Record<string, unknown>,
  format: string,
  band?: { min: number; max: number },
): CheckRow[] {
  const n = (k: string) => (typeof checks[k] === "number" ? (checks[k] as number) : null);
  const rows: CheckRow[] = [];
  const add = (key: string, label: string, value: string, target: string | null, ok: boolean | null) =>
    rows.push({ key, label, value, target, ok });
  const seen = new Set<string>();
  const num = (
    key: string,
    label: string,
    unit: string,
    target: string | null,
    rule: ((v: number) => boolean) | null,
    digits = 1,
  ) => {
    seen.add(key);
    const v = n(key);
    if (v === null) return;
    add(key, label, `${v.toFixed(digits)}${unit}`, target, rule ? rule(v) : null);
  };
  num("loudness_lufs", "Integrated loudness", " LUFS", "−14 ±1", (v) => Math.abs(v + 14) <= 1);
  num("true_peak_dbtp", "True peak", " dBTP", "≤ −2", (v) => v <= -2);
  num("loudness_range_lu", "Loudness range", " LU", null, null);
  num("safe_zone_violations", "Safe-zone violations", "", "0", (v) => v === 0, 0);
  num("font_fallbacks", "Font fallbacks", "", "0", (v) => v === 0, 0);
  num("black_frames_s", "Black frames", " s", null, null, 2);
  const w = n("width");
  const h = n("height");
  seen.add("width");
  seen.add("height");
  if (w !== null && h !== null) {
    const want = format === "landscape" ? [1920, 1080] : [1080, 1920];
    add("resolution", "Resolution", `${w}×${h}`, `${want[0]}×${want[1]}`, w === want[0] && h === want[1]);
  }
  num("fps", "Frame rate", " fps", "30", (v) => Math.abs(v - 30) < 1e-6, 0);
  num(
    "duration_s",
    "Duration",
    " s",
    band ? `${band.min}–${band.max} s` : null,
    band ? (v) => v >= band.min && v <= band.max : null,
  );
  for (const [key, want] of [
    ["video_codec", "h264"],
    ["audio_codec", "aac"],
  ] as const) {
    seen.add(key);
    if (typeof checks[key] === "string")
      add(key, key === "video_codec" ? "Video codec" : "Audio codec", String(checks[key]), want, checks[key] === want);
  }
  for (const [key, v] of Object.entries(checks)) {
    if (seen.has(key)) continue;
    add(key, key.replace(/_/g, " "), typeof v === "object" ? JSON.stringify(v) : String(v), null, null);
  }
  return rows;
}
