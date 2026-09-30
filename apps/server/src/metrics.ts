/** Cross-channel metrics (DESIGN §6.1 screen 6, §6.7). Unavailable fields stay null; dry runs say so. */
import { eq } from "drizzle-orm";
import { type Db, metricsDaily, projects, publications, renders } from "./db";

type Row = typeof metricsDaily.$inferSelect;
const sum = (rows: Row[], k: keyof Row): number | null => {
  const vals = rows.map((r) => r[k]).filter((v): v is number => typeof v === "number");
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
};

export function metricsOverview(db: Db) {
  const pubs = db.select({ pub: publications, project: projects })
    .from(publications)
    .innerJoin(renders, eq(renders.id, publications.render_id))
    .innerJoin(projects, eq(projects.id, renders.project_id))
    .all();
  const out = pubs.map(({ pub, project }) => {
    const daily = db.select().from(metricsDaily).where(eq(metricsDaily.publication_id, pub.id)).all().sort((a, b) => a.date.localeCompare(b.date));
    return {
      publication_id: pub.id, project_id: project.id, title: project.title, use_case_id: project.use_case_id, sport: project.sport,
      platform: pub.platform, external_id: pub.external_id, visibility: pub.visibility, url: pub.url, published_at: pub.published_at, mode: pub.mode,
      views: sum(daily, "views"), likes: sum(daily, "likes"), comments: sum(daily, "comments"), shares: sum(daily, "shares"),
      watch_time_s: sum(daily, "watch_time_s"), subs_delta: sum(daily, "subs_delta"),
      avg_view_duration_s: daily.length ? daily.at(-1)!.avg_view_duration_s : null,
      daily: daily.map((d) => ({ date: d.date, views: d.views, likes: d.likes, avg_view_duration_s: d.avg_view_duration_s })),
      data: pub.mode === "dry" ? "dry-run: nothing was uploaded, so there are no platform metrics" : daily.length ? "platform" : "not pulled yet",
    };
  });
  const group = (key: "use_case_id" | "sport") => {
    const m = new Map<string, { key: string; publications: number; views: number | null }>();
    for (const p of out) {
      const g = m.get(p[key]) ?? { key: p[key], publications: 0, views: null };
      g.publications++;
      if (p.views !== null) g.views = (g.views ?? 0) + p.views;
      m.set(p[key], g);
    }
    return [...m.values()];
  };
  return { publications: out, by_use_case: group("use_case_id"), by_sport: group("sport") };
}
