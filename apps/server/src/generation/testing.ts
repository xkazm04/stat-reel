/** Test helpers shared by the generation tests (not imported by production code). */
import type { Db } from "../db";

export const CASE_A = "ci-aaaaaaa1";
export const CASE_B = "ci-bbbbbbb2";
export const CASE_C = "ci-ccccccc3";

/** Insert a minimal case idea (all NOT NULL columns) so jobs have something to prepare from. */
export function insertCase(db: Db, id: string, o: { status?: string; data_status?: string } = {}): void {
  db.$client.prepare(
    `insert or ignore into case_ideas (id, title, pitch, domain, arc, insight, why_lasts, tension_json, unknowns_json, beats_json, timeline_json, span_years,
       chart_ideas_json, requires_json, sources_json, evidence_json, data_status, status, created_at)
     values (?, ?, 'pitch', 'f1', 'arc', 'insight', 'lasts', '[]', '[]', '[]', '[]', 10, '[]', '[]', '[]', '[]', ?, ?, ?)`,
  ).run(id, `Case ${id}`, o.data_status ?? "staged", o.status ?? "accepted", new Date().toISOString());
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function until(cond: () => boolean | Promise<boolean>, ms = 5000, step = 10): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await sleep(step);
  }
  throw new Error("timed out waiting for condition");
}
