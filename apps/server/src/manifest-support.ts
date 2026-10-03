/**
 * Provenance-manifest inputs derived from what was actually rendered (DESIGN §6.8, ADR 003) instead of
 * literals: the warehouse views a composition reads, the composition and renderer versions, and the
 * audio assets the current timing really references. Pure of the DB so they can be unit-tested.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Timeline } from "@statreel/schemas";

/** Warehouse models/views each composition reads (its query templates); a composition missing here cannot be rendered into a manifest. */
export const COMPOSITION_DATA: Record<string, { models: string[]; views: string[] }> = {
  EraAdjustedSlope: { models: ["mart_era_adjusted"], views: ["f1_driver_era_adjusted"] },
};

/** `EraAdjustedSlope-vertical` -> `EraAdjustedSlope` */
export const compositionBase = (compositionId: string): string => compositionId.replace(/-(vertical|landscape)$/, "");

const readJson = (f: string) => JSON.parse(readFileSync(f, "utf8")) as { version?: string; dependencies?: Record<string, string> };

export type ManifestBuildInfo = { composition: string; renderer: string; views: string[]; models: string[] };

/** Versions come from packages/compositions/package.json (composition version, pinned `remotion` renderer). */
export function manifestBuildInfo(compositionId: string, repoRoot: string): ManifestBuildInfo {
  const base = compositionBase(compositionId);
  const data = COMPOSITION_DATA[base];
  if (!data) throw new Error(`composition ${base} has no declared data views (COMPOSITION_DATA in manifest-support.ts)`);
  const pkg = readJson(path.join(repoRoot, "packages", "compositions", "package.json"));
  const remotion = pkg.dependencies?.remotion;
  if (!pkg.version || !remotion) throw new Error("packages/compositions/package.json has no version / remotion dependency");
  return {
    composition: `${base}@${pkg.version}`,
    renderer: `remotion@${remotion.replace(/^[^\d]*/, "")}`,
    views: data.views,
    models: [...data.models, ...data.views],
  };
}

const baseName = (src: string) => decodeURIComponent(src.split("?")[0]!.split("/").at(-1) ?? "");

/** File names of the audio the timeline plays: every scene's voice and every music cue. */
export function referencedAudioFiles(timing: Pick<Timeline, "scenes" | "music"> | undefined): string[] {
  const srcs = [...(timing?.scenes ?? []).map((s) => s.voice_src), ...(timing?.music ?? []).map((m) => m.src)];
  return [...new Set(srcs.filter((s): s is string => !!s).map(baseName).filter(Boolean))];
}
