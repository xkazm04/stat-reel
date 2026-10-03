/** Shared keyboard guard for the Board's single-letter shortcuts (decide, J/K, Z). No React. */

/** Is the event aimed at something the owner types into? Then a letter is text, not a shortcut. */
export const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && !!t.closest("input, textarea, select, [contenteditable='true']");
