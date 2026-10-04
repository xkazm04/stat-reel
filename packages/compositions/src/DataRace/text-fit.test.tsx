import { DATA_RACE_LIMITS } from "@statreel/schemas";
import { measureText } from "@statreel/viz";
import { describe, expect, it } from "vitest";
import {
  CARD_TEXT_W,
  cardLayout,
  clockLayout,
  FOOTER_W,
  FULL_W,
  footerLayout,
  HOOK_TILE_W,
  hookLayout,
  hookTileNameLayout,
  L,
  nameLayout,
  spotlightFactLayout,
  titleLayout,
  unitLayout,
  winnerLayout,
} from "./layout";

/**
 * Worst-case sweep: for every text slot, the longest string the schema allows (DATA_RACE_LIMITS),
 * in the glyph mixes that are widest in the real fonts (W / M runs, alternating, upper case,
 * diacritics, real long names), measured with the generated advance table, not an average em.
 * A line "fits" when its measured width is <= the slot width; nothing may be truncated or < 28 px.
 */
const fill = (n: number, unit: string): string => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
/** Mixes at exactly `n` characters; the "words" ones break the same glyphs into sentence-like words. */
const mixes = (n: number): Record<string, string> => ({
  W: fill(n, "W"),
  M: fill(n, "M"),
  WM: fill(n, "WM"),
  "W words": fill(n, "WWWWWWW "),
  "M words": fill(n, "MMMMMM "),
  caps: fill(n, "BRAZILIAN GRAND PRIX "),
  diacritics: fill(n, "Räikkönen Ångström Çağlar "),
  lower: fill(n, "the quick brown fox jumps over "),
  digits: fill(n, "0123456789 "),
});

type Face = "condensed" | "ui" | "mono";
const lineW = (line: string, size: number, face: Face, weight: number): number =>
  measureText(line, size, face, 0, weight);

describe("DataRace text fits its schema-max string at >= 28 px (measured with the real font table)", () => {
  it("entity names (22): one line at 28-36 px or two lines in the 232 px column", () => {
    for (const [k, s] of Object.entries(mixes(DATA_RACE_LIMITS.nameMaxChars))) {
      const f = nameLayout(s);
      expect(f.truncated, k).toBe(false);
      expect(f.fontSize, k).toBeGreaterThanOrEqual(28);
      expect(f.lines.length, k).toBeLessThanOrEqual(2);
      expect(f.lines.join("").replace(/ /g, ""), k).toBe(s.replace(/ /g, ""));
      for (const l of f.lines)
        expect(lineW(l, f.fontSize, "condensed", 700), `${k}: ${l}`).toBeLessThanOrEqual(L.nameW);
      expect(f.lines.length * f.fontSize * 1.1, k).toBeLessThanOrEqual(L.rowH - 8);
    }
    expect(nameLayout("Kimi Räikkönen").lines).toEqual(["Kimi Räikkönen"]);
  });

  it("the name column took 32 px from the bar and nothing else (bar end stays at x 824)", () => {
    expect(L.barX + L.barMaxW).toBe(824);
    expect(L.nameX + L.nameW).toBeLessThanOrEqual(L.barX - 12);
  });

  it("source line (70): <= 2 lines of 28 px in 905 px, bottom-anchored inside the safe box", () => {
    for (const [k, s] of Object.entries(mixes(DATA_RACE_LIMITS.sourceLineMaxChars))) {
      if (k === "W" || k === "M" || k === "WM") continue; // wider than two lines, see the next test
      const f = footerLayout(s);
      expect(f.truncated, k).toBe(false);
      expect(f.lines.length, k).toBeLessThanOrEqual(2);
      for (const l of f.lines) expect(lineW(l, 28, "ui", 500), `${k}: ${l}`).toBeLessThanOrEqual(FOOTER_W);
      expect(f.top + f.height, k).toBeLessThanOrEqual(1580);
      expect(f.top, k).toBeGreaterThanOrEqual(1516);
    }
  });

  it("an unbroken run of 70 W at 28 px is wider than two lines: it ends in an explicit ellipsis, never a silent clip", () => {
    const run = fill(70, "W");
    const f = footerLayout(run);
    expect(lineW(run, 28, "ui", 500)).toBeGreaterThan(2 * FOOTER_W);
    expect(f.truncated).toBe(true);
    expect(f.lines.at(-1)?.endsWith("…")).toBe(true);
    for (const l of f.lines) expect(lineW(l, 28, "ui", 500)).toBeLessThanOrEqual(FOOTER_W);
  });

  it("event title (36): one line, 46 -> 28 px, inside the 768 px card text", () => {
    for (const [k, s] of Object.entries(mixes(DATA_RACE_LIMITS.eventTitleMaxChars))) {
      const c = cardLayout({ title: s, facts: [{ text: "x" }] });
      expect(c.title.truncated, k).toBe(false);
      expect(c.title.lines, k).toHaveLength(1);
      expect(c.title.fontSize, k).toBeGreaterThanOrEqual(28);
      expect(lineW(c.title.lines[0] as string, c.title.fontSize, "condensed", 700), k).toBeLessThanOrEqual(CARD_TEXT_W);
    }
    expect(cardLayout({ title: "Verstappen wins at Monza", facts: [{ text: "x" }] }).title.fontSize).toBe(46);
  });

  it("fact lines (48, two per card): <= 2 lines of 28 px each, the card grows to hold them (<= 284 px)", () => {
    for (const [k, s] of Object.entries(mixes(DATA_RACE_LIMITS.factTextMaxChars))) {
      const c = cardLayout({ title: "t", facts: [{ text: s }, { text: s }] });
      for (const f of c.facts) {
        expect(f.truncated, k).toBe(false);
        expect(f.lines.length, k).toBeLessThanOrEqual(2);
        for (const l of f.lines) expect(lineW(l, 28, "ui", 500), `${k}: ${l}`).toBeLessThanOrEqual(CARD_TEXT_W);
      }
      expect(c.height, k).toBeLessThanOrEqual(284);
    }
    expect(
      cardLayout({ title: "t", facts: [{ text: "Won 11 of 22 rounds" }, { text: "Fastest laps: 9" }] }).height,
    ).toBe(212);
  });

  it("spotlight label (28) and value (20): each fits the 960 px column at >= 28 px; stacked when not side by side", () => {
    for (const [kl, label] of Object.entries(mixes(DATA_RACE_LIMITS.spotlightLabelMaxChars))) {
      for (const [kv, value] of Object.entries(mixes(DATA_RACE_LIMITS.spotlightValueMaxChars))) {
        const f = spotlightFactLayout({ label, value_text: value });
        const key = `${kl}/${kv}`;
        expect(f.label.truncated || f.value.truncated, key).toBe(false);
        expect(f.label.fontSize, key).toBeGreaterThanOrEqual(28);
        expect(f.value.fontSize, key).toBeGreaterThanOrEqual(28);
        for (const l of f.label.lines) expect(lineW(l, f.label.fontSize, "ui", 500), key).toBeLessThanOrEqual(FULL_W);
        for (const l of f.value.lines)
          expect(lineW(l, f.value.fontSize, "condensed", 700), key).toBeLessThanOrEqual(FULL_W);
        if (f.mode === "row") {
          const both =
            lineW(f.label.lines[0] as string, f.label.fontSize, "ui", 500) +
            18 +
            lineW(f.value.lines[0] as string, f.value.fontSize, "condensed", 700);
          expect(both, key).toBeLessThanOrEqual(FULL_W);
        }
      }
    }
    expect(spotlightFactLayout({ label: "Wins", value_text: "103" }).mode).toBe("row");
  });

  it("title (42): one line, 64 -> 28 px (a normal title keeps >= 40); hook (60): <= 3 lines, <= 96 px", () => {
    for (const [k, s] of Object.entries(mixes(DATA_RACE_LIMITS.titleMaxChars))) {
      const t = titleLayout(s);
      expect(t.truncated, k).toBe(false);
      expect(t.fontSize, k).toBeGreaterThanOrEqual(28);
      expect(lineW(t.lines[0] as string, t.fontSize, "condensed", 800), k).toBeLessThanOrEqual(FULL_W);
    }
    expect(titleLayout("Who led the most laps in a season?").fontSize).toBeGreaterThanOrEqual(40);
    for (const [k, s] of Object.entries(mixes(DATA_RACE_LIMITS.hookMaxChars))) {
      const h = hookLayout(s);
      expect(h.truncated, k).toBe(false);
      expect(h.lines.length, k).toBeLessThanOrEqual(3);
      expect(h.fontSize, k).toBeGreaterThanOrEqual(28);
      for (const l of h.lines) expect(lineW(l, h.fontSize, "condensed", 800), `${k}: ${l}`).toBeLessThanOrEqual(FULL_W);
      expect(h.lines.length * h.fontSize * 1.08, k).toBeLessThanOrEqual(3 * 104);
    }
  });

  it("hook logo-tile names (22): <= 3 lines in a 180 px tile; 5 tiles fit one row", () => {
    expect(5 * HOOK_TILE_W + 4 * 12).toBeLessThanOrEqual(FULL_W);
    for (const [k, s] of Object.entries(mixes(DATA_RACE_LIMITS.nameMaxChars))) {
      const f = hookTileNameLayout(s);
      expect(f.truncated, k).toBe(false);
      expect(f.fontSize, k).toBeGreaterThanOrEqual(28);
      for (const l of f.lines)
        expect(lineW(l, f.fontSize, "condensed", 700), `${k}: ${l}`).toBeLessThanOrEqual(HOOK_TILE_W);
    }
  });

  it("unit label (40) and the clock share the row: the label wraps to 2 lines of >= 28 px in what the clock leaves", () => {
    const clock = clockLayout(["Nov 2017", "Sept 2017", "2017-12"]);
    expect(clock.fontSize).toBe(52);
    for (const [k, s] of Object.entries(mixes(DATA_RACE_LIMITS.unitLabelMaxChars))) {
      const u = unitLayout(s, clock.width);
      expect(u.truncated, k).toBe(false);
      expect(u.fontSize, k).toBeGreaterThanOrEqual(28);
      for (const l of u.lines) expect(lineW(l, u.fontSize, "ui", 600), `${k}: ${l}`).toBeLessThanOrEqual(u.width);
    }
    // a long period label shrinks the clock instead of running into the unit label
    const long = clockLayout(["Week of 29 November 2017"]);
    expect(long.fontSize).toBeLessThan(52);
    expect(long.fontSize).toBeGreaterThanOrEqual(28);
    expect(long.width).toBeLessThanOrEqual(420);
  });

  it("winner row: a 22-character name next to a wide value never overruns the row at >= 28 px", () => {
    for (const [k, s] of Object.entries(mixes(DATA_RACE_LIMITS.nameMaxChars))) {
      const w = winnerLayout(s, "US$ 1234.567 million");
      expect(w.name.truncated, k).toBe(false);
      expect(w.valueSize, k).toBeGreaterThanOrEqual(28);
      expect(w.name.fontSize, k).toBeGreaterThanOrEqual(28);
    }
  });
});
