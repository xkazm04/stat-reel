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
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value_json: text("value_json").notNull(),
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
`;

export type Db = BetterSQLite3Database<Record<string, never>> & { $client: Database.Database };

export function openDb(file: string): Db {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(DDL);
  return drizzle(sqlite) as Db;
}

export const now = () => new Date().toISOString();
