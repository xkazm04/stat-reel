import type { HeatmapCell } from "@statreel/schemas";
import { describe, expect, it } from "vitest";
import { barEnd, bestSource, byClass, finishShare, GO_END, isShort, LINE, reach } from "./finishline";
import { isTheme, otherTheme, resolveTheme } from "./theme";

describe("theme resolution", () => {
  it("a stored pick wins over the system scheme", () => {
    expect(resolveTheme("photofinish", true)).toBe("photofinish");
    expect(resolveTheme("onair", false)).toBe("onair");
  });
  it("without a pick, dark -> onair and light -> photofinish", () => {
    expect(resolveTheme(null, true)).toBe("onair");
    expect(resolveTheme(null, false)).toBe("photofinish");
    expect(resolveTheme("sepia", false)).toBe("photofinish");
  });
  it("knows its two themes", () => {
    expect(isTheme("onair")).toBe(true);
    expect(isTheme("photofinish")).toBe(true);
    expect(isTheme("dark")).toBe(false);
    expect(otherTheme("onair")).toBe("photofinish");
    expect(otherTheme("photofinish")).toBe("onair");
  });
});

const kind = (best: HeatmapCell["kinds"][number]["best"], sources: HeatmapCell["kinds"][number]["sources"] = []) => ({
  kind: "hist" as const,
  best,
  tested: true,
  sources,
});

describe("finish line geometry", () => {
  it("the weakest required kind decides the reach", () => {
    expect(reach({ kinds: [kind("legal"), kind("non_commercial")] })).toBe(56);
    expect(reach({ kinds: [kind("legal"), kind(null)] })).toBe(0);
    expect(reach({ kinds: [] })).toBe(0);
  });
  it("nothing passes the line without a composition; only Go crosses", () => {
    const cell = { mode: "monetized" as const, kinds: [kind("legal")] };
    expect(barEnd(cell, "data-ready")).toBe(LINE.monetized);
    expect(barEnd(cell, "go")).toBe(GO_END);
    expect(barEnd(cell, "blocked")).toBe(0);
    expect(barEnd({ mode: "non_commercial", kinds: [kind("legal")] }, "data-ready")).toBe(LINE.non_commercial);
    expect(barEnd({ mode: "monetized", kinds: [kind("paid")] }, "ask")).toBe(32);
  });
  it("the line splits the picture by mode", () => {
    expect(finishShare("monetized")).toBeCloseTo(1.7 / 2.7, 4);
    expect(finishShare("non_commercial")).toBeCloseTo(0.7 / 2.7, 4);
  });
  it("best source is the first passing source of the best class", () => {
    expect(
      bestSource(
        kind("legal", [
          { id: "a", license_class: "non_commercial", status: "pass" },
          { id: "b", license_class: "legal", status: "fail" },
          { id: "c", license_class: "legal", status: "pass" },
        ]),
      ),
    ).toBe("c");
    expect(bestSource(kind(null, [{ id: "a", license_class: "legal", status: "declared" }]))).toBeNull();
  });
  it("groups sources into the picture's columns and marks what stops short", () => {
    const g = byClass([
      { id: "a", license_class: "legal" },
      { id: "b", license_class: "paid" },
      { id: "c", license_class: "avoid" },
    ]);
    expect(g.legal.map((s) => s.id)).toEqual(["a"]);
    expect(g.paid.map((s) => s.id)).toEqual(["b"]);
    expect(g.non_commercial).toEqual([]);
    expect(isShort("non_commercial", "monetized")).toBe(true);
    expect(isShort("non_commercial", "non_commercial")).toBe(false);
    expect(isShort("legal", "monetized")).toBe(false);
  });
});
