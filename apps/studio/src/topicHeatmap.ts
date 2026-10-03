/**
 * Pure helpers of the topic heatmap (ADR 011): topic rows x video ordinal columns, coloured by how
 * recently each video was made. Bucket boundaries live in @statreel/schemas (RECENCY_BUCKETS) so the
 * server tags and the legend draws from one constant.
 */
import { type BucketId, bucketForAge, type TopicHeatmap } from "@statreel/schemas";

export type TopicRow = TopicHeatmap["topics"][number];
export type TopicVideoCell = TopicRow["videos"][number];

export const bucketOf = (ageDays: number): BucketId => bucketForAge(ageDays);

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

/** Last video first (never-produced rows last), then label A-Z; the server sorts the same way. */
export function sortTopics<T extends { last_at: string | null; label: string }>(topics: readonly T[]): T[] {
  return [...topics].sort((a, b) => {
    if (a.last_at && b.last_at && a.last_at !== b.last_at) return a.last_at < b.last_at ? 1 : -1;
    if (!!a.last_at !== !!b.last_at) return a.last_at ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

const DAY_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "Energy, video 2 of 3, created 3 Oct 2026, 3 days ago" */
export function cellAria(topic: string, v: TopicVideoCell, total: number): string {
  const when = v.age_days < 1 ? "today" : v.age_days === 1 ? "1 day ago" : `${v.age_days} days ago`;
  return `${topic}, video ${v.n} of ${total}, created ${DAY_FMT.format(new Date(v.created_at))}, ${when}`;
}
