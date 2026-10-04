import { describe, expect, it } from "vitest";
import type { TopicVideoCell } from "./topicHeatmap";
import {
  ageLabel,
  cellAria,
  cellTarget,
  clampPos,
  emptyCellLabel,
  gridColCount,
  gridWidth,
  newTabLabel,
  nextPos,
  sortTopics,
  tabIndexFor,
  topicSummary,
  visibleColumns,
} from "./topicHeatmap";

describe("topic heatmap helpers", () => {
  it("ageLabel", () => {
    expect([0, 1, 3, 14, 45, 120, 400].map(ageLabel)).toEqual(["today", "1d", "3d", "2w", "6w", "4mo", "1y"]);
  });
  it("visibleColumns caps at 24 and reports the earlier count", () => {
    expect(visibleColumns(0)).toEqual({ first: 1, last: 1, earlier: 0 });
    expect(visibleColumns(24)).toEqual({ first: 1, last: 24, earlier: 0 });
    expect(visibleColumns(30)).toEqual({ first: 7, last: 30, earlier: 6 });
  });
  it("gridWidth leaves room for the ghost cell of the widest row's queued or rendering video", () => {
    const row = (videos: number, queued = 0, running = false) => ({
      videos: Array.from({ length: videos }, (_, i) => ({ n: i + 1 }) as TopicVideoCell),
      pending: { queued, running },
    });
    // the server's max_videos counts finished videos only (apps/server/src/topics.ts)
    expect(gridWidth(1, [row(1, 1)])).toBe(2);
    expect(gridWidth(2, [row(2, 0, true), row(1)])).toBe(3);
    expect(gridWidth(3, [row(3), row(1, 1)])).toBe(3);
    expect(gridWidth(0, [row(0, 1)])).toBe(1);
    expect(gridWidth(0, [])).toBe(0);
    // with the ghost the widest row's next ordinal is a drawn column
    const cols = visibleColumns(gridWidth(1, [row(1, 1)]));
    expect(cols.last).toBe(2);
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
    const v = {
      n: 2,
      id: "vd-1",
      title: "t",
      created_at: "2026-10-03T10:00:00Z",
      age_days: 3,
      bucket: "fresh" as const,
      case_id: null,
      project_id: null,
      url: null,
    };
    expect(cellAria("Energy", v, 3)).toBe("Energy, video 2 of 3, t, created 3 Oct 2026, 3 days ago");
  });
  it("cellAria reads the video title; a blank title adds nothing", () => {
    const v = {
      n: 1,
      id: "vd-1",
      title: "Solar race",
      created_at: "2026-10-03T10:00:00Z",
      age_days: 0,
      bucket: "fresh" as const,
      case_id: null,
      project_id: null,
      url: null,
    };
    expect(cellAria("Energy", v, 1)).toBe("Energy, video 1 of 1, Solar race, created 3 Oct 2026, today");
    expect(cellAria("Energy", { ...v, title: "  " }, 1)).toBe("Energy, video 1 of 1, created 3 Oct 2026, today");
  });
  it("cellTarget: file, then project, then case, else none", () => {
    const all = { url: "/files/a.mp4", project_id: "p1", case_id: "c1" };
    expect(cellTarget(all)).toEqual({ kind: "file", url: "/files/a.mp4" });
    expect(cellTarget({ ...all, url: null })).toEqual({ kind: "project", projectId: "p1" });
    expect(cellTarget({ url: null, project_id: null, case_id: "c1" })).toEqual({ kind: "case" });
    expect(cellTarget({ url: null, project_id: null, case_id: null })).toEqual({ kind: "none" });
  });
  it("gridColCount counts the overflow column only when it is drawn", () => {
    expect(gridColCount(5, 0)).toBe(6);
    expect(gridColCount(24, 6)).toBe(26);
  });
  it("topicSummary counts topics, videos and accepted cases from the data", () => {
    const v = { n: 1 } as TopicVideoCell;
    expect(
      topicSummary([
        { videos: [], accepted_cases: 2 },
        { videos: [], accepted_cases: 3 },
        { videos: [], accepted_cases: 1 },
      ]),
    ).toBe("3 topics, 0 videos, 6 accepted cases");
    expect(topicSummary([{ videos: [v], accepted_cases: 1 }])).toBe("1 topic, 1 video, 1 accepted case");
  });
  it("announces new-tab links and labels empty cells", () => {
    expect(newTabLabel("Energy, video 1 of 1")).toBe("Energy, video 1 of 1, opens in a new tab");
    expect(emptyCellLabel("Energy", 2, "queued", false)).toBe("Energy, video 2: queued");
    expect(emptyCellLabel("Energy", 1, null, true)).toBe("Energy: no video yet");
    expect(emptyCellLabel("Energy", 3, null, false)).toBe("Energy, video 3: empty");
  });
  it("roving tabindex: one tab stop, arrows reach every cell, edges clamp", () => {
    const cur = { r: 1, c: 2 };
    expect(tabIndexFor(cur, 1, 2)).toBe(0);
    expect(tabIndexFor(cur, 0, 0)).toBe(-1);
    expect(nextPos(cur, "ArrowRight", 3, 5)).toEqual({ r: 1, c: 3 });
    expect(nextPos(cur, "ArrowDown", 3, 5)).toEqual({ r: 2, c: 2 });
    expect(nextPos({ r: 2, c: 4 }, "ArrowDown", 3, 5)).toEqual({ r: 2, c: 4 });
    expect(nextPos(cur, "Home", 3, 5)).toEqual({ r: 1, c: 0 });
    expect(nextPos(cur, "End", 3, 5)).toEqual({ r: 1, c: 4 });
    expect(nextPos(cur, "Enter", 3, 5)).toBeNull();
    expect(nextPos(cur, "ArrowUp", 0, 0)).toBeNull();
    // a stale position after the grid shrank is pulled back inside first
    expect(clampPos({ r: 9, c: 9 }, 3, 5)).toEqual({ r: 2, c: 4 });
    expect(nextPos({ r: 9, c: 9 }, "ArrowLeft", 3, 5)).toEqual({ r: 2, c: 3 });
  });
});
