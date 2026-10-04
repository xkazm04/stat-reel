import { describe, expect, it } from "vitest";
import { KEY_BLOCKERS, keysSuppressed, overlayOpen } from "./keys";

/** No DOM in this suite: a root that answers the guard's one query from a list of "open" selectors. */
const rootWith = (open: string[]) => ({
  querySelector: (sel: string) =>
    sel
      .split(",")
      .map((s) => s.trim())
      .some((s) => open.includes(s))
      ? {}
      : null,
});

describe("overlayOpen", () => {
  it("is false on a bare page", () => {
    expect(overlayOpen(rootWith([]))).toBe(false);
  });
  it.each(["[data-keys-block]", "dialog[open]:not(.bd-lb)", '[aria-modal="true"]'])("is true while %s matches", (s) => {
    expect(overlayOpen(rootWith([s]))).toBe(true);
  });
  it("covers the log drawer, open dialogs and aria-modal, but spares the Board lightbox", () => {
    expect(KEY_BLOCKERS).toContain("[data-keys-block]");
    expect(KEY_BLOCKERS).toContain("dialog[open]:not(.bd-lb)");
    expect(KEY_BLOCKERS).toContain('[aria-modal="true"]');
    expect(KEY_BLOCKERS).not.toMatch(/^dialog\[open\]/);
  });
});

describe("keysSuppressed", () => {
  it("suppresses while an overlay is open, for any target", () => {
    expect(keysSuppressed(null, rootWith(["[data-keys-block]"]))).toBe(true);
  });
  it("lets keys through on a bare page with no typing target", () => {
    expect(keysSuppressed(null, rootWith([]))).toBe(false);
  });
});
