/**
 * Design tokens. `tokens.css` is the source of truth for the studio UI (CSS custom properties).
 * `videoTheme` is the same palette as plain values for Remotion compositions, which render
 * inside Chromium frames where a TS object is easier to thread through pure viz functions.
 *
 * Baseline: contest `brand-screens` variant A/3 "Patchbay" (temporary, 2026-09-29). Swap by
 * editing this package only.
 */

export const fontFamilies = {
  display: '"Barlow Condensed", "Arial Narrow", sans-serif',
  ui: '"Inter", system-ui, sans-serif',
  data: '"JetBrains Mono", ui-monospace, monospace',
} as const;

export const statusGlyphs = {
  go: { glyph: "●", label: "GO" },
  "data-ready": { glyph: "◐", label: "READY" },
  ask: { glyph: "▲", label: "ASK" },
  blocked: { glyph: "⊘", label: "BLOCKED" },
} as const;

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

/** Video frames use the Patchbay "display" inset: black glass, light ink, one orange signal. */
export const videoTheme: VideoTheme = {
  background: "#0D0F0F",
  surface: "#151919",
  grid: "#232929",
  ink: "#EAF2EE",
  inkDim: "#93A29D",
  inkFaint: "#5E6B67",
  accent: "#FF5B1F",
  accentInk: "#FF7A45",
  captionBox: "rgba(0, 0, 0, 0.72)",
  captionInk: "#FFFFFF",
  captionActive: "#FF5B1F",
  fonts: fontFamilies,
};

/** Union safe zone of TikTok / Reels / Shorts for 1080x1920 (DESIGN.md §6.5). */
export const safeZoneVertical = { top: 270, bottom: 670, left: 65, right: 130, width: 1080, height: 1920 } as const;
export const safeZoneLandscape = { top: 60, bottom: 90, left: 96, right: 96, width: 1920, height: 1080 } as const;

export const motion = { snapMs: 140, settleMs: 650, sweepMs: 900 } as const;
