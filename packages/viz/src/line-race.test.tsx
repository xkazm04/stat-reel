import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { LineRace } from "./LineRace";
import { fallbackColor, headAt, lineRaceLayout, type RaceSeries } from "./line-race";
import type { VizTheme } from "./types";

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

// cumulative points over 10 rounds; three contenders finish bunched so their labels must dodge
const cum = (inc: number[]) => {
  let s = 0;
  return inc.map((v, i) => {
    s += v;
    return { t: i + 1, v: s };
  });
};
const series: RaceSeries[] = [
  { id: "ham", label: "HAM", points: cum([25, 18, 25, 25, 18, 15, 25, 18, 25, 18]) },
  { id: "ver", label: "VER", points: cum([18, 25, 15, 18, 25, 25, 18, 25, 15, 25]) },
  { id: "nor", label: "NOR", points: cum([15, 15, 18, 15, 15, 18, 15, 15, 18, 15]) },
  { id: "lec", label: "LEC", points: cum([12, 12, 12, 12, 12, 12, 12, 12, 12, 12]) },
  { id: "late", label: "LATE", points: [{ t: 6, v: 4 }, { t: 10, v: 40 }] },
];
const base = { series, xDomain: [1, 10] as const, yDomain: [0, 300] as const, width: 1000, height: 900 };
const ts = Array.from({ length: 91 }, (_, i) => 1 + i * 0.1);

describe("headAt", () => {
  const pts = [{ t: 1, v: 10 }, { t: 3, v: 30 }];
  it("interpolates linearly, holds past the end, hides before the start", () => {
    expect(headAt(pts, 0.5)).toBeNull();
    expect(headAt(pts, 2)).toEqual({ t: 2, v: 20 });
    expect(headAt(pts, 1)).toEqual({ t: 1, v: 10 });
    expect(headAt(pts, 9)).toEqual({ t: 3, v: 30 });
    expect(headAt([], 1)).toBeNull();
  });
});

describe("lineRaceLayout", () => {
  it("is deterministic", () => {
    expect(lineRaceLayout({ ...base, t: 4.3 })).toEqual(lineRaceLayout({ ...base, t: 4.3 }));
  });

  it("reveals monotonically: path length never decreases as t advances", () => {
    for (const s of series) {
      let prev = -1;
      for (const t of ts) {
        const l = lineRaceLayout({ ...base, t }).series.find((x) => x.id === s.id);
        expect(l?.length).toBeGreaterThanOrEqual(prev);
        prev = l?.length ?? prev;
      }
    }
  });

  it("hides a series before its first sample and shows it from then on", () => {
    expect(lineRaceLayout({ ...base, t: 5.9 }).series.find((s) => s.id === "late")?.visible).toBe(false);
    expect(lineRaceLayout({ ...base, t: 5.9 }).series.find((s) => s.id === "late")?.labelY).toBeNull();
    expect(lineRaceLayout({ ...base, t: 6 }).series.find((s) => s.id === "late")?.visible).toBe(true);
  });

  it("puts the head exactly on the interpolated value, between samples and on them", () => {
    const l = lineRaceLayout({ ...base, t: 3.25 });
    const ham = l.series.find((s) => s.id === "ham");
    const p = series[0]?.points ?? [];
    const v = (p[2]?.v ?? 0) + ((p[3]?.v ?? 0) - (p[2]?.v ?? 0)) * 0.25;
    expect(ham?.head?.v).toBeCloseTo(v, 9);
    const { plot, yDomain } = l;
    const y = plot.bottom + ((v - yDomain[0]) / (yDomain[1] - yDomain[0])) * (plot.top - plot.bottom);
    expect(ham?.head?.y).toBeCloseTo(y, 9);
    expect(ham?.points.at(-1)).toEqual({ x: ham?.head?.x, y: ham?.head?.y });
    // on a sample the head equals the sample and the polyline has no duplicate vertex
    const on = lineRaceLayout({ ...base, t: 4 }).series.find((s) => s.id === "ham");
    expect(on?.head?.v).toBe(p[3]?.v);
    expect(on?.points).toHaveLength(4);
  });

  it("keeps end labels >= minLabelGap apart, inside the plot, in head order", () => {
    for (const t of ts) {
      const l = lineRaceLayout({ ...base, t });
      expect(l.overflow).toBe(false);
      const vis = l.series.filter((s) => s.visible);
      const byHead = [...vis].sort((a, b) => (a.head?.y ?? 0) - (b.head?.y ?? 0) || (a.id < b.id ? -1 : 1));
      for (let i = 0; i < byHead.length; i++) {
        const y = byHead[i]?.labelY as number;
        expect(y).toBeGreaterThanOrEqual(l.plot.top - 1e-6);
        expect(y).toBeLessThanOrEqual(l.plot.bottom + 1e-6);
        if (i > 0) expect(y - (byHead[i - 1]?.labelY as number)).toBeGreaterThanOrEqual(l.minLabelGap - 1e-6);
      }
    }
  });

  it("flags overflow when the labels cannot fit", () => {
    expect(lineRaceLayout({ ...base, t: 10, height: 120 }).overflow).toBe(true);
  });

  it("identifies the leader and ranks by head value", () => {
    const l = lineRaceLayout({ ...base, t: 10 });
    expect(l.leaderId).toBe("ham");
    expect(l.series.filter((s) => s.isLeader).map((s) => s.id)).toEqual(["ham"]);
    expect(l.series.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(lineRaceLayout({ ...base, t: 0 }).leaderId).toBeNull();
    // exact ties resolve by id, not input order
    const tie = [
      { id: "b", label: "B", points: [{ t: 1, v: 5 }] },
      { id: "a", label: "A", points: [{ t: 1, v: 5 }] },
    ];
    expect(lineRaceLayout({ ...base, series: tie, t: 1 }).leaderId).toBe("a");
  });

  it("growOnly: the y domain never shrinks as t advances and covers the data; off = fixed", () => {
    let prevHi = Number.NEGATIVE_INFINITY;
    let prevLo = Number.POSITIVE_INFINITY;
    for (const t of ts) {
      const l = lineRaceLayout({ ...base, yDomain: [0, 50], growOnly: true, t });
      expect(l.yDomain[1]).toBeGreaterThanOrEqual(prevHi);
      expect(l.yDomain[0]).toBeLessThanOrEqual(prevLo);
      prevHi = l.yDomain[1];
      prevLo = l.yDomain[0];
      for (const s of l.series) if (s.head) expect(s.head.v).toBeLessThanOrEqual(l.yDomain[1]);
    }
    expect(prevHi).toBeGreaterThan(50);
    expect(lineRaceLayout({ ...base, yDomain: [0, 50], t: 10 }).yDomain).toEqual([0, 50]);
    // a series that falls back does not pull the domain back down
    const dip = [{ id: "d", label: "D", points: [{ t: 1, v: 10 }, { t: 2, v: 200 }, { t: 3, v: 20 }] }];
    const at = (t: number) => lineRaceLayout({ ...base, series: dip, yDomain: [0, 50], growOnly: true, t }).yDomain[1];
    expect(at(3)).toBe(at(2));
  });

  it("is continuous in t when growing (no step when the domain starts to grow)", () => {
    let prev = lineRaceLayout({ ...base, yDomain: [0, 50], growOnly: true, t: 1 }).yDomain[1];
    for (let t = 1.01; t <= 10; t += 0.01) {
      const hi = lineRaceLayout({ ...base, yDomain: [0, 50], growOnly: true, t }).yDomain[1];
      expect(Math.abs(hi - prev)).toBeLessThan(10);
      prev = hi;
    }
  });

  it("uses a stable fallback colour per id and honours an explicit one", () => {
    const l = lineRaceLayout({ ...base, series: [{ ...(series[0] as RaceSeries), color: "red" }, series[1] as RaceSeries], t: 5 });
    expect(l.series[0]?.color).toBe("red");
    expect(l.series[1]?.color).toBe(fallbackColor("ver"));
    expect(fallbackColor("ver")).toBe(fallbackColor("ver"));
    expect(fallbackColor("ver")).not.toBe(fallbackColor("ham"));
  });

  it("clamps the font to 28 px", () => {
    expect(lineRaceLayout({ ...base, t: 5, fontSize: 12 }).fontSize).toBe(28);
  });
});

describe("LineRace", () => {
  const el = (t: number) => LineRace({ ...base, t, theme, growOnly: true });
  it("renders the same tree for the same inputs", () => {
    expect(JSON.stringify(el(6.5))).toBe(JSON.stringify(el(6.5)));
  });
  it("draws only revealed series, with >= 28 px tabular text", () => {
    expect(walk(el(0)).filter((e) => e.type === "path")).toHaveLength(0);
    const nodes = walk(el(6.5));
    expect(nodes.filter((e) => e.type === "path")).toHaveLength(5);
    expect(walk(el(5)).filter((e) => e.type === "path")).toHaveLength(4);
    const text = nodes.filter((e) => e.type === "text");
    expect(text.length).toBeGreaterThan(5);
    for (const e of text) expect(Number(e.props.fontSize)).toBeGreaterThanOrEqual(28);
    const tspans = nodes.filter((e) => e.type === "tspan");
    expect(tspans.length).toBe(5);
    for (const e of tspans) expect((e.props.style as { fontVariantNumeric: string }).fontVariantNumeric).toBe("tabular-nums");
  });
  it("draws the leader's line last", () => {
    const paths = walk(el(10)).filter((e) => e.type === "path");
    expect(paths.at(-1)?.props.strokeWidth).toBe(6);
  });
});
