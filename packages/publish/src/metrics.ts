/**
 * Normalize platform stats into `metrics_daily` rows (DESIGN.md §9). Unavailable fields are null,
 * never 0 - an unmeasured number is not a zero.
 */
import type { AnalyticsReport, VideoStats } from "./youtube";

export interface MetricsDailyRow {
  publication_id: string;
  /** YYYY-MM-DD */
  date: string;
  views: number | null;
  watch_time_s: number | null;
  avg_view_duration_s: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  subs_delta: number | null;
}

export function emptyMetricsRow(publication_id: string, date: string): MetricsDailyRow {
  return {
    publication_id,
    date,
    views: null,
    watch_time_s: null,
    avg_view_duration_s: null,
    likes: null,
    comments: null,
    shares: null,
    subs_delta: null,
  };
}

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * YouTube Analytics reports.query with dimensions=day, one video per query.
 * estimatedMinutesWatched -> seconds; averageViewDuration is already seconds;
 * subs_delta = subscribersGained - subscribersLost (null unless both present).
 */
export function normalizeYouTubeAnalytics(publication_id: string, report: AnalyticsReport): MetricsDailyRow[] {
  const idx = new Map(report.columnHeaders.map((h, i) => [h.name, i]));
  const dayIdx = idx.get("day");
  if (dayIdx === undefined) throw new Error("analytics report has no 'day' dimension");
  const col = (row: Array<string | number>, name: string) => {
    const i = idx.get(name);
    return i === undefined ? null : toNum(row[i]);
  };
  return (report.rows ?? []).map((row) => {
    const minutes = col(row, "estimatedMinutesWatched");
    const gained = col(row, "subscribersGained");
    const lost = col(row, "subscribersLost");
    return {
      publication_id,
      date: String(row[dayIdx]),
      views: col(row, "views"),
      watch_time_s: minutes === null ? null : Math.round(minutes * 60),
      avg_view_duration_s: col(row, "averageViewDuration"),
      likes: col(row, "likes"),
      comments: col(row, "comments"),
      shares: col(row, "shares"),
      subs_delta: gained === null || lost === null ? null : gained - lost,
    };
  });
}

/**
 * Data API videos.list statistics are LIFETIME totals, available immediately (Analytics lags
 * 1-3 days). Use as a same-day snapshot; watch time, shares and subscribers are not exposed.
 * The row is a LIFETIME snapshot, not a per-day delta: consumers must take the latest row as the
 * total and difference consecutive rows for per-day values (apps/server metrics.ts), never sum them.
 */
export function normalizeYouTubeStatistics(publication_id: string, date: string, stats: VideoStats): MetricsDailyRow {
  return {
    ...emptyMetricsRow(publication_id, date),
    views: stats.viewCount,
    likes: stats.likeCount,
    comments: stats.commentCount,
  };
}
