/**
 * Theme runtime (ADR 006): `onair` (A/1, dark) or `photofinish` (A/3, light) on <html data-theme>.
 * Default follows `prefers-color-scheme` (dark -> onair, light -> photofinish) and keeps following
 * it until the owner picks one in the nav; the pick persists per browser (localStorage, guarded).
 * index.html runs the same resolution inline before first paint, so there is no flash.
 */
import { type ThemeName, themes } from "@statreel/design-tokens";
import { createContext, createElement, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

export type { ThemeName };
export const THEME_KEY = "statreel.theme";
export const THEME_LABEL: Record<ThemeName, string> = { onair: "On Air", photofinish: "Photo Finish" };
export const THEME_SCHEME_WORD: Record<ThemeName, string> = { onair: "dark", photofinish: "light" };

export const isTheme = (v: unknown): v is ThemeName => typeof v === "string" && (themes as readonly string[]).includes(v);

/** The theme to show: a stored pick wins, else the system scheme. Pure (unit-tested). */
export function resolveTheme(stored: string | null | undefined, prefersDark: boolean): ThemeName {
  if (isTheme(stored)) return stored;
  return prefersDark ? "onair" : "photofinish";
}

export const otherTheme = (t: ThemeName): ThemeName => (t === "onair" ? "photofinish" : "onair");

export function readStoredTheme(): string | null {
  try {
    return window.localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

export function writeStoredTheme(t: ThemeName): void {
  try {
    window.localStorage.setItem(THEME_KEY, t);
  } catch {
    // private mode or blocked storage: the pick lasts for this page only
  }
}

const DARK = "(prefers-color-scheme: dark)";
const prefersDark = (): boolean => typeof window !== "undefined" && !!window.matchMedia?.(DARK).matches;

function apply(t: ThemeName): void {
  const root = document.documentElement;
  root.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "onair" ? "#05070c" : "#eceff2");
}

type ThemeCtx = { theme: ThemeName; setTheme: (t: ThemeName) => void; toggle: () => void; chosen: boolean };
const Ctx = createContext<ThemeCtx>({ theme: "onair", setTheme: () => {}, toggle: () => {}, chosen: false });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [chosen, setChosen] = useState(() => isTheme(readStoredTheme()));
  const [theme, set] = useState<ThemeName>(() => resolveTheme(readStoredTheme(), prefersDark()));

  useEffect(() => apply(theme), [theme]);

  // follow the system scheme until the owner picks a theme
  useEffect(() => {
    if (chosen) return;
    const m = window.matchMedia?.(DARK);
    if (!m) return;
    const on = () => set(resolveTheme(null, m.matches));
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [chosen]);

  const setTheme = useCallback((t: ThemeName) => {
    writeStoredTheme(t);
    setChosen(true);
    set(t);
  }, []);
  const toggle = useCallback(() => setTheme(otherTheme(theme)), [setTheme, theme]);
  return createElement(Ctx.Provider, { value: { theme, setTheme, toggle, chosen } }, children);
}

export const useTheme = (): ThemeCtx => useContext(Ctx);
