import type { HeatmapCell } from "@statreel/schemas";
import { describe, expect, it } from "vitest";
import {
  activeJob,
  bestCells,
  biggestMovers,
  composeDescription,
  fmtDuration,
  fmtValue,
  modeDiff,
  neverFetchedFor,
  parseTags,
  rankSteps,
  resumeCandidate,
  rundownOrder,
  sparkPoints,
  splitName,
  tickerFacts,
  trendSummary,
  verdictCounts,
} from "./onair";

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
  it("orders movers by rank change and rolls ranks step by step", () => {
    const rows = [
      { name: "a", raw_rank: 1, adjusted_rank: 4 },
      { name: "b", raw_rank: 43, adjusted_rank: 1 },
      { name: "c", raw_rank: 2, adjusted_rank: 3 },
    ];
    expect(biggestMovers(rows, 2).map((r) => r.name)).toEqual(["b", "a"]);
    expect(rankSteps(4, 1)).toEqual([4, 3, 2, 1]);
    expect(rankSteps(2, 3)).toEqual([2, 3]);
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
  it("builds the ticker from counts only", () => {
    const cells = [
      cell("u", "F1", "monetized", "go"),
      cell("u", "F1", "non_commercial", "go"),
      cell("u", "NBA", "non_commercial", "data-ready"),
    ];
    const facts = tickerFacts({
      sources,
      capabilities: [{ status: "pass" }, { status: "fail" }],
      cells,
      usecases: 10,
      projects: 1,
    });
    expect(facts).toContain("5 sources on the registry");
    expect(facts).toContain("2 never fetched");
    expect(facts).toContain("1 of 2 capability tests pass");
    expect(facts).toContain("1 of 40 cells go · monetized");
    expect(facts).toContain("1 go · 1 data ready · non-commercial");
    expect(facts).toContain("1 project in the rundown");
    expect(
      tickerFacts({ sources, capabilities: [], cells, usecases: 10, projects: null }).some((f) =>
        f.includes("rundown"),
      ),
    ).toBe(false);
  });
  it("lists never-fetched sources for a cell", () => {
    expect(neverFetchedFor(sources, "F1", ["hist"]).map((s) => s.id)).toEqual(["f1com"]);
    expect(neverFetchedFor(sources, "NBA", ["hist"]).map((s) => s.id)).toEqual(["nbacom"]);
    expect(neverFetchedFor(sources, "NHL", ["hist"])).toEqual([]);
  });
  it("finds cells the mode switch changes and the best cells to make", () => {
    const cells = [
      cell("a", "F1", "monetized", "ask"),
      cell("a", "F1", "non_commercial", "data-ready"),
      cell("b", "F1", "monetized", "go"),
      cell("b", "F1", "non_commercial", "go"),
    ];
    expect([...modeDiff(cells).entries()]).toEqual([["a", ["F1"]]]);
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

describe("publish", () => {
  it("mirrors what the server appends to the description", () => {
    expect(
      composeDescription({
        description: "",
        fallbackTitle: "T",
        methodNote: "Method.",
        attributions: ["Data: F1DB (CC BY 4.0)", null, "Data: F1DB (CC BY 4.0)"],
      }),
    ).toBe("T\n\nMethod.\n\nData: F1DB (CC BY 4.0)\n\nNarration and music are AI-generated (ElevenLabs).");
    expect(parseTags(" F1, data ,, x")).toEqual(["F1", "data", "x"]);
  });
});
