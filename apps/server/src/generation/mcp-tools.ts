/**
 * MCP tools of a generation session (SPEC D.7). `fetch_asset` is real (T8). The other three are stubs
 * until the DataRace composition and the rules validator land (T9): `validate_generation_output`
 * already runs the finalize validator interface, the rest answer with a structured "not yet" error.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { AssetFetcher } from "./assets";
import { jobPaths } from "./paths";
import type { GenerationQueue } from "./queue";
import { type GenerationValidator, stubValidator } from "./validator";

export const jobIdInput = { job_id: z.string() };

export type GenerationMcpTools = {
  fetch_asset(input: unknown): Promise<unknown>;
  get_generation_context(input: { job_id: string }): Promise<unknown>;
  compute_timing_plan(input: { job_id: string; [k: string]: unknown }): Promise<unknown>;
  validate_generation_output(input: { job_id: string }): Promise<unknown>;
};

export function makeGenerationMcpTools(d: { queue: GenerationQueue; assets: AssetFetcher; dataRoot: string; validator?: GenerationValidator }): GenerationMcpTools {
  const running = (id: string) => {
    const job = d.queue.get(id);
    return job && job.status === "running" ? job : null;
  };
  return {
    fetch_asset: (input) => d.assets.fetchAsset(input),
    async get_generation_context({ job_id }) {
      const job = running(job_id);
      if (!job) return { error: `job ${job_id} is not running` };
      const p = jobPaths(job.id, d.dataRoot);
      return { case: existsSync(p.caseJson) ? JSON.parse(readFileSync(p.caseJson, "utf8")) : null, props_schema: null, note: "the DataRaceProps schema and rules arrive with T9; follow refs/ and the prompt" };
    },
    async compute_timing_plan({ job_id }) {
      return running(job_id) ? { error: "compute_timing_plan is not available yet (timing module lands with T9)" } : { error: `job ${job_id} is not running` };
    },
    async validate_generation_output({ job_id }) {
      const job = running(job_id);
      if (!job) return { error: `job ${job_id} is not running` };
      const r = await (d.validator ?? stubValidator).validate({ type: job.type, paths: jobPaths(job.id, d.dataRoot) });
      return { ok: r.ok, errors: r.errors, outputs: r.outputs };
    },
  };
}
