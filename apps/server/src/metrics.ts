/**
 * Cross-channel metrics (DESIGN §6.1 screen 6, §6.7). Unavailable fields stay null; dry runs say so.
 *
 * Semantics: every `metrics_daily` row the pipeline writes is a LIFETIME SNAPSHOT (YouTube Data API
 * videos.list statistics), not a per-day delta - so summing rows double-counts. Therefore:
 *  - a publication's total = its LATEST non-null snapshot per metric;
 *  - a per-day value = the difference between consecutive non-null snapshots; the first snapshot has
 *    no predecessor, so its delta is null (we do not know how much of it accrued that day). The raw
 *    snapshot stays available as `views_total` / `likes_total` on each daily entry;
 *  - a group sums the publications' totals and says how many were unmeasured: `lower_bound` is true
 *    when any member has no data (dry run or not pulled yet), because the sum then under-counts
 *    (measurement-honesty: an unmeasured number is not a zero, and a partial sum is a lower bound).
 */
import { eq } from "drizzle-orm";
import { type Db, metricsDaily, projects, publications, renders } from "./db";

type Row = typeof metricsDaily.$inferSelect;
const sum = (rows: Row[], k: keyof Row): number | null => {
  const vals = rows.map((r) => r[k]).filter((v): v is number => typeof v === "number");
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
};

/** Latest non-null snapshot of a lifetime metric (rows sorted by date). */
const latest = (rows: Row[], k: keyof Row): number | null => {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i]![k];
    if (typeof v === "number") return v;
  }
  return null;
};

/** Per-day deltas between consecutive non-null snapshots; null where unmeasured or no predecessor. */
const deltas = (rows: Row[], k: keyof Row): Array<number | null> => {
  let prev: number | null = null;
  return rows.map((r) => {
    const v = r[k];
    if (typeof v !== "number") return null;
    const d = prev === null ? null : v - prev;
    prev = v;
    return d;
  });
};

export function metricsOverview(db: Db) {
  const pubs = db.select({ pub: publications, project: projects })
    .from(publications)
    .innerJoin(renders, eq(renders.id, publications.render_id))
    .innerJoin(projects, eq(projects.id, renders.project_id))
    .all();
  const out = pubs.map(({ pub, project }) => {
    const daily = db.select().from(metricsDaily).where(eq(metricsDaily.publication_id, pub.id)).all().sort((a, b) => a.date.localeCompare(b.date));
    const dViews = deltas(daily, "views");
    const dLikes = deltas(daily, "likes");
    return {
      publication_id: pub.id, project_id: project.id, title: project.title, use_case_id: project.use_case_id, sport: project.sport,
      platform: pub.platform, external_id: pub.external_id, visibility: pub.visibility, url: pub.url, published_at: pub.published_at, mode: pub.mode,
      views: latest(daily, "views"), likes: latest(daily, "likes"), comments: latest(daily, "comments"), shares: latest(daily, "shares"),
      watch_time_s: latest(daily, "watch_time_s"), subs_delta: latest(daily, "subs_delta"),
      avg_view_duration_s: latest(daily, "avg_view_duration_s"),
      daily: daily.map((d, i) => ({ date: d.date, views: dViews[i]!, likes: dLikes[i]!, views_total: d.views, likes_total: d.likes, avg_view_duration_s: d.avg_view_duration_s })),
      data: pub.mode === "dry" ? "dry-run: nothing was uploaded, so there are no platform metrics" : daily.length ? "platform" : "not pulled yet",
    };
  });
  const group = (key: "use_case_id" | "sport") => {
    const m = new Map<string, { key: string; publications: number; views: number | null; measured: number; unmeasured: number; lower_bound: boolean }>();
    for (const p of out) {
      const g = m.get(p[key]) ?? { key: p[key], publications: 0, views: null, measured: 0, unmeasured: 0, lower_bound: false };
      g.publications++;
      if (p.views !== null) { g.views = (g.views ?? 0) + p.views; g.measured++; } else { g.unmeasured++; g.lower_bound = true; }
      m.set(p[key], g);
    }
    return [...m.values()];
  };
  return { publications: out, by_use_case: group("use_case_id"), by_sport: group("sport") };
}
