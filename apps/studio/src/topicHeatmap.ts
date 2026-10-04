/**
 * Pure helpers of the topic heatmap (ADR 011): topic rows x video ordinal columns, coloured by how
 * recently each video was made. Bucket boundaries live in @statreel/schemas (RECENCY_BUCKETS) so the
 * server tags and the legend draws from one constant.
 */
import type { TopicHeatmap } from "@statreel/schemas";
import { gridMove } from "./heatmap";

export type TopicRow = TopicHeatmap["topics"][number];
export type TopicVideoCell = TopicRow["videos"][number];

/** Cell text: "today", "3d", "2w", "4mo", "1y" (mono, tabular; the colour is never the only signal). */
export function ageLabel(ageDays: number): string {
  const d = Math.max(0, Math.floor(ageDays));
  if (d < 1) return "today";
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.floor(d / 7)}w`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

/** Ordinals shown for a widest row of `max` videos: all up to `cap`, else the newest `cap` plus an "earlier" count. */
export function visibleColumns(max: number, cap = 24): { first: number; last: number; earlier: number } {
  const last = Math.max(1, max);
  if (last <= cap) return { first: 1, last, earlier: 0 };
  return { first: last - cap + 1, last, earlier: last - cap };
}

/**
 * Widest row to draw. The server's `max_videos` counts finished videos only, so a row whose next
 * video is queued or rendering needs one more column, or its ghost cell falls off the grid.
 */
export function gridWidth(maxVideos: number, rows: readonly Pick<TopicRow, "videos" | "pending">[]): number {
  return rows.reduce(
    (m, t) => Math.max(m, t.videos.length + (t.pending.running || t.pending.queued > 0 ? 1 : 0)),
    maxVideos,
  );
}

/** Last video first (never-produced rows last), then label A-Z; the server sorts the same way. */
export function sortTopics<T extends { last_at: string | null; label: string }>(topics: readonly T[]): T[] {
  return [...topics].sort((a, b) => {
    if (a.last_at && b.last_at && a.last_at !== b.last_at) return a.last_at < b.last_at ? 1 : -1;
    if (!!a.last_at !== !!b.last_at) return a.last_at ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

const DAY_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "Energy, video 2 of 3, Solar race, created 3 Oct 2026, 3 days ago" (the title is read, not only a hover tooltip). */
export function cellAria(topic: string, v: TopicVideoCell, total: number): string {
  const when = v.age_days < 1 ? "today" : v.age_days === 1 ? "1 day ago" : `${v.age_days} days ago`;
  const title = v.title.trim() ? `, ${v.title.trim()}` : "";
  return `${topic}, video ${v.n} of ${total}${title}, created ${DAY_FMT.format(new Date(v.created_at))}, ${when}`;
}

export type CellTarget =
  | { kind: "file"; url: string }
  | { kind: "project"; projectId: string }
  | { kind: "case" }
  | { kind: "none" };

/**
 * Where a video cell leads, in order: the served file (`url`, new tab), else its Studio project
 * (`project_id`), else the Board case (`case_id`). The project outranks the case because it is the
 * video itself; the case only explains where it came from.
 */
export function cellTarget(v: Pick<TopicVideoCell, "url" | "project_id" | "case_id">): CellTarget {
  if (v.url) return { kind: "file", url: v.url };
  if (v.project_id) return { kind: "project", projectId: v.project_id };
  if (v.case_id) return { kind: "case" };
  return { kind: "none" };
}

/** aria-colcount: the topic column, the "+N earlier" overflow column when shown, and the ordinals. */
export const gridColCount = (ordinals: number, earlier: number): number => 1 + (earlier > 0 ? 1 : 0) + ordinals;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Screen-reader summary of the grid's shape, from the data: "3 topics, 0 videos, 6 accepted cases". */
export function topicSummary(rows: readonly Pick<TopicRow, "videos" | "accepted_cases">[]): string {
  const videos = rows.reduce((a, t) => a + t.videos.length, 0);
  const cases = rows.reduce((a, t) => a + t.accepted_cases, 0);
  return `${plural(rows.length, "topic")}, ${plural(videos, "video")}, ${plural(cases, "accepted case")}`;
}

/** A link label that tells assistive tech the link leaves the page ("opens in a new tab"). */
export const newTabLabel = (label: string): string => `${label}, opens in a new tab`;

/** Label of a cell that holds no video, so arrows land on something that says what it is. */
export function emptyCellLabel(topic: string, n: number, pending: string | null, none: boolean): string {
  if (pending) return `${topic}, video ${n}: ${pending}`;
  return none ? `${topic}: no video yet` : `${topic}, video ${n}: empty`;
}

export type GridPos = { r: number; c: number };

/** The roving position kept inside the grid (rows or columns may shrink when "Show all topics" flips). */
export function clampPos(p: GridPos, rows: number, cols: number): GridPos {
  return { r: Math.max(0, Math.min(rows - 1, p.r)), c: Math.max(0, Math.min(cols - 1, p.c)) };
}

/** Roving tabindex: exactly one cell of the grid is a tab stop. */
export const tabIndexFor = (cur: GridPos, r: number, c: number): 0 | -1 => (cur.r === r && cur.c === c ? 0 : -1);

/** Next position for a grid key over ALL cells (linked or not); null for keys that do not move. */
export function nextPos(cur: GridPos, key: string, rows: number, cols: number): GridPos | null {
  if (rows < 1 || cols < 1) return null;
  const at = clampPos(cur, rows, cols);
  const m = gridMove(at.r, at.c, key, rows, cols);
  return m ? { r: m[0], c: m[1] } : null;
}
