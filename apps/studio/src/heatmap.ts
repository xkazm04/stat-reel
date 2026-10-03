/**
 * Pure heatmap helpers for the two layers (grid + cell): the cell's short hint, focus keys, grid
 * keyboard moves, per-sport counts, what would fix one cell (its failing kinds, the legal sources
 * already on the registry, how many other cells the same fix flips) and neighbours to make next.
 * No React, no DOM (unit-tested in heatmap.test.ts).
 */
import type { CellStatus, HeatmapCell, LicenseClass, Mode, Sport } from "@statreel/schemas";
import { allowedIn, decisionAid, failingKinds, relTime, SPORTS } from "./logic";
import { bestCells } from "./display";

/**
 * Why a Blocked cell is blocked (DESIGN §7). Blocked stays ONE status; the cause is what a reader
 * needs to tell a to-do ("not tested") from a dead end ("not applicable") or a real failure.
 * Derived from the payload only: the server writes "not applicable: ..." into `reason` for a
 * format that does not exist in that sport (apps/server/src/heatmap.ts), and every other cause
 * comes from the first required kind without a passing source.
 */
export type BlockedCause = "not-tested" | "failing-test" | "not-applicable" | "licence" | "no-source";

export function blockedCause(c: HeatmapCell): BlockedCause {
  if (/^not applicable\b/i.test(c.reason)) return "not-applicable";
  const k = c.kinds.find((x) => !x.best);
  if (!k) return "not-applicable"; // nothing to test or fix: every kind passes, yet the cell is blocked
  if (k.tested) return "failing-test";
  if (!k.sources.length) return "no-source";
  // declared sources exist but none could ever clear in this mode: testing them would not help
  return k.sources.some((s) => allowedIn(c.mode, s.license_class)) ? "not-tested" : "licence";
}

const BLOCKED_HINT: Record<BlockedCause, string> = {
  "not-tested": "not tested",
  "failing-test": "failing test",
  "not-applicable": "n/a here",
  licence: "licence",
  "no-source": "no source",
};
/** Legend wording per cause, in display order. */
export const BLOCKED_CAUSES: { cause: BlockedCause; label: string }[] = [
  { cause: "not-tested", label: "not tested" },
  { cause: "failing-test", label: "failing test" },
  { cause: "no-source", label: "no source" },
  { cause: "licence", label: "licence" },
  { cause: "not-applicable", label: "n/a" },
];

/** Blocked cells of one mode, counted per cause (zero causes omitted from the legend by the caller). */
export function blockedBreakdown(cells: HeatmapCell[], mode: Mode): Record<BlockedCause, number> {
  const out: Record<BlockedCause, number> = {
    "not-tested": 0,
    "failing-test": 0,
    "not-applicable": 0,
    licence: 0,
    "no-source": 0,
  };
  for (const c of cells) if (c.mode === mode && c.status === "blocked") out[blockedCause(c)]++;
  return out;
}

/** "34 blocked · 33 not tested · 1 n/a" for the legend; "" when nothing is blocked. */
export function blockedLegend(b: Record<BlockedCause, number>): string {
  const total = Object.values(b).reduce((a, n) => a + n, 0);
  if (!total) return "";
  const parts = BLOCKED_CAUSES.filter((x) => b[x.cause]).map((x) => `${b[x.cause]} ${x.label}`);
  return [`${total} blocked`, ...parts].join(" · ");
}

/** The short second line inside a cell: why, in three words. */
export function cellHint(c: HeatmapCell): string {
  if (c.status === "go") return "cleared, built";
  if (c.status === "data-ready") return "not built yet";
  if (c.status === "ask") {
    const k = c.kinds.find((x) => x.best && !allowedIn(c.mode, x.best));
    return k?.best === "paid" ? "paid licence" : "NC only";
  }
  return BLOCKED_HINT[blockedCause(c)];
}

export const focusKey = (usecase: string, sport: string): string => `${usecase}|${sport}`;

/** "<usecase>|<sport>" -> parts, when both name a known use case and sport. */
export function parseFocus(focus: string | undefined, usecases: { id: string }[]): { uc: string; sport: Sport } | null {
  if (!focus) return null;
  const [uc, sport] = focus.split("|");
  if (!uc || !usecases.some((u) => u.id === uc) || !SPORTS.includes(sport as Sport)) return null;
  return { uc, sport: sport as Sport };
}

/** Next [row, col] for a grid key (arrows, Home, End), clamped; null for other keys. */
export function gridMove(r: number, c: number, key: string, rows: number, cols: number): [number, number] | null {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, v));
  switch (key) {
    case "ArrowRight":
      return [r, clamp(c + 1, cols)];
    case "ArrowLeft":
      return [r, clamp(c - 1, cols)];
    case "ArrowDown":
      return [clamp(r + 1, rows), c];
    case "ArrowUp":
      return [clamp(r - 1, rows), c];
    case "Home":
      return [r, 0];
    case "End":
      return [r, cols - 1];
    default:
      return null;
  }
}

/** Status counts for one sport in a mode. */
export function sportCounts(cells: HeatmapCell[], mode: Mode, sport: string): Record<CellStatus, number> {
  const out: Record<CellStatus, number> = { go: 0, "data-ready": 0, ask: 0, blocked: 0 };
  for (const c of cells) if (c.mode === mode && c.sport === sport) out[c.status]++;
  return out;
}

/** "snapshot 3 h ago" from the newest trend snapshot (the cell data is a snapshot, not live). */
export function snapshotAge(trend: { at: string }[], now = Date.now()): string {
  const at = trend.at(-1)?.at;
  return at ? `snapshot ${relTime(at, now)}` : "no snapshot yet";
}

export type FixCandidate = { id: string; status: string; action: string };
export type CellFix = {
  kind: string;
  /** best licence class that passes today for this kind (any class), or null */
  best: LicenseClass | null;
  tested: boolean;
  /** this kind is the cell's only failing kind: fixing it flips the cell */
  flipsThisCell: boolean;
  /** the status the cell would become if this were its only fix */
  becomes: CellStatus;
  /** sources already on the registry for this kind in this cell whose licence class is allowed in the cell's mode and that do not pass yet */
  candidates: FixCandidate[];
  /** ASK/BLOCKED cells in this mode that this same kind x sport alone would flip (this one included) */
  flipsInGrid: number;
};

const ACTION: Record<string, string> = {
  declared: "test it",
  needs_review: "review its terms",
  fail: "fix its failing test",
};

/**
 * What would clear one cell in its mode: one entry per failing kind (none for Go / Data ready).
 * Candidates are sources the registry already declares whose class clears THIS mode (legal only when
 * monetized; legal or non-commercial in non-commercial mode); finding a new one is the owner's call.
 */
export function cellFixes(cells: HeatmapCell[], cell: HeatmapCell): CellFix[] {
  const failing = failingKinds(cell);
  if (!failing.length) return [];
  const aid = decisionAid(cells, cell.mode);
  return failing.map((kind) => {
    const k = cell.kinds.find((x) => x.kind === kind);
    const entry = aid.find((a) => a.kind === kind && a.sport === cell.sport);
    return {
      kind,
      best: (k?.best ?? null) as LicenseClass | null,
      tested: !!k?.tested,
      flipsThisCell: failing.length === 1,
      becomes: cell.composition_implemented ? "go" : "data-ready",
      candidates: (k?.sources ?? [])
        .filter((s) => allowedIn(cell.mode, s.license_class) && s.status !== "pass")
        .map((s) => ({ id: s.id, status: s.status, action: ACTION[s.status] ?? `resolve "${s.status}"` })),
      flipsInGrid: entry?.flips.length ?? 0,
    };
  });
}

/** Best other cells to make in this mode (status first, then the simplest format). */
export function neighbours(
  cells: HeatmapCell[],
  cell: HeatmapCell,
  stageOf: (usecase: string) => number,
  n = 4,
): HeatmapCell[] {
  return bestCells(cells, cell.mode, stageOf, n + 1)
    .filter((c) => !(c.usecase === cell.usecase && c.sport === cell.sport))
    .slice(0, n);
}

/** Clip-path inset (px) that shows only `rect` inside a box at `box` (both in viewport px). */
export function insetFor(
  rect: { top: number; left: number; right: number; bottom: number },
  box: { top: number; left: number; width: number; height: number },
): string {
  const t = Math.max(0, rect.top - box.top);
  const l = Math.max(0, rect.left - box.left);
  const r = Math.max(0, box.left + box.width - rect.right);
  const b = Math.max(0, box.top + box.height - rect.bottom);
  return `inset(${t.toFixed(1)}px ${r.toFixed(1)}px ${b.toFixed(1)}px ${l.toFixed(1)}px)`;
}
