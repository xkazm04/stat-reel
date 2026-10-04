import { readFileSync } from "node:fs";
import { safeZoneVertical, videoTheme } from "@statreel/design-tokens";
import type { Cue, WordTiming } from "@statreel/schemas";
import { measureText } from "@statreel/viz";
import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  activeCueAt,
  activeWordIndex,
  BurnedCaptions,
  buildCues,
  captionBox,
  captionSafeZoneViolations,
  captionTextWidth,
  estimateLineWidth,
} from "./index";

// react-dom/server is not resolvable from packages/captions (not a dependency), so the component is
// rendered by calling it directly: it uses no hooks and only host elements, so its return value is
// the complete element tree.

type El = { type: unknown; props: { style?: Record<string, unknown>; children?: ReactNode } };

function text(node: ReactNode | El): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement(node)) return text((node as El).props.children);
  return "";
}

function elements(node: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(node)) for (const n of node) elements(n, out);
  else if (isValidElement(node)) {
    out.push(node as El);
    elements((node as El).props.children, out);
  }
  return out;
}

const W = (display: string, start_s: number, end_s: number): WordTiming => ({
  scene_id: "s",
  display,
  spoken: display,
  start_s,
  end_s,
});
const words = [W("Fangio", 0, 0.5), W("won", 0.5, 0.8), W("24", 1.0, 1.4), W("races.", 1.4, 2.0)];
const cues: Cue[] = [
  { start_s: 0, end_s: 2.2, lines: ["Fangio won", "24 races."], words },
  { start_s: 5, end_s: 6, lines: ["Later"], words: [W("Later", 5, 5.6)] },
];

function render(t: number, format: "vertical" | "landscape" = "vertical") {
  return BurnedCaptions({ cues, t, format, theme: videoTheme });
}

describe("activeCueAt / activeWordIndex", () => {
  it("finds the cue whose [start, end) contains t", () => {
    expect(activeCueAt(cues, 0)).toBe(cues[0]);
    expect(activeCueAt(cues, 2.19)).toBe(cues[0]);
    expect(activeCueAt(cues, 2.2)).toBeNull();
    expect(activeCueAt(cues, 5.5)).toBe(cues[1]);
    expect(activeCueAt(cues, 6)).toBeNull();
    expect(activeCueAt([], 1)).toBeNull();
  });

  it("finds the word whose [start, end) contains t, or -1 in a pause", () => {
    const c = cues[0] as Cue;
    expect(activeWordIndex(c, 0.1)).toBe(0);
    expect(activeWordIndex(c, 0.5)).toBe(1);
    expect(activeWordIndex(c, 0.9)).toBe(-1);
    expect(activeWordIndex(c, 1.2)).toBe(2);
  });
});

describe("BurnedCaptions", () => {
  it("renders nothing when no cue is active", () => {
    expect(render(3)).toBeNull();
    expect(render(10)).toBeNull();
  });

  it("renders the active cue's lines and highlights the active word", () => {
    const el = render(1.2);
    expect(text(el)).toBe("Fangio won24 races.");
    const lines = elements(el).filter((e) => e.props.style?.whiteSpace === "nowrap");
    expect(lines.map((l) => text(l))).toEqual(["Fangio won", "24 races."]);
    const hi = elements(el).filter((e) => e.props.style?.color === videoTheme.captionActive);
    expect(hi.map((e) => text(e))).toEqual(["24"]);
  });

  it("a blank-display word renders no extra space and keeps the word grouping", () => {
    const ws = [W("Fangio", 0, 0.4), W("", 0.4, 0.6), W("won", 0.6, 1.0)];
    const [cue] = buildCues(ws, { format: "vertical", fps: 30 });
    const el = BurnedCaptions({ cues: [cue as Cue], t: 0.7, format: "vertical", theme: videoTheme });
    expect(text(el)).toBe("Fangio won");
    const hi = elements(el).filter((e) => e.props.style?.color === videoTheme.captionActive);
    expect(hi.map((e) => text(e))).toEqual(["won"]);
  });

  it("paints no plate for a cue with no visible text (the sidecar writers drop the same cue)", () => {
    const blank: Cue[] = [{ start_s: 0, end_s: 2, lines: [" "], words: [W("", 0, 1)] }];
    expect(BurnedCaptions({ cues: blank, t: 0.5, format: "vertical", theme: videoTheme })).toBeNull();
    const empty: Cue[] = [{ start_s: 0, end_s: 2, lines: ["", ""], words: [] }];
    expect(BurnedCaptions({ cues: empty, t: 0.5, format: "landscape", theme: videoTheme })).toBeNull();
  });

  it("highlights nothing in a pause between words", () => {
    const hi = elements(render(0.9)).filter((e) => e.props.style?.color === videoTheme.captionActive);
    expect(hi).toHaveLength(0);
    expect(text(render(5.2))).toBe("Later");
  });

  it("uses the vertical and landscape type specs (proportional figures: cues are static, tnum widens hyphens)", () => {
    for (const [format, size] of [
      ["vertical", 76],
      ["landscape", 52],
    ] as const) {
      const styled = elements(render(1.2, format)).find((e) => e.props.style?.fontSize !== undefined);
      expect(styled?.props.style).toMatchObject({
        fontSize: size,
        fontWeight: 700,
        fontFamily: videoTheme.fonts.ui,
        fontVariantNumeric: "proportional-nums",
        background: videoTheme.captionBox,
        color: videoTheme.captionInk,
      });
    }
  });

  it("is a pure function of t: seek-stable, order-independent, no transitions", () => {
    const a = JSON.stringify(render(1.2));
    render(0.1);
    render(5.5);
    expect(JSON.stringify(render(1.2))).toBe(a);
    for (const e of elements(render(1.2))) {
      const keys = Object.keys(e.props.style ?? {}).join(",");
      expect(keys).not.toMatch(/transition|animation/i);
    }
  });

  it("source uses no stateful/effect hooks and no CSS transitions/animations", () => {
    for (const f of ["./BurnedCaptions.tsx", "./geometry.ts", "./cues.ts"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src).not.toMatch(/\buse(State|Effect|LayoutEffect|Ref|Reducer|InsertionEffect|Transition)\b/);
      expect(src).not.toMatch(/\b(transition|animation)\s*:/i);
    }
  });
});

describe("caption box geometry and safe zone", () => {
  it("vertical box sits inside the safe zone with its bottom edge at y=1250", () => {
    const b = captionBox("vertical");
    expect(b.x).toBe(safeZoneVertical.left);
    expect(b.x + b.width).toBe(safeZoneVertical.width - safeZoneVertical.right);
    expect(b.y + b.maxHeight).toBeCloseTo(1250, 6);
    expect(b.y).toBeGreaterThanOrEqual(safeZoneVertical.top);
  });

  it("landscape box is bottom-centred above the landscape safe margin", () => {
    const b = captionBox("landscape");
    expect(b.y + b.maxHeight).toBeCloseTo(1080 - 90, 6);
    expect(b.x + b.width / 2).toBe(960);
  });

  it("counts cues whose lines overflow the box", () => {
    const wide: Cue = { start_s: 0, end_s: 3, lines: ["x".repeat(32)], words: [] };
    const ok: Cue = { start_s: 4, end_s: 6, lines: ["short"], words: [] };
    expect(captionSafeZoneViolations([wide, ok], "vertical")).toBe(1);
    expect(captionSafeZoneViolations([wide, ok], "landscape")).toBe(0);
    const three: Cue = { start_s: 0, end_s: 3, lines: ["a", "b", "c"], words: [] };
    expect(captionSafeZoneViolations([three], "landscape")).toBe(1);
  });

  it("measures lines with real Inter Bold advances, so an upper-case line the 0.56 em average passes is counted", () => {
    // 19 chars: the old estimate (19 x 0.56 x 76 = 809 px) fit the 837 px inner box; Inter Bold sets it at ~935 px
    const caps: Cue = { start_s: 0, end_s: 3, lines: ["MAXIMUM WORLD TITLE"], words: [] };
    const mixed: Cue = { start_s: 4, end_s: 6, lines: ["Fangio won 24 races"], words: [] };
    expect(estimateLineWidth("MAXIMUM WORLD TITLE", "vertical")).toBeGreaterThan(captionTextWidth("vertical"));
    expect(estimateLineWidth("Fangio won 24 races", "vertical")).toBeLessThan(captionTextWidth("vertical"));
    expect(captionSafeZoneViolations([caps, mixed], "vertical")).toBe(1);
    // same OFL face, same weight as the burn-in style: the width the layout trusts is the width viz measures
    expect(estimateLineWidth("MAXIMUM WORLD TITLE", "landscape")).toBeCloseTo(measureText("MAXIMUM WORLD TITLE", 52, "ui", 0, 700), 6);
  });

  it("cues built by buildCues have zero safe-zone violations in both formats", () => {
    const ws: WordTiming[] = [];
    let t = 0;
    for (const w of "Juan Manuel Fangio won five world titles in the fifties and still ranks first after era adjustment".split(
      " ",
    )) {
      ws.push(W(w, t, t + 0.35));
      t += 0.35;
    }
    for (const format of ["vertical", "landscape"] as const) {
      expect(captionSafeZoneViolations(buildCues(ws, { format, fps: 30 }), format)).toBe(0);
    }
  });

  it("segmentation breaks by measured width too: an upper-case script stays inside the box", () => {
    const ws: WordTiming[] = [];
    let t = 0;
    for (const w of "MAXIMUM WORLD TITLES FOR MERCEDES WHO WON EIGHT CONSTRUCTORS CHAMPIONSHIPS IN A ROW".split(" ")) {
      ws.push(W(w, t, t + 0.4));
      t += 0.4;
    }
    for (const format of ["vertical", "landscape"] as const) {
      expect(captionSafeZoneViolations(buildCues(ws, { format, fps: 30 }), format)).toBe(0);
      // an explicit character limit is a cap, never a licence to leave the box
      expect(captionSafeZoneViolations(buildCues(ws, { format, fps: 30, maxCharsPerLine: 42 }), format)).toBe(0);
    }
  });
});
