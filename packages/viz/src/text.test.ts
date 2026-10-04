import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FONT_ADVANCES, FONT_METRIC_CODES } from "./font-metrics";
import { CHAR_EM, ellipsize, fitText, measureText, wrapText } from "./text";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("font metrics table", () => {
  it("is exactly what scripts/font-metrics.mjs generates from fonts/ (no drift)", () => {
    expect(() =>
      execFileSync(process.execPath, [path.join(root, "scripts", "font-metrics.mjs"), "--check"], { stdio: "pipe" }),
    ).not.toThrow();
  });

  it("holds one row per face weight, indexed like FONT_METRIC_CODES, Latin-1 covered", () => {
    expect(Object.keys(FONT_ADVANCES).sort()).toEqual(
      [
        "condensed-500",
        "condensed-600",
        "condensed-700",
        "condensed-800",
        "mono-400",
        "mono-500",
        "mono-600",
        "mono-700",
        "mono-800",
        "ui-400",
        "ui-500",
        "ui-600",
        "ui-700",
      ].sort(),
    );
    for (const row of Object.values(FONT_ADVANCES)) expect(row).toHaveLength(FONT_METRIC_CODES.length);
    for (const cp of [0x20, 0x41, 0x57, 0x7a, 0xe4, 0xf6, 0xe7, 0xc5]) expect(FONT_METRIC_CODES).toContain(cp);
  });

  it("the mono face is exactly 0.6 em at every weight", () => {
    for (const w of [400, 500, 600, 700, 800])
      expect(measureText("0123456789 WM", 30, "mono", 0, w)).toBeCloseTo(13 * 0.6 * 30, 6);
  });

  it("is real, not an average: W is wider than i, bolder is wider, Inter is wider than Barlow Condensed", () => {
    expect(measureText("W", 100, "ui", 0, 500)).toBeGreaterThan(measureText("i", 100, "ui", 0, 500) * 3);
    expect(measureText("Hamilton", 100, "condensed", 0, 800)).toBeGreaterThan(
      measureText("Hamilton", 100, "condensed", 0, 500),
    );
    expect(measureText("Hamilton", 100, "ui", 0, 500)).toBeGreaterThan(
      measureText("Hamilton", 100, "condensed", 0, 700),
    );
    // a few anchors read from the font files (1/1000 em)
    expect(measureText("W", 1000, "condensed", 0, 700)).toBeCloseTo(689, 6);
    expect(measureText("W", 1000, "ui", 0, 500)).toBeCloseTo(1003, 6);
  });

  it("applies letter spacing per character and snaps an off-table weight to the nearest face weight", () => {
    expect(measureText("abc", 30, "ui", 2, 500)).toBeCloseTo(measureText("abc", 30, "ui", 0, 500) + 6, 9);
    expect(measureText("abc", 30, "ui", 0, 520)).toBe(measureText("abc", 30, "ui", 0, 500));
  });

  it("falls back to the average em for a glyph the table lacks (and counts arrows twice)", () => {
    const cjk = "漢";
    expect(measureText(cjk, 100, "ui", 0, 500)).toBeCloseTo(CHAR_EM.ui * 100, 9);
    expect(measureText("→", 100, "condensed", 0, 700)).toBeGreaterThan(0);
  });
});

describe("wrapText / fitText / ellipsize", () => {
  it("keeps a long word whole by default and cuts it at characters with breakWords", () => {
    const word = "W".repeat(22);
    expect(wrapText(word, 232, 28, "condensed", 0, { weight: 700 })).toEqual([word]);
    const cut = wrapText(word, 232, 28, "condensed", 0, { weight: 700, breakWords: true });
    expect(cut.length).toBeGreaterThan(1);
    expect(cut.join("")).toBe(word);
    for (const l of cut) expect(measureText(l, 28, "condensed", 0, 700)).toBeLessThanOrEqual(232);
  });

  it("flow fills every line to the column, dropping spaces at a line edge", () => {
    const text = "WWWWWWW WWWWWWW WWWWWWW W";
    const words = wrapText(text, 232, 28, "condensed", 0, { weight: 700 });
    const flow = wrapText(text, 232, 28, "condensed", 0, { weight: 700, flow: true });
    expect(flow.length).toBeLessThan(words.length);
    expect(flow.join("").replace(/ /g, "")).toBe(text.replace(/ /g, ""));
    for (const l of flow) expect(measureText(l, 28, "condensed", 0, 700)).toBeLessThanOrEqual(232);
  });

  it("fitText reports whether it fit; ellipsize ends in an ellipsis within the width", () => {
    expect(fitText("Hello", { maxWidth: 400, face: "ui", min: 28, max: 40 }).fits).toBe(true);
    expect(fitText("W".repeat(40), { maxWidth: 200, face: "ui", min: 28, max: 40, maxLines: 1 }).fits).toBe(false);
    const cut = ellipsize("W".repeat(40), 300, 28, "ui", 0, 500);
    expect(cut.endsWith("…")).toBe(true);
    expect(measureText(cut, 28, "ui", 0, 500)).toBeLessThanOrEqual(300);
    expect(ellipsize("short", 300, 28, "ui")).toBe("short");
  });

  it("fitText tries `min` itself when max - min is odd (it fits there, so it must say so)", () => {
    const text = "Hello world";
    const maxWidth = measureText(text, 29, "ui", 0, 500) + 0.1;
    expect(fitText(text, { maxWidth, face: "ui", min: 29, max: 40, maxLines: 1 })).toEqual({
      fontSize: 29,
      lines: [text],
      fits: true,
    });
  });
});
