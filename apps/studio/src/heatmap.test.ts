import type { HeatmapCell } from "@statreel/schemas";
import { describe, expect, it } from "vitest";
import { blockedBreakdown, blockedCause, blockedLegend, cellFixes, cellHint, focusKey, gridMove, insetFor, neighbours, parseFocus, snapshotAge, sportCounts } from "./heatmap";

const cell = (o: Partial<HeatmapCell> & Pick<HeatmapCell, "usecase" | "sport" | "status">): HeatmapCell => ({
  mode: "monetized",
  reason: "r",
  kinds: [],
  composition_implemented: false,
  ...o,
});

const nbaBlocked = cell({
  usecase: "era",
  sport: "NBA",
  status: "blocked",
  composition_implemented: true,
  kinds: [
    {
      kind: "hist",
      best: null,
      tested: false,
      sources: [
        { id: "balldontlie", license_class: "legal", status: "declared" },
        { id: "nba-api", license_class: "non_commercial", status: "declared" },
      ],
    },
  ],
});
const nhlBlocked = cell({
  usecase: "dist",
  sport: "NBA",
  status: "blocked",
  kinds: [
    { kind: "hist", best: null, tested: false, sources: [] },
    { kind: "bio", best: null, tested: false, sources: [] },
  ],
});
const f1Go = cell({
  usecase: "era",
  sport: "F1",
  status: "go",
  composition_implemented: true,
  kinds: [{ kind: "hist", best: "legal", tested: true, sources: [{ id: "f1db", license_class: "legal", status: "pass" }] }],
});

describe("heatmap helpers", () => {
  it("hints why in three words", () => {
    expect(cellHint(f1Go)).toBe("cleared, built");
    expect(cellHint(nbaBlocked)).toBe("not tested");
    expect(cellHint(cell({ usecase: "x", sport: "F1", status: "blocked", kinds: [{ kind: "hist", best: null, tested: false, sources: [] }] }))).toBe(
      "no source",
    );
  });

  it("names the cause of every blocked cell", () => {
    const k = (o: Partial<HeatmapCell["kinds"][number]>): HeatmapCell["kinds"][number] => ({
      kind: "hist",
      best: null,
      tested: false,
      sources: [],
      ...o,
    });
    const b = (kinds: HeatmapCell["kinds"], o: Partial<HeatmapCell> = {}) =>
      cell({ usecase: "x", sport: "NBA", status: "blocked", kinds, ...o });
    expect(blockedCause(nbaBlocked)).toBe("not-tested");
    expect(blockedCause(b([k({ tested: true, sources: [{ id: "a", license_class: "legal", status: "fail" }] })]))).toBe("failing-test");
    expect(blockedCause(b([k({})]))).toBe("no-source");
    // declared, but only a non-commercial source: monetized can never clear it, non-commercial can
    const nc = [k({ sources: [{ id: "nc", license_class: "non_commercial", status: "declared" }] })];
    expect(blockedCause(b(nc))).toBe("licence");
    expect(blockedCause(b(nc, { mode: "non_commercial" }))).toBe("not-tested");
    // the server's reason wins, even when the kinds look like a plain to-do
    expect(blockedCause(b(nbaBlocked.kinds, { reason: "not applicable: Race is a F1 format" }))).toBe("not-applicable");
    // fallback: no kind lacks a pass (all kinds have best) and nothing else explains it
    expect(blockedCause(b([k({ best: "legal", tested: true })]))).toBe("not-applicable");
    expect(cellHint(b([k({})], { reason: "not applicable: x" }))).toBe("n/a here");
  });

  it("counts blocked causes for the legend, per mode", () => {
    const na = cell({ usecase: "n", sport: "NHL", status: "blocked", reason: "not applicable: x", kinds: [] });
    const other = cell({ usecase: "n", sport: "NHL", status: "blocked", mode: "non_commercial", kinds: [] });
    const counts = blockedBreakdown([nbaBlocked, nhlBlocked, na, other, f1Go], "monetized");
    expect(counts).toMatchObject({ "not-tested": 1, "no-source": 1, "not-applicable": 1, "failing-test": 0 });
    expect(blockedLegend(counts)).toBe("3 blocked · 1 not tested · 1 no source · 1 n/a");
    expect(blockedLegend(blockedBreakdown([f1Go], "monetized"))).toBe("");
  });

  it("parses focus keys against known use cases and sports", () => {
    expect(parseFocus(focusKey("era", "F1"), [{ id: "era" }])).toEqual({ uc: "era", sport: "F1" });
    expect(parseFocus("era|Cricket", [{ id: "era" }])).toBeNull();
    expect(parseFocus("nope|F1", [{ id: "era" }])).toBeNull();
    expect(parseFocus(undefined, [{ id: "era" }])).toBeNull();
  });

  it("moves in the grid and clamps at the edges", () => {
    expect(gridMove(0, 0, "ArrowRight", 4, 10)).toEqual([0, 1]);
    expect(gridMove(0, 0, "ArrowLeft", 4, 10)).toEqual([0, 0]);
    expect(gridMove(3, 2, "ArrowDown", 4, 10)).toEqual([3, 2]);
    expect(gridMove(1, 5, "End", 4, 10)).toEqual([1, 9]);
    expect(gridMove(1, 5, "Home", 4, 10)).toEqual([1, 0]);
    expect(gridMove(1, 5, "Enter", 4, 10)).toBeNull();
  });

  it("counts per sport and mode", () => {
    expect(sportCounts([nbaBlocked, nhlBlocked, f1Go], "monetized", "NBA")).toEqual({ go: 0, "data-ready": 0, ask: 0, blocked: 2 });
  });

  it("names the fix for a cell: failing kinds, legal candidates, grid-wide flips", () => {
    const fixes = cellFixes([nbaBlocked, nhlBlocked, f1Go], nbaBlocked);
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({ kind: "hist", flipsThisCell: true, becomes: "go", flipsInGrid: 1 });
    expect(fixes[0]?.candidates).toEqual([{ id: "balldontlie", status: "declared", action: "test it" }]);
    // two failing kinds: neither alone flips the cell
    expect(cellFixes([nbaBlocked, nhlBlocked], nhlBlocked).every((f) => !f.flipsThisCell)).toBe(true);
    // mode-aware candidates: a non-commercial source clears non_commercial mode only
    const ncOf = (mode: "monetized" | "non_commercial") => ({ ...nbaBlocked, mode });
    expect(cellFixes([ncOf("monetized")], ncOf("monetized"))[0]?.candidates.map((c) => c.id)).toEqual(["balldontlie"]);
    expect(cellFixes([ncOf("non_commercial")], ncOf("non_commercial"))[0]?.candidates.map((c) => c.id)).toEqual([
      "balldontlie",
      "nba-api",
    ]);
    // a Go cell needs nothing
    expect(cellFixes([f1Go], f1Go)).toEqual([]);
  });

  it("states the snapshot age from the newest trend entry", () => {
    const now = Date.parse("2026-10-03T12:00:00Z");
    expect(snapshotAge([{ at: "2026-10-03T01:00:00Z" }, { at: "2026-10-03T09:00:00Z" }], now)).toBe("snapshot 3 h ago");
    expect(snapshotAge([], now)).toBe("no snapshot yet");
  });

  it("lists neighbours without the cell itself", () => {
    const n = neighbours([nbaBlocked, nhlBlocked, f1Go], nbaBlocked, () => 1, 4);
    expect(n.map((c) => `${c.usecase}|${c.sport}`)).toEqual(["era|F1", "dist|NBA"]);
  });

  it("builds an inset clip for a rect inside a box", () => {
    expect(insetFor({ top: 100, left: 50, right: 150, bottom: 140 }, { top: 56, left: 0, width: 1000, height: 700 })).toBe(
      "inset(44.0px 850.0px 616.0px 50.0px)",
    );
  });
});
