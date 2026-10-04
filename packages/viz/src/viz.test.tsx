import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  Callout,
  dodge,
  easeInOutCubic,
  easeOutCubic,
  interpolate,
  lineProgress,
  ordinal,
  rollingDigits,
  Slopegraph,
  type SlopeRow,
  scaleLinear,
  scaleRank,
  seededRandom,
  slopegraphLayout,
  springEase,
  stagger,
  wrapText,
} from "./index";

const theme = {
  background: "#0D0F0F",
  surface: "#151919",
  grid: "#232929",
  ink: "#EAF2EE",
  inkDim: "#93A29D",
  inkFaint: "#5E6B67",
  accent: "#FF5B1F",
  accentInk: "#FF7A45",
  fonts: { display: "Barlow Condensed", ui: "Inter", data: "JetBrains Mono" },
};

const NAMES = [
  "Juan Manuel Fangio",
  "Alberto Ascari",
  "Max Verstappen",
  "Lewis Hamilton",
  "Michael Schumacher",
  "Ayrton Senna",
  "Jim Clark",
  "Alain Prost",
  "Jackie Stewart",
  "Sebastian Vettel",
  "Niki Lauda",
  "Kimi Räikkönen",
];
const RAW = [43, 73, 2, 1, 10, 22, 30, 5, 18, 3, 25, 6];
const ADJ = [1, 2, 3, 4, 6, 8, 5, 7, 9, 10, 12, 11];
const rows12: SlopeRow[] = NAMES.map((name, i) => ({
  id: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  left: RAW[i] as number,
  right: ADJ[i] as number,
}));

// the vertical chart zone the composition uses (885 x 600 inside the 1080x1920 safe box). Height is
// 600, not 580: the owner rule "every readable text >= 28 px" raised the subtitle to 28 px (39c7943),
// growing the header ~9 px, and 12 rows at the 44 px minimum gap no longer fit in 580.
const zone = { width: 885, height: 600, format: "vertical" as const };
const titles = { left: "As awarded", right: "Era-adjusted", leftSub: "Career points", rightSub: "Points per start" };

type El = { type: unknown; props: Record<string, unknown> & { children?: ReactNode } };
function walk(node: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(node)) for (const n of node) walk(n, out);
  else if (isValidElement(node)) {
    out.push(node as El);
    walk((node as El).props.children, out);
  }
  return out;
}
function textOf(node: ReactNode | El): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node) || (typeof node === "object" && node !== null && "props" in node))
    return textOf((node as El).props.children);
  return "";
}

describe("scales and easing", () => {
  it("interpolate clamps by default and maps linearly", () => {
    expect(interpolate(5, [0, 10], [0, 100])).toBe(50);
    expect(interpolate(-5, [0, 10], [0, 100])).toBe(0);
    expect(interpolate(15, [0, 10], [0, 100])).toBe(100);
    expect(interpolate(15, [0, 10], [0, 100], { clamp: false })).toBe(150);
    expect(interpolate(5, [0, 10], [0, 1], { easing: easeOutCubic })).toBeCloseTo(0.875);
  });
  it("easings hit their end points", () => {
    for (const e of [easeOutCubic, easeInOutCubic, springEase()]) {
      expect(e(0)).toBe(0);
      expect(e(1)).toBe(1);
    }
    // a spring overshoots somewhere before settling
    const s = springEase({ damping: 0.4, bounces: 2 });
    expect(Math.max(...Array.from({ length: 100 }, (_, i) => s(i / 100)))).toBeGreaterThan(1);
  });
  it("linear and rank scales", () => {
    const s = scaleLinear([0, 10], [100, 200]);
    expect(s(5)).toBe(150);
    const r = scaleRank(5, [0, 400]);
    expect([0, 1, 4].map(r)).toEqual([0, 100, 400]);
    expect(scaleRank(3, [0, 400], { maxStep: 50 })(2)).toBe(100);
  });
  it("stagger gives each item its own window", () => {
    expect(stagger(0, 0, 4)).toBe(0);
    expect(stagger(1, 3, 4)).toBe(1);
    expect(stagger(0.2, 0, 4)).toBeGreaterThan(stagger(0.2, 3, 4));
  });
  it("seeded RNG repeats for the same seed", () => {
    const a = seededRandom("fangio");
    const b = seededRandom("fangio");
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it("text helpers", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 43, 101].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "43rd",
      "101st",
    ]);
    expect(wrapText("Most points or most dominant", 300, 60, "condensedCaps").length).toBeGreaterThan(1);
  });
});

describe("dodge", () => {
  it("separates crowded labels, keeps order and bounds", () => {
    const ys = [100, 101, 102, 300, 305];
    const out = dodge(ys, 44, 0, 1000);
    const sorted = [...out].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++)
      expect((sorted[i] as number) - (sorted[i - 1] as number)).toBeGreaterThanOrEqual(44 - 1e-9);
    expect(out[0]).toBeLessThan(out[1] as number);
    expect(out[3]).toBeLessThan(out[4] as number);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(0);
  });
});

describe("slopegraphLayout", () => {
  for (const scale of ["ordinal", "linear"] as const) {
    it(`12 rows (${scale}): monotonic per axis and overlap-free at >= 44 px`, () => {
      const l = slopegraphLayout(rows12, { ...zone, titles, scale });
      expect(l.overflow).toBe(false);
      expect(l.fontSize).toBeGreaterThanOrEqual(28);
      for (const side of ["left", "right"] as const) {
        const byRank = [...l.rows].sort((a, b) => a[side].rank - b[side].rank);
        for (let i = 1; i < byRank.length; i++) {
          const prev = byRank[i - 1]?.[side];
          const cur = byRank[i]?.[side];
          expect(cur?.y).toBeGreaterThan(prev?.y as number);
          expect(cur?.labelY).toBeGreaterThan(prev?.labelY as number);
          expect((cur?.labelY as number) - (prev?.labelY as number)).toBeGreaterThanOrEqual(44 - 1e-6);
        }
      }
      // everything inside the box, lines have room to slope
      for (const r of l.rows) {
        expect(r.left.labelY - l.fontSize * 0.4).toBeGreaterThanOrEqual(l.header.height - 1e-6);
        expect(r.right.labelY + l.fontSize * 0.4).toBeLessThanOrEqual(zone.height);
        expect(r.left.nameX - r.label.length * 0.6 * l.fontSize).toBeGreaterThanOrEqual(-1e-6);
        expect(r.right.nameX + r.label.length * 0.6 * l.fontSize).toBeLessThanOrEqual(zone.width + 1e-6);
      }
      expect(l.plot.rightX - l.plot.leftX).toBeGreaterThan(zone.width * 0.25);
    });
  }

  it("never shrinks names below the 28 px floor, even from an odd fitted size", () => {
    // 9 rows fit at 29 px; 17-char surnames then force the horizontal shrink (29 -> 27 before the fix)
    for (let len = 10; len <= 22; len++) {
      const name = `A ${"M".repeat(len)}`;
      const rows = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name, left: i + 1, right: 9 - i }));
      expect(slopegraphLayout(rows, { ...zone, titles }).fontSize, `surname ${len}`).toBeGreaterThanOrEqual(28);
    }
  });

  it("flags overflow when 12 rows cannot fit at 44 px", () => {
    expect(slopegraphLayout(rows12, { ...zone, height: 300 }).overflow).toBe(true);
  });

  it("is deterministic", () => {
    const a = slopegraphLayout(rows12, { ...zone, titles });
    const b = slopegraphLayout(rows12, { ...zone, titles });
    expect(a).toEqual(b);
    expect(
      a.rows.slice(0, 3).map((r) => ({
        id: r.id,
        label: r.label,
        left: [r.left.slot, Math.round(r.left.y)],
        right: [r.right.slot, Math.round(r.right.y)],
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "id": "juan-manuel-fangio",
          "label": "FANGIO",
          "left": [
            10,
            544,
          ],
          "right": [
            0,
            92,
          ],
        },
        {
          "id": "alberto-ascari",
          "label": "ASCARI",
          "left": [
            11,
            589,
          ],
          "right": [
            1,
            137,
          ],
        },
        {
          "id": "max-verstappen",
          "label": "VERSTAPPEN",
          "left": [
            1,
            137,
          ],
          "right": [
            2,
            182,
          ],
        },
      ]
    `);
  });
});

describe("Slopegraph", () => {
  const el = (progress: number, extra: Record<string, unknown> = {}) =>
    Slopegraph({
      rows: rows12,
      highlightId: "juan-manuel-fangio",
      focus: ["lewis-hamilton"],
      progress,
      theme,
      format: "vertical",
      width: zone.width,
      height: zone.height,
      labels: titles,
      ...extra,
    });

  it("renders the same tree for the same inputs", () => {
    expect(JSON.stringify(el(0.5))).toBe(JSON.stringify(el(0.5)));
  });

  it("draws the highlight in the accent, last, and thicker than the rest", () => {
    const lines = walk(el(1)).filter((e) => e.type === "line" && e.props.strokeLinecap === "round");
    expect(lines).toHaveLength(12);
    const last = lines.at(-1);
    expect(last?.props.stroke).toBe(theme.accent);
    expect(lines.filter((l) => l.props.stroke === theme.accent)).toHaveLength(1);
    expect(Number(last?.props.strokeWidth)).toBeGreaterThan(Number(lines[0]?.props.strokeWidth));
  });

  it("progress 0 draws no lines; the highlight line starts after the others", () => {
    expect(walk(el(0)).filter((e) => e.type === "line" && e.props.strokeLinecap === "round")).toHaveLength(0);
    const p = lineProgress(
      0.5,
      rows12.map((r, i) => ({ id: r.id, leftSlot: i })),
      "juan-manuel-fangio",
    );
    expect(p.get("juan-manuel-fangio")).toBe(0);
    expect(p.get("lewis-hamilton")).toBeGreaterThan(0);
  });

  it("labels are at least 28 px and show ranks + surnames", () => {
    const texts = walk(el(1)).filter((e) => e.type === "text");
    const labels = texts.filter((e) => e.props.fontFamily === theme.fonts.data);
    expect(labels.every((e) => Number(e.props.fontSize) >= 28)).toBe(true);
    const all = texts.map((e) => textOf(e)).join(" ");
    expect(all).toContain("FANGIO");
    expect(all).toContain("43");
    expect(all).toContain("ERA-ADJUSTED");
  });
});

describe("Callout", () => {
  it("rolling digits land exactly on the value", () => {
    expect(rollingDigits(17.1, 1).map((c) => c.position)).toEqual([1, 7, 1]);
    expect(rollingDigits(1, 0, 2).map((c) => c.visible)).toEqual([0, 1]);
    // halfway between 19 and 20 the tens column is mid-roll
    const mid = rollingDigits(19.5, 0);
    expect(mid[0]?.position).toBeCloseTo(1.5);
    expect(mid[1]?.position).toBeCloseTo(9.5);
  });

  it("counts from `from` to `value` over its window and uses tabular figures", () => {
    const at = (t: number) =>
      Callout({
        value: 1,
        from: 43,
        t,
        start: 0,
        duration: 1,
        theme,
        fontSize: 200,
        suffix: (n) => (n === 1 ? "st" : "th"),
      });
    expect(walk(at(0))[0]?.props["data-callout"]).toBe(43);
    expect(walk(at(2))[0]?.props["data-callout"]).toBe(1);
    const digits = walk(at(2)).filter((e) => e.type === "text" && textOf(e) === "1");
    expect(digits.length).toBeGreaterThan(0);
    expect((digits[0]?.props.style as Record<string, string> | undefined)?.fontVariantNumeric).toBe("tabular-nums");
    expect(JSON.stringify(at(0.4))).toBe(JSON.stringify(at(0.4)));
  });
});
