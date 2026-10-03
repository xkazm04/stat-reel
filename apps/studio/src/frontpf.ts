/**
 * Pure helpers for the Photo Finish front (A/3 port): counts for the readout and the ways in,
 * the registry picture, the short's scene strip. Every figure is counted from API data; no React,
 * no DOM (unit-tested in frontpf.test.ts).
 */
import type { LicenseClass, Mode } from "@statreel/schemas";
import { SPORTS } from "./logic";
import { bucketCounts, type ProjectBucketCounts } from "./projectState";

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
/** "Ten" for 10; digits above twelve. */
export const numberWord = (n: number): string => WORDS[n] ?? String(n);

type Src = { id: string; verdict: string; sport: string };

/** Sources across the licence line in a mode: legal only (monetized), legal + NC (non-commercial). */
export function acrossCount(sources: { verdict: string }[], mode: Mode): number {
  return sources.filter((s) => s.verdict === "legal" || (mode === "non_commercial" && s.verdict === "non_commercial"))
    .length;
}

/**
 * Studio counts from project statuses (the buckets of projectState.ts, which partition the
 * projects: published + refused + gated + notGated = total). Rendered-but-not-gated means the gate
 * refused the render; gated means the gate allowed it and the private upload is left.
 */
export function studioCounts(projects: { status: string }[]): ProjectBucketCounts {
  return bucketCounts(projects);
}

// ------------------------------------------------------------------ on the line today

type TopicLike = {
  key: string;
  label: string;
  accepted_cases: number;
  pending: { queued: number; running: boolean };
  videos: unknown[];
};

/** What the owner has in hand today, counted from the topic heatmap and the Board (no invention). */
export type OnTheLine = {
  acceptedCases: number;
  /** topics with accepted cases, most first (ties by label) */
  byTopic: { key: string; label: string; accepted: number }[];
  /** generation jobs waiting, summed over topics */
  queued: number;
  /** topics with a generation job running (the API reports a flag per topic, not a count) */
  running: number;
  /** videos on the ledger */
  videos: number;
  boardAccepted: number;
  boardPending: number;
};

export function onTheLine(topics: TopicLike[], board: { status: string }[]): OnTheLine {
  const byTopic = topics
    .filter((t) => t.accepted_cases > 0)
    .map((t) => ({ key: t.key, label: t.label, accepted: t.accepted_cases }))
    .sort((a, b) => b.accepted - a.accepted || a.label.localeCompare(b.label));
  return {
    acceptedCases: byTopic.reduce((n, t) => n + t.accepted, 0),
    byTopic,
    queued: topics.reduce((n, t) => n + t.pending.queued, 0),
    running: topics.filter((t) => t.pending.running).length,
    videos: topics.reduce((n, t) => n + t.videos.length, 0),
    boardAccepted: board.filter((i) => i.status === "accepted").length,
    boardPending: board.filter((i) => i.status === "pending").length,
  };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Where the owner acts on a count (the view maps each to a route). */
export type LineTarget = "topics" | "board-pending" | "board-accepted";
export type LineItem = { id: string; to: LineTarget; n: number; text: string; detail: string | null };

/** The panel's rows: one per count, each linked to where the owner acts; zero rows stay (a labelled 0). */
export function lineItems(l: OnTheLine): LineItem[] {
  const top = l.byTopic.slice(0, 3).map((t) => `${t.label} ${t.accepted}`);
  const more = l.byTopic.length - top.length;
  return [
    {
      id: "cases",
      to: "topics",
      n: l.acceptedCases,
      text: plural(l.acceptedCases, "accepted case", "accepted cases"),
      detail: top.length ? `${top.join(", ")}${more > 0 ? `, +${more} more` : ""}` : null,
    },
    {
      id: "generation",
      to: "topics",
      n: l.queued + l.running,
      text: `generating: ${l.queued} queued, ${l.running} ${plural(l.running, "topic", "topics")} running`,
      detail: null,
    },
    { id: "board-accepted", to: "board-accepted", n: l.boardAccepted, text: "accepted on the Board", detail: null },
    { id: "board-pending", to: "board-pending", n: l.boardPending, text: "awaiting your call on the Board", detail: null },
  ];
}

/** True when nothing is accepted, queued, running or pending: the panel then says so in one line. */
export const lineIsQuiet = (l: OnTheLine): boolean =>
  l.acceptedCases + l.queued + l.running + l.boardAccepted + l.boardPending === 0;

/** The ledger line; honest about the stub: finished generation jobs do not add a video yet. */
export const videosLine = (l: OnTheLine): string =>
  l.videos === 0
    ? "0 videos rendered yet: a finished generation job does not add one to the ledger yet"
    : `${l.videos} ${plural(l.videos, "video", "videos")} on the ledger`;

export const REG_GROUPS = [...SPORTS, "all"] as const;
export const REG_CLASSES: LicenseClass[] = ["avoid", "paid", "non_commercial", "legal"];

/** The registry picture: sources per sport group (all = cross-sport) and licence verdict. */
export function registryGrid<T extends Src>(sources: T[]): { group: string; total: number; cells: Record<LicenseClass, T[]> }[] {
  return REG_GROUPS.map((g) => {
    const list = sources.filter((s) => s.sport === g);
    const cells = { avoid: [], paid: [], non_commercial: [], legal: [] } as Record<LicenseClass, T[]>;
    for (const s of list) if (s.verdict in cells) cells[s.verdict as LicenseClass].push(s);
    return { group: g, total: list.length, cells };
  });
}

/**
 * Registry picture columns: never start .95fr, paid .62fr, NC 1fr, legal 1fr. The share before the
 * line: monetized stops before legal, non-commercial before NC.
 */
export function registryShare(mode: Mode): number {
  const total = 0.95 + 0.62 + 1 + 1;
  return mode === "monetized" ? (0.95 + 0.62 + 1) / total : (0.95 + 0.62) / total;
}

/** A hook line split at "≠" (the Latin subsets lack the glyph; the UI draws it). */
export function splitNeq(text: string): [string, string | null] {
  const i = text.indexOf("≠");
  if (i < 0) return [text, null];
  return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
}

export type StripScene = { id: string; label: string; start: number; end: number };

/**
 * Scenes on a time strip: measured timing when Produce has run, else an even split over the
 * draft duration (labelled as such by the caller).
 */
export function sceneStrip(
  scenes: { id: string; kind: string }[],
  timing: { duration_s: number; scenes: { scene_id: string; start_s: number; end_s: number }[] } | null | undefined,
  draftDuration: number,
): { scenes: StripScene[]; duration: number; measured: boolean } {
  if (timing && timing.duration_s > 0) {
    const kind = new Map(scenes.map((s) => [s.id, s.kind]));
    return {
      scenes: timing.scenes.map((s) => ({ id: s.scene_id, label: kind.get(s.scene_id) ?? s.scene_id, start: s.start_s, end: s.end_s })),
      duration: timing.duration_s,
      measured: true,
    };
  }
  const d = draftDuration > 0 ? draftDuration : 1;
  const w = scenes.length ? d / scenes.length : d;
  return {
    scenes: scenes.map((s, i) => ({ id: s.id, label: s.kind, start: i * w, end: (i + 1) * w })),
    duration: d,
    measured: false,
  };
}

/** m:ss.mmm for the readout clock. */
export function clock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? "0" : ""}${r.toFixed(3)}`;
}
