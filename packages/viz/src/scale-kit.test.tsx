import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { DataClock, dataClockLabel } from "./DataClock";
import { scaleLinear } from "./scales";
import { declaredDomain, parseTime, scaleTime, yearTicks } from "./time-scale";
import { niceStep, niceTicks } from "./ticks";
import { TABULAR, type VizTheme } from "./types";

const theme: VizTheme = {
  background: "#000",
  surface: "#111",
  grid: "#222",
  ink: "#fff",
  inkDim: "#ccc",
  inkFaint: "#888",
  accent: "#f80",
  accentInk: "#000",
  fonts: { display: "D", ui: "U", data: "N" },
};

type El = { type: unknown; props: Record<string, unknown> & { children?: ReactNode } };
function walk(node: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(node)) for (const n of node) walk(n, out);
  else if (isValidElement(node)) {
    out.push(node as El);
    walk((node as El).props.children, out);
  }
  return out;
}

describe("niceTicks", () => {
  it("uses 1/2/2.5/5 x 10^n steps", () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(0, 10, 4)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(3, 97, 5)).toEqual([20, 40, 60, 80]);
  });
  it("handles negatives and ranges crossing zero without -0", () => {
    expect(niceTicks(-50, 50, 4)).toEqual([-50, -25, 0, 25, 50]);
    expect(niceTicks(-100, -20, 4)).toEqual([-100, -80, -60, -40, -20]);
    expect(Object.is(niceTicks(-1, 1, 2)[1], 0)).toBe(true);
  });
  it("handles tiny ranges without float noise", () => {
    expect(niceTicks(0, 0.3, 3)).toEqual([0, 0.1, 0.2, 0.3]);
    expect(niceTicks(1e-9, 3e-9, 2)).toEqual([1e-9, 2e-9, 3e-9]);
  });
  it("edge cases: zero-width, reversed, empty, non-finite", () => {
    expect(niceTicks(0, 0)).toEqual([0]);
    expect(niceTicks(7, 7)).toEqual([7]);
    expect(niceTicks(100, 0, 5)).toEqual(niceTicks(0, 100, 5));
    expect(niceTicks(Number.NaN, 5)).toEqual([]);
    expect(niceTicks(0, Number.POSITIVE_INFINITY)).toEqual([]);
    expect(niceStep(0, 5)).toBe(0);
  });
  it("is deterministic and bounded by count + 1", () => {
    for (const [a, b, n] of [[0, 137, 6], [-3.3, 8.1, 5], [1000, 1011, 3], [0, 1e6, 4]] as const) {
      const t = niceTicks(a, b, n);
      expect(t).toEqual(niceTicks(a, b, n));
      expect(t.length).toBeLessThanOrEqual(n + 1);
      expect(t.every((x) => x >= a && x <= b)).toBe(true);
    }
  });
});

describe("scaleLinear", () => {
  it("is backwards compatible: unclamped, extrapolates", () => {
    const s = scaleLinear([0, 10], [0, 100]);
    expect(s(5)).toBe(50);
    expect(s(20)).toBe(200);
    expect(s.domain).toEqual([0, 10]);
  });
  it("clamps when asked, including inverted ranges", () => {
    const s = scaleLinear([0, 10], [100, 0], { clamp: true });
    expect(s(-5)).toBe(100);
    expect(s(99)).toBe(0);
    expect(s(5)).toBe(50);
  });
  it("inverts, and round-trips", () => {
    const s = scaleLinear([2, 12], [40, 540]);
    expect(s.invert(290)).toBe(7);
    for (const x of [2, 3.7, 12]) expect(s.invert(s(x))).toBeCloseTo(x, 9);
    expect(scaleLinear([0, 10], [0, 100], { clamp: true }).invert(500)).toBe(10);
    expect(scaleLinear([3, 9], [5, 5]).invert(5)).toBe(3);
  });
});

describe("time scale", () => {
  it("parses years and ISO dates to fractional years", () => {
    expect(parseTime(1988)).toBe(1988);
    expect(parseTime("1988")).toBe(1988);
    expect(parseTime("2024-01-01")).toBe(2024);
    expect(parseTime("2024-07-01")).toBeCloseTo(2024 + 182 / 366, 9);
    expect(parseTime("2023-03-01")).toBeCloseTo(2023 + 59 / 365, 9);
    expect(parseTime("2024-03-01")).toBeCloseTo(2024 + 60 / 366, 9);
    expect(parseTime("nope")).toBeNaN();
    expect(parseTime("2024-13-01")).toBeNaN();
  });
  it("refuses a day the month does not have instead of rolling into the next month", () => {
    expect(parseTime("2023-02-29")).toBeNaN();
    expect(parseTime("2023-02-31")).toBeNaN();
    expect(parseTime("2023-04-31")).toBeNaN();
    expect(parseTime("2024-02-29")).toBeCloseTo(2024 + 59 / 366, 9);
    expect(parseTime("2023-12-31")).toBeCloseTo(2023 + 364 / 365, 9);
  });
  it("maps seasons and dates to px, with invert", () => {
    const s = scaleTime([1950, 2020], [0, 700]);
    expect(s(1950)).toBe(0);
    expect(s(1985)).toBe(350);
    expect(s("1985-01-01")).toBe(350);
    expect(s.invert(350)).toBe(1985);
    expect(s(2100)).toBeGreaterThan(700);
    expect(scaleTime([1950, 2020], [0, 700], { clamp: true })(2100)).toBe(700);
  });
  it("ticks by decade for long spans and by year for short ones", () => {
    expect(scaleTime([1950, 2020], [0, 700]).ticks(8).map((t) => t.label)).toEqual([
      "1950", "1960", "1970", "1980", "1990", "2000", "2010", "2020",
    ]);
    expect(yearTicks(2019, 2024, 6).map((t) => t.value)).toEqual([2019, 2020, 2021, 2022, 2023, 2024]);
    expect(yearTicks(1951, 1989, 2).map((t) => t.value)).toEqual([1960, 1980]);
    expect(yearTicks(1900, 2000, 3).map((t) => t.value)).toEqual([1900, 1950, 2000]);
    expect(yearTicks(Number.NaN, 2000)).toEqual([]);
  });
});

describe("declaredDomain", () => {
  it("takes the declared domain verbatim, from a tuple or {min,max}", () => {
    expect(declaredDomain([0, 93])).toEqual([0, 93]);
    expect(declaredDomain({ min: 10, max: 20 })).toEqual([10, 20]);
  });
  it("nice widens to tick multiples", () => {
    expect(declaredDomain([0, 93], { nice: true, count: 5 })).toEqual([0, 100]);
    expect(declaredDomain([3, 97], { nice: true, count: 5 })).toEqual([0, 100]);
  });
  it("nice keeps an end that is already a tick multiple, and returns tidy numbers (same tolerance as niceTicks)", () => {
    expect(declaredDomain([0, 0.07], { nice: true, count: 8 })).toEqual([0, 0.07]);
    expect(declaredDomain([0, 0.14], { nice: true, count: 8 })).toEqual([0, 0.14]);
    expect(declaredDomain([0.1, 1.1], { nice: true, count: 5 })).toEqual([0, 1.2]);
    expect(declaredDomain([0, 0.7], { nice: true, count: 7 })).toEqual([0, 0.7]);
  });
  it("refuses a missing or degenerate declaration instead of falling back to the sample", () => {
    expect(() => declaredDomain(undefined)).toThrow(/declared/);
    expect(() => declaredDomain([5, 5])).toThrow();
    expect(() => declaredDomain([0, Number.NaN])).toThrow();
  });
});

describe("DataClock", () => {
  const props = { value: 1988.4, domain: [1950, 2020] as const, width: 400, theme };
  it("labels the whole season, with an optional prefix, clamped into the domain", () => {
    expect(dataClockLabel(props)).toBe("1988");
    expect(dataClockLabel({ ...props, prefix: "R12", value: 2024.2, domain: [2020, 2024] })).toBe("R12 · 2024");
    expect(dataClockLabel({ ...props, value: 1900 })).toBe("1950");
  });
  it("renders >= 28 px tabular text, even when asked for less", () => {
    for (const fontSize of [undefined, 12]) {
      const text = walk(DataClock({ ...props, fontSize })).filter((e) => e.type === "text");
      expect(text).toHaveLength(1);
      expect(Number(text[0]?.props.fontSize)).toBeGreaterThanOrEqual(28);
      expect(text[0]?.props.style).toBe(TABULAR);
    }
  });
  it("progress bar tracks position in the declared range and can be hidden", () => {
    const rects = (p: number) => walk(DataClock({ ...props, value: p })).filter((e) => e.type === "rect");
    expect(Number(rects(1950)[1]?.props.width)).toBe(0);
    expect(Number(rects(1985)[1]?.props.width)).toBe(200);
    expect(Number(rects(3000)[1]?.props.width)).toBe(400);
    expect(walk(DataClock({ ...props, progress: false })).filter((e) => e.type === "rect")).toHaveLength(0);
  });
  it("is a pure function of its props", () => {
    expect(JSON.stringify(DataClock(props))).toBe(JSON.stringify(DataClock(props)));
  });
});
