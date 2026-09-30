import { describe, expect, it } from "vitest";
import { metricsDaily, openDb, projects, publications, renders } from "./db";
import { metricsOverview } from "./metrics";

describe("metrics overview (DESIGN §6.1 screen 6)", () => {
  it("joins publications to projects and aggregates per use case and sport, nulls stay null", () => {
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
    expect(m.publications[0]).toMatchObject({ project_id: "p1", platform: "youtube", views: 40, likes: 3, comments: null, mode: "live" });
    expect(m.publications[0]!.daily.map((d) => d.views)).toEqual([10, 30]);
    expect(m.by_use_case).toEqual([{ key: "era-adjusted-rankings", publications: 1, views: 40 }]);
    expect(m.by_sport).toEqual([{ key: "F1", publications: 1, views: 40 }]);
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
