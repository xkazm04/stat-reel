/**
 * WCAG 2.x contrast helpers for #rrggbb colours. No React, no DOM. The video theme guarantees its own
 * text colours (design-tokens video-theme.test.ts); this is for colours that come from DATA, such as
 * entity colours, which must never be used as text on the sheet (a yellow like #e0a100 is ~2:1).
 */

const lin = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance, 0 (black) .. 1 (white). */
export function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** Contrast ratio between two colours, 1 .. 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
