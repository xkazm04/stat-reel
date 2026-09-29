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
    expect(computeHeatmap({ usecases, sources, capabilities: f1, implemented: new Set() })).toHaveLength(10 * 4 * 2);
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
    const caps = [...f1, cap("F1", "events", "openf1", "non_commercial")];
    const cells = computeHeatmap({ usecases, sources, capabilities: caps, implemented: new Set() });
    expect(cell(cells, "spatial-career-maps", "F1", "monetized").status).toBe("ask");
    expect(cell(cells, "spatial-career-maps", "F1", "non_commercial").status).toBe("data-ready");
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
    expect(cell(cells, "similarity-dna", "Soccer", "non_commercial").status).not.toBe("data-ready");
  });
});
