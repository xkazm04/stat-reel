import { describe, expect, it } from "vitest";
import { type Capability, computeHeatmap } from "./heatmap";
import { loadRegistry } from "./registry";

const { sources, usecases } = loadRegistry();
const cap = (sport: string, kind: string, source_id: string, license_class: string, status = "pass"): Capability => ({
  sport, kind, source_id, license_class, status, coverage_from: 1950, coverage_to: 2026, rows: 1000, detail: "",
});
const f1 = [cap("F1", "hist", "f1db", "legal"), cap("F1", "bio", "f1db", "legal"), cap("F1", "live", "f1db", "legal")];
const cell = (cells: ReturnType<typeof computeHeatmap>, u: string, s: string, m: string) =>
  cells.find((c) => c.usecase === u && c.sport === s && c.mode === m)!;

describe("heatmap (DESIGN §7)", () => {
  it("covers every use case x sport x mode", () => {
    expect(computeHeatmap({ usecases, sources, capabilities: f1, implemented: new Set() })).toHaveLength(usecases.length * 4 * 2);
  });

  it("F1 x era-adjusted is Go once the composition is implemented and hist passes", () => {
    const cells = computeHeatmap({ usecases, sources, capabilities: f1, implemented: new Set(["EraAdjustedSlope"]) });
    expect(cell(cells, "era-adjusted-rankings", "F1", "monetized").status).toBe("go");
    expect(cell(cells, "era-adjusted-rankings", "F1", "non_commercial").status).toBe("go");
  });

  it("is Data ready when data passes but the composition is not built", () => {
    const cells = computeHeatmap({ usecases, sources, capabilities: f1, implemented: new Set() });
    const c = cell(cells, "era-adjusted-rankings", "F1", "monetized");
    expect(c.status).toBe("data-ready");
    expect(c.reason).toMatch(/composition/);
  });

  it("is Ask when the only passing source is non-commercial in monetized mode", () => {
    const caps = [cap("F1", "hist", "jolpica-f1", "non_commercial")];
    const cells = computeHeatmap({ usecases, sources, capabilities: caps, implemented: new Set() });
    expect(cell(cells, "career-wins-race", "F1", "monetized").status).toBe("ask");
    expect(cell(cells, "career-wins-race", "F1", "non_commercial").status).toBe("data-ready");
  });

  it("is Blocked, saying why, when a kind is declared but never tested", () => {
    const cells = computeHeatmap({ usecases, sources, capabilities: f1, implemented: new Set() });
    const c = cell(cells, "era-adjusted-rankings", "NBA", "monetized");
    expect(c.status).toBe("blocked");
    expect(c.reason).toMatch(/not tested/);
    expect(c.kinds[0]!.tested).toBe(false);
  });

  it("a failing capability blocks and is named", () => {
    const caps = [cap("F1", "hist", "f1db", "legal", "fail")];
    const cells = computeHeatmap({ usecases, sources, capabilities: caps, implemented: new Set(["EraAdjustedSlope"]) });
    const c = cell(cells, "era-adjusted-rankings", "F1", "monetized");
    expect(c.status).toBe("blocked");
    expect(c.reason).toMatch(/failing/);
  });

  it("never counts an avoid source", () => {
    const caps = [cap("Soccer", "hist", "fbref", "avoid")];
    const cells = computeHeatmap({ usecases, sources, capabilities: caps, implemented: new Set() });
    expect(cell(cells, "league-table-race", "Soccer", "non_commercial").status).not.toBe("data-ready");
  });

  it("a sport-specific format is not applicable in other sports, and says so", () => {
    const cells = computeHeatmap({ usecases, sources, capabilities: f1, implemented: new Set() });
    const c = cell(cells, "grid-to-victory", "NBA", "monetized");
    expect(c.status).toBe("blocked");
    expect(c.reason).toMatch(/not applicable.*F1 format/);
    expect(cell(cells, "grid-to-victory", "F1", "monetized").status).toBe("data-ready");
  });

  it("every time-evolution use case declares its data time, chart form and arc", () => {
    for (const u of usecases.filter((x) => x.family === "time-evolution")) {
      expect(u.data_time, u.id).toBeTruthy();
      expect(u.chart_form, u.id).toBeTruthy();
      expect(u.arc, u.id).toBeTruthy();
      expect(u.duration_s.min, u.id).toBeGreaterThanOrEqual(30);
      expect(u.duration_s.max, u.id).toBeLessThanOrEqual(90);
    }
  });
});

describe("heatmap evidence freshness", () => {
  const fresh = { evaluated_at: "2026-10-01T00:00:00", max_staleness_days: 35 };
  const live = (extra: Partial<Capability>): Capability => ({ ...cap("F1", "live", "f1db", "legal"), ...extra });
  const caps = (liveExtra: Partial<Capability>) => [cap("F1", "hist", "f1db", "legal"), cap("F1", "bio", "f1db", "legal"), live(liveExtra)];
  const seasonSoFar = (cells: ReturnType<typeof computeHeatmap>) => cells.find((c) => c.sport === "F1" && c.mode === "monetized" && c.kinds.some((k) => k.kind === "live"))!;

  it("a live pass inside its window still counts", () => {
    const cells = computeHeatmap({ usecases, sources, capabilities: caps(fresh), implemented: new Set(), now: new Date("2026-10-20T00:00:00Z") });
    expect(seasonSoFar(cells).status).not.toBe("blocked");
  });

  it("a live pass evaluated beyond its window is not data-ready and says since when", () => {
    const cells = computeHeatmap({ usecases, sources, capabilities: caps(fresh), implemented: new Set(), now: new Date("2026-12-01T00:00:00Z") });
    const c = seasonSoFar(cells);
    expect(c.status).toBe("blocked");
    expect(c.reason).toContain("evidence stale since 2026-11-05");
    expect(c.kinds.find((k) => k.kind === "live")!.sources[0]!.status).toBe("stale");
  });

  it("capabilities without a window or timestamp are judged as before", () => {
    const cells = computeHeatmap({ usecases, sources, capabilities: caps({}), implemented: new Set(), now: new Date("2030-01-01T00:00:00Z") });
    expect(seasonSoFar(cells).status).not.toBe("blocked");
  });
});
