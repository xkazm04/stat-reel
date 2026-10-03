/**
 * DataRaceProps: the props of the `DataRace` composition (bar race of up to 10 entities, event-card
 * stack, fixed ending). Spec D.7 / D.8. There is NO transition field, NO ending field and NO
 * free-form timing: the composition derives card sides from the card index, renders the fixed
 * ending itself, and takes every frame from the timing plan (`timing_plan_sha256`).
 *
 * `timing_plan` is a render-time field: the server embeds the plan whose sha256 matches
 * (`resolveDataRaceRenderProps`) before it hands props to Remotion. Authors never write it.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { type TimingPlan, TimingPlanSchema, planSha256 } from "./timing-plan";

/** Same shape as FactKey in index.ts (duplicated: index.ts re-exports this module). */
export const DataRaceFactRef = z
  .string()
  .regex(/^[a-z0-9-]+:[^#\s]+#[a-z_]+$/, "fact ref must be '<row fact_key>#<column>'");

export const DATA_RACE_LIMITS = {
  maxEntities: 10,
  titleMaxChars: 42,
  eventTitleMaxChars: 42,
  lifeFramesDefault: 120,
  lifeFramesMin: 105,
  lifeFramesMax: 135,
  factTextMaxChars: 50,
  /** shown as a burned badge when data_provenance is "sample" (spec D.6) */
  sampleBadgeText: "SAMPLE DATA · DESIGN PREVIEW",
} as const;

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "colour must be #rrggbb");
const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id must be a lowercase slug");

export const DataRaceLogoSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("file"),
      /** repo-relative path: under `work/assets/` (saved with fetch_asset) or `data/assets/logos/` */
      path: z.string().min(1),
      /** resolved URL the renderer loads (staged by the server at render time) */
      src: z.string().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("wordmark") }).strict(),
]);
export type DataRaceLogo = z.infer<typeof DataRaceLogoSchema>;

export const DataRaceEntitySchema = z
  .object({
    id: Slug,
    name: z.string().min(1).max(22),
    /** other names the entity is known by (rule 4 keeps them out of title and hook) */
    aliases: z.array(z.string().min(1)).default([]),
    /** unique per entity (rule 3) */
    color: HexColor,
    logo: DataRaceLogoSchema,
    /** one value per period; null = not in the data yet (the row waits at the bottom, hidden) */
    values: z.array(z.number().finite().nullable()).min(2),
    /** fact ref of the series, `<row fact_key>#<column>` */
    value_ref: DataRaceFactRef,
  })
  .strict();
export type DataRaceEntity = z.infer<typeof DataRaceEntitySchema>;

export const DataRaceFactSchema = z
  .object({ text: z.string().min(1).max(DATA_RACE_LIMITS.factTextMaxChars), ref: DataRaceFactRef })
  .strict();

export const DataRaceEventSchema = z
  .object({
    id: Slug,
    /** optional: the entity the card is about (its colour marks the card) */
    entity_id: Slug.optional(),
    /** <= 42 chars, one line; may name entities, never the final ranking (rule 4; checked by checkGenerationRules) */
    title: z.string().min(1),
    date_label: z.string().min(1).max(24),
    /** 1-2 short facts with refs */
    facts: z.array(DataRaceFactSchema).min(1).max(2),
    /** from the timing plan (rule 2) */
    start_frame: z.number().int().nonnegative(),
    /** card lifespan, default 120; 105-135 allowed (rule 6; checked by checkGenerationRules) */
    life_frames: z.number().int().optional(),
  })
  .strict();
export type DataRaceEvent = z.infer<typeof DataRaceEventSchema>;

export const DataRaceSpotlightSchema = z
  .object({
    /** 1-2 stats of the final #1, each with a fact ref (rule 5) */
    facts: z
      .array(
        z
          .object({
            label: z.string().min(1).max(28),
            value_text: z.string().min(1).max(20),
            ref: DataRaceFactRef,
          })
          .strict(),
      )
      .min(1)
      .max(2),
  })
  .strict();

export const DataRacePropsSchema = z
  .object({
    format: z.literal("vertical").default("vertical"),
    data_provenance: z.enum(["real", "sample"]),
    /** one line, <= 42 chars, never names or hints at the final #1 (rule 4) */
    title: z.string().min(1),
    /** a question ending in "?" that does not reveal the outcome (rule 4) */
    hook: z.string().min(1),
    /** what the bars measure, e.g. "Share of searches" */
    unit_label: z.string().min(1).max(40),
    value_format: z
      .object({
        decimals: z.number().int().min(0).max(3).default(1),
        prefix: z.string().max(4).default(""),
        suffix: z.string().max(6).default(""),
      })
      .default({}),
    /** fixed axis maximum; omit for an axis that follows the current leader */
    axis_max: z.number().positive().optional(),
    /** attribution line (data source, licence) */
    source_line: z.string().min(1).max(70),
    /** one display label per period, e.g. "Nov 2017" */
    periods: z.array(z.string().min(1)).min(2),
    entities: z.array(DataRaceEntitySchema).min(2).max(DATA_RACE_LIMITS.maxEntities),
    /** required when fewer than 10 entities are shown (rule 3) */
    entity_count_reason: z.string().min(1).optional(),
    /** entity ids that use the wordmark fallback because no acceptable logo was found (rule 3) */
    missing_logos: z.array(z.string()).default([]),
    events: z.array(DataRaceEventSchema).default([]),
    spotlight: DataRaceSpotlightSchema,
    timing_plan_sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256 hex"),
    /** render-time only: the plan matching timing_plan_sha256 */
    timing_plan: TimingPlanSchema.optional(),
  })
  .strict();
export type DataRaceProps = z.infer<typeof DataRacePropsSchema>;
/** The input shape (defaults not yet applied). */
export type DataRacePropsInput = z.input<typeof DataRacePropsSchema>;

/** JSON Schema of `DataRaceProps` (authors and the MCP `get_generation_context` hand this to the model). */
export const dataRacePropsJsonSchema = (): Record<string, unknown> => {
  const { timing_plan: _renderOnly, ...shape } = DataRacePropsSchema.shape;
  return zodToJsonSchema(z.object(shape).strict(), {
    name: "DataRaceProps",
    $refStrategy: "none",
  }) as Record<string, unknown>;
};

/**
 * Embeds the plan into the props for rendering, after proving it is the plan the props name.
 * Throws if the sha256 does not match.
 */
export function resolveDataRaceRenderProps(props: DataRaceProps, plan: TimingPlan): DataRaceProps {
  const sha = planSha256(plan);
  if (sha !== props.timing_plan_sha256) {
    throw new Error(`timing_plan_sha256 mismatch: props name ${props.timing_plan_sha256}, plan is ${sha}`);
  }
  return { ...props, timing_plan: plan };
}

/** Card side, derived from the card's index in start order: even -> left, odd -> right (rule 1). */
export const eventSide = (index: number): "left" | "right" => (index % 2 === 0 ? "left" : "right");
