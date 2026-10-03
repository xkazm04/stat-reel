/**
 * Is this error a lazy-chunk load failure? After a rebuild the old bundle still points at chunk
 * hashes that no longer exist, so the dynamic import rejects; retrying inside the stale bundle
 * can never succeed (lazyRouteComponent caches the rejection), only a reload can. The messages
 * are the engines' own (Chromium, Firefox, Safari), the same set TanStack's isModuleNotFoundError
 * matches, plus the CSS-preload variant Vite raises.
 * No React, no DOM (unit-tested in moduleError.test.ts).
 */
const PREFIXES = [
  "Failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "Importing a module script failed",
  "Unable to preload CSS",
];

export function isModuleLoadError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof (error as { message?: unknown } | null)?.message === "string" ? (error as { message: string }).message : "";
  return PREFIXES.some((p) => message.startsWith(p));
}
