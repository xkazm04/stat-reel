/**
 * Topics and the videos ledger (ADR 011): the controlled topic list, topic resolution, the video
 * rows written when a render succeeds, and the topic heatmap read (`GET /api/heatmap/topics`).
 */
import { randomUUID } from "node:crypto";
import {
  ageDays,
  bucketForAge,
  DOMAIN_TOPIC,
  RECENCY_BUCKETS,
  SPORT_TOPIC,
  slug,
  type Topic,
  type TopicFamily,
  type TopicHeatmap,
  type TopicInput,
  type TopicPatch,
  type TopicSource,
  UNASSIGNED_TOPIC,
} from "@statreel/schemas";
import type { Db } from "./db";
import { relativeToData } from "./topics-migrate";

// ---------------------------------------------------------------- resolution

export type TopicInputs = {
  /** case_ideas.topic */
  caseTopic?: string | null;
  /** case_ideas.domain */
  caseDomain?: string | null;
  /** projects.topic */
  projectTopic?: string | null;
  /** projects.sport */
  projectSport?: string | null;
};

/** First match wins: case.topic, the unambiguous domain, project.topic, the sport mapping, `unassigned`. */
export function resolveTopic(i: TopicInputs): { key: string; source: TopicSource } {
  if (i.caseTopic) return { key: i.caseTopic, source: "case.topic" };
  const byDomain = i.caseDomain ? DOMAIN_TOPIC[i.caseDomain] : undefined;
  if (byDomain) return { key: byDomain, source: "case.domain" };
  if (i.projectTopic) return { key: i.projectTopic, source: "project.topic" };
  const bySport = i.projectSport ? SPORT_TOPIC[i.projectSport] : undefined;
  if (bySport) return { key: bySport, source: "project.sport" };
  return { key: UNASSIGNED_TOPIC, source: "unassigned" };
}

// ---------------------------------------------------------------- service

type TopicRow = { key: string; label: string; family: TopicFamily; sort: number; active: number };
const toTopic = (r: TopicRow): Topic => ({ key: r.key, label: r.label, family: r.family, sort: r.sort, active: !!r.active });
const SERVED = ["renders", "audio", "board"];

export type NewVideo = {
  topic_key: string; topic_source: TopicSource; case_id?: string | null; project_id?: string | null; render_id?: string | null;
  generation_job_id?: string | null; title: string; format: string; duration_s?: number | null;
  /** relative to data/ (or absolute: it is made relative) */
  path: string; created_at?: string;
};

export class TopicService {
  private readonly sql;
  constructor(private readonly db: Db) {
    this.sql = db.$client;
  }

  list(opts: { all?: boolean } = {}): Topic[] {
    const rows = this.sql.prepare(`select * from topics ${opts.all ? "" : "where active = 1"} order by sort, label`).all() as TopicRow[];
    return rows.map(toTopic);
  }

  get(key: string): Topic | undefined {
    const r = this.sql.prepare("select * from topics where key = ?").get(key) as TopicRow | undefined;
    return r ? toTopic(r) : undefined;
  }

  /** A key an owner or a loop may assign: active, and not the reserved fallback. Throws a 400-style message otherwise. */
  assertPickable(key: string): void {
    const t = this.get(key);
    if (!t || !t.active) throw new Error(`unknown topic '${key}'; pick one of the active topics (GET /api/topics)`);
    if (key === UNASSIGNED_TOPIC) throw new Error("'unassigned' is the reserved fallback; clear the topic instead");
  }

  create(input: TopicInput): Topic {
    const key = input.key ?? slug(input.label);
    if (!key) throw new Error("a topic needs a label that makes a key");
    if (this.get(key)) throw new Error(`topic '${key}' already exists`);
    const sort = ((this.sql.prepare("select max(sort) as m from topics where key != ?").get(UNASSIGNED_TOPIC) as { m: number | null }).m ?? 0) + 10;
    this.sql.prepare("insert into topics (key, label, family, sort, active, created_at) values (?, ?, ?, ?, 1, ?)").run(key, input.label, input.family, sort, new Date().toISOString());
    return this.get(key)!;
  }

  /** Rename, regroup, reorder, retire or restore. Retire instead of delete: history keeps the key. */
  patch(key: string, p: TopicPatch): Topic {
    const cur = this.get(key);
    if (!cur) throw new Error(`unknown topic '${key}'`);
    if (key === UNASSIGNED_TOPIC && p.active === false) throw new Error("'unassigned' cannot be retired");
    const next = { ...cur, ...p };
    this.sql.prepare("update topics set label = ?, family = ?, sort = ?, active = ? where key = ?").run(next.label, next.family, next.sort, next.active ? 1 : 0, key);
    return this.get(key)!;
  }

  /**
   * Resolve a topic for a finished project render with resolveTopic's precedence: the originating
   * case's topic (then its domain) when `caseId` is given, then project.topic, then the sport, then `unassigned`.
   */
  resolveForProject(projectId: string, caseId?: string | null): { key: string; source: TopicSource } {
    const p = this.sql.prepare("select topic, sport from projects where id = ?").get(projectId) as { topic: string | null; sport: string } | undefined;
    const c = caseId ? (this.sql.prepare("select topic, domain from case_ideas where id = ?").get(caseId) as { topic: string | null; domain: string } | undefined) : undefined;
    const r = resolveTopic({ caseTopic: c?.topic, caseDomain: c?.domain, projectTopic: p?.topic, projectSport: p?.sport });
    return this.get(r.key)?.active === false || !this.get(r.key) ? { key: UNASSIGNED_TOPIC, source: "unassigned" } : r;
  }

  /**
   * Append a row to the ledger (idempotent per render_id / generation_job_id). Returns the id of the
   * row that is in the ledger: on a replay that is the EXISTING row's id, never a phantom one.
   * A record with neither key has nothing to be idempotent on and is always appended.
   */
  recordVideo(v: NewVideo): string {
    const topic = this.get(v.topic_key) ?? this.get(UNASSIGNED_TOPIC)!;
    // a full UUID: with 8 hex digits a collision on the primary key was ignored and then reported as a missing row
    const id = `vd-${randomUUID().replace(/-/g, "")}`;
    const abs = v.path.replace(/\\/g, "/");
    const rel = /^([a-zA-Z]:)?\//.test(abs) ? relativeToData(abs) : abs;
    const res = this.sql
      .prepare(
        `insert or ignore into videos (id, topic_key, topic_label, topic_source, case_id, project_id, render_id, generation_job_id, title, format, duration_s, path, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, topic.key, topic.label, topic.key === v.topic_key ? v.topic_source : "unassigned", v.case_id ?? null, v.project_id ?? null, v.render_id ?? null,
        v.generation_job_id ?? null, v.title, v.format, v.duration_s ?? null, rel, v.created_at ?? new Date().toISOString());
    if (res.changes > 0) return id;
    const existing = (v.render_id ? this.sql.prepare("select id from videos where render_id = ?").get(v.render_id) : undefined) as { id: string } | undefined
      ?? (v.generation_job_id ? (this.sql.prepare("select id from videos where generation_job_id = ?").get(v.generation_job_id) as { id: string } | undefined) : undefined);
    if (!existing) throw new Error("video row was ignored but no row matches its render_id/generation_job_id");
    return existing.id;
  }

  /** A video row for a successful project render (hooked next to the `renders` insert in pipeline.ts). */
  recordRender(r: { render_id: string; project_id: string; title: string; format: string; path: string; duration_s?: number | null; created_at: string; case_id?: string | null }): string {
    const t = this.resolveForProject(r.project_id, r.case_id);
    return this.recordVideo({ topic_key: t.key, topic_source: t.source, case_id: r.case_id ?? null, project_id: r.project_id, render_id: r.render_id, title: r.title, format: r.format,
      duration_s: r.duration_s ?? null, path: r.path, created_at: r.created_at });
  }

  /** Set (or clear with null) the topic of a case idea. Only an active, pickable key is accepted. */
  setCaseTopic(caseId: string, topic: string | null): void {
    if (topic !== null) this.assertPickable(topic);
    const r = this.sql.prepare("update case_ideas set topic = ? where id = ?").run(topic, caseId);
    if (!r.changes) throw new Error(`unknown case idea ${caseId}`);
  }

  // ---------------------------------------------------------------- heatmap

  /** Does the generation queue exist yet? (T7 adds `generation_jobs`; until then pending is zero.) */
  private hasGenerationJobs(): boolean {
    return !!this.sql.prepare("select 1 from sqlite_master where type = 'table' and name = 'generation_jobs'").get();
  }

  /**
   * include_empty: "0" only topics with videos; "1" (default) also topics of accepted cases;
   * "all" every active topic of the controlled list.
   */
  heatmap(opts: { now?: Date | string | number; include_empty?: string } = {}): TopicHeatmap {
    const now = new Date(opts.now ?? Date.now());
    const mode = opts.include_empty === "0" || opts.include_empty === "all" ? opts.include_empty : "1";
    const topics = new Map(this.list({ all: true }).map((t) => [t.key, t]));
    type Row = { id: string; topic_key: string; topic_source: TopicSource; case_id: string | null; project_id: string | null; title: string; path: string; created_at: string; n: number };
    const videos = this.sql
      .prepare(
        `select v.id, v.topic_key, v.topic_source, v.case_id, v.project_id, v.title, v.path, v.created_at,
                row_number() over (partition by v.topic_key order by v.created_at, v.id) as n
         from videos v order by v.topic_key, n`,
      )
      .all() as Row[];

    type Acc = { key: string; source: TopicSource; videos: TopicHeatmap["topics"][number]["videos"]; queued: number; running: boolean; accepted: number; last_at: string | null };
    const rows = new Map<string, Acc>();
    const row = (key: string, source: TopicSource): Acc => {
      let a = rows.get(key);
      if (!a) rows.set(key, (a = { key, source, videos: [], queued: 0, running: false, accepted: 0, last_at: null }));
      return a;
    };
    for (const v of videos) {
      const a = row(v.topic_key, v.topic_source);
      const age = ageDays(v.created_at, now);
      const first = v.path.replace(/\\/g, "/").split("/")[0] ?? "";
      a.videos.push({ n: v.n, id: v.id, title: v.title, created_at: v.created_at, age_days: age, bucket: bucketForAge(age), case_id: v.case_id, project_id: v.project_id,
        url: SERVED.includes(first) ? `/files/${v.path.replace(/\\/g, "/")}` : null });
      a.source = v.topic_source; // the newest video wins (rows are ordered by n)
      a.last_at = !a.last_at || v.created_at > a.last_at ? v.created_at : a.last_at;
    }

    if (mode !== "0") {
      const cases = this.sql.prepare("select id, topic, domain, status from case_ideas where status = 'accepted'").all() as { id: string; topic: string | null; domain: string }[];
      for (const c of cases) {
        const r = resolveTopic({ caseTopic: c.topic, caseDomain: c.domain });
        row(r.key, r.source).accepted += 1;
      }
      if (this.hasGenerationJobs()) {
        const jobs = this.sql
          .prepare(
            `select g.status, c.topic, c.domain from generation_jobs g join case_ideas c on c.id = g.case_id
             where g.type = 'generate_video' and g.status in ('queued', 'running')`,
          )
          .all() as { status: string; topic: string | null; domain: string }[];
        for (const j of jobs) {
          const a = row(resolveTopic({ caseTopic: j.topic, caseDomain: j.domain }).key, "case.topic");
          if (j.status === "running") a.running = true;
          else a.queued += 1;
        }
      }
    }
    if (mode === "all") for (const t of topics.values()) if (t.active) row(t.key, t.key === UNASSIGNED_TOPIC ? "unassigned" : "case.topic");

    const out = [...rows.values()]
      .map((a) => {
        const t = topics.get(a.key);
        return {
          key: a.key, label: t?.label ?? a.key, family: (t?.family ?? "other") as TopicFamily, source: a.source, videos: a.videos,
          pending: { queued: a.queued, running: a.running }, accepted_cases: a.accepted, last_at: a.last_at,
        };
      })
      .sort((x, y) => (x.last_at === y.last_at ? 0 : !x.last_at ? 1 : !y.last_at ? -1 : y.last_at.localeCompare(x.last_at)) || x.label.localeCompare(y.label));
    return {
      generated_at: now.toISOString(), buckets: [...RECENCY_BUCKETS], max_videos: out.reduce((m, t) => Math.max(m, t.videos.length), 0), topics: out,
    };
  }
}
