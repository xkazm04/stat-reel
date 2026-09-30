import type { HeatmapCell } from "@statreel/schemas";
import { describe, expect, it } from "vitest";
import { cellFixes, cellHint, focusKey, gridMove, insetFor, neighbours, parseFocus, sportCounts } from "./heatmap";

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
    // a Go cell needs nothing
    expect(cellFixes([f1Go], f1Go)).toEqual([]);
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
