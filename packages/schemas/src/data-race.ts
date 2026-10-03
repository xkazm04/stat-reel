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
import { FACT_KEY_MESSAGE, FACT_KEY_PATTERN } from "./fact-key";
import { type TimingPlan, TimingPlanSchema, planSha256 } from "./timing-plan";

/** Same grammar as FactKey in index.ts (one shared pattern in fact-key.ts, which breaks the re-export cycle). */
export const DataRaceFactRef = z.string().regex(FACT_KEY_PATTERN, FACT_KEY_MESSAGE);

/**
 * Text limits are derived from the DataRace frame geometry (DataRace/parts.tsx, DataRaceFrame.tsx),
 * because the frame clips (nowrap + overflow hidden) or wraps text instead of failing.
 * Average advance widths in em, pessimistic for mixed-case text: Barlow Condensed 0.46 (the figure
 * titleFontSize / nameFontSize already use; the 800 weight of the hook is set to 0.48), Inter 0.56
 * (packages/captions AVG_CHAR_EM).
 *
 *   title        Barlow 800, shrinks 64 -> 40 px to fit 960 px: 960 / (40 * 0.46) = 52 chars at the
 *                floor. 42 stays the authoring rule (49 px, still a clear headline), well inside it.
 *   event title  Barlow 700 46 px, nowrap, card content width 840 - 44 - 28 = 768 px:
 *                768 / (46 * 0.46) = 36.3 -> 36 chars.
 *   fact text    Inter 500 28 px, nowrap, same 768 px: 768 / (28 * 0.56) = 48.98 -> 48 chars.
 *   hook         Barlow 800 96 px, line-height 1.08 (104 px), 960 px wide, starts at y 400 and the
 *                logo tiles start at y 860: 3 lines end at y ~711 (4 would reach 815, too close).
 *                Chars per line 960 / (96 * 0.48) = 20.8 -> 20; 3 lines = 60 chars.
 *   name, date label, unit label, source line, spotlight label / value: the pre-existing authoring
 *                limits, kept as they were (the name and title shrink to fit first; these are the
 *                points where the floor font size would still clip). They now say "N characters fit".
 *
 * Array caps come from the format (30-90 s at 30 fps, hook + 240-frame ending, so a timeline of at most
 * ~2400 frames) and from what the repo has produced (n = 53 full DataRace props files across the repo
 * and the sibling worktrees on 2026-10-04: periods <= 96, entities <= 10, events <= 6, aliases 0):
 *
 *   periods      120 = ten years of monthly data. The plan clamps a period to >= avg * 0.25 frames, so
 *                120 periods in 2400 frames is >= 5 frames (0.17 s) per step, still readable as motion;
 *                beyond it the bars cannot settle between steps. Observed max 96.
 *   events       12: each card lives 105-135 frames and holds the timeline 40 frames (default dwell),
 *                so 12 cards take ~480 of ~2400 timeline frames in dwell alone and stay one at a time
 *                per side. Observed max 6.
 *   aliases      6 per entity: they only feed the rule-4 reveal check; more is a list, not a name.
 *   values       as many as periods (and exactly as many, see the refinement).
 */
export const DATA_RACE_LIMITS = {
  maxEntities: 10,
  titleMaxChars: 42,
  eventTitleMaxChars: 36,
  hookMaxChars: 60,
  maxPeriods: 120,
  maxEvents: 12,
  maxAliases: 6,
  nameMaxChars: 22,
  dateLabelMaxChars: 24,
  unitLabelMaxChars: 40,
  sourceLineMaxChars: 70,
  spotlightLabelMaxChars: 28,
  spotlightValueMaxChars: 20,
  lifeFramesDefault: 120,
  lifeFramesMin: 105,
  lifeFramesMax: 135,
  factTextMaxChars: 48,
  /** shown as a burned badge when data_provenance is "sample" (spec D.6) */
  sampleBadgeText: "SAMPLE DATA · DESIGN PREVIEW",
} as const;

/** The one wording of every length limit: what, and how many characters fit. */
const tooLong = (what: string, n: number) => `${what} is too long: shorten it - ${n} characters fit`;
/** The one wording of every array cap. */
const tooMany = (what: string, n: number) => `too many ${what}: at most ${n} fit - drop some`;

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
    name: z.string().min(1).max(DATA_RACE_LIMITS.nameMaxChars, tooLong("entity name", DATA_RACE_LIMITS.nameMaxChars)),
    /** other names the entity is known by (rule 4 keeps them out of title and hook) */
    aliases: z.array(z.string().min(1)).max(DATA_RACE_LIMITS.maxAliases, tooMany("aliases", DATA_RACE_LIMITS.maxAliases)).default([]),
    /** unique per entity (rule 3) */
    color: HexColor,
    logo: DataRaceLogoSchema,
    /** one value per period; null = not in the data yet (the row waits at the bottom, hidden) */
    values: z.array(z.number().finite().nullable()).min(2).max(DATA_RACE_LIMITS.maxPeriods, tooMany("values (one per period)", DATA_RACE_LIMITS.maxPeriods)),
    /** fact ref of the series, `<row fact_key>#<column>` */
    value_ref: DataRaceFactRef,
  })
  .strict();
export type DataRaceEntity = z.infer<typeof DataRaceEntitySchema>;

export const DataRaceFactSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .max(DATA_RACE_LIMITS.factTextMaxChars, tooLong("fact text (one line on the card)", DATA_RACE_LIMITS.factTextMaxChars)),
    ref: DataRaceFactRef,
  })
  .strict();

export const DataRaceEventSchema = z
  .object({
    id: Slug,
    /** optional: the entity the card is about (its colour marks the card) */
    entity_id: Slug.optional(),
    /** <= 36 chars, one line (the card clips beyond it); may name entities, never the final ranking (rule 4; checked by checkGenerationRules) */
    title: z
      .string()
      .min(1)
      .max(DATA_RACE_LIMITS.eventTitleMaxChars, tooLong("event title (one line on the card)", DATA_RACE_LIMITS.eventTitleMaxChars)),
    date_label: z.string().min(1).max(DATA_RACE_LIMITS.dateLabelMaxChars, tooLong("date label", DATA_RACE_LIMITS.dateLabelMaxChars)),
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
            label: z.string().min(1).max(DATA_RACE_LIMITS.spotlightLabelMaxChars, tooLong("spotlight label", DATA_RACE_LIMITS.spotlightLabelMaxChars)),
            value_text: z.string().min(1).max(DATA_RACE_LIMITS.spotlightValueMaxChars, tooLong("spotlight value", DATA_RACE_LIMITS.spotlightValueMaxChars)),
            ref: DataRaceFactRef,
          })
          .strict(),
      )
      .min(1)
      .max(2),
  })
  .strict();

const DataRacePropsObject = z
  .object({
    format: z.literal("vertical").default("vertical"),
    data_provenance: z.enum(["real", "sample"]),
    /** one line, <= 42 chars, never names or hints at the final #1 (rule 4) */
    title: z
      .string()
      .min(1)
      .max(DATA_RACE_LIMITS.titleMaxChars, tooLong("title (one line)", DATA_RACE_LIMITS.titleMaxChars)),
    /** a question ending in "?" that does not reveal the outcome (rule 4); <= 60 chars = 3 lines at 96 px */
    hook: z
      .string()
      .min(1)
      .max(DATA_RACE_LIMITS.hookMaxChars, tooLong("hook (3 lines at 96 px, longer reaches the logo tiles)", DATA_RACE_LIMITS.hookMaxChars)),
    /** what the bars measure, e.g. "Share of searches" */
    unit_label: z.string().min(1).max(DATA_RACE_LIMITS.unitLabelMaxChars, tooLong("unit label", DATA_RACE_LIMITS.unitLabelMaxChars)),
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
    source_line: z.string().min(1).max(DATA_RACE_LIMITS.sourceLineMaxChars, tooLong("source line", DATA_RACE_LIMITS.sourceLineMaxChars)),
    /** one display label per period, e.g. "Nov 2017" */
    periods: z.array(z.string().min(1)).min(2).max(DATA_RACE_LIMITS.maxPeriods, tooMany("periods", DATA_RACE_LIMITS.maxPeriods)),
    entities: z.array(DataRaceEntitySchema).min(2).max(DATA_RACE_LIMITS.maxEntities),
    /** required when fewer than 10 entities are shown (rule 3) */
    entity_count_reason: z.string().min(1).optional(),
    /** entity ids that use the wordmark fallback because no acceptable logo was found (rule 3) */
    missing_logos: z.array(z.string()).default([]),
    events: z.array(DataRaceEventSchema).max(DATA_RACE_LIMITS.maxEvents, tooMany("events", DATA_RACE_LIMITS.maxEvents)).default([]),
    spotlight: DataRaceSpotlightSchema,
    timing_plan_sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256 hex"),
    /** render-time only: the plan matching timing_plan_sha256 */
    timing_plan: TimingPlanSchema.optional(),
  })
  .strict();

/**
 * The object plus the cross-field checks no single field can state. Every issue is path-addressed and
 * carries the observed value (the lengths, the duplicated id, the unknown id), so a model that wrote
 * the props can fix the one field it names. The composition's `?? 0` mask on a short values array
 * (DataRace/state.ts) is therefore unreachable for props that came through this schema.
 */
export const DataRacePropsSchema = DataRacePropsObject.superRefine((p, ctx) => {
  const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const entityIds = new Map<string, number>();
  p.entities.forEach((e, i) => {
    if (e.values.length !== p.periods.length)
      add(["entities", i, "values"], `entity '${e.id}' has ${e.values.length} values for ${p.periods.length} periods: values needs exactly one entry per period`);
    const first = entityIds.get(e.id);
    if (first !== undefined) add(["entities", i, "id"], `duplicate entity id '${e.id}' (also entities[${first}].id): every entity needs a unique id`);
    else entityIds.set(e.id, i);
  });
  const known = () => [...entityIds.keys()].join(", ");
  const eventIds = new Map<string, number>();
  p.events.forEach((ev, i) => {
    const first = eventIds.get(ev.id);
    if (first !== undefined) add(["events", i, "id"], `duplicate event id '${ev.id}' (also events[${first}].id): every event needs a unique id`);
    else eventIds.set(ev.id, i);
    if (ev.entity_id !== undefined && !entityIds.has(ev.entity_id))
      add(["events", i, "entity_id"], `event '${ev.id}' names unknown entity '${ev.entity_id}' (entities: ${known()})`);
  });
  p.missing_logos.forEach((m, i) => {
    if (!entityIds.has(m)) add(["missing_logos", i], `missing_logos names unknown entity '${m}' (entities: ${known()})`);
  });
});
export type DataRaceProps = z.infer<typeof DataRacePropsSchema>;
/** The input shape (defaults not yet applied). */
export type DataRacePropsInput = z.input<typeof DataRacePropsSchema>;

/** JSON Schema of `DataRaceProps` (authors and the MCP `get_generation_context` hand this to the model). */
export const dataRacePropsJsonSchema = (): Record<string, unknown> => {
  const { timing_plan: _renderOnly, ...shape } = DataRacePropsObject.shape;
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
