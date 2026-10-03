import type { HeatmapCell } from "@statreel/schemas";
import { describe, expect, it } from "vitest";
import {
  activeJob,
  bestCells,
  biggestMovers,
  effectiveIntervalS,
  filterByVerdict,
  fmtCoverage,
  fmtPublishedRate,
  fmtDuration,
  fmtValue,
  neverFetchedFor,
  rateFacts,
  safeHttpUrl,
  resumeCandidate,
  rundownOrder,
  sparkPoints,
  splitName,
  termsReview,
  trendSummary,
  verdictCounts,
} from "./display";

const cell = (
  usecase: string,
  sport: HeatmapCell["sport"],
  mode: HeatmapCell["mode"],
  status: HeatmapCell["status"],
): HeatmapCell => ({ usecase, sport, mode, status, reason: "r", kinds: [], composition_implemented: false });

describe("names and figures", () => {
  it("splits a name over two lines", () => {
    expect(splitName("Era-adjusted rankings")).toEqual(["Era-adjusted", "rankings"]);
    expect(splitName("Metric explainer shorts")).toEqual(["Metric explainer", "shorts"]);
    expect(splitName("Similarity")).toEqual(["Similarity", ""]);
  });
  it("formats values without inventing precision", () => {
    expect(fmtValue(3452.5)).toBe("3,452.5");
    expect(fmtValue(17.118)).toBe("17.12");
    expect(fmtValue(0.4706)).toBe("0.471");
    expect(fmtValue(43)).toBe("43");
    expect(fmtValue(null)).toBe("—");
    expect(fmtDuration(65.28)).toBe("1:05");
    expect(fmtDuration(null)).toBe("—");
  });
  it("orders movers by rank change", () => {
    const rows = [
      { name: "a", raw_rank: 1, adjusted_rank: 4 },
      { name: "b", raw_rank: 43, adjusted_rank: 1 },
      { name: "c", raw_rank: 2, adjusted_rank: 3 },
    ];
    expect(biggestMovers(rows, 2).map((r) => r.name)).toEqual(["b", "a"]);
  });
});

describe("rights desk", () => {
  const sources = [
    { id: "f1db", verdict: "legal", sport: "F1", kinds: ["hist", "bio"] },
    { id: "jolpica", verdict: "non_commercial", sport: "F1", kinds: ["hist"] },
    { id: "f1com", verdict: "avoid", sport: "F1", kinds: [] as string[] },
    { id: "nbacom", verdict: "avoid", sport: "NBA", kinds: ["hist"] },
    { id: "sr", verdict: "paid", sport: "all", kinds: ["track"] },
  ];
  it("counts verdicts", () => {
    expect(verdictCounts(sources)).toEqual({ legal: 1, non_commercial: 1, paid: 1, avoid: 2 });
  });
  it("lists never-fetched sources for a cell", () => {
    expect(neverFetchedFor(sources, "F1", ["hist"]).map((s) => s.id)).toEqual(["f1com"]);
    expect(neverFetchedFor(sources, "NBA", ["hist"]).map((s) => s.id)).toEqual(["nbacom"]);
    expect(neverFetchedFor(sources, "NHL", ["hist"])).toEqual([]);
  });
  it("picks the best cells to make", () => {
    const cells = [
      cell("a", "F1", "monetized", "ask"),
      cell("a", "F1", "non_commercial", "data-ready"),
      cell("b", "F1", "monetized", "go"),
      cell("b", "F1", "non_commercial", "go"),
    ];
    expect(bestCells(cells, "monetized", () => 1).map((c) => c.usecase)).toEqual(["b", "a"]);
  });
  it("summarises a GO trend honestly", () => {
    expect(trendSummary([])).toEqual({ now: 0, delta: null, snapshots: 0 });
    expect(trendSummary([1])).toEqual({ now: 1, delta: null, snapshots: 1 });
    expect(trendSummary([0, 1, 2])).toEqual({ now: 2, delta: 2, snapshots: 3 });
  });
});

describe("charts and rundown", () => {
  it("draws a sparkline only from numbers", () => {
    expect(sparkPoints([null, null], 100, 20)).toBeNull();
    expect(sparkPoints([0, 10], 100, 20)).toBe("0.0,17.0 100.0,3.0");
    expect(sparkPoints([5], 100, 20)).toBe("50.0,3.0");
  });
  it("orders the rundown by needs-you, sinking published", () => {
    const p = (id: string, status: string, created_at: string, jobs: { kind: string; status: string }[] = []) => ({
      id,
      status,
      created_at,
      jobs,
    });
    const order = rundownOrder([
      p("pub", "published", "2026-09-30"),
      p("wait", "scripted", "2026-09-29", [{ kind: "render", status: "running" }]),
      p("you", "gated", "2026-09-28"),
      p("idea", "idea", "2026-09-27"),
    ]).map((x) => x.id);
    expect(order).toEqual(["you", "idea", "wait", "pub"]);
  });
  it("picks the newest unpublished project and the active job", () => {
    const projects = [
      { status: "published", created_at: "2026-09-30" },
      { status: "scripted", created_at: "2026-09-29" },
      { status: "idea", created_at: "2026-09-28" },
    ];
    expect(resumeCandidate(projects)?.status).toBe("scripted");
    expect(resumeCandidate([{ status: "published", created_at: "x" }])).toBeNull();
    expect(
      activeJob([
        { status: "succeeded", created_at: "2" },
        { status: "running", created_at: "1" },
      ])?.created_at,
    ).toBe("1");
    expect(activeJob([{ status: "failed", created_at: "1" }])).toBeNull();
  });
});

describe("sources ethics facts", () => {
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`);
  it("shows the published limit and the client's half rate", () => {
    expect(rateFacts({ requests: 60, per_s: 3600 })).toEqual({
      published: "60 / hour",
      effective: "1 request / 120 s (<= 50 % of published)",
      isDefault: false,
    });
    expect(fmtPublishedRate({ requests: 30, per_s: 60, burst_per_s: 3 })).toBe("30 / min, burst 3 / s");
    expect(fmtPublishedRate({ requests: 5, per_s: 7 })).toBe("5 / 7 s");
  });
  it("lets a burst limit slow the client when it is the slower one", () => {
    // 30/min = 2 s, burst 3/s = 0.33 s -> 2 s / 0.5 = 4 s
    expect(effectiveIntervalS({ requests: 30, per_s: 60, burst_per_s: 3 })).toBe(4);
    expect(effectiveIntervalS({ requests: 500, per_s: 3600, burst_per_s: 4 })).toBeCloseTo(14.4);
    expect(effectiveIntervalS({ requests: 1, per_s: 1, burst_per_s: 0.1 })).toBe(20);
  });
  it("falls back to the documented default when no limit is published", () => {
    expect(rateFacts(null)).toEqual({ published: "none published", effective: "1 request / 3 s (default)", isDefault: true });
    expect(effectiveIntervalS(undefined)).toBe(3);
  });
  it("flags terms older than 180 days, strictly like the ingest lint", () => {
    expect(termsReview("2026-04-07", day("2026-10-04"))).toEqual({ days: 180, due: false });
    expect(termsReview("2026-04-06", day("2026-10-04"))).toEqual({ days: 181, due: true });
    expect(termsReview("2026-09-29T00:00:00.000Z", day("2026-10-04"))).toEqual({ days: 5, due: false });
    expect(termsReview(undefined)).toBeNull();
    expect(termsReview("soon")).toBeNull();
  });
  it("formats coverage and keeps only the missing ones null", () => {
    expect(fmtCoverage({ from: 1950, to: "current" })).toBe("1950–now");
    expect(fmtCoverage({ from: 1950, to: 2025 })).toBe("1950–2025");
    expect(fmtCoverage(null)).toBeNull();
    expect(fmtCoverage({})).toBeNull();
  });
  it("filters by verdict and only links http(s) terms", () => {
    const rows = [{ verdict: "legal" }, { verdict: "avoid" }, { verdict: "legal" }];
    expect(filterByVerdict(rows, "all")).toHaveLength(3);
    expect(filterByVerdict(rows, "avoid")).toHaveLength(1);
    expect(safeHttpUrl("https://a.example/t")).toBe("https://a.example/t");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });
});
