/**
 * @statreel/schemas - the shared contract (Zod). Registry, use cases, props, script, timing,
 * captions, provenance manifest, policy IO, projects and jobs.
 *
 * Fact references: a figure cites `<row fact_key>#<column>` from an `llm.*` view row, e.g.
 * `f1db:driver:juan-manuel-fangio:era-adjusted#rank_adjusted` (ADR 003 #2).
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { FACT_KEY_MESSAGE, FACT_KEY_PATTERN } from "./fact-key";

// ------------------------------------------------------------------ registry + use cases

export const LicenseClass = z.enum(["legal", "non_commercial", "paid", "avoid"]);
export type LicenseClass = z.infer<typeof LicenseClass>;
export const DataKind = z.enum(["hist", "bio", "events", "track", "live", "money"]);
export const Sport = z.enum(["F1", "NBA", "NHL", "Soccer"]);
export type Sport = z.infer<typeof Sport>;
export const Format = z.enum(["vertical", "landscape"]);
export type Format = z.infer<typeof Format>;

export const SourceSchema = z.object({
  id: z.string(),
  sport: z.union([Sport, z.literal("all")]),
  url: z.string(),
  access: z.enum(["bulk_download", "api", "html_scrape", "manual"]),
  hosts: z.array(z.string()).default([]),
  verdict: LicenseClass,
  verdict_note: z.string().nullish(),
  license: z.string(),
  attribution: z.string().nullable(),
  kinds: z.array(DataKind),
  partial_kinds: z.array(DataKind).default([]),
  notes: z.string().nullish(),
}).passthrough();
export type Source = z.infer<typeof SourceSchema>;

export const UseCaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** time-evolution = the format (ADR 007); headline = legacy M1 walking skeleton */
  family: z.enum(["time-evolution", "headline"]).default("time-evolution"),
  stage: z.number().int(),
  /** sport-specific formats; absent = any sport */
  sports: z.array(Sport).optional(),
  /** what the video's clock runs through: data time maps monotonically to video time */
  data_time: z.object({ unit: z.enum(["season", "race", "matchday", "career-start", "date"]), from: z.string(), to: z.string() }).optional(),
  chart_form: z.string().optional(),
  /** what the visualization reveals as time passes */
  arc: z.string().optional(),
  requires: z.object({ kinds: z.array(DataKind), min_seasons: z.number().int().optional() }),
  composition: z.string().nullable(),
  formats: z.array(Format),
  default_format: Format,
  duration_s: z.object({ min: z.number(), max: z.number() }),
  props_schema: z.string().nullable(),
  query_templates: z.array(z.string()).default([]),
  notes: z.string().nullish(),
});
export type UseCase = z.infer<typeof UseCaseSchema>;

// ------------------------------------------------------------------ heatmap

export const CellStatus = z.enum(["go", "data-ready", "ask", "blocked"]);
export type CellStatus = z.infer<typeof CellStatus>;
export const Mode = z.enum(["monetized", "non_commercial"]);
export type Mode = z.infer<typeof Mode>;
export const HeatmapCellSchema = z.object({
  usecase: z.string(),
  sport: Sport,
  mode: Mode,
  status: CellStatus,
  reason: z.string(),
  kinds: z.array(z.object({
    kind: DataKind,
    best: LicenseClass.nullable(),
    tested: z.boolean(),
    sources: z.array(z.object({ id: z.string(), license_class: LicenseClass, status: z.string() })),
  })),
  composition_implemented: z.boolean(),
});
export type HeatmapCell = z.infer<typeof HeatmapCellSchema>;

// ------------------------------------------------------------------ props (EraAdjustedSlope)

export const HookShape = z.enum(["payoff-first", "contradiction", "scenario", "stake"]);
export const SceneKind = z.enum(["hook", "context", "reveal", "payoff", "close", "endcard"]);

export const FactKey = z.string().regex(FACT_KEY_PATTERN, FACT_KEY_MESSAGE);

export const SceneSchema = z.object({
  id: z.string(),
  kind: SceneKind,
  on_screen: z.string().max(80),
  /** which rows this scene emphasises (player ids); empty = all */
  focus: z.array(z.string()).default([]),
});

/**
 * EraAdjusted text limits, derived from the frame geometry (compositions/src/layout.ts, viz slopegraph)
 * at the 28 px floor, Inter 0.56 em / JetBrains Mono 0.6 em / Barlow Condensed caps 0.46 em (+0.04 spacing):
 *
 *   row name        the highlight callout is one nowrap line of Barlow caps at 52 px (vertical) / 48 px
 *                   (landscape): 869 / (52 * 0.50) = 33, 770 / (48 * 0.50) = 32 -> 32 chars.
 *   metric labels   wrapped into one slope column, (869 / 2 - 12) = 422 px at 28 px Inter: 26 chars per
 *                   line; two lines are the most the 564 px chart can give up (each costs 35 px) -> 48.
 *   attribution     one nowrap line beside the AI-disclosure chip (~376 px + 16 gap): vertical
 *                   (869 - 392) / (28 * 0.6 + 0.56) = 27 chars; landscape (1712 - 392) / 17.4 = 75 -> 76
 *                   in the schema, 27 for a vertical short (checked in the refinement below).
 *   method note     (not yet enforced, see the commit that lands it) vertical two lines of ~55,
 *                   landscape one line of ~109.
 */
export const ERA_TEXT_LIMITS = {
  rowNameMaxChars: 32,
  metricLabelMaxChars: 48,
  attributionMaxChars: 76,
  attributionVerticalMaxChars: 27,
} as const;
const eraTooLong = (what: string, n: number) => `${what} is too long: shorten it - ${n} characters fit`;

export const EraRowSchema = z.object({
  player_id: z.string(),
  name: z.string().max(ERA_TEXT_LIMITS.rowNameMaxChars, eraTooLong("player name", ERA_TEXT_LIMITS.rowNameMaxChars)),
  raw_rank: z.number().int().positive(),
  adjusted_rank: z.number().int().positive(),
  raw_value: z.number(),
  adjusted_value: z.number(),
  raw_rank_fact_key: FactKey,
  adjusted_rank_fact_key: FactKey,
  raw_fact_key: FactKey,
  adjusted_fact_key: FactKey,
});

export const EraAdjustedPropsSchema = z.object({
  format: Format,
  hook_shape: HookShape,
  title: z.string().max(60),
  metric_raw_label: z.string().max(ERA_TEXT_LIMITS.metricLabelMaxChars, eraTooLong("metric_raw_label", ERA_TEXT_LIMITS.metricLabelMaxChars)),
  metric_adjusted_label: z.string().max(ERA_TEXT_LIMITS.metricLabelMaxChars, eraTooLong("metric_adjusted_label", ERA_TEXT_LIMITS.metricLabelMaxChars)),
  rows: z.array(EraRowSchema).min(3).max(12),
  highlight_player_id: z.string(),
  scenes: z.array(SceneSchema).min(3),
  attribution: z.string().min(1).max(ERA_TEXT_LIMITS.attributionMaxChars, eraTooLong("attribution", ERA_TEXT_LIMITS.attributionMaxChars)),
  method_note: z.string().min(1),
  show_safe_zone: z.boolean().default(false),
  /** filled by the audio stage; absent in a draft */
  timing: z.lazy(() => TimelineSchema).optional(),
}).superRefine((p, ctx) => {
  if (p.scenes[0]?.kind !== "hook") ctx.addIssue({ code: "custom", message: "first scene must be the hook", path: ["scenes", 0] });
  if (p.format === "vertical") {
    if (p.scenes.at(-1)?.kind !== "close") ctx.addIssue({ code: "custom", message: "a vertical short ends on a reframe close", path: ["scenes"] });
    if (p.scenes.some((s) => s.kind === "endcard")) ctx.addIssue({ code: "custom", message: "end cards are landscape-only", path: ["scenes"] });
  }
  if (p.format === "vertical" && p.attribution.length > ERA_TEXT_LIMITS.attributionVerticalMaxChars)
    ctx.addIssue({ code: "custom", message: eraTooLong("attribution (one line beside the AI-disclosure chip in a vertical short)", ERA_TEXT_LIMITS.attributionVerticalMaxChars), path: ["attribution"] });
  if (!p.rows.some((r) => r.player_id === p.highlight_player_id))
    ctx.addIssue({ code: "custom", message: "highlight_player_id must be one of rows", path: ["highlight_player_id"] });
});
export type EraAdjustedProps = z.infer<typeof EraAdjustedPropsSchema>;

/** JSON Schema of the props object (refinements are not expressible; set_props enforces them). */
export function eraPropsJsonSchema(): unknown {
  const inner = (EraAdjustedPropsSchema as unknown as { _def: { schema: z.ZodTypeAny } })._def.schema;
  return zodToJsonSchema(inner, "EraAdjustedProps");
}

/** Every figure in props must equal the fact it cites. Returns human-readable problems. */
export function untracedFigures(props: EraAdjustedProps, facts: Map<string, number | string>): string[] {
  const problems: string[] = [];
  const check = (who: string, key: string, value: number) => {
    if (!facts.has(key)) problems.push(`${who}: unknown fact ${key}`);
    else if (Math.abs(Number(facts.get(key)) - value) > 1e-6) problems.push(`${who}: ${value} != fact ${key} = ${facts.get(key)}`);
  };
  for (const r of props.rows) {
    check(r.name, r.raw_fact_key, r.raw_value);
    check(r.name, r.adjusted_fact_key, r.adjusted_value);
    check(r.name, r.raw_rank_fact_key, r.raw_rank);
    check(r.name, r.adjusted_rank_fact_key, r.adjusted_rank);
  }
  return problems;
}

// ------------------------------------------------------------------ script (spoken vs display)

export const TokenSchema = z.object({
  display: z.string(),
  spoken: z.string(),
  fact_key: FactKey.optional(),
  /** a figure that is a rule, not data (e.g. "25 points for a win"): the reason */
  literal: z.string().optional(),
});
export const ScriptSceneSchema = z.object({ scene_id: z.string(), tokens: z.array(TokenSchema).min(1) });
export const ScriptSchema = z.object({
  scenes: z.array(ScriptSceneSchema).min(1),
  pronunciations: z.record(z.string(), z.string()).default({}),
  words_per_minute: z.object({ min: z.number(), max: z.number() }).default({ min: 140, max: 175 }),
});
export type Script = z.infer<typeof ScriptSchema>;
export type ScriptScene = z.infer<typeof ScriptSceneSchema>;

const join = (parts: string[]) => parts.join(" ").replace(/\s+([,.!?;:])/g, "$1");
export const sceneSpokenText = (s: ScriptScene) => join(s.tokens.map((t) => t.spoken));
export const sceneDisplayText = (s: ScriptScene) => join(s.tokens.map((t) => t.display));

export function untracedScriptFigures(script: Script): string[] {
  return script.scenes.flatMap((s) =>
    s.tokens.filter((t) => /\d/.test(t.display) && !t.fact_key && !t.literal).map((t) => `${s.scene_id}: '${t.display}' has no fact_key`),
  );
}

// ------------------------------------------------------------------ timing + captions

/** ElevenLabs /with-timestamps alignment (character level). */
export const CharAlignmentSchema = z.object({
  characters: z.array(z.string()),
  character_start_times_seconds: z.array(z.number()),
  character_end_times_seconds: z.array(z.number()),
});
export type CharAlignment = z.infer<typeof CharAlignmentSchema>;

export const WordTimingSchema = z.object({
  scene_id: z.string(),
  display: z.string(),
  spoken: z.string(),
  start_s: z.number(),
  end_s: z.number(),
});
export type WordTiming = z.infer<typeof WordTimingSchema>;

export const CueSchema = z.object({
  start_s: z.number(),
  end_s: z.number(),
  lines: z.array(z.string()).min(1).max(2),
  words: z.array(WordTimingSchema),
});
export type Cue = z.infer<typeof CueSchema>;

export const TimelineSchema = z.object({
  duration_s: z.number().positive(),
  scenes: z.array(z.object({ scene_id: z.string(), start_s: z.number(), end_s: z.number(), voice_src: z.string().optional() })),
  words: z.array(WordTimingSchema),
  cues: z.array(CueSchema),
  music: z.array(z.object({ src: z.string(), start_s: z.number(), end_s: z.number(), gain_db: z.number() })).default([]),
  voice_lead_s: z.number().default(0.5),
});
export type Timeline = z.infer<typeof TimelineSchema>;

// ------------------------------------------------------------------ provenance + policy

export const PlanTier = z.enum(["free", "starter", "creator", "pro", "scale", "business", "enterprise"]);
export type PlanTier = z.infer<typeof PlanTier>;
export const AudioAssetSchema = z.object({
  kind: z.enum(["tts", "music", "sfx"]),
  provider: z.literal("elevenlabs"),
  request_id: z.string().nullish(),
  model_id: z.string(),
  voice_id: z.string().nullish(),
  prompt_sha256: z.string().nullish(),
  plan_tier: PlanTier,
  generated_at: z.string(),
  sha256: z.string(),
  scene_id: z.string().nullish(),
  c2pa: z.enum(["claimed-by-provider", "absent", "unknown"]).default("unknown"),
});

export type AudioAsset = z.infer<typeof AudioAssetSchema>;

export const ProvenanceManifestSchema = z.object({
  subject: z.object({ file: z.string(), sha256: z.string() }),
  build: z.object({ git_sha: z.string(), composition: z.string(), props_sha256: z.string(), renderer: z.string(), /** content hash of the bundled sources; with props_sha256 it keys render reuse */ source_sha256: z.string().nullish() }),
  data: z.object({
    models: z.array(z.string()),
    license_class: z.string(),
    sources: z.array(z.object({
      id: z.string(), snapshot: z.string(), license: z.string(), license_class: z.string(), verdict: z.string(), attribution: z.string().nullable(),
    })),
    facts_cited: z.array(z.string()).default([]),
  }),
  audio: z.array(AudioAssetSchema),
  fonts: z.array(z.object({ family: z.string(), license: z.string(), sha256: z.string() })),
  captions: z.object({ burned_in: z.boolean(), sidecar: z.array(z.string()), max_cps: z.number() }),
  checks: z.object({
    loudness_lufs: z.number(),
    true_peak_dbtp: z.number(),
    loudness_range_lu: z.number().nullish(),
    safe_zone_violations: z.number().int(),
    /** measured from the browser's font report; absent when the report was missing (the gate then denies it, never a silent 0) */
    font_fallbacks: z.number().int().nullish(),
    width: z.number().int(), height: z.number().int(), fps: z.number(), duration_s: z.number(),
    video_codec: z.string(), audio_codec: z.string(), /** measured by blackdetect; absent stays absent so the gate denies it (a default 0 would turn "not measured" into "no black frames") */
    black_frames_s: z.number().nullish(),
  }),
  llm: z.object({ engine: z.string(), session_id: z.string().nullish() }).nullish(),
  disclosure: z.object({ ai_voice: z.boolean(), ai_music: z.boolean(), on_frame: z.boolean() }),
});
export type ProvenanceManifest = z.infer<typeof ProvenanceManifestSchema>;

export const PublishTargetSchema = z.object({
  platform: z.enum(["youtube", "tiktok", "instagram"]),
  monetized: z.boolean(),
  ai_disclosure: z.boolean(),
  visibility: z.enum(["private", "unlisted", "draft"]).default("private"),
});
export type PublishTarget = z.infer<typeof PublishTargetSchema>;

export const PolicyResultSchema = z.object({
  allow: z.boolean(),
  deny: z.array(z.string()),
  warn: z.array(z.string()).default([]),
  checks_run: z.array(z.string()),
});
export type PolicyResult = z.infer<typeof PolicyResultSchema>;

// ------------------------------------------------------------------ projects + jobs

export const ProjectStatus = z.enum(["idea", "data-ready", "scripted", "rendered", "gated", "published"]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;
export const JobKind = z.enum(["ingest", "transform", "audio", "render", "publish", "metrics", "llm", "gen_render"]);
export type JobKind = z.infer<typeof JobKind>;
export const JobStatus = z.enum(["queued", "running", "succeeded", "failed", "cancelled", "refused"]);
export type JobStatus = z.infer<typeof JobStatus>;

export * from "./fixtures";

export * from "./fact-key";
export * from "./data-race";
export * from "./generation-rules";
export * from "./sha256";
export * from "./timing-plan";
export * from "./topics";
export * from "./generation";
export * from "./pipeline";

/** A row of the app DB `jobs` table (apps/server/src/db.ts), as GET /api/jobs returns it. */
export const JobRowSchema = z.object({
  id: z.string(),
  kind: JobKind,
  project_id: z.string().nullable(),
  status: JobStatus,
  progress: z.number(),
  params_json: z.string(),
  result_json: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
});
export type JobRow = z.infer<typeof JobRowSchema>;
