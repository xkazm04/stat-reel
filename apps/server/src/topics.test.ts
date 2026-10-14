import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { TOPIC_SEED } from "@statreel/schemas";
import { type AppDeps, buildApp } from "./app";
import { GenerationQueue } from "./generation/queue";
import { openDb } from "./db";
import { EventBus } from "./events";
import { CaseIdeas, type NewCaseIdea } from "./library";
import { resolveTopic, TopicService } from "./topics";
import { migrateTopics } from "./topics-migrate";

const idea: NewCaseIdea = {
  title: "The wins record changes hands", pitch: "Who held the all-time wins record", domain: "sports", arc: "six holders in 75 years",
  insight: "Records last longer each time", why_lasts: "Fangio leads until 1957, Clark passes him in 1968, Prost collapses in 1987",
  tension: { expectation: "records fall often", reality: "only six holders since 1950", strength: "strong", counter: { provenance: "constructed", case: "records fall often because rules change" } },
  beats: [{ at: "1957", what: "a" }, { at: "1968", what: "b" }, { at: "1987", what: "c" }, { at: "2001", what: "d" }],
  timeline: { unit: "race", from: 1, to: 1150, years_from: 1950, years_to: 2026 },
  sources: [{ name: "F1DB", url: "https://github.com/f1db/f1db", license: "CC-BY-4.0" }], data_status: "staged",
};
const DAY = 86_400_000;
const NOW = new Date("2026-10-31T12:00:00.000Z");
const daysAgo = (d: number, extraMs = 0) => new Date(NOW.getTime() - d * DAY - extraMs).toISOString();

const setup = () => {
  const db = openDb(":memory:");
  const topics = new TopicService(db);
  const cases = new CaseIdeas(db);
  const app = buildApp({ db, cases, topics, bus: new EventBus() } as unknown as AppDeps);
  const video = (key: string, created_at: string, extra: Partial<Parameters<TopicService["recordVideo"]>[0]> = {}) =>
    topics.recordVideo({ topic_key: key, topic_source: "case.topic", title: `v ${created_at}`, format: "landscape", path: "renders/p/x/video.mp4", created_at, ...extra });
  return { db, topics, cases, app, video };
};
const json = (app: ReturnType<typeof buildApp>, url: string, method = "GET", body?: unknown) =>
  app.request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });

describe("resolveTopic: first match wins", () => {
  it("case.topic, then the domain mapping, then project.topic, then project.sport, then unassigned", () => {
    expect(resolveTopic({ caseTopic: "energy", caseDomain: "f1", projectTopic: "boxing", projectSport: "NBA" })).toEqual({ key: "energy", source: "case.topic" });
    expect(resolveTopic({ caseDomain: "f1", projectTopic: "boxing", projectSport: "NBA" })).toEqual({ key: "formula-1", source: "case.domain" });
    expect(resolveTopic({ caseDomain: "sports", projectTopic: "boxing", projectSport: "NBA" })).toEqual({ key: "boxing", source: "project.topic" });
    expect(resolveTopic({ caseDomain: "geoeconomy", projectSport: "NBA" })).toEqual({ key: "basketball", source: "project.sport" });
    expect(resolveTopic({ projectSport: "NHL" })).toEqual({ key: "ice-hockey", source: "project.sport" });
    expect(resolveTopic({ caseDomain: "sports", projectSport: "Cricket" })).toEqual({ key: "unassigned", source: "unassigned" });
    expect(resolveTopic({})).toEqual({ key: "unassigned", source: "unassigned" });
  });
});

describe("seed and migrations", () => {
  it("seeds the controlled list, and opening the same database twice adds nothing", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "topics-")), "app.sqlite");
    const count = (db: ReturnType<typeof openDb>, t: string) => (db.$client.prepare(`select count(*) as n from ${t}`).get() as { n: number }).n;
    const a = openDb(file);
    expect(count(a, "topics")).toBe(TOPIC_SEED.length);
    a.$client.close();
    const b = openDb(file);
    expect(count(b, "topics")).toBe(TOPIC_SEED.length);
    b.$client.close();
  });

  it("backfills case topics only where the domain is unambiguous, and videos from renders, once", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "topics-")), "old.sqlite");
    // an older database: case_ideas and projects without the topic column, renders already present
    const old = new Database(file);
    old.exec(`
      create table projects (id text primary key, title text not null, use_case_id text not null, sport text not null, format text not null, mode text not null, status text not null, created_at text not null);
      create table renders (id text primary key, project_id text not null, job_id text not null, format text not null, path text not null, manifest_path text not null, checks_json text not null, policy_json text, created_at text not null);
      insert into projects values ('p-1', 'Fangio', 'era-adjusted-rankings', 'F1', 'landscape', 'x', 'rendered', '2026-10-01T00:00:00.000Z');
      insert into projects values ('p-2', 'Mystery', 'x', 'Cricket', 'landscape', 'x', 'rendered', '2026-10-01T00:00:00.000Z');
      insert into renders values ('11111111-aaaa', 'p-1', 'j1', 'landscape', 'C:\\repo\\data\\renders\\p-1\\run\\video.mp4', 'm', '{"duration_s": 42.5}', null, '2026-10-02T00:00:00.000Z');
      insert into renders values ('22222222-bbbb', 'p-2', 'j2', 'landscape', '/repo/data/renders/p-2/run/video.mp4', 'm', 'not json', null, '2026-10-03T00:00:00.000Z');
    `);
    old.close();
    const first = openDb(file);
    // case ideas are created through the service after migration; backfill ran on an empty table, so seed rows by hand and re-open
    first.$client.exec(`
      create table if not exists _x (a);
      insert into case_ideas (id, title, pitch, domain, arc, insight, why_lasts, tension_json, unknowns_json, beats_json, timeline_json, span_years, chart_ideas_json, requires_json, sources_json, evidence_json, data_status, status, created_at)
      values ('c-f1','a','p','f1','a','i','w','{}','[]','[]','{}',20,'[]','[]','[]','[]','staged','pending','t'),
             ('c-sp','b','p','sports','a','i','w','{}','[]','[]','{}',20,'[]','[]','[]','[]','staged','pending','t'),
             ('c-ge','c','p','geoeconomy','a','i','w','{}','[]','[]','{}',20,'[]','[]','[]','[]','staged','pending','t'),
             ('c-mu','d','p','music','a','i','w','{}','[]','[]','{}',20,'[]','[]','[]','[]','staged','pending','t');
    `);
    first.$client.close();
    const db = openDb(file);
    const sql = db.$client;
    const topicOf = (id: string) => (sql.prepare("select topic from case_ideas where id = ?").get(id) as { topic: string | null }).topic;
    expect([topicOf("c-f1"), topicOf("c-sp"), topicOf("c-ge"), topicOf("c-mu")]).toEqual(["formula-1", null, null, "music"]);
    const vids = sql.prepare("select * from videos order by created_at").all() as Record<string, unknown>[];
    expect(vids).toHaveLength(2);
    expect(vids[0]).toMatchObject({ topic_key: "formula-1", topic_label: "Formula 1", topic_source: "project.sport", project_id: "p-1", title: "Fangio", duration_s: 42.5, path: "renders/p-1/run/video.mp4", created_at: "2026-10-02T00:00:00.000Z" });
    expect(vids[1]).toMatchObject({ topic_key: "unassigned", topic_source: "unassigned", duration_s: null, path: "renders/p-2/run/video.mp4" });
    sql.close();
    const again = openDb(file);
    expect((again.$client.prepare("select count(*) as n from videos").get() as { n: number }).n).toBe(2);
    again.$client.close();
  });

  it("backfills one ledger row per render even when two render ids share their first 8 hex digits", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "topics-")), "old.sqlite");
    const old = new Database(file);
    old.exec(`
      create table projects (id text primary key, title text not null, use_case_id text not null, sport text not null, format text not null, mode text not null, status text not null, created_at text not null);
      create table renders (id text primary key, project_id text not null, job_id text not null, format text not null, path text not null, manifest_path text not null, checks_json text not null, policy_json text, created_at text not null);
      insert into projects values ('p-1', 'Fangio', 'era-adjusted-rankings', 'F1', 'landscape', 'x', 'rendered', '2026-10-01T00:00:00.000Z');
      insert into renders values ('3f2a9c1e-0001-4000-8000-000000000001', 'p-1', 'j1', 'landscape', '/d/renders/p-1/a/video.mp4', 'm', '{}', null, '2026-10-02T00:00:00.000Z');
      insert into renders values ('3f2a9c1e-0002-4000-8000-000000000002', 'p-1', 'j2', 'landscape', '/d/renders/p-1/b/video.mp4', 'm', '{}', null, '2026-10-03T00:00:00.000Z');
    `);
    old.close();
    const db = openDb(file);
    const ids = (db.$client.prepare("select id, render_id from videos order by created_at").all() as { id: string; render_id: string }[]);
    expect(ids.map((v) => v.render_id)).toEqual(["3f2a9c1e-0001-4000-8000-000000000001", "3f2a9c1e-0002-4000-8000-000000000002"]);
    expect(new Set(ids.map((v) => v.id)).size).toBe(2);
    db.$client.close();
  });

  it("does not overwrite a topic the owner already picked when the backfill runs again", () => {
    const { db, cases } = setup();
    const c = cases.create({ ...idea, domain: "f1", topic: "motorsport-endurance" });
    const d = cases.create({ ...idea, title: "no topic", domain: "f1" });
    migrateTopics(db.$client);
    expect(cases.get(c.id)?.topic).toBe("motorsport-endurance");
    expect(cases.get(d.id)?.topic).toBe("formula-1"); // an unambiguous domain gets its topic on the next open
  });
});

describe("topic validation (400)", () => {
  it("CaseIdeas.create rejects unknown, retired and reserved keys, and accepts a seed key", () => {
    const { cases, topics } = setup();
    expect(() => cases.create({ ...idea, topic: "knitting" })).toThrow(/unknown topic/);
    expect(() => cases.create({ ...idea, topic: "unassigned" })).toThrow(/reserved/);
    topics.patch("tennis", { active: false });
    expect(() => cases.create({ ...idea, topic: "tennis" })).toThrow(/unknown topic/);
    expect(cases.create({ ...idea, topic: "energy" }).topic).toBe("energy");
    expect(cases.create(idea).topic).toBeNull();
  });

  it("POST /api/cases answers 400 for an unknown topic", async () => {
    const { app } = setup();
    expect((await json(app, "/api/cases", "POST", { ...idea, topic: "knitting" })).status).toBe(400);
    expect((await json(app, "/api/cases", "POST", { ...idea, topic: "energy" })).status).toBe(201);
  });

  it("PATCH /api/cases/:id sets, clears and validates the topic", async () => {
    const { app, cases } = setup();
    const c = cases.create(idea);
    const ok = await json(app, `/api/cases/${c.id}`, "PATCH", { topic: "energy" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ id: c.id, topic: "energy" });
    expect((await json(app, `/api/cases/${c.id}`, "PATCH", { topic: "knitting" })).status).toBe(400);
    expect((await json(app, `/api/cases/${c.id}`, "PATCH", { topic: "unassigned" })).status).toBe(400);
    expect(cases.get(c.id)?.topic).toBe("energy");
    expect(await (await json(app, `/api/cases/${c.id}`, "PATCH", { topic: null })).json()).toMatchObject({ topic: null });
    expect((await json(app, `/api/cases/${c.id}`, "PATCH", {})).status).toBe(400);
    expect((await json(app, "/api/cases/nope", "PATCH", { topic: "energy" })).status).toBe(404);
  });

  it("GET/POST/PATCH /api/topics list, add and retire topics (retired ones leave the list)", async () => {
    const { app } = setup();
    const list = async (q = "") => ((await (await json(app, `/api/topics${q}`)).json()) as { topics: { key: string; active: boolean }[] }).topics;
    expect((await list()).length).toBe(TOPIC_SEED.length);
    const made = await json(app, "/api/topics", "POST", { label: "Surfing", family: "sport" });
    expect(made.status).toBe(201);
    expect(((await made.json()) as { topic: { key: string } }).topic.key).toBe("surfing");
    expect((await json(app, "/api/topics", "POST", { label: "Surfing", family: "sport" })).status).toBe(400);
    expect((await json(app, "/api/topics", "POST", { label: "x", family: "weather" })).status).toBe(400);
    expect((await json(app, "/api/topics/surfing", "PATCH", { active: false })).status).toBe(200);
    expect((await list()).some((t) => t.key === "surfing")).toBe(false);
    expect((await list("?all=1")).some((t) => t.key === "surfing" && !t.active)).toBe(true);
    expect((await json(app, "/api/topics/unassigned", "PATCH", { active: false })).status).toBe(400);
  });
});

describe("GET /api/heatmap/topics", () => {
  it("numbers videos per topic by created_at, ties broken by id", () => {
    const { topics } = setup();
    const t = "2026-10-20T00:00:00.000Z";
    topics.recordVideo({ topic_key: "energy", topic_source: "case.topic", title: "late", format: "landscape", path: "renders/a.mp4", created_at: "2026-10-25T00:00:00.000Z" });
    topics.recordVideo({ topic_key: "energy", topic_source: "case.topic", title: "early", format: "landscape", path: "renders/b.mp4", created_at: "2026-10-10T00:00:00.000Z" });
    const x = topics.recordVideo({ topic_key: "energy", topic_source: "case.topic", title: "tie-x", format: "landscape", path: "renders/c.mp4", created_at: t });
    const y = topics.recordVideo({ topic_key: "energy", topic_source: "case.topic", title: "tie-y", format: "landscape", path: "renders/d.mp4", created_at: t });
    topics.recordVideo({ topic_key: "boxing", topic_source: "case.topic", title: "only", format: "landscape", path: "renders/e.mp4", created_at: t });
    const h = topics.heatmap({ now: NOW });
    const energy = h.topics.find((r) => r.key === "energy")!;
    const tied = [x, y].sort();
    expect(energy.videos.map((v) => [v.n, v.title])).toEqual([[1, "early"], [2, tied[0] === x ? "tie-x" : "tie-y"], [3, tied[0] === x ? "tie-y" : "tie-x"], [4, "late"]]);
    expect(h.topics.find((r) => r.key === "boxing")!.videos.map((v) => v.n)).toEqual([1]);
    expect(h.max_videos).toBe(4);
    expect(energy.videos[0]!.url).toBe("/files/renders/b.mp4");
  });

  it("tags the recency bucket at 7/8, 30/31 and 90/91 days with `now` injected", () => {
    const { topics, video } = setup();
    for (const d of [0, 7, 8, 30, 31, 90, 91, 400]) video("energy", daysAgo(d), { title: `d${d}` });
    video("energy", daysAgo(7, -1000), { title: "just inside 7" }); // 1 s younger than 7 d
    const vs = topics.heatmap({ now: NOW }).topics.find((r) => r.key === "energy")!.videos;
    const by = (title: string) => vs.find((v) => v.title === title)!;
    expect([by("d0"), by("d7"), by("d8"), by("d30"), by("d31"), by("d90"), by("d91"), by("d400")].map((v) => v.bucket)).toEqual(
      ["fresh", "fresh", "recent", "recent", "cooling", "cooling", "cold", "cold"]);
    expect(by("d7").age_days).toBe(7);
    expect(by("just inside 7")).toMatchObject({ age_days: 6, bucket: "fresh" });
  });

  it("lists empty topics from accepted cases (with the unassigned fallback), and every topic with include_empty=all", () => {
    const { topics, cases } = setup();
    const a = cases.create({ ...idea, domain: "geoeconomy", topic: "energy" });
    const b = cases.create({ ...idea, title: "b", domain: "music" });
    const c = cases.create({ ...idea, title: "c", domain: "sports" }); // no topic: unassigned until picked
    cases.create({ ...idea, title: "d", topic: "tennis" }); // pending: not listed
    for (const x of [a, b, c]) cases.decide(x.id, "accept");
    const keys = (q?: string) => topics.heatmap({ now: NOW, include_empty: q }).topics.map((t) => t.key).sort();
    expect(keys()).toEqual(["energy", "music", "unassigned"]);
    expect(topics.heatmap({ now: NOW }).topics.find((t) => t.key === "energy")).toMatchObject({ accepted_cases: 1, videos: [], last_at: null });
    expect(keys("0")).toEqual([]);
    expect(keys("all")).toHaveLength(TOPIC_SEED.length);
  });

  it("orders rows by last video, newest first, empty rows last by label", () => {
    const { topics, video, cases } = setup();
    video("boxing", daysAgo(30));
    video("golf", daysAgo(2));
    cases.decide(cases.create({ ...idea, topic: "cycling" }).id, "accept");
    cases.decide(cases.create({ ...idea, title: "z", topic: "athletics" }).id, "accept");
    expect(topics.heatmap({ now: NOW }).topics.map((t) => t.key)).toEqual(["golf", "boxing", "athletics", "cycling"]);
  });

  it("pending counts come from queued/running generate_video jobs, and are zero without any", () => {
    const { db, topics, cases } = setup();
    const c1 = cases.create({ ...idea, topic: "energy" });
    const c2 = cases.create({ ...idea, title: "two", topic: "energy" });
    const c3 = cases.create({ ...idea, title: "three", topic: "boxing" });
    for (const c of [c1, c2, c3]) cases.decide(c.id, "accept");
    const row = (key: string) => topics.heatmap({ now: NOW }).topics.find((t) => t.key === key)!;
    expect(row("energy").pending).toEqual({ queued: 0, running: false });
    const q = new GenerationQueue(db);
    const setStatus = (id: string, status: string) => db.$client.prepare("update generation_jobs set status = ? where id = ?").run(status, id);
    q.enqueue({ type: "generate_video", case_id: c1.id, board_item_id: "bd-00000001" });
    setStatus(q.enqueue({ type: "generate_video", case_id: c2.id, board_item_id: "bd-00000002" }).job.id, "running");
    q.enqueue({ type: "visual_options", case_id: c3.id }); // not a video job
    setStatus(q.enqueue({ type: "generate_video", case_id: c3.id, board_item_id: "bd-00000003" }).job.id, "done"); // finished
    expect(row("energy").pending).toEqual({ queued: 1, running: true });
    expect(row("boxing").pending).toEqual({ queued: 0, running: false });
  });

  it("is served at /api/heatmap/topics and matches the contract", async () => {
    const { app, video } = setup();
    video("formula-1", new Date().toISOString(), { title: "Fangio" });
    const r = await json(app, "/api/heatmap/topics");
    expect(r.status).toBe(200);
    const body = (await r.json()) as { buckets: unknown[]; max_videos: number; topics: { key: string; videos: { n: number; bucket: string; age_days: number }[] }[] };
    expect(body.buckets).toHaveLength(4);
    expect(body.max_videos).toBe(1);
    expect(body.topics[0]).toMatchObject({ key: "formula-1", videos: [{ n: 1, bucket: "fresh", age_days: 0 }] });
  });
});

describe("recording a render", () => {
  it("resolves the topic from the project (topic, then sport) and is idempotent per render", () => {
    const { db, topics } = setup();
    const sql = db.$client;
    sql.exec(`insert into projects (id, title, use_case_id, sport, format, mode, status, created_at, topic) values
      ('p-a','A','u','NBA','landscape','m','rendered','t',null), ('p-b','B','u','NBA','landscape','m','rendered','t','boxing'), ('p-c','C','u','Cricket','landscape','m','rendered','t',null)`);
    const rec = (project_id: string, render_id: string) => topics.recordRender({ render_id, project_id, title: project_id, format: "landscape", path: `renders/${project_id}/v.mp4`, duration_s: 30, created_at: new Date().toISOString() });
    rec("p-a", "r1"); rec("p-b", "r2"); rec("p-c", "r3"); rec("p-a", "r1");
    const rows = sql.prepare("select project_id, topic_key, topic_source, topic_label from videos order by project_id").all();
    expect(rows).toEqual([
      { project_id: "p-a", topic_key: "basketball", topic_source: "project.sport", topic_label: "Basketball" },
      { project_id: "p-b", topic_key: "boxing", topic_source: "project.topic", topic_label: "Boxing" },
      { project_id: "p-c", topic_key: "unassigned", topic_source: "unassigned", topic_label: "Unassigned" },
    ]);
  });
});

describe("ledger robustness", () => {
  it("a replayed recordVideo returns the existing row's id, not a phantom one", () => {
    const { db, topics } = setup();
    const v = { topic_key: "energy", topic_source: "case.topic" as const, title: "t", format: "landscape", path: "renders/a.mp4" };
    const a = topics.recordVideo({ ...v, render_id: "r1" });
    expect(topics.recordVideo({ ...v, render_id: "r1" })).toBe(a);
    const g = topics.recordVideo({ ...v, generation_job_id: "g1", path: "renders/b.mp4" });
    expect(topics.recordVideo({ ...v, generation_job_id: "g1", path: "renders/b.mp4" })).toBe(g);
    expect((db.$client.prepare("select count(*) as n from videos").get() as { n: number }).n).toBe(2);
  });

  it("a record with neither render_id nor generation_job_id has nothing to dedupe on and is always appended", () => {
    const { db, topics } = setup();
    const v = { topic_key: "energy", topic_source: "case.topic" as const, title: "t", format: "landscape", path: "renders/a.mp4" };
    expect(topics.recordVideo(v)).not.toBe(topics.recordVideo(v));
    expect((db.$client.prepare("select count(*) as n from videos").get() as { n: number }).n).toBe(2);
  });

  it("recordRender applies the originating case's topic when case_id is given, else the project's", () => {
    const { db, topics, cases } = setup();
    const c = cases.create({ ...idea, domain: "sports", topic: "motorsport-endurance" });
    db.$client.exec(`insert into projects (id, title, use_case_id, sport, format, mode, status, created_at, topic) values ('p-a','A','u','NBA','landscape','m','rendered','t',null)`);
    const rec = (render_id: string, case_id?: string) => topics.recordRender({ render_id, project_id: "p-a", title: "A", format: "landscape", path: "renders/p-a/v.mp4", created_at: "2026-10-01T00:00:00.000Z", ...(case_id ? { case_id } : {}) });
    rec("r1", c.id);
    rec("r2");
    const rows = db.$client.prepare("select render_id, topic_key, topic_source, case_id from videos order by render_id").all();
    expect(rows).toEqual([
      { render_id: "r1", topic_key: "motorsport-endurance", topic_source: "case.topic", case_id: c.id },
      { render_id: "r2", topic_key: "basketball", topic_source: "project.sport", case_id: null },
    ]);
  });
});

describe("the board skill's case brief and checker stay in step with the seed", () => {
  const skill = path.resolve(__dirname, "../../../.claude/skills/board");
  const pickable = TOPIC_SEED.map((t) => t.key).filter((k) => k !== "unassigned");
  it("lib.mjs CASE_TOPICS equals the seed without the reserved key", async () => {
    const lib = (await import(/* @vite-ignore */ pathToFileURL(path.join(skill, "scripts", "lib.mjs")).href)) as { CASE_TOPICS: string[] };
    expect([...lib.CASE_TOPICS].sort()).toEqual([...pickable].sort());
  });
  it("case-brief.md lists every pickable key and asks for `topic`", () => {
    const md = readFileSync(path.join(skill, "references", "case-brief.md"), "utf8");
    for (const k of pickable) expect(md).toContain(`\`${k}\``);
    expect(md).not.toContain("`unassigned`");
    expect(md).toMatch(/"topic": "music"/);
  });
});
