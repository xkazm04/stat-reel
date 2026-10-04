import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fontFamilies, type VideoTheme, videoTheme } from "./index";

/** WCAG relative luminance and contrast ratio for #rrggbb. */
const lum = (hex: string): number => {
  const c = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};
/** Composite an rgba(r, g, b, a) colour over an opaque #rrggbb background. */
const over = (rgba: string, bg: string): string => {
  const m = rgba.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
  if (!m) throw new Error(`not rgba: ${rgba}`);
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const ch = [1, 3, 5].map((i, k) => {
    const base = Number.parseInt(bg.slice(i, i + 2), 16);
    return Math.round(Number(m[k + 1]) * a + base * (1 - a));
  });
  return `#${ch.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "theme-photofinish.css"), "utf8");
const token = (name: string): string => {
  const m = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m?.[1]) throw new Error(`token ${name} missing`);
  return m[1].toLowerCase();
};

describe("videoTheme is the Photo Finish palette (ADR 009)", () => {
  // Every colour key and the studio token it copies. Typed over keyof VideoTheme, so a new key does
  // not compile until it names its source; captionBox is the token's rgb at the plate's alpha.
  const SOURCE: Record<Exclude<keyof VideoTheme, "fonts">, string> = {
    background: "--color-bg",
    surface: "--color-surface",
    grid: "--color-line",
    ink: "--color-text",
    inkDim: "--color-text-muted",
    inkFaint: "--color-text-dim",
    accent: "--color-signal",
    accentInk: "--color-brand",
    captionBox: "--color-bg-raised",
    captionInk: "--color-text",
    captionActive: "--color-brand",
  };
  const opaque = (c: string): string => (c.startsWith("#") ? c.toLowerCase() : over(c.replace(/,\s*[\d.]+\s*\)$/, ")"), "#000000"));

  it("reuses the studio token values (every colour key)", () => {
    expect(Object.keys(videoTheme).filter((k) => k !== "fonts").sort()).toEqual(Object.keys(SOURCE).sort());
    for (const [k, t] of Object.entries(SOURCE)) expect(opaque(videoTheme[k as keyof typeof SOURCE]), `${k} = ${t}`).toBe(token(t));
    expect(videoTheme.fonts).toBe(fontFamilies);
  });

  it("every text colour reaches 4.5:1 on the video background", () => {
    const bg = videoTheme.background;
    for (const k of ["ink", "inkDim", "inkFaint", "accentInk"] as const) {
      expect(contrast(videoTheme[k], bg), k).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("burned captions: graphite on the translucent sheet plate, active word in the brand red", () => {
    // the plate is translucent: check it over the sheet and over the darkest thing it can sit on
    const plate = over(videoTheme.captionBox, videoTheme.background);
    expect(contrast(videoTheme.captionInk, plate)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(videoTheme.captionActive, plate)).toBeGreaterThanOrEqual(4.5);
    const onGraphite = over(videoTheme.captionBox, "#12161a");
    expect(contrast(videoTheme.captionInk, onGraphite)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(videoTheme.captionActive, onGraphite)).toBeGreaterThanOrEqual(4.5);
  });

  it("the signal stroke is the one clay red (non-text, so 3:1 is enough)", () => {
    expect(contrast(videoTheme.accent, videoTheme.background)).toBeGreaterThanOrEqual(3);
  });
});
