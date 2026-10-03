import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contrast gate for the studio theme (ADR 009, design-tokens standard: contrast floor in the
 * contract). It PARSES theme-photofinish.css, so a retuned hex fails here instead of in review.
 * shared.css defines no colours (only type, space, layout), so it is not parsed.
 * video-theme.test.ts keeps the video palette; this file is the studio UI.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "theme-photofinish.css"), "utf8");

const tokens = new Map<string, string>();
for (const m of css.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g))
  tokens.set(m[1] as string, (m[2] as string).toLowerCase());
const hex = (name: string): string => {
  const v = tokens.get(name);
  if (!v) throw new Error(`token ${name} missing from theme-photofinish.css`);
  return v;
};
const num = (name: string): number => {
  const m = css.match(new RegExp(`${name}:\\s*([\\d.]+)%`));
  if (!m?.[1]) throw new Error(`token ${name} missing`);
  return Number(m[1]) / 100;
};

/** WCAG relative luminance and contrast ratio for #rrggbb. */
const lum = (h: string): number => {
  const c = [1, 3, 5].map((i) => {
    const v = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};
/** color-mix(in srgb, a p%, b): the same arithmetic the browser does for the lane ink rule. */
const mix = (a: string, b: string, p: number): string =>
  `#${[1, 3, 5]
    .map((i) =>
      Math.round(Number.parseInt(a.slice(i, i + 2), 16) * p + Number.parseInt(b.slice(i, i + 2), 16) * (1 - p))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

// Grounds a studio text or outline can sit on: the sheet, raised bands, inputs, selected rows.
const GROUNDS = ["--color-bg", "--color-bg-raised", "--color-surface", "--color-surface-2"] as const;
// Control outlines sit on the sheet, raised bands and inputs; selected rows (surface-2) carry
// their own fill, so the outline floor is checked on the first three only.
const OUTLINE_GROUNDS = ["--color-bg", "--color-bg-raised", "--color-surface"] as const;

/** Text tokens: each must reach 4.5:1 (WCAG AA) on every ground. */
const TEXT_TOKENS = [
  "--color-text",
  "--color-text-muted",
  "--color-text-dim",
  "--color-brand",
  "--status-go",
  "--status-data-ready",
  "--status-ask",
  "--status-blocked",
  "--licence-legal",
  "--licence-non-commercial",
  "--licence-paid",
  "--licence-avoid",
] as const;

/** Non-text tokens: outlines and signals must reach 3:1 (WCAG 1.4.11) on their grounds. */
const OUTLINE_TOKENS = ["--color-line-strong"] as const;

describe("studio theme contrast (Photo Finish)", () => {
  for (const t of TEXT_TOKENS) {
    it(`${t} is >= 4.5:1 as text on every ground`, () => {
      for (const g of GROUNDS) expect(contrast(hex(t), hex(g)), `${t} on ${g}`).toBeGreaterThanOrEqual(4.5);
    });
  }

  for (const t of OUTLINE_TOKENS) {
    it(`${t} is >= 3:1 as a control outline`, () => {
      for (const g of OUTLINE_GROUNDS) expect(contrast(hex(t), hex(g)), `${t} on ${g}`).toBeGreaterThanOrEqual(3);
    });
  }

  it("the signal stroke is >= 3:1 on the sheet", () => {
    expect(contrast(hex("--color-signal"), hex("--color-bg"))).toBeGreaterThanOrEqual(3);
  });

  it("lane text (lane hue mixed toward graphite by --lane-ink-mix) is >= 4.5:1 for all ten lanes", () => {
    // Lane hues stay as marks and fills (they only need 3:1); where a lane colour is TEXT the
    // studio uses color-mix(lane, --color-text, --lane-ink-mix). Same arithmetic as the browser.
    const p = num("--lane-ink-mix");
    const text = hex("--color-text");
    for (let n = 1; n <= 10; n++) {
      for (const g of GROUNDS) {
        const ink = mix(hex(`--lane-${n}`), text, p);
        expect(contrast(ink, hex(g)), `lane-${n} ink ${ink} on ${g}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("studio text never takes a raw lane colour (only marks and fills do)", () => {
    const front = readFileSync(path.join(here, "../../../apps/studio/src/styles/front-pf.css"), "utf8");
    expect(front).not.toMatch(/(^|[;\s{])color:\s*var\(--lane-color/m);
    expect(front).toMatch(/color:\s*color-mix\(in srgb, var\(--lane-color[^)]*\) var\(--lane-ink-mix\)/);
  });
});
