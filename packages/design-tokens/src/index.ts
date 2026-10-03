/**
 * Design tokens. `tokens.css` is the source of truth for the studio UI (CSS custom properties):
 * one semantic vocabulary, one theme: Photo Finish (ADR 009).
 * `videoTheme` is the same brand as plain values for Remotion compositions.
 *
 * In Photo Finish the one signal is the clay-red finish line.
 */

export const fontFamilies = {
  display: '"Barlow Condensed", "Arial Narrow", sans-serif',
  ui: '"Inter", system-ui, sans-serif',
  data: '"JetBrains Mono", ui-monospace, monospace',
} as const;

/** One ident colour per use case (the Photo Finish lanes; the studio reads them as --ident-<id>, which aliases --lane-N;
 * token-parity.test.ts holds this list against the CSS). */
export const identColors: Record<string, string> = {
  "counterfactual-timelines": "#6a5be2",
  "era-adjusted-rankings": "#0a93a3",
  "spatial-career-maps": "#2c9a55",
  "network-flow-timelines": "#1f73da",
  "distribution-races": "#b83c9b",
  "probability-narratives": "#d4820e",
  "similarity-dna": "#d2426b",
  "metric-explainer-shorts": "#6e8f10",
  "reactive-weekend-pipeline": "#1899cf",
  "interactive-companion-loop": "#566a90",
};

export type VideoTheme = {
  background: string;
  surface: string;
  grid: string;
  ink: string;
  inkDim: string;
  inkFaint: string;
  accent: string;
  accentInk: string;
  captionBox: string;
  captionInk: string;
  captionActive: string;
  fonts: typeof fontFamilies;
};

/**
 * Video frames (ADR 009, owner decision 2026-10-03): the Photo Finish palette, built from the same
 * values as the studio tokens (theme-photofinish.css): the timing sheet as ground, graphite ink,
 * one clay-red signal. `accent` is the signal as a stroke or fill; text in the signal colour uses
 * `accentInk` (the brand red, AA on the sheet). All text colours reach 4.5:1 on `background`
 * (video-theme.test.ts). Burned captions are graphite on a translucent sheet plate.
 */
export const videoTheme: VideoTheme = {
  background: "#eceff2", // --color-bg, the timing sheet
  surface: "#ffffff", // --color-surface
  grid: "#c6ced5", // --color-line, hairline rules
  ink: "#12161a", // --color-text, graphite
  inkDim: "#38414a", // --color-text-muted
  inkFaint: "#56616c", // --color-text-dim, still AA on the sheet
  accent: "#e4432a", // --color-signal, the finish line
  accentInk: "#b8321a", // --color-brand, the line as text
  captionBox: "rgba(245, 247, 249, 0.94)", // --color-bg-raised as a translucent plate
  captionInk: "#12161a",
  captionActive: "#b8321a",
  fonts: fontFamilies,
};

/** Union safe zone of TikTok / Reels / Shorts for 1080x1920 (DESIGN.md §6.5). */
export const safeZoneVertical = { top: 270, bottom: 670, left: 65, right: 130, width: 1080, height: 1920 } as const;
export const safeZoneLandscape = { top: 60, bottom: 90, left: 96, right: 96, width: 1920, height: 1080 } as const;

export * from "./logo";
