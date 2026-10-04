import { describe, expect, it } from "vitest";
import { metricsDaily, openDb, projects, publications, renders } from "./db";
import { metricsOverview } from "./metrics";

describe("metrics overview (DESIGN §6.1 screen 6)", () => {
  it("average view duration is the latest measured snapshot, like every other metric (a later unmeasured day is not 'unknown')", () => {
    const db = openDb(":memory:");
    db.insert(projects).values({ id: "p1", title: "T", use_case_id: "era-adjusted-rankings", sport: "F1", format: "vertical", mode: "monetized", status: "published", created_at: "2026-09-30" }).run();
    db.insert(renders).values({ id: "r1", project_id: "p1", job_id: "j", format: "vertical", path: "v.mp4", manifest_path: "m.json", checks_json: "{}", created_at: "2026-09-30" }).run();
    db.insert(publications).values({ id: "pub1", render_id: "r1", platform: "youtube", external_id: "abc", visibility: "private", status: "private", mode: "live" }).run();
    db.insert(metricsDaily).values([
      { publication_id: "pub1", date: "2026-09-29", views: 10, likes: 1, comments: null, shares: null, watch_time_s: 100, avg_view_duration_s: 12, subs_delta: null },
      { publication_id: "pub1", date: "2026-09-30", views: 30, likes: 2, comments: null, shares: null, watch_time_s: null, avg_view_duration_s: null, subs_delta: null },
    ]).run();
    expect(metricsOverview(db).publications[0]).toMatchObject({ views: 30, watch_time_s: 100, avg_view_duration_s: 12 });
  });

  it("lifetime snapshots: total is the latest snapshot, per-day is the difference (not a sum), nulls stay null", () => {
    const db = openDb(":memory:");
    db.insert(projects).values({ id: "p1", title: "T", use_case_id: "era-adjusted-rankings", sport: "F1", format: "vertical", mode: "monetized", status: "published", created_at: "2026-09-30" }).run();
    db.insert(renders).values({ id: "r1", project_id: "p1", job_id: "j", format: "vertical", path: "v.mp4", manifest_path: "m.json", checks_json: "{}", created_at: "2026-09-30" }).run();
    db.insert(publications).values({ id: "pub1", render_id: "r1", platform: "youtube", external_id: "abc", visibility: "private", status: "private", mode: "live" }).run();
    db.insert(metricsDaily).values([
      { publication_id: "pub1", date: "2026-09-29", views: 10, likes: 1, comments: null, shares: null, watch_time_s: 100, avg_view_duration_s: 10, subs_delta: null },
      { publication_id: "pub1", date: "2026-09-30", views: 30, likes: 2, comments: null, shares: null, watch_time_s: 300, avg_view_duration_s: 10, subs_delta: null },
    ]).run();
    const m = metricsOverview(db);
    expect(m.publications).toHaveLength(1);
    expect(m.publications[0]).toMatchObject({ project_id: "p1", platform: "youtube", views: 30, likes: 2, comments: null, mode: "live" });
    // Was views: 40 / [10, 30]: rows are LIFETIME totals (videos.list), so summing 10 + 30 double-counted.
    expect(m.publications[0]!.daily.map((d) => d.views)).toEqual([null, 20]);
    expect(m.publications[0]!.daily.map((d) => d.views_total)).toEqual([10, 30]);
    expect(m.by_use_case).toEqual([{ key: "era-adjusted-rankings", publications: 1, views: 30, measured: 1, unmeasured: 0, lower_bound: false }]);
    expect(m.by_sport).toEqual([{ key: "F1", publications: 1, views: 30, measured: 1, unmeasured: 0, lower_bound: false }]);
  });

  it("a group with an unmeasured (dry) publication is flagged as a lower bound", () => {
    const db = openDb(":memory:");
    db.insert(projects).values({ id: "p1", title: "T", use_case_id: "era-adjusted-rankings", sport: "F1", format: "vertical", mode: "monetized", status: "published", created_at: "2026-09-30" }).run();
    db.insert(renders).values({ id: "r1", project_id: "p1", job_id: "j", format: "vertical", path: "v.mp4", manifest_path: "m.json", checks_json: "{}", created_at: "2026-09-30" }).run();
    db.insert(publications).values([
      { id: "live1", render_id: "r1", platform: "youtube", external_id: "abc", visibility: "private", status: "private", mode: "live" },
      { id: "dry1", render_id: "r1", platform: "youtube", external_id: "dry-1", visibility: "private", status: "private", mode: "dry" },
    ]).run();
    db.insert(metricsDaily).values({ publication_id: "live1", date: "2026-09-30", views: 30, likes: null, comments: null, shares: null, watch_time_s: null, avg_view_duration_s: null, subs_delta: null }).run();
    const m = metricsOverview(db);
    expect(m.by_sport).toEqual([{ key: "F1", publications: 2, views: 30, measured: 1, unmeasured: 1, lower_bound: true }]);
    expect(m.publications.find((p) => p.publication_id === "live1")!.likes).toBeNull();
  });

  it("dry-run publications report that no platform data exists instead of zeros", () => {
    const db = openDb(":memory:");
    db.insert(projects).values({ id: "p1", title: "T", use_case_id: "era-adjusted-rankings", sport: "F1", format: "vertical", mode: "monetized", status: "published", created_at: "2026-09-30" }).run();
    db.insert(renders).values({ id: "r1", project_id: "p1", job_id: "j", format: "vertical", path: "v.mp4", manifest_path: "m.json", checks_json: "{}", created_at: "2026-09-30" }).run();
    db.insert(publications).values({ id: "pub1", render_id: "r1", platform: "youtube", external_id: "dry-1", visibility: "private", status: "private", mode: "dry" }).run();
    const m = metricsOverview(db);
    expect(m.publications[0]).toMatchObject({ views: null, data: "dry-run: nothing was uploaded, so there are no platform metrics" });
  });
});
