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

/** One ident colour per use case (the Photo Finish lanes; the studio reads them as --ident-<id>). */
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

/** Video frames (night palette; moves to Photo Finish in the video-palette step of ADR 009). */
export const videoTheme: VideoTheme = {
  background: "#05070c",
  surface: "#0f1524",
  grid: "#222c43",
  ink: "#f3f6fb",
  inkDim: "#a3aec4",
  inkFaint: "#7887a3",
  accent: "#d6ff3f",
  accentInk: "#d6ff3f",
  captionBox: "rgba(5, 7, 12, 0.78)",
  captionInk: "#ffffff",
  captionActive: "#d6ff3f",
  fonts: fontFamilies,
};

/** Union safe zone of TikTok / Reels / Shorts for 1080x1920 (DESIGN.md §6.5). */
export const safeZoneVertical = { top: 270, bottom: 670, left: 65, right: 130, width: 1080, height: 1920 } as const;
export const safeZoneLandscape = { top: 60, bottom: 90, left: 96, right: 96, width: 1920, height: 1080 } as const;

export const motion = { instantMs: 90, fastMs: 160, baseMs: 260, wipeMs: 560, sceneMs: 900 } as const;
export * from "./logo";
