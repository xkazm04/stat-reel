import { describe, expect, it } from "vitest";
import { ageLabel, bucketOf, cellAria, sortTopics, visibleColumns } from "./topicHeatmap";

describe("topic heatmap helpers", () => {
  it("bucketOf: boundaries at 7/8, 30/31 and 90/91 days", () => {
    expect([0, 7, 8, 30, 31, 90, 91, 400].map(bucketOf)).toEqual(["fresh", "fresh", "recent", "recent", "cooling", "cooling", "cold", "cold"]);
  });
  it("ageLabel", () => {
    expect([0, 1, 3, 14, 45, 120, 400].map(ageLabel)).toEqual(["today", "1d", "3d", "2w", "6w", "4mo", "1y"]);
  });
  it("visibleColumns caps at 24 and reports the earlier count", () => {
    expect(visibleColumns(0)).toEqual({ first: 1, last: 1, earlier: 0 });
    expect(visibleColumns(24)).toEqual({ first: 1, last: 24, earlier: 0 });
    expect(visibleColumns(30)).toEqual({ first: 7, last: 30, earlier: 6 });
  });
  it("sortTopics: newest video first, empty rows last, then by label", () => {
    const rows = [
      { label: "Boxing", last_at: null },
      { label: "Energy", last_at: "2026-10-01T00:00:00Z" },
      { label: "Golf", last_at: "2026-10-03T00:00:00Z" },
      { label: "Athletics", last_at: null },
    ];
    expect(sortTopics(rows).map((r) => r.label)).toEqual(["Golf", "Energy", "Athletics", "Boxing"]);
  });
  it("cellAria names topic, ordinal, date and age", () => {
    const v = { n: 2, id: "vd-1", title: "t", created_at: "2026-10-03T10:00:00Z", age_days: 3, bucket: "fresh" as const, case_id: null, project_id: null, url: null };
    expect(cellAria("Energy", v, 3)).toBe("Energy, video 2 of 3, created 3 Oct 2026, 3 days ago");
  });
});
