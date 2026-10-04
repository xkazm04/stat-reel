/**
 * The StatReel tool surface (DESIGN §6.6). One set of handlers, used by the MCP server (live LLM
 * sessions) and by the replay engine (re-executed tool calls). Each returns JSON-serialisable data;
 * validation failures are returned verbatim, never thrown, so the LLM can correct itself. Inputs are
 * validated by tool-schemas.ts (the same schemas the MCP server advertises) in `executor`; results
 * are bounded by tool-output.ts. A result carrying `error`/`errors` is an MCP isError (mcp.ts).
 */
import { eraPropsJsonSchema, type PublishTarget } from "@statreel/schemas";
import type { HeatmapService } from "./heatmap-service";
import type { ProjectService } from "./projects";
import { capQueryResult, capViews } from "./tool-output";
import { MAX_FRAMES, parseToolInput } from "./tool-schemas";
import type { Warehouse } from "./warehouse";

export interface PipelineApi {
  /** queues the one audio job, which always makes voice (per scene) AND music: there is no voice-only or music-only run */
  generateAudio(projectId: string): Promise<{ job_id: string }>;
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

const MAX_LISTED_IDS = 20;

export function makeTools(d: ToolDeps) {
  /** An unknown-id error names the valid ids, so the model can correct the call instead of guessing. */
  const unknownProject = (id: string) => {
    if (d.projects.get(id)) return undefined;
    const ids = d.projects.list().slice(0, MAX_LISTED_IDS).map((p) => p.id);
    return { error: `unknown project "${id}". ${ids.length ? `Valid project ids: ${ids.join(", ")}.` : "There are no projects yet."}` };
  };
  return {
    async list_use_cases() {
      const cells = await d.heatmap.current();
      return d.heatmap.usecases().map((u) => ({ ...u, cells: cells.filter((c) => c.usecase === u.id).map(({ sport, mode, status, reason }) => ({ sport, mode, status, reason })) }));
    },
    async describe_views(input: { sport?: string }) {
      const { views, note } = capViews(await d.wh.describeViews(input.sport));
      return { views, ...(note ? { note } : {}), fact_refs: "cite a figure as '<fact_key>#<column>', e.g. f1db:driver:juan-manuel-fangio:era-adjusted#rank_adjusted" };
    },
    async query(input: { sql: string }) {
      try {
        return capQueryResult(await d.wh.query(input.sql));
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
    async get_props_schema(input: { use_case: string }) {
      if (input.use_case !== "era-adjusted-rankings") {
        const ids = d.heatmap.usecases().map((u) => u.id);
        return { error: `no props schema for "${input.use_case}" yet (only era-adjusted-rankings is implemented). Known use case ids: ${ids.join(", ")}.` };
      }
      return { json_schema: eraPropsJsonSchema(), rules: PROPS_RULES };
    },
    async set_props(input: { project: string; props: unknown }) {
      return unknownProject(input.project) ?? d.projects.setProps(input.project, input.props, "llm");
    },
    async write_script(input: { project: string; script: unknown }) {
      return unknownProject(input.project) ?? d.projects.writeScript(input.project, input.script);
    },
    async generate_audio(input: { project: string; kind?: "tts" | "music" | "all" }) {
      const kind = input.kind ?? "all";
      // the schema still advertises tts|music (a schema edit waits for the co-pilot re-record); the pipeline would
      // ignore it and spend on both, so a narrower request is refused rather than silently widened
      if (kind !== "all") return { error: `kind "${kind}" is not supported: the audio job always generates voice and music together. Call generate_audio with kind "all" (or omit kind).` };
      return unknownProject(input.project) ?? d.pipeline.generateAudio(input.project);
    },
    async render_keyframes(input: { project: string; frames_s: number[] }) {
      // the schema rejects more than MAX_FRAMES; direct callers get the same error rather than a silent slice
      if (input.frames_s.length > MAX_FRAMES) return { error: `at most ${MAX_FRAMES} frames per call (got ${input.frames_s.length}): ask for fewer seconds, or call again for the rest` };
      return unknownProject(input.project) ?? d.pipeline.renderKeyframes(input.project, input.frames_s);
    },
    async get_render_report(input: { project: string }) {
      return unknownProject(input.project) ?? d.pipeline.renderReport(input.project);
    },
    async policy_check(input: { project: string; target: PublishTarget }) {
      return unknownProject(input.project) ?? d.pipeline.policyCheck(input.project, input.target);
    },
  };
}
export type Tools = ReturnType<typeof makeTools>;
export type ToolName = keyof Tools;

export function executor(tools: Tools) {
  return async (tool: string, input: unknown) => {
    const fn = (tools as Record<string, (i: unknown) => Promise<unknown>>)[tool];
    if (!fn) return { error: `unknown tool ${tool}. Available tools: ${Object.keys(tools).join(", ")}.` };
    // the same schemas the MCP server enforces: a replayed call is validated exactly like a live one
    const parsed = parseToolInput(tool, input);
    if (!parsed.ok) return { error: parsed.error, issues: parsed.issues };
    return fn(parsed.value);
  };
}
