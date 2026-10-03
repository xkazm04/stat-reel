/** app.sqlite - projects, props, scripts, assets, jobs, renders, LLM sessions, publications, metrics (DESIGN §9). */
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  use_case_id: text("use_case_id").notNull(),
  sport: text("sport").notNull(),
  format: text("format").notNull(),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  created_at: text("created_at").notNull(),
});
export const projectProps = sqliteTable("project_props", {
  project_id: text("project_id").notNull(),
  version: integer("version").notNull(),
  props_json: text("props_json").notNull(),
  schema_version: text("schema_version").notNull(),
  created_by: text("created_by").notNull(),
  created_at: text("created_at").notNull(),
});
export const scripts = sqliteTable("scripts", {
  project_id: text("project_id").notNull(),
  version: integer("version").notNull(),
  scenes_json: text("scenes_json").notNull(),
  words: integer("words").notNull(),
  est_duration_s: real("est_duration_s").notNull(),
  created_at: text("created_at").notNull(),
});
export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  project_id: text("project_id").notNull(),
  kind: text("kind").notNull(),
  provider: text("provider"),
  request_id: text("request_id"),
  model_id: text("model_id"),
  voice_id: text("voice_id"),
  plan_tier: text("plan_tier"),
  prompt_sha256: text("prompt_sha256"),
  scene_id: text("scene_id"),
  path: text("path").notNull(),
  sha256: text("sha256").notNull(),
  generated_at: text("generated_at").notNull(),
  lifecycle: text("lifecycle").notNull().default("draft"),
});
export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  project_id: text("project_id"),
  status: text("status").notNull(),
  progress: real("progress").notNull().default(0),
  params_json: text("params_json").notNull(),
  result_json: text("result_json"),
  error: text("error"),
  created_at: text("created_at").notNull(),
  started_at: text("started_at"),
  finished_at: text("finished_at"),
});
export const renders = sqliteTable("renders", {
  id: text("id").primaryKey(),
  project_id: text("project_id").notNull(),
  job_id: text("job_id").notNull(),
  format: text("format").notNull(),
  path: text("path").notNull(),
  manifest_path: text("manifest_path").notNull(),
  checks_json: text("checks_json").notNull(),
  policy_json: text("policy_json"),
  created_at: text("created_at").notNull(),
});
export const llmSessions = sqliteTable("llm_sessions", {
  id: text("id").primaryKey(),
  engine: text("engine").notNull(),
  external_session_id: text("external_session_id"),
  project_id: text("project_id"),
  started_at: text("started_at").notNull(),
  ended_at: text("ended_at"),
  fixture_path: text("fixture_path"),
});
export const llmEvents = sqliteTable("llm_events", {
  session_id: text("session_id").notNull(),
  seq: integer("seq").notNull(),
  type: text("type").notNull(),
  payload_json: text("payload_json").notNull(),
  at: text("at").notNull(),
});
export const publications = sqliteTable("publications", {
  id: text("id").primaryKey(),
  render_id: text("render_id").notNull(),
  platform: text("platform").notNull(),
  external_id: text("external_id"),
  visibility: text("visibility").notNull(),
  url: text("url"),
  published_at: text("published_at"),
  status: text("status").notNull(),
  mode: text("mode").notNull(),
});
export const metricsDaily = sqliteTable("metrics_daily", {
  publication_id: text("publication_id").notNull(),
  date: text("date").notNull(),
  views: integer("views"),
  watch_time_s: real("watch_time_s"),
  avg_view_duration_s: real("avg_view_duration_s"),
  likes: integer("likes"),
  comments: integer("comments"),
  shares: integer("shares"),
  subs_delta: integer("subs_delta"),
  retention_json: text("retention_json"),
});
export const heatmapSnapshots = sqliteTable("heatmap_snapshots", {
  run_id: text("run_id").primaryKey(),
  at: text("at").notNull(),
  cells_json: text("cells_json").notNull(),
});
export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  note: text("note"),
  created_at: text("created_at").notNull(),
});
export const schedule = sqliteTable("schedule", {
  id: text("id").primaryKey(),
  project_id: text("project_id").notNull(),
  render_id: text("render_id").notNull(),
  channel_id: text("channel_id").notNull(),
  publish_at: text("publish_at").notNull(),
  status: text("status").notNull(),
  title: text("title"),
  description: text("description"),
  tags_json: text("tags_json"),
  job_id: text("job_id"),
  publication_id: text("publication_id"),
  error: text("error"),
  created_at: text("created_at").notNull(),
});
export const boardItems = sqliteTable("board_items", {
  id: text("id").primaryKey(),
  image: text("image").notNull(),
  video: text("video"),
  duration_s: real("duration_s"),
  width: integer("width"),
  height: integer("height"),
  title: text("title").notNull(),
  summary: text("summary"),
  use_case_id: text("use_case_id"),
  proposed_case_json: text("proposed_case_json"),
  style_json: text("style_json"),
  source_json: text("source_json"),
  status: text("status").notNull(),
  decision: text("decision"),
  note: text("note"),
  decided_at: text("decided_at"),
  created_at: text("created_at").notNull(),
  case_idea_id: text("case_idea_id"),
});
export const boardStyles = sqliteTable("board_styles", {
  id: text("id").primaryKey(),
  status: text("status"),
  note: text("note"),
  hero_item_id: text("hero_item_id"),
  updated_at: text("updated_at").notNull(),
});
export const caseIdeas = sqliteTable("case_ideas", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  pitch: text("pitch").notNull(),
  domain: text("domain").notNull(),
  arc: text("arc").notNull(),
  insight: text("insight").notNull(),
  why_lasts: text("why_lasts").notNull(),
  tension_json: text("tension_json").notNull(),
  unknowns_json: text("unknowns_json").notNull(),
  beats_json: text("beats_json").notNull(),
  timeline_json: text("timeline_json").notNull(),
  span_years: real("span_years").notNull(),
  chart_ideas_json: text("chart_ideas_json").notNull(),
  requires_json: text("requires_json").notNull(),
  sources_json: text("sources_json").notNull(),
  evidence_json: text("evidence_json").notNull(),
  data_status: text("data_status").notNull(),
  kind: text("kind"),
  method: text("method"),
  data_guess: text("data_guess"),
  feasibility: text("feasibility"),
  source_json: text("source_json"),
  status: text("status").notNull(),
  decision: text("decision"),
  note: text("note"),
  decided_at: text("decided_at"),
  created_at: text("created_at").notNull(),
});
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value_json: text("value_json").notNull(),
});

// ---- generation queue (ADR 010): written by the server (enqueue/cancel/retry) and the worker process
export const generationJobs = sqliteTable("generation_jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  case_id: text("case_id").notNull(),
  board_item_id: text("board_item_id"),
  dedupe_key: text("dedupe_key").notNull(),
  status: text("status").notNull(),
  attempts: integer("attempts").notNull().default(0),
  max_attempts: integer("max_attempts").notNull().default(2),
  params_json: text("params_json").notNull().default("{}"),
  result_json: text("result_json"),
  error: text("error"),
  error_kind: text("error_kind"),
  log_path: text("log_path"),
  output_dir: text("output_dir"),
  pid: integer("pid"),
  phase: text("phase"),
  progress_note: text("progress_note"),
  last_tool: text("last_tool"),
  cancel_requested_at: text("cancel_requested_at"),
  heartbeat_at: text("heartbeat_at"),
  created_at: text("created_at").notNull(),
  started_at: text("started_at"),
  finished_at: text("finished_at"),
  updated_at: text("updated_at").notNull(),
});
export const generationJobEvents = sqliteTable("generation_job_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  job_id: text("job_id").notNull(),
  at: text("at").notNull(),
  type: text("type").notNull(),
  data_json: text("data_json").notNull().default("{}"),
});
export const workerLease = sqliteTable("worker_lease", {
  id: text("id").primaryKey(),
  pid: integer("pid").notNull(),
  host: text("host").notNull(),
  heartbeat_at: text("heartbeat_at").notNull(),
});

const DDL = `
create table if not exists projects (id text primary key, title text not null, use_case_id text not null, sport text not null,
  format text not null, mode text not null, status text not null, created_at text not null);
create table if not exists project_props (project_id text not null, version integer not null, props_json text not null,
  schema_version text not null, created_by text not null, created_at text not null, primary key (project_id, version));
create table if not exists scripts (project_id text not null, version integer not null, scenes_json text not null,
  words integer not null, est_duration_s real not null, created_at text not null, primary key (project_id, version));
create table if not exists assets (id text primary key, project_id text not null, kind text not null, provider text, request_id text,
  model_id text, voice_id text, plan_tier text, prompt_sha256 text, scene_id text, path text not null, sha256 text not null,
  generated_at text not null, lifecycle text not null default 'draft');
create table if not exists jobs (id text primary key, kind text not null, project_id text, status text not null,
  progress real not null default 0, params_json text not null, result_json text, error text, created_at text not null,
  started_at text, finished_at text);
create table if not exists renders (id text primary key, project_id text not null, job_id text not null, format text not null,
  path text not null, manifest_path text not null, checks_json text not null, policy_json text, created_at text not null);
create table if not exists llm_sessions (id text primary key, engine text not null, external_session_id text, project_id text,
  started_at text not null, ended_at text, fixture_path text);
create table if not exists llm_events (session_id text not null, seq integer not null, type text not null, payload_json text not null,
  at text not null, primary key (session_id, seq));
create table if not exists publications (id text primary key, render_id text not null, platform text not null, external_id text,
  visibility text not null, url text, published_at text, status text not null, mode text not null);
create table if not exists metrics_daily (publication_id text not null, date text not null, views integer, watch_time_s real,
  avg_view_duration_s real, likes integer, comments integer, shares integer, subs_delta integer, retention_json text,
  primary key (publication_id, date));
create table if not exists heatmap_snapshots (run_id text primary key, at text not null, cells_json text not null);
create table if not exists settings (key text primary key, value_json text not null);
create table if not exists channels (id text primary key, platform text not null, name text not null, status text not null, note text,
  created_at text not null);
create table if not exists schedule (id text primary key, project_id text not null, render_id text not null, channel_id text not null,
  publish_at text not null, status text not null, title text, description text, tags_json text, job_id text, publication_id text,
  error text, created_at text not null);
create table if not exists board_items (id text primary key, image text not null, video text, duration_s real, width integer, height integer, title text not null,
  summary text, use_case_id text, proposed_case_json text, style_json text, source_json text, status text not null, decision text,
  note text, decided_at text, created_at text not null);
create table if not exists board_styles (id text primary key, status text, note text, hero_item_id text, updated_at text not null);
create table if not exists case_ideas (id text primary key, title text not null, pitch text not null, domain text not null, arc text not null,
  insight text not null, why_lasts text not null, tension_json text not null, unknowns_json text not null, beats_json text not null, timeline_json text not null,
  span_years real not null, chart_ideas_json text not null, requires_json text not null, sources_json text not null,
  evidence_json text not null, data_status text not null, kind text, method text, data_guess text, feasibility text, source_json text, status text not null, decision text, note text,
  decided_at text, created_at text not null);
`;

const GENERATION_DDL = `
create table if not exists generation_jobs (id text primary key,
  type text not null check (type in ('visual_options','generate_video')),
  case_id text not null, board_item_id text, dedupe_key text not null,
  status text not null check (status in ('queued','running','done','failed','cancelled')),
  attempts integer not null default 0, max_attempts integer not null default 2, params_json text not null default '{}',
  result_json text, error text, error_kind text, log_path text, output_dir text, pid integer,
  phase text, progress_note text, last_tool text, cancel_requested_at text, heartbeat_at text,
  created_at text not null, started_at text, finished_at text, updated_at text not null);
create unique index if not exists generation_jobs_active on generation_jobs(dedupe_key) where status in ('queued','running');
create index if not exists generation_jobs_status on generation_jobs(status, created_at);
create index if not exists generation_jobs_case on generation_jobs(case_id, created_at);
create table if not exists generation_job_events (id integer primary key autoincrement, job_id text not null, at text not null,
  type text not null, data_json text not null default '{}');
create index if not exists generation_job_events_job on generation_job_events(job_id, id);
create table if not exists worker_lease (id text primary key, pid integer not null, host text not null, heartbeat_at text not null);
`;

export type Db = BetterSQLite3Database<Record<string, never>> & { $client: Database.Database };

export function openDb(file: string): Db {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  // two writers (server + generation worker, ADR 010): wait for the lock instead of failing
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(DDL);
  sqlite.exec(GENERATION_DDL);
  // additive migrations for databases created before a column existed
  const addColumn = (table: string, column: string, type: string) => {
    const cols = (sqlite.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes(column)) sqlite.exec(`alter table ${table} add column ${column} ${type}`);
  };
  addColumn("board_items", "video", "text");
  addColumn("board_items", "duration_s", "real");
  addColumn("board_items", "case_idea_id", "text");
  addColumn("case_ideas", "beats_json", "text not null default '[]'");
  for (const c of ["kind", "method", "data_guess", "feasibility"]) addColumn("case_ideas", c, "text");
  return drizzle(sqlite) as Db;
}

export const now = () => new Date().toISOString();
