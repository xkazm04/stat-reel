import { describe, expect, it } from "vitest";
import { emptyMetricsRow, normalizeYouTubeAnalytics, normalizeYouTubeStatistics } from "./metrics";
import { ANALYTICS_METRICS } from "./youtube";

describe("metrics normalization", () => {
  it("maps an Analytics day report to metrics_daily rows", () => {
    const report = {
      columnHeaders: [{ name: "day" }, ...ANALYTICS_METRICS.map((name) => ({ name }))],
      rows: [["2026-09-28", 120, 30, 15, 7, 2, 1, 5, 1]],
    };
    expect(normalizeYouTubeAnalytics("pub-1", report)).toEqual([
      {
        publication_id: "pub-1",
        date: "2026-09-28",
        views: 120,
        watch_time_s: 1800,
        avg_view_duration_s: 15,
        likes: 7,
        comments: 2,
        shares: 1,
        subs_delta: 4,
      },
    ]);
  });

  it("leaves unavailable columns null", () => {
    const rows = normalizeYouTubeAnalytics("p", {
      columnHeaders: [{ name: "day" }, { name: "views" }],
      rows: [["2026-09-28", 3]],
    });
    expect(rows[0]).toEqual({ ...emptyMetricsRow("p", "2026-09-28"), views: 3 });
  });

  it("requires the day dimension", () => {
    expect(() => normalizeYouTubeAnalytics("p", { columnHeaders: [{ name: "views" }] })).toThrow(/day/);
  });

  it("maps Data API statistics with nulls for what it does not expose", () => {
    expect(
      normalizeYouTubeStatistics("p", "2026-09-29", { videoId: "v", viewCount: 10, likeCount: null, commentCount: 0 }),
    ).toEqual({
      ...emptyMetricsRow("p", "2026-09-29"),
      views: 10,
      comments: 0,
    });
  });
});
