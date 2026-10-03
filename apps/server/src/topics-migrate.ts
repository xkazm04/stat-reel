/**
 * Topics and the videos ledger (ADR 011, SPEC C.3): DDL, seed and backfill. Every statement is
 * idempotent and additive, so opening an existing database twice (or the owner's real one) changes
 * nothing the second time. Raw better-sqlite3 on purpose: db.ts calls this and must not import it back.
 */
import type Database from "better-sqlite3";
import { DOMAIN_TOPIC, SPORT_TOPIC, TOPIC_SEED, UNASSIGNED_TOPIC } from "@statreel/schemas";

export const TOPICS_DDL = `
create table if not exists topics (
  key text primary key,
  label text not null,
  family text not null check (family in ('sport','geoeconomy','culture','science','games','music','other')),
  sort integer not null default 0,
  active integer not null default 1,
  created_at text not null
);
create table if not exists videos (
  id text primary key,
  topic_key text not null references topics(key),
  topic_label text not null,
  topic_source text not null,
  case_id text,
  project_id text,
  render_id text,
  generation_job_id text,
  title text not null,
  format text not null,
  duration_s real,
  path text not null,
  created_at text not null
);
create index if not exists videos_topic_created on videos(topic_key, created_at);
create unique index if not exists videos_render on videos(render_id) where render_id is not null;
create unique index if not exists videos_gen on videos(generation_job_id) where generation_job_id is not null;
`;

const hasColumn = (db: Database.Database, table: string, column: string) =>
  (db.prepare(`pragma table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);

/** The path stored in `videos` is relative to data/; renders keep the absolute path of the file. */
export const relativeToData = (p: string): string => {
  const n = p.replace(/\\/g, "/");
  const i = n.lastIndexOf("/renders/");
  return i >= 0 ? n.slice(i + 1) : n;
};

export function migrateTopics(db: Database.Database, now: () => string = () => new Date().toISOString()): void {
  db.exec(TOPICS_DDL);
  // additive FK columns (SQLite allows ADD COLUMN ... REFERENCES while the default is NULL)
  for (const table of ["case_ideas", "projects"]) {
    if (!hasColumn(db, table, "topic")) db.exec(`alter table ${table} add column topic text references topics(key)`);
  }

  const at = now();
  const seed = db.prepare("insert or ignore into topics (key, label, family, sort, active, created_at) values (?, ?, ?, ?, 1, ?)");
  for (const t of TOPIC_SEED) seed.run(t.key, t.label, t.family, t.sort, at);

  // case ideas: only the unambiguous domains get a topic (`sports`, `geoeconomy` stay null)
  const setDomain = db.prepare("update case_ideas set topic = ? where topic is null and domain = ?");
  for (const [domain, topic] of Object.entries(DOMAIN_TOPIC)) setDomain.run(topic, domain);

  // one videos row per render that lacks one; topic from the project (topic, then sport), else unassigned
  const labels = new Map(TOPIC_SEED.map((t) => [t.key, t.label]));
  const rows = db
    .prepare(
      `select r.id as render_id, r.project_id, r.format, r.path, r.checks_json, r.created_at, p.title, p.topic, p.sport
       from renders r left join projects p on p.id = r.project_id
       where not exists (select 1 from videos v where v.render_id = r.id)
       order by r.created_at, r.id`,
    )
    .all() as { render_id: string; project_id: string; format: string; path: string; checks_json: string; created_at: string; title: string | null; topic: string | null; sport: string | null }[];
  const ins = db.prepare(
    `insert or ignore into videos (id, topic_key, topic_label, topic_source, case_id, project_id, render_id, generation_job_id, title, format, duration_s, path, created_at)
     values (?, ?, ?, ?, null, ?, ?, null, ?, ?, ?, ?, ?)`,
  );
  const known = (key: string | null | undefined): key is string => !!key && !!db.prepare("select 1 from topics where key = ?").get(key);
  for (const r of rows) {
    const fromSport = r.sport ? SPORT_TOPIC[r.sport] : undefined;
    const [key, source] = known(r.topic) ? [r.topic, "project.topic"] : known(fromSport) ? [fromSport, "project.sport"] : [UNASSIGNED_TOPIC, "unassigned"];
    const label = (db.prepare("select label from topics where key = ?").get(key) as { label: string } | undefined)?.label ?? labels.get(key) ?? key;
    let duration: number | null = null;
    try {
      const d = JSON.parse(r.checks_json)?.duration_s;
      duration = typeof d === "number" ? d : null;
    } catch {
      duration = null;
    }
    ins.run(`vd-${r.render_id.replace(/-/g, "").slice(0, 8)}`, key, label, source, r.project_id, r.render_id, r.title ?? r.project_id, r.format, duration, relativeToData(r.path), r.created_at);
  }
}
