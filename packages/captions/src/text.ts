/**
 * Display-text joining, identical to `sceneDisplayText` in @statreel/schemas for every token that
 * shows text: tokens are joined with a space and the space before punctuation is dropped, so a
 * punctuation-only token glues to the previous word. A token whose display form is blank (spoken,
 * not shown) adds nothing - not even a space - where the schemas join would double the space.
 */
const PUNCT_START = /^[,.!?;:]/;
const BLANK = /^\s*$/;

/** True when a token's display text attaches to the previous token without a space (punctuation, or nothing to show). */
export const isGlued = (display: string): boolean => PUNCT_START.test(display) || BLANK.test(display);

export const joinDisplay = (parts: string[]): string =>
  parts
    .filter((p) => !BLANK.test(p))
    .join(" ")
    .replace(/\s+([,.!?;:])/g, "$1");
