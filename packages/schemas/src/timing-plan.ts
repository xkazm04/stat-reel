/**
 * The timing plan (spec D.8 rule 2): computed BEFORE any props are written, by `computeTimingPlan`
 * in @statreel/compositions (port of the box prototype timing.mjs). The plan is the only source of
 * frame numbers: the period -> frame knots, the order the viewer sees, and each event card's frame.
 * `planSha256` ties a props file to one exact plan.
 */
import { z } from "zod";
import { canonicalJson, sha256Hex } from "./sha256";

/** The plan format this build computes and reads. A stored plan of another version must be recomputed. */
export const TIMING_PLAN_VERSION = 1;
export const DATA_RACE_FPS = 30;
/** The fixed ending, in frames (spec D.8 rule 5): winner spotlight, like & subscribe, Powered by StatReel. */
export const ENDING_FRAMES = { spotlight: 60, like: 60, powered: 90 } as const;
export const ENDING_TOTAL_FRAMES = ENDING_FRAMES.spotlight + ENDING_FRAMES.like + ENDING_FRAMES.powered;
/** Video length band (ADR 007): 30-90 s. */
export const DATA_RACE_DURATION_S = { min: 30, max: 90 } as const;

export const TimingPlanSchema = z.object({
  version: z.literal(TIMING_PLAN_VERSION, {
    errorMap: (_issue, ctx) => ({
      message:
        ctx.data === undefined
          ? `timing plan has no version (expects ${TIMING_PLAN_VERSION}) - recompute the plan`
          : `timing plan version ${JSON.stringify(ctx.data)} is not supported by this build (expects ${TIMING_PLAN_VERSION}) - recompute the plan`,
    }),
  }),
  fps: z.literal(DATA_RACE_FPS),
  /** Frame boundaries. hook = [0, hook_end), timeline = [hook_end, timeline_end), then the fixed ending. */
  sections: z.object({
    hook_end: z.number().int().nonnegative(),
    timeline_end: z.number().int().positive(),
    spotlight_end: z.number().int().positive(),
    like_end: z.number().int().positive(),
    total: z.number().int().positive(),
  }),
  /** how the plan was computed (human-readable; listed in TIMING.md) */
  strategy: z.object({
    unit: z.string(),
    order: z.string(),
    order_label: z.string().nullable(),
    rank_smooth: z.number().nonnegative(),
    hysteresis: z.object({ rel: z.number().nonnegative(), abs: z.number().nonnegative() }).nullable(),
    top_n: z.number().int().positive(),
    axis_max: z.number().positive(),
    min_frames: z.number().positive(),
    max_frames: z.number().positive(),
    sigma: z.number().positive(),
    weights: z.object({ rank: z.number(), value: z.number(), base: z.number(), entry: z.number() }),
  }),
  periods: z.array(z.string()).min(2),
  entities: z.array(z.string()).min(1),
  /** [frame, period index] per period; frames and periods strictly increase (monotone) */
  knots: z.array(z.tuple([z.number(), z.number()])).min(2),
  /** the order the viewer sees at each period (entity ids, best first); moving average + hysteresis */
  orders: z.array(z.array(z.string())).min(2),
  events: z.array(
    z.object({
      id: z.string(),
      period: z.number().int().nonnegative(),
      label: z.string(),
      dwell: z.number().nonnegative(),
      /** the card's start_frame */
      frame: z.number().int().nonnegative(),
    }),
  ),
  frames_per_period: z.array(z.number()),
  detail: z.array(z.object({ period: z.string(), rank: z.number(), value: z.number(), entries: z.number() })),
  per_group: z.array(
    z.object({
      group: z.string(),
      change_score: z.number(),
      seconds: z.number(),
      changes_per_sec_warped: z.number(),
      changes_per_sec_ex_dwell: z.number(),
      changes_per_sec_uniform: z.number(),
    }),
  ),
  evenness: z.object({
    cv_uniform: z.number(),
    cv_warped_ex_dwell: z.number(),
    cv_warped_incl_dwell: z.number(),
  }),
});
export type TimingPlan = z.infer<typeof TimingPlanSchema>;

/** sha256 (hex) of the plan's canonical JSON (sorted keys, no whitespace). */
export const planSha256 = (plan: unknown): string => sha256Hex(canonicalJson(plan));
