/**
 * Format idents: the ident colour of a use case (the Photo Finish lanes, ADR 009). The drawn
 * ident artwork of the retired broadcast front is gone; only the colour token reference remains.
 */
import { identColors } from "@statreel/design-tokens";

/** The ident colour of a use case, as a token reference (falls back to muted text). */
export const identVar = (id: string): string => (id in identColors ? `var(--ident-${id})` : "var(--color-text-muted)");
