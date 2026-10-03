/**
 * Theme (ADR 009): Photo Finish is the only studio theme. `<html data-theme="photofinish">` is
 * static (index.html), so the scoped selectors keep applying; there is no switch and no provider.
 * Earlier builds stored a pick in `localStorage["statreel.theme"]`; any stored value other than
 * the current theme is dropped on boot (index.html does the same inline before first paint).
 */
export const THEME = "photofinish";
export const THEME_KEY = "statreel.theme";

type StoreLike = Pick<Storage, "getItem" | "removeItem">;

/** Remove a stale stored theme pick. Returns true when something was removed. Storage may throw: guarded. */
export function dropStaleTheme(store?: StoreLike): boolean {
  try {
    const s = store ?? window.localStorage;
    const v = s.getItem(THEME_KEY);
    if (v === null || v === THEME) return false;
    s.removeItem(THEME_KEY);
    return true;
  } catch {
    return false;
  }
}
