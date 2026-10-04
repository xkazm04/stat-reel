/** Shared keyboard guard for the Board's single-letter shortcuts (decide, J/K, Z). No React. */

/** Is the event aimed at something the owner types into? Then a letter is text, not a shortcut. */
export const typing = (t: EventTarget | null): boolean =>
  typeof HTMLElement !== "undefined" && t instanceof HTMLElement && !!t.closest("input, textarea, select, [contenteditable='true']");

/**
 * Overlays that own the keyboard: the generation log drawer (`data-keys-block`, a non-modal dialog the
 * owner reads while the page stays live behind it), any open native <dialog> that is not a Board lightbox
 * (`.bd-lb` is where decisions are MADE, so its keys must keep working; the cancel confirm and the
 * calendar's dialogs are not), and anything that says `aria-modal`.
 */
export const KEY_BLOCKERS = '[data-keys-block], dialog[open]:not(.bd-lb), [aria-modal="true"]';

/** Is an overlay open that the decision and undo keys must leave alone? `root` is the document (a seam for tests). */
export const overlayOpen = (root: { querySelector(selector: string): unknown } = document): boolean =>
  root.querySelector(KEY_BLOCKERS) !== null;

/** One guard for every Board shortcut (decide, J/K, Z): the owner is typing, or an overlay is open. */
export const keysSuppressed = (t: EventTarget | null, root?: { querySelector(selector: string): unknown }): boolean =>
  typing(t) || overlayOpen(root);
