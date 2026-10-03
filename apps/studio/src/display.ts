/**
 * Pure display helpers for the front, the heatmap, the rundown and the sources desk. Every figure
 * they return is counted from API data; no React, no DOM (unit-tested in display.test.ts).
 */
import type { CellStatus, HeatmapCell, LicenseClass, Mode } from "@statreel/schemas";
import { type JobLike, needsYou, SPORTS, stageIndex } from "./logic";

/** The status words the UI writes as text (never colour-only; e2e reads them). */
export const STATUS_WORD: Record<CellStatus, string> = {
  go: "GO",
  "data-ready": "DATA READY",
  ask: "ASK",
  blocked: "BLOCKED",
};
/** One line under a status: what it means for the video. */
export const STATUS_AIR: Record<CellStatus, string> = {
  go: "Cleared to air",
  "data-ready": "Data cleared · composition not built",
  ask: "Rights needed",
  blocked: "Blackout",
};
const STATUS_RANK: Record<CellStatus, number> = { go: 3, "data-ready": 2, ask: 1, blocked: 0 };
export const STATUS_ORDER: CellStatus[] = ["go", "data-ready", "ask", "blocked"];

const KIND_LONG: Record<string, string> = {
  hist: "Historical results",
  bio: "Biographical",
  events: "Event data",
  track: "Tracking",
  live: "Live / recent results",
  money: "Money / transfers",
};
export const kindLong = (k: string): string => KIND_LONG[k] ?? k;

export const LICENCE_WORD: Record<LicenseClass, string> = {
  legal: "Legal",
  non_commercial: "Non-commercial",
  paid: "Paid",
  avoid: "Never fetched",
};

export const formatLabel = (f: string | null | undefined): string => (f === "landscape" ? "16:9" : "9:16");
export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Split a name over two display lines (the second line takes the ident colour). */
export function splitName(name: string): [string, string] {
  const w = name.split(" ");
  if (w.length < 2) return [name, ""];
  const half = Math.ceil(w.length / 2);
  return [w.slice(0, half).join(" "), w.slice(half).join(" ")];
}

/** A figure as the data has it: integers stay whole, others keep up to 3 decimals by magnitude. */
export function fmtValue(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 1 : abs >= 10 ? 2 : 3;
  return Number(v.toFixed(digits)).toLocaleString("en-US", { maximumFractionDigits: digits });
}

export const fmtNum = (v: number | null | undefined): string =>
  v === null || v === undefined ? "—" : v.toLocaleString("en-US");

export function fmtDuration(s: number | null | undefined): string {
  if (s === null || s === undefined || Number.isNaN(s)) return "—";
  return `${Math.floor(s / 60)}:${pad2(Math.floor(s % 60))}`;
}

type RankRow = { name: string; raw_rank: number; adjusted_rank: number };
/** Rows ordered by how far they move between the raw and the adjusted rank (biggest first). */
export function biggestMovers<T extends RankRow>(rows: T[], n = 6): T[] {
  return [...rows]
    .sort(
      (a, b) =>
        Math.abs(b.raw_rank - b.adjusted_rank) - Math.abs(a.raw_rank - a.adjusted_rank) ||
        a.adjusted_rank - b.adjusted_rank,
    )
    .slice(0, n);
}

type RegistrySource = {
  id: string;
  verdict: string;
  sport: string;
  kinds: readonly string[];
  partial_kinds?: readonly string[];
};

/** Counts by licence verdict. */
export function verdictCounts(sources: { verdict: string }[]): Record<LicenseClass, number> {
  const c: Record<LicenseClass, number> = { legal: 0, non_commercial: 0, paid: 0, avoid: 0 };
  for (const s of sources) if (s.verdict in c) c[s.verdict as LicenseClass]++;
  return c;
}

/** Registry sources marked avoid that would otherwise touch a cell (its sport and a required kind). */
export function neverFetchedFor<T extends RegistrySource>(sources: T[], sport: string, kinds: string[]): T[] {
  return sources.filter(
    (s) =>
      s.verdict === "avoid" &&
      (s.sport === sport || s.sport === "all") &&
      (s.kinds.length === 0 ||
        s.kinds.some((k) => kinds.includes(k)) ||
        (s.partial_kinds ?? []).some((k) => kinds.includes(k))),
  );
}

/** Best cells to make in a mode: best status first, then the simplest format (use-case stage). */
export function bestCells(
  cells: HeatmapCell[],
  mode: Mode,
  stageOf: (usecase: string) => number,
  n = 5,
): HeatmapCell[] {
  return cells
    .filter((c) => c.mode === mode)
    .sort(
      (a, b) =>
        STATUS_RANK[b.status] - STATUS_RANK[a.status] ||
        stageOf(a.usecase) - stageOf(b.usecase) ||
        SPORTS.indexOf(a.sport) - SPORTS.indexOf(b.sport),
    )
    .slice(0, n);
}

/** Trend of GO counts for one use case x mode, with the change since the oldest snapshot. */
export function trendSummary(series: number[]): { now: number; delta: number | null; snapshots: number } {
  const now = series.at(-1) ?? 0;
  return { now, delta: series.length > 1 ? now - (series[0] ?? 0) : null, snapshots: series.length };
}

/** SVG polyline points for a sparkline; null when there is no numeric value at all. */
export function sparkPoints(values: (number | null)[], w: number, h: number, pad = 3): string | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (!nums.length) return null;
  const max = Math.max(...nums);
  const min = Math.min(0, ...nums);
  const span = max - min || 1;
  const n = values.length;
  const pts: string[] = [];
  values.forEach((v, i) => {
    if (typeof v !== "number") return;
    const x = n === 1 ? w / 2 : (i / (n - 1)) * w;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  return pts.join(" ");
}

export type ProjectLike = { id: string; status: string; created_at: string; jobs?: JobLike[] };

/** Rundown order: published sinks; needs-you first; then closest to air; then newest. */
export function rundownOrder<T extends ProjectLike>(projects: T[]): T[] {
  const score = (p: T) =>
    [p.status === "published" ? 0 : 1, needsYou(p.status, p.jobs?.[0]) ? 1 : 0, stageIndex(p.status)] as const;
  return [...projects].sort((a, b) => {
    const x = score(a);
    const y = score(b);
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2] || b.created_at.localeCompare(a.created_at);
  });
}

/** Newest project that is not published yet (the front's Resume). */
export function resumeCandidate<T extends { status: string; created_at: string }>(projects: T[]): T | null {
  return (
    [...projects].filter((p) => p.status !== "published").sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ??
    null
  );
}

/** The newest queued/running job, if any. */
export function activeJob<T extends { status: string; created_at: string }>(jobs: T[]): T | null {
  return (
    [...jobs]
      .filter((j) => j.status === "queued" || j.status === "running")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  );
}

/** Percent string for a 0..1 job progress. */
export const pct = (p: number | null | undefined): string => `${Math.round(Math.max(0, Math.min(1, p ?? 0)) * 100)} %`;
