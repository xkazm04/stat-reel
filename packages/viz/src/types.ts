/**
 * Structural types for viz. `@statreel/viz` depends on React only, so the theme and format are
 * declared structurally here; `VideoTheme` from `@statreel/design-tokens` satisfies `VizTheme`.
 */

export type VizFormat = "vertical" | "landscape";

export type VizTheme = {
  background: string;
  surface: string;
  grid: string;
  ink: string;
  inkDim: string;
  inkFaint: string;
  accent: string;
  accentInk: string;
  fonts: { display: string; ui: string; data: string };
};

export type Point = { x: number; y: number };

/** Numeric layers must use tabular figures (DESIGN.md §6.5). */
export const TABULAR = { fontVariantNumeric: "tabular-nums", fontFeatureSettings: '"tnum" 1' } as const;
