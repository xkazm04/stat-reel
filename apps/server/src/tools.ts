/**
 * The StatReel tool surface (DESIGN §6.6). One set of handlers, used by the MCP server (live LLM
 * sessions) and by the replay engine (re-executed tool calls). Each returns JSON-serialisable data;
 * validation failures are returned verbatim, never thrown, so the LLM can correct itself.
 */
import { eraPropsJsonSchema, type PublishTarget } from "@statreel/schemas";
import type { HeatmapService } from "./heatmap-service";
import type { ProjectService } from "./projects";
import type { Warehouse } from "./warehouse";

export interface PipelineApi {
  generateAudio(projectId: string, kind: "tts" | "music" | "all"): Promise<{ job_id: string }>;
  renderKeyframes(projectId: string, frames_s: number[]): Promise<{ stills: string[] }>;
  renderReport(projectId: string): Promise<unknown>;
  policyCheck(projectId: string, target: PublishTarget): Promise<unknown>;
}

export type ToolDeps = { wh: Warehouse; projects: ProjectService; heatmap: HeatmapService; pipeline: PipelineApi };

// Props schema without the refinements (zod-to-json-schema can't express superRefine); the rules
// are listed in the description and enforced by set_props.
const PROPS_RULES = [
  "first scene kind must be 'hook' (its on_screen text is the hook sentence, shown at 0 s)",
  "vertical: last scene kind must be 'close' (a one-line reframe that loops back to the hook); no 'endcard'",
  "every figure must cite a fact ref '<row fact_key>#<column>' from an llm.* view row and equal it",
  "highlight_player_id must be one of rows",
  "never use 'did you know' framing; hook_shape is one of payoff-first | contradiction | scenario | stake",
];

export function makeTools(d: ToolDeps) {
  return {
    async list_use_cases() {
      const cells = await d.heatmap.current();
      return d.heatmap.usecases().map((u) => ({ ...u, cells: cells.filter((c) => c.usecase === u.id).map(({ sport, mode, status, reason }) => ({ sport, mode, status, reason })) }));
    },
    async describe_views(input: { sport?: string }) {
      return { views: await d.wh.describeViews(input.sport), fact_refs: "cite a figure as '<fact_key>#<column>', e.g. f1db:driver:juan-manuel-fangio:era-adjusted#rank_adjusted" };
    },
    async query(input: { sql: string }) {
      try {
        return await d.wh.query(input.sql);
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
    async get_props_schema(input: { use_case: string }) {
      if (input.use_case !== "era-adjusted-rankings") return { error: `no props schema for ${input.use_case} yet (only era-adjusted-rankings is implemented)` };
      return { json_schema: eraPropsJsonSchema(), rules: PROPS_RULES };
    },
    async set_props(input: { project: string; props: unknown }) {
      return d.projects.setProps(input.project, input.props, "llm");
    },
    async write_script(input: { project: string; script: unknown }) {
      return d.projects.writeScript(input.project, input.script);
    },
    async generate_audio(input: { project: string; kind?: "tts" | "music" | "all" }) {
      return d.pipeline.generateAudio(input.project, input.kind ?? "all");
    },
    async render_keyframes(input: { project: string; frames_s: number[] }) {
      return d.pipeline.renderKeyframes(input.project, input.frames_s.slice(0, 6));
    },
    async get_render_report(input: { project: string }) {
      return d.pipeline.renderReport(input.project);
    },
    async policy_check(input: { project: string; target: PublishTarget }) {
      return d.pipeline.policyCheck(input.project, input.target);
    },
  };
}
export type Tools = ReturnType<typeof makeTools>;
export type ToolName = keyof Tools;

export function executor(tools: Tools) {
  return async (tool: string, input: unknown) => {
    const fn = (tools as Record<string, (i: unknown) => Promise<unknown>>)[tool];
    if (!fn) return { error: `unknown tool ${tool}` };
    return fn(input ?? {});
  };
}
