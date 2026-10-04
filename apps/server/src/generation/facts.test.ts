import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paths as appPaths } from "../config";
import { Warehouse } from "../warehouse";
import { textFigureProblems } from "./facts";
import { F1_DRIVERS, F1_SEASONS, seasonFactKey } from "./fixture-rows";

describe("textFigureProblems (the project pipeline's rounding and sign rules)", () => {
  it("accepts a rounded figure and ignores a year", () => {
    expect(textFigureProblems("e", "17.1 s in 2014", "k#v", 17.118)).toEqual([]);
    expect(textFigureProblems("e", "13 wins in 2004", "k#wins", 13)).toEqual([]);
    expect(textFigureProblems("e", "1,200 points", "k#p", 1200)).toEqual([]);
  });
  it("a text without a figure shows nothing to check", () => {
    expect(textFigureProblems("e", "Two catalogues become one", "k#c", 2)).toEqual([]);
  });
  it("refuses a changed figure and a flipped sign", () => {
    expect(textFigureProblems("e", "14 wins", "k#wins", 13)).toHaveLength(1);
    expect(textFigureProblems("e", "+5 places", "k#d", -5)).toHaveLength(1);
    expect(textFigureProblems("e", "−5 places", "k#d", -5)).toEqual([]);
  });
  it("refuses a second figure that no fact backs", () => {
    expect(textFigureProblems("e", "13 wins, 40 podiums", "k#wins", 13)).toHaveLength(1);
  });
});

/** The committed snapshot is real: when the local warehouse exists, every figure matches it (skipped in CI). */
describe.runIf(existsSync(appPaths.warehouse))("fixture-rows snapshot vs the live warehouse", () => {
  it("every row resolves to the snapshotted figure", async () => {
    const wh = await Warehouse.open(appPaths.warehouse);
    const want = new Map<string, number>();
    for (const d of F1_DRIVERS)
      F1_SEASONS.forEach((s, i) => {
        if (d.points[i] !== null) want.set(`${seasonFactKey(d.id, s)}#points_current_system`, d.points[i] as number);
        if (d.wins[i] !== null) want.set(`${seasonFactKey(d.id, s)}#wins`, d.wins[i] as number);
      });
    const got = await wh.facts([...want.keys()]);
    expect(got.size).toBe(want.size);
    for (const [k, v] of want) expect(Number(got.get(k)), k).toBe(v);
  });
});
