/**
 * Render & gate state helpers. No React, no DOM.
 * `renders` is newest first (ProjectDetail order), so index 0 is the latest render.
 */

/** True when the viewer pinned a render (picker) and a different, newer one now exists. */
export function isNewerRender(renders: readonly { id: string }[], pinnedId: string | null): boolean {
  const latest = renders[0];
  return !!pinnedId && !!latest && latest.id !== pinnedId && renders.some((r) => r.id === pinnedId);
}

/**
 * Whether the manifest names a caption sidecar of this file name. Narration-free videos write no
 * sidecar, so a <track> pointing at one would 404; unknown (manifest not loaded) counts as no.
 */
export function hasCaptionSidecar(
  manifest: { captions?: { sidecar?: readonly string[] } } | null | undefined,
  file: string,
): boolean {
  return !!manifest?.captions?.sidecar?.includes(file);
}

/** A render has post-render checks to tabulate (checks_json parsed to a non-empty object). */
export const hasChecks = (checks: Record<string, unknown> | null): checks is Record<string, unknown> =>
  !!checks && Object.keys(checks).length > 0;
