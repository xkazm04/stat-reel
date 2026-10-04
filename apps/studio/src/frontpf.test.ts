import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  acrossCount,
  clock,
  durationRange,
  heatmapWay,
  laneRotation,
  lanesLabel,
  lineIsQuiet,
  lineItems,
  loadCause,
  numberWord,
  onTheLine,
  registryGrid,
  registryShare,
  sceneStrip,
  splitNeq,
  sportsPhrase,
  studioCounts,
  videosLine,
} from "./frontpf";

describe("frontpf", () => {
  it("counts sources across the line per mode", () => {
    const s = [{ verdict: "legal" }, { verdict: "non_commercial" }, { verdict: "paid" }, { verdict: "avoid" }, { verdict: "legal" }];
    expect(acrossCount(s, "monetized")).toBe(2);
    expect(acrossCount(s, "non_commercial")).toBe(3);
  });
  it("counts the studio from statuses", () => {
    const c = studioCounts([{ status: "published" }, { status: "rendered" }, { status: "idea" }, { status: "scripted" }, { status: "gated" }]);
    expect(c).toEqual({ total: 5, published: 1, refused: 1, gated: 1, notGated: 2 });
    expect(c.published + c.refused + c.gated + c.notGated).toBe(c.total);
  });
  it("groups the registry by sport and verdict", () => {
    const g = registryGrid([
      { id: "a", verdict: "legal", sport: "F1" },
      { id: "b", verdict: "avoid", sport: "F1" },
      { id: "c", verdict: "legal", sport: "all" },
    ]);
    expect(g.map((x) => x.group)).toEqual(["F1", "NBA", "NHL", "Soccer", "all"]);
    expect(g[0]?.total).toBe(2);
    expect(g[0]?.cells.avoid.map((s) => s.id)).toEqual(["b"]);
    expect(g[4]?.cells.legal.map((s) => s.id)).toEqual(["c"]);
  });
  it("moves the registry line with the mode", () => {
    expect(registryShare("monetized")).toBeCloseTo(0.7199, 3);
    expect(registryShare("non_commercial")).toBeCloseTo(0.4398, 3);
  });
  it("splits a hook at the not-equal sign", () => {
    expect(splitNeq("Most wins ≠ most dominant")).toEqual(["Most wins", "most dominant"]);
    expect(splitNeq("Plain")).toEqual(["Plain", null]);
  });
  it("uses measured timing, else an even draft split", () => {
    const scenes = [
      { id: "s1", kind: "hook" },
      { id: "s2", kind: "close" },
    ];
    const m = sceneStrip(scenes, { duration_s: 10, scenes: [{ scene_id: "s1", start_s: 0, end_s: 3 }, { scene_id: "s2", start_s: 3, end_s: 10 }] }, 60);
    expect(m?.measured).toBe(true);
    expect(m?.scenes[1]).toEqual({ id: "s2", label: "close", start: 3, end: 10 });
    const d = sceneStrip(scenes, null, 60);
    expect(d?.measured).toBe(false);
    expect(d?.scenes[1]?.start).toBe(30);
  });
  it("draws no strip and claims no length while the draft duration is unknown (no player yet)", () => {
    const scenes = [{ id: "s1", kind: "hook" }];
    // the player's meta has not arrived (composition loading, or not built): no "0:01 draft length"
    expect(sceneStrip(scenes, null, 0)).toBeNull();
    expect(sceneStrip(scenes, { duration_s: 0, scenes: [] }, 0)).toBeNull();
  });
  it("formats words and the clock", () => {
    expect(numberWord(10)).toBe("Ten");
    expect(numberWord(14)).toBe("14");
    expect(clock(62.5)).toBe("1:02.500");
  });
});

describe("on the line today", () => {
  const topic = (key: string, accepted_cases: number, queued = 0, running = false, videos = 0) => ({
    key,
    label: key.toUpperCase(),
    accepted_cases,
    pending: { queued, running },
    videos: Array.from({ length: videos }, () => ({})),
  });
  it("counts cases, generation, ledger and Board from the real shapes", () => {
    const l = onTheLine(
      [topic("a", 2, 1, true), topic("b", 0, 3), topic("c", 5, 0, false, 2)],
      [{ status: "accepted" }, { status: "pending" }, { status: "pending" }, { status: "rejected" }],
    );
    expect(l).toEqual({
      acceptedCases: 7,
      byTopic: [
        { key: "c", label: "C", accepted: 5 },
        { key: "a", label: "A", accepted: 2 },
      ],
      queued: 4,
      running: 1,
      videos: 2,
      boardAccepted: 1,
      boardPending: 2,
    });
  });
  it("keeps zero rows labelled and links each count to where the owner acts", () => {
    const l = onTheLine([], []);
    expect(lineIsQuiet(l)).toBe(true);
    expect(lineItems(l).map((i) => [i.id, i.to, i.n])).toEqual([
      ["cases", "topics", 0],
      ["generation", "topics", 0],
      ["board-accepted", "board-accepted", 0],
      ["board-pending", "board-pending", 0],
    ]);
  });
  it("shortens the topic detail and pluralises", () => {
    const l = onTheLine([topic("a", 1), topic("b", 1), topic("c", 1), topic("d", 1)], []);
    const cases = lineItems(l)[0];
    expect(cases?.text).toBe("accepted cases");
    expect(cases?.detail).toBe("A 1, B 1, C 1, +1 more");
    expect(lineItems(onTheLine([topic("a", 1)], []))[0]?.text).toBe("accepted case");
  });
  it("says honestly that the ledger is empty", () => {
    expect(videosLine(onTheLine([], []))).toMatch(/^0 videos rendered yet/);
    expect(videosLine(onTheLine([topic("a", 0, 0, false, 1)], []))).toBe("1 video on the ledger");
  });
});

describe("front copy and lane rotation (derived, never hardcoded)", () => {
  it("lanesLabel names the count, or none while loading", () => {
    expect(lanesLabel(10)).toBe("Ten lanes");
    expect(lanesLabel(7)).toBe("Seven lanes");
    expect(lanesLabel(0)).toBe("Lanes");
  });
  it("sportsPhrase lists the sports the registry has, in product order, skipping cross-sport", () => {
    expect(sportsPhrase([{ sport: "Soccer" }, { sport: "F1" }, { sport: "all" }, { sport: "NBA" }, { sport: "NHL" }])).toBe("F1, NBA, NHL and soccer");
    expect(sportsPhrase([{ sport: "F1" }, { sport: "Soccer" }])).toBe("F1 and soccer");
    expect(sportsPhrase([{ sport: "NBA" }])).toBe("NBA");
    expect(sportsPhrase([{ sport: "all" }])).toBe("");
    expect(sportsPhrase([])).toBe("");
  });
  it("durationRange spans the use cases", () => {
    expect(durationRange([])).toBeNull();
    expect(durationRange([{ duration_s: { min: 30, max: 60 } }, { duration_s: { min: 45, max: 90 } }])).toBe("30\u201390 s");
    expect(durationRange([{ duration_s: { min: 30, max: 30 } }])).toBe("30 s");
  });
  const base = { reduced: false, paused: false, hovered: false, focused: false, sceneOpen: false, count: 10 };
  it("laneRotation rotates only when nothing holds it, and is a live region only while still", () => {
    expect(laneRotation(base)).toEqual({ auto: true, control: true, live: "off" });
    for (const hold of [{ paused: true }, { hovered: true }, { focused: true }, { sceneOpen: true }])
      expect(laneRotation({ ...base, ...hold })).toMatchObject({ auto: false, live: "polite" });
  });
  it("laneRotation never rotates under reduced motion or with fewer than two lanes, and then offers no control", () => {
    expect(laneRotation({ ...base, reduced: true })).toEqual({ auto: false, control: false, live: "polite" });
    expect(laneRotation({ ...base, count: 1 })).toEqual({ auto: false, control: false, live: "polite" });
  });
});

describe("front failure copy names the cause it has (async-ui-states/failure-states)", () => {
  it("says the API is offline only when nothing answered", () => {
    expect(loadCause(new TypeError("Failed to fetch"))).toBe("API offline");
    // the dev proxy's own 500 page while the API is down, and a gateway text body
    expect(loadCause(new ApiError(500, null, "GET /api/sources: 500 Internal Server Error"))).toBe("API offline");
    expect(loadCause(new ApiError(502, "Bad Gateway", "GET /api/sources: Bad Gateway"))).toBe("API offline");
  });
  it("an answer from the API is quoted, not called offline", () => {
    expect(loadCause(new ApiError(500, { error: "SQLITE_BUSY: database is locked" }, "GET /api/heatmap: SQLITE_BUSY"))).toBe(
      "the API answered: SQLITE_BUSY: database is locked",
    );
    expect(loadCause(new ApiError(404, { error: "no such project" }, "GET /api/projects/p: no such project"))).toBe(
      "the API answered: no such project",
    );
  });
});

describe("the Front's heatmap way (async-ui-states/failure-states: failure is not empty, empty is not loading)", () => {
  it("tells loading, failure, an empty mode and counts apart", () => {
    expect(heatmapWay({ isLoading: true, isError: false }, 0)).toBe("loading");
    expect(heatmapWay({ isLoading: false, isError: true }, 0)).toBe("error");
    expect(heatmapWay({ isLoading: false, isError: false }, 0)).toBe("empty");
    expect(heatmapWay({ isLoading: false, isError: false }, 40)).toBe("ready");
    // a failed refetch while counts are held keeps the counts (degrade, never destroy)
    expect(heatmapWay({ isLoading: false, isError: true }, 40)).toBe("ready");
  });
});
