/**
 * Display-text joining, identical to `sceneDisplayText` in @statreel/schemas: tokens are joined
 * with a space and the space before punctuation is dropped, so a punctuation-only token glues to
 * the previous word.
 */
const PUNCT_START = /^[,.!?;:]/;

/** True when a token's display text attaches to the previous token without a space. */
export const isGlued = (display: string): boolean => PUNCT_START.test(display);

export const joinDisplay = (parts: string[]): string => parts.join(" ").replace(/\s+([,.!?;:])/g, "$1");
