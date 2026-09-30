/**
 * Pure Photo Finish geometry (A/3): where a lane bar stops relative to the licence line. The line
 * stands where the mode draws it (monetized: only legal crosses; non-commercial: legal and
 * non-commercial). A cell's reach is decided by its weakest required kind; nothing passes the line
 * without a built composition, and only Go crosses it. No React, no DOM (unit-tested).
 */
import type { CellStatus, HeatmapCell, LicenseClass, Mode } from "@statreel/schemas";
import { allowedIn } from "./logic";

/** Share of a lane (percent) a licence class reaches. */
export const REACH: Record<LicenseClass | "none", number> = { none: 0, avoid: 0, paid: 32, non_commercial: 56, legal: 80 };
/** Where the finish line stands per mode (percent of the lane). */
export const LINE: Record<Mode, number> = { monetized: 80, non_commercial: 56 };
/** A Go bar crosses the line and ends here, flag up. */
export const GO_END = 94;
/** Licence classes left to right: toward the line. */
export const CLASS_ORDER: LicenseClass[] = ["paid", "non_commercial", "legal"];

type KindLike = { best: string | null; sources: { id: string; license_class: string; status: string }[] };

/** How far a cell's data gets: the weakest required kind decides (percent). */
export function reach(cell: { kinds: KindLike[] }): number {
  let r = 100;
  for (const k of cell.kinds) r = Math.min(r, REACH[(k.best ?? "none") as LicenseClass | "none"] ?? 0);
  return cell.kinds.length ? r : 0;
}

/** Where a status's bar ends on a lane for a cell (percent). */
export function barEnd(cell: Pick<HeatmapCell, "kinds" | "mode">, status: CellStatus): number {
  if (status === "go") return GO_END;
  if (status === "blocked") return 0;
  return Math.min(reach(cell), LINE[cell.mode]);
}

/** The passing source that sets a kind's best licence class (first pass of that class). */
export function bestSource(k: KindLike): string | null {
  return k.sources.find((s) => s.status === "pass" && s.license_class === k.best)?.id ?? null;
}

/**
 * The finish picture's column split: paid .7fr + non-commercial 1fr + legal 1fr. The share of the
 * picture (after the kind column) that stands before the line in a mode.
 */
export function finishShare(mode: Mode): number {
  const paid = 0.7;
  const total = 2.7;
  return mode === "monetized" ? (paid + 1) / total : paid / total;
}

/** Sources of a kind grouped into the three columns of the finish picture. */
export function byClass<T extends { license_class: string }>(sources: T[]): Record<"paid" | "non_commercial" | "legal", T[]> {
  const out: Record<"paid" | "non_commercial" | "legal", T[]> = { paid: [], non_commercial: [], legal: [] };
  for (const s of sources)
    if (s.license_class === "paid" || s.license_class === "non_commercial" || s.license_class === "legal")
      out[s.license_class].push(s);
  return out;
}

/** True when a source stops short of the line in this mode. */
export const isShort = (cls: string, mode: Mode): boolean => !allowedIn(mode, cls);
