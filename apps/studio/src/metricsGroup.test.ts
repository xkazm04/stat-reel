import { describe, expect, it } from "vitest";
import { groupFigure } from "./metricsGroup";

const g = (over: Partial<Parameters<typeof groupFigure>[0]>) => ({
  publications: 1,
  views: 0,
  measured: 1,
  unmeasured: 0,
  lower_bound: false,
  ...over,
});

describe("groupFigure (unmeasurable is not zero)", () => {
  it("a fully measured group is exact", () => {
    expect(groupFigure(g({ publications: 3, views: 1200, measured: 3 }))).toEqual({
      kind: "exact",
      value: "1,200",
      detail: "3 publications",
      summary: "1,200 views",
    });
  });

  it("a mixed group is a lower bound that says how much was measured", () => {
    const f = groupFigure(g({ publications: 3, views: 1200, measured: 2, unmeasured: 1, lower_bound: true }));
    expect(f.kind).toBe("lower_bound");
    expect(f.value).toBe("at least 1,200");
    expect(f.summary).toBe("at least 1,200 views · 2 of 3 measured");
    expect(f.detail).toBe("3 publications · 2 of 3 measured");
  });

  it("a fully unmeasured group has no number, keeps its label, and is never 0", () => {
    const f = groupFigure(g({ publications: 1, views: null, measured: 0, unmeasured: 1, lower_bound: true }));
    expect(f).toEqual({
      kind: "unmeasured",
      value: "—",
      detail: "1 publication · no platform numbers",
      summary: "no platform numbers",
    });
  });

  it("a measured zero is a real zero, not a lower bound of nothing", () => {
    expect(groupFigure(g({ views: 0, measured: 1 })).value).toBe("0");
  });

  it("trusts the counts if lower_bound is missing from an older server", () => {
    expect(groupFigure(g({ publications: 2, views: 5, measured: 1, unmeasured: 1, lower_bound: false })).kind).toBe(
      "lower_bound",
    );
  });
});
