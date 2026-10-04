/**
 * Pure helpers for the Photo Finish front (A/3 port): counts for the readout and the ways in,
 * the registry picture, the short's scene strip. Every figure is counted from API data; no React,
 * no DOM (unit-tested in frontpf.test.ts).
 */
import type { LicenseClass, Mode } from "@statreel/schemas";
import { serverAnswered, serverError } from "./api";
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
 * draft duration (labelled as such by the caller). Null while neither is known (the player's meta
 * has not arrived, or the composition has no player): a strip then would print an invented length.
 */
export function sceneStrip(
  scenes: { id: string; kind: string }[],
  timing: { duration_s: number; scenes: { scene_id: string; start_s: number; end_s: number }[] } | null | undefined,
  draftDuration: number,
): { scenes: StripScene[]; duration: number; measured: boolean } | null {
  if (timing && timing.duration_s > 0) {
    const kind = new Map(scenes.map((s) => [s.id, s.kind]));
    return {
      scenes: timing.scenes.map((s) => ({ id: s.scene_id, label: kind.get(s.scene_id) ?? s.scene_id, start: s.start_s, end: s.end_s })),
      duration: timing.duration_s,
      measured: true,
    };
  }
  if (!(draftDuration > 0)) return null;
  const d = draftDuration;
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

// ------------------------------------------------------------------ copy from data, lane rotation

/**
 * Why a Front load failed, in the words the cause allows (async-ui-states/failure-states; the same
 * split as ui.tsx Failure): "API offline" only when nothing answered (a thrown fetch, the dev
 * proxy's own page), else the API's own error verbatim - an answered 500 is not a down API.
 */
export const loadCause = (e: unknown): string =>
  serverAnswered(e) ? `the API answered: ${serverError(e)}` : "API offline";

/**
 * Which state the Front's "Open the heatmap" way is in. Held counts win (a failed refetch keeps
 * them); otherwise a failure, a load in flight and an answered-but-empty mode are three different
 * claims and must not share one sentence.
 */
export function heatmapWay(q: { isLoading: boolean; isError: boolean }, perMode: number): "loading" | "error" | "empty" | "ready" {
  if (perMode > 0) return "ready";
  if (q.isError) return "error";
  return q.isLoading ? "loading" : "empty";
}

/** "Ten lanes", or just "Lanes" while the use cases are not loaded (never a hardcoded count). */
export const lanesLabel = (n: number): string => (n > 0 ? `${numberWord(n)} lanes` : "Lanes");

/**
 * The sports the registry actually covers, in the product's SPORTS order, as prose:
 * "F1, NBA, NHL and soccer". Cross-sport ("all") sources name no sport; "" when there are none.
 */
export function sportsPhrase(sources: { sport: string }[]): string {
  const have = new Set(sources.map((s) => s.sport));
  const names = SPORTS.filter((s) => have.has(s)).map((s) => (s === "Soccer" ? "soccer" : s));
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "30-90 s" across the use cases' durations (ADR 007), or null when there are none. */
export function durationRange(usecases: { duration_s: { min: number; max: number } }[]): string | null {
  if (!usecases.length) return null;
  const lo = Math.min(...usecases.map((u) => u.duration_s.min));
  const hi = Math.max(...usecases.map((u) => u.duration_s.max));
  return lo === hi ? `${lo} s` : `${lo}\u2013${hi} s`;
}

export type RotationInput = {
  reduced: boolean;
  /** the owner paused it (pause button, or by acting on a lane) */
  paused: boolean;
  hovered: boolean;
  focused: boolean;
  /** a lane scene overlay is open */
  sceneOpen: boolean;
  count: number;
};

/**
 * The lane carousel's state (WCAG 2.2.2): it rotates only when it can (two lanes, no reduced
 * motion) and nothing holds it (pause, hover, focus, scene). The pause control shows whenever it
 * could rotate; the stage is a live region only while it is NOT rotating by itself, so a screen
 * reader is not narrated a lane every 3 s.
 */
export function laneRotation(i: RotationInput): { auto: boolean; control: boolean; live: "off" | "polite" } {
  const control = !i.reduced && i.count >= 2;
  const auto = control && !i.paused && !i.hovered && !i.focused && !i.sceneOpen;
  return { auto, control, live: auto ? "off" : "polite" };
}
