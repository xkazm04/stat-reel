/**
 * Design tokens. `tokens.css` is the source of truth for the studio UI (CSS custom properties).
 * `videoTheme` is the same brand as plain values for Remotion compositions.
 *
 * Baseline: contest `landing-screens` variant A/1 "On Air" (owner verdict 2026-09-30, ADR 005).
 * Volt means one thing everywhere: cleared to air.
 */

export const fontFamilies = {
  display: '"Barlow Condensed", "Arial Narrow", sans-serif',
  ui: '"Inter", system-ui, sans-serif',
  data: '"JetBrains Mono", ui-monospace, monospace',
} as const;

/** Status is a shape and a pattern before it is a hue; always labelled. */
export const statusGlyphs = {
  go: { glyph: "disc-play", pattern: "solid", label: "GO", color: "#d6ff3f" },
  "data-ready": { glyph: "half-disc", pattern: "dots", label: "DATA READY", color: "#46d9ff" },
  ask: { glyph: "triangle-bang", pattern: "hatch", label: "ASK", color: "#ffb531" },
  blocked: { glyph: "square-cross", pattern: "crosshatch", label: "BLOCKED", color: "#ff5a6e" },
} as const;

export const licenceColors = { legal: "#d6ff3f", non_commercial: "#ffb531", paid: "#b48cff", avoid: "#ff5a6e" } as const;

/** One ident colour per use case (the reel's format idents). */
export const identColors: Record<string, string> = {
  "counterfactual-timelines": "#b48cff",
  "era-adjusted-rankings": "#d6ff3f",
  "spatial-career-maps": "#3ee6a8",
  "network-flow-timelines": "#46d9ff",
  "distribution-races": "#ff8a3d",
  "probability-narratives": "#ff5fa2",
  "similarity-dna": "#8c9bff",
  "metric-explainer-shorts": "#ffd23e",
  "reactive-weekend-pipeline": "#ff6b5b",
  "interactive-companion-loop": "#6be3e3",
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

/** Video frames: floodlit night ground, light ink, volt for the one thing that matters. */
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
