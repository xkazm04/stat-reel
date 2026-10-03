/** `prepare` step of a job (SPEC D.4): the job folder, case.json, and the config snapshot. */
import { mkdirSync, writeFileSync } from "node:fs";
import type { GenerationConfig, GenerationJob } from "@statreel/schemas";
import { perTypeValue } from "@statreel/schemas";
import type { Db } from "../db";
import { GenerationError } from "./engine";
import { assertIds, type JobPaths } from "./paths";

const JSON_COLS = ["tension", "unknowns", "beats", "timeline", "chart_ideas", "requires", "sources", "evidence"] as const;
const parse = (s: unknown) => {
  try { return typeof s === "string" ? JSON.parse(s) : null; } catch { return null; }
};

/** What the session reads: the case idea with its JSON columns expanded, plus the accepted visual when there is one. */
export function buildCaseData(db: Db, job: GenerationJob): Record<string, unknown> {
  assertIds(job);
  const row = db.$client.prepare("select * from case_ideas where id = ?").get(job.case_id) as Record<string, unknown> | undefined;
  if (!row) throw new GenerationError("validation", `case ${job.case_id} no longer exists`);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.endsWith("_json")) continue;
    out[k] = v;
  }
  for (const c of JSON_COLS) out[c] = parse(row[`${c}_json`]) ?? [];
  out.source = parse(row.source_json);
  let item: Record<string, unknown> | null = null;
  if (job.board_item_id) {
    item = (db.$client.prepare("select id, title, summary, style_json, source_json, image from board_items where id = ?").get(job.board_item_id) as Record<string, unknown> | undefined) ?? null;
    if (!item) throw new GenerationError("validation", `board item ${job.board_item_id} no longer exists`);
  }
  return {
    ...out,
    job: { id: job.id, type: job.type, format: "vertical", fps: 30, variants: 3 },
    visual: item ? { id: item.id, title: item.title, summary: item.summary, image: item.image, style: parse(item.style_json), source: parse(item.source_json) } : null,
  };
}

/** The effective settings written to `params_json` so a run is reproducible (no secrets live in config). */
export function configSnapshot(config: GenerationConfig, jobType: GenerationJob["type"], extra: Record<string, unknown> = {}) {
  return {
    mode: config.mode, cli: { kind: config.cli.kind, bin: config.cli.bin, extraArgs: config.cli.extraArgs }, model: config.model, fallbackModel: config.fallbackModel,
    effort: config.effort, permissionMode: config.permissionMode, web: config.web,
    timeoutMin: perTypeValue(config.timeoutMin, jobType), budgetUsd: perTypeValue(config.budgetUsd, jobType), maxAttempts: config.maxAttempts, ...extra,
  };
}

export function prepareDirs(p: JobPaths): void {
  for (const d of [p.refs, p.assets, p.out]) mkdirSync(d, { recursive: true });
}

export function writeCaseJson(p: JobPaths, data: Record<string, unknown>): void {
  writeFileSync(p.caseJson, JSON.stringify(data, null, 2));
}
