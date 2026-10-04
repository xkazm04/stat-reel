/**
 * MCP tools of a generation session (SPEC D.7). The LLM never writes code: it asks these tools for the
 * context, has the timing plan computed server-side, and validates its output with exactly the finalize
 * validation. All four only touch the job's own folder.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { computeTimingPlan, renderTimingMd } from "@statreel/compositions/timing";
import { DATA_RACE_DURATION_S, DATA_RACE_FPS, DATA_RACE_LIMITS, dataRacePropsJsonSchema, ENDING_FRAMES, planSha256, REVEAL_DENYLIST } from "@statreel/schemas";
import { z } from "zod";
import type { AssetFetcher } from "./assets";
import { jobPaths } from "./paths";
import type { GenerationQueue } from "./queue";
import type { GenerationValidator } from "./validator";
import { dataRaceValidator } from "./validate-data-race";

export const jobIdInput = { job_id: z.string() };

export type GenerationMcpTools = {
  fetch_asset(input: unknown): Promise<unknown>;
  get_generation_context(input: { job_id: string }): Promise<unknown>;
  compute_timing_plan(input: { job_id: string; [k: string]: unknown }): Promise<unknown>;
  validate_generation_output(input: { job_id: string }): Promise<unknown>;
};

/**
 * The plan's props must match it exactly (checkGenerationRules: same entities, same period count, an event per
 * plan event), so the plan takes the props' limits: a plan the props can never carry is refused here, not after
 * the session has written props around it. mcp.ts publishes this same object as the tool's input schema.
 */
export const TimingInput = z.object({
  periods: z.array(z.string().min(1)).min(2).max(DATA_RACE_LIMITS.maxPeriods),
  entities: z.array(z.string().min(1)).min(2).max(DATA_RACE_LIMITS.maxEntities),
  values: z.record(z.array(z.number().finite().nullable()).max(DATA_RACE_LIMITS.maxPeriods)),
  events: z
    .array(z.object({ id: z.string().min(1), period: z.number().int().nonnegative(), label: z.string().min(1).max(80), dwell: z.number().nonnegative().max(200).optional(), spread: z.number().positive().max(10).optional() }))
    .max(DATA_RACE_LIMITS.maxEvents)
    .default([]),
  opts: z
    .object({
      unit: z.string().max(20).optional(),
      hookFrames: z.number().int().min(0).max(300).optional(),
      timelineFrames: z.number().int().min(300).max(2000).optional(),
      rankSmooth: z.number().int().min(0).max(6).optional(),
      hysteresis: z.object({ rel: z.number().min(0).max(1), abs: z.number().min(0) }).nullable().optional(),
      topN: z.number().int().min(2).max(10).optional(),
      axisMax: z.number().positive().optional(),
      minFrames: z.number().positive().optional(),
      maxFrames: z.number().positive().optional(),
      sigma: z.number().positive().max(10).optional(),
      orderLabel: z.string().max(40).nullable().optional(),
    })
    .strict()
    .default({}),
});

/** The rules in the words a session needs; the validator enforces every one (checkGenerationRules). */
export const GENERATION_RULES = [
  "1. Event cards always side-reveal, alternating left/right by card index. Props have no transition/enter/exit field (any such key is an error).",
  "2. Timing plan first: call compute_timing_plan, then put its sha256 in props.timing_plan_sha256 and every event's start_frame from the plan. Knots must be monotone.",
  `3. At most ${DATA_RACE_LIMITS.maxEntities} entities (say why in entity_count_reason when fewer). Each has a unique colour and a logo: an asset file saved with fetch_asset (path under assets/, with a ledger row in out/assets.json) or {kind: "wordmark"} listed in missing_logos.`,
  `4. title <= ${DATA_RACE_LIMITS.titleMaxChars} chars, one line; hook ends with "?". Neither may name the final #1 (or an alias) or use: ${REVEAL_DENYLIST.join(", ")}. Event titles <= ${DATA_RACE_LIMITS.eventTitleMaxChars} chars.`,
  `5. The ending (winner spotlight ${ENDING_FRAMES.spotlight} + like & subscribe ${ENDING_FRAMES.like} + Powered by StatReel ${ENDING_FRAMES.powered} frames) is rendered by the composition; props only give spotlight.facts[] (1-2, fact-ref'd).`,
  `6. Event cards live life_frames = ${DATA_RACE_LIMITS.lifeFramesDefault} by default (${DATA_RACE_LIMITS.lifeFramesMin}-${DATA_RACE_LIMITS.lifeFramesMax} allowed).`,
  `Format: vertical 1080x1920, ${DATA_RACE_FPS} fps, ${DATA_RACE_DURATION_S.min}-${DATA_RACE_DURATION_S.max} s, no narration.`,
  'Data: a case whose data is new-source or guess may only carry data_provenance "sample" (labelled SAMPLE DATA); a video needs "real" with a fact ref (<row fact_key>#<column>) for every number.',
];

export function makeGenerationMcpTools(d: { queue: GenerationQueue; assets: AssetFetcher; dataRoot: string; validator?: GenerationValidator }): GenerationMcpTools {
  const running = (id: string) => {
    const job = d.queue.get(id);
    return job && job.status === "running" ? job : null;
  };
  const validator = d.validator ?? dataRaceValidator;
  return {
    fetch_asset: (input) => d.assets.fetchAsset(input),

    async get_generation_context({ job_id }) {
      const job = running(job_id);
      if (!job) return { error: `job ${job_id} is not running` };
      const p = jobPaths(job.id, d.dataRoot);
      const caseData = existsSync(p.caseJson) ? JSON.parse(readFileSync(p.caseJson, "utf8")) : null;
      return {
        job: { id: job.id, type: job.type, case_id: job.case_id, board_item_id: job.board_item_id },
        case: caseData,
        accepted_visual: (caseData as { visual?: unknown } | null)?.visual ?? null,
        outputs: job.type === "visual_options"
          ? ["out/variants/v1.props.json", "out/variants/v2.props.json", "out/variants/v3.props.json", "out/variants/v1.md", "out/variants/v2.md", "out/variants/v3.md", "out/timing-plan.json (compute_timing_plan writes it)"]
          : ["out/props.json", "out/timing-plan.json (compute_timing_plan writes it)"],
        props_schema: dataRacePropsJsonSchema(),
        rules: GENERATION_RULES,
        limits: DATA_RACE_LIMITS,
      };
    },

    async compute_timing_plan(input) {
      const job = running(input.job_id);
      if (!job) return { ok: false, error: `job ${input.job_id} is not running` };
      const parsed = TimingInput.safeParse(input);
      if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
      try {
        const plan = computeTimingPlan(parsed.data);
        const p = jobPaths(job.id, d.dataRoot);
        mkdirSync(p.out, { recursive: true });
        writeFileSync(path.join(p.out, "timing-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
        writeFileSync(path.join(p.out, "TIMING.md"), renderTimingMd(plan, { title: String((JSON.parse(readFileSync(p.caseJson, "utf8")) as { title?: string }).title ?? job.case_id) }));
        const seconds = plan.sections.total / plan.fps;
        return {
          ok: true,
          sha256: planSha256(plan),
          path: "out/timing-plan.json",
          sections: plan.sections,
          seconds: Math.round(seconds * 10) / 10,
          warning: seconds < DATA_RACE_DURATION_S.min || seconds > DATA_RACE_DURATION_S.max ? `the video would be ${seconds.toFixed(1)} s; it must be ${DATA_RACE_DURATION_S.min}-${DATA_RACE_DURATION_S.max} s (change opts.timelineFrames)` : undefined,
          events: plan.events.map((e) => ({ id: e.id, start_frame: e.frame })),
          final_order: plan.orders[plan.orders.length - 1],
          note: "put sha256 in props.timing_plan_sha256 and each event's start_frame in the props",
        };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    async validate_generation_output({ job_id }) {
      const job = running(job_id);
      if (!job) return { error: `job ${job_id} is not running` };
      const r = await validator.validate({ type: job.type, paths: jobPaths(job.id, d.dataRoot) });
      return { ok: r.ok, errors: r.errors, outputs: r.outputs };
    },
  };
}
