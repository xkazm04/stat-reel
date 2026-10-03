/** Projects, versioned props and scripts. Every figure is checked against the warehouse facts it cites. */
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import {
  EraAdjustedPropsSchema, type EraAdjustedProps, type ProjectStatus, ScriptSchema, type Script,
  sceneSpokenText, untracedFigures, untracedScriptFigures, type UseCase,
} from "@statreel/schemas";
import { type Db, now, projectProps, projects, scripts } from "./db";
import { loadRegistry } from "./registry";
import { TopicService } from "./topics";
import type { Warehouse } from "./warehouse";

export type NewProject = { title: string; use_case_id: string; sport: string; format: string; mode: string; topic?: string | null };
export const SCHEMA_VERSION = "era-adjusted@1";
/** Narrator speech rate MEASURED on rendered TTS (voice "Daniel", 2026-09-29: 99-127 wpm, figures slow it). */
export const NARRATOR_WPM = { min: 115, max: 128 };
/** Fixed time the audio stage adds around speech: 0.35 s per scene gap + 1.2 s tail. */
const OVERHEAD_S = (scenes: number) => 0.35 * Math.max(0, scenes - 1) + 1.2;
const ORDER: ProjectStatus[] = ["idea", "data-ready", "scripted", "rendered", "gated", "published"];

export class ProjectService {
  constructor(private readonly db: Db, private readonly wh: Warehouse, private readonly usecases: UseCase[] = loadRegistry().usecases) {}

  create(p: NewProject) {
    if (p.topic) new TopicService(this.db).assertPickable(p.topic);
    const row = { id: `p-${randomUUID().slice(0, 8)}`, ...p, topic: p.topic ?? null, status: "idea", created_at: now() };
    this.db.insert(projects).values(row).run();
    return row;
  }

  list() {
    return this.db.select().from(projects).all().sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  get(id: string) {
    return this.db.select().from(projects).where(eq(projects.id, id)).get();
  }

  /** Move forward only (a later stage is never undone by an earlier event). */
  advance(id: string, to: ProjectStatus): void {
    const cur = this.get(id);
    if (cur && ORDER.indexOf(to) > ORDER.indexOf(cur.status as ProjectStatus)) this.db.update(projects).set({ status: to }).where(eq(projects.id, id)).run();
  }

  latestProps(id: string): { version: number; props: EraAdjustedProps; created_by: string } | undefined {
    const r = this.db.select().from(projectProps).where(eq(projectProps.project_id, id)).orderBy(desc(projectProps.version)).get();
    return r ? { version: r.version, props: JSON.parse(r.props_json), created_by: r.created_by } : undefined;
  }

  propsHistory(id: string) {
    return this.db.select().from(projectProps).where(eq(projectProps.project_id, id)).orderBy(desc(projectProps.version)).all()
      .map((r) => ({ version: r.version, created_by: r.created_by, created_at: r.created_at, props: JSON.parse(r.props_json) }));
  }

  async setProps(id: string, input: unknown, by: "llm" | "user"): Promise<{ version: number | null; errors: string[] }> {
    if (!this.get(id)) return { version: null, errors: [`unknown project ${id}`] };
    const parsed = EraAdjustedPropsSchema.safeParse(input);
    if (!parsed.success) return { version: null, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
    const refs = parsed.data.rows.flatMap((r) => [r.raw_fact_key, r.adjusted_fact_key, r.raw_rank_fact_key, r.adjusted_rank_fact_key]);
    const errors = untracedFigures(parsed.data, await this.wh.facts(refs));
    if (errors.length) return { version: null, errors };
    const version = (this.latestProps(id)?.version ?? 0) + 1;
    this.db.insert(projectProps).values({ project_id: id, version, props_json: JSON.stringify(parsed.data), schema_version: SCHEMA_VERSION, created_by: by, created_at: now() }).run();
    this.advance(id, "data-ready");
    return { version, errors: [] };
  }

  /** Update only the timing block (audio stage) without a new author version. */
  attachTiming(id: string, timing: EraAdjustedProps["timing"]): number {
    const cur = this.latestProps(id);
    if (!cur) throw new Error(`project ${id} has no props`);
    const version = cur.version + 1;
    this.db.insert(projectProps).values({ project_id: id, version, props_json: JSON.stringify({ ...cur.props, timing }), schema_version: SCHEMA_VERSION, created_by: "system", created_at: now() }).run();
    return version;
  }

  latestScript(id: string): { version: number; script: Script } | undefined {
    const r = this.db.select().from(scripts).where(eq(scripts.project_id, id)).orderBy(desc(scripts.version)).get();
    return r ? { version: r.version, script: JSON.parse(r.scenes_json) } : undefined;
  }

  private durationBand(projectId: string): { min: number; max: number } | undefined {
    const useCase = this.get(projectId)?.use_case_id;
    return this.usecases?.find((u) => u.id === useCase)?.duration_s;
  }

  async writeScript(id: string, input: unknown): Promise<{ version: number | null; errors: string[]; words: number; est_duration_s: { min: number; max: number }; per_scene: { scene_id: string; words: number }[] }> {
    const empty = { version: null, words: 0, est_duration_s: { min: 0, max: 0 }, per_scene: [] };
    if (!this.get(id)) return { ...empty, errors: [`unknown project ${id}`] };
    const parsed = ScriptSchema.safeParse(input);
    if (!parsed.success) return { ...empty, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
    const script = parsed.data;
    const errors = untracedScriptFigures(script);
    const refs = script.scenes.flatMap((s) => s.tokens.filter((t) => t.fact_key).map((t) => ({ scene: s.scene_id, t })));
    const facts = await this.wh.facts(refs.map((r) => r.t.fact_key!));
    for (const { scene, t } of refs) {
      const f = facts.get(t.fact_key!);
      const shown = parseDisplayed(t.display);
      if (f === undefined) errors.push(`${scene}: '${t.display}' cites unknown fact ${t.fact_key}`);
      else if (typeof f === "number" && !Number.isNaN(shown) && !matchesDisplayed(f, shown, t.display)) errors.push(`${scene}: '${t.display}' shows ${shown} but ${t.fact_key} = ${f}`);
    }
    const perScene = script.scenes.map((s) => ({ scene_id: s.scene_id, words: sceneSpokenText(s).split(/\s+/).filter(Boolean).length }));
    const words = perScene.reduce((a, s) => a + s.words, 0);
    const overhead = OVERHEAD_S(script.scenes.length);
    const est = {
      min: Math.round(((words / NARRATOR_WPM.max) * 60 + overhead) * 10) / 10,
      max: Math.round(((words / NARRATOR_WPM.min) * 60 + overhead) * 10) / 10,
    };
    const band = this.durationBand(id);
    if (band && est.max > band.max) {
      const maxWords = Math.floor(((band.max - overhead) / 60) * NARRATOR_WPM.min);
      errors.push(`too long: ~${est.max} s at the narrator's measured ${NARRATOR_WPM.min}-${NARRATOR_WPM.max} wpm; this use case allows ${band.min}-${band.max} s. Tighten to <= ${maxWords} spoken words (now ${words}) without dropping figures or hedges.`);
    } else if (band && est.min < band.min) {
      errors.push(`too short: ~${est.min} s; this use case needs at least ${band.min} s.`);
    }
    if (errors.length) return { version: null, errors, words, est_duration_s: est, per_scene: perScene };
    const version = (this.latestScript(id)?.version ?? 0) + 1;
    this.db.insert(scripts).values({ project_id: id, version, scenes_json: JSON.stringify(script), words, est_duration_s: est.max, created_at: now() }).run();
    this.advance(id, "scripted");
    return { version, errors: [], words, est_duration_s: est, per_scene: perScene };
  }
}

/** Numeric value of a displayed token. U+2212 / en dash minus are normalised to "-": the sign is part of the figure. */
export function parseDisplayed(display: string): number {
  return Number(display.replace(/[−–‒]/g, "-").replace(/[^\d.\-]/g, ""));
}

/**
 * A displayed figure may be rounded ("47%" for 0.4706, "17.1" for 17.118) but not changed, and its sign
 * must match. The x100 reading ("42" for a 0.42 share) is only offered for fractions: |fact| <= 1 and
 * non-integer, or an integer 0/1 that the display marks with "%". A rank 1 shown as "100" therefore fails.
 */
export function matchesDisplayed(fact: number, shown: number, display = ""): boolean {
  const candidates = [fact];
  if (Math.abs(fact) <= 1 && (!Number.isInteger(fact) || display.includes("%"))) candidates.push(fact * 100);
  const decimals = (String(shown).split(".")[1] ?? "").length;
  return candidates.some((c) => Math.abs(Number(c.toFixed(decimals)) - shown) < 1e-9);
}
