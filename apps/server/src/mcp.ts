/**
 * MCP servers (streamable HTTP, stateless, localhost only). Thin wrapper over tools.ts.
 * Two endpoints, two catalogs (least privilege, registry mcp-tools): /mcp is the co-pilot's (DESIGN §6.6),
 * /mcp/generation the generation worker's (ADR 010). Both register under the server name "statreel", so
 * the CLI's `mcp__statreel__*` naming holds for each; the catalogs differ, the name does not.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isFailedToolResult } from "@statreel/llm";
import { z } from "zod";
import type { GenerationMcpTools } from "./generation/mcp-tools";
import type { Tools } from "./tools";
import { MAX_FRAMES, toolShapes } from "./tool-schemas";

/**
 * A result that carries `error` (string) or a non-empty `errors` array is a failed call: flag it isError.
 * One rule for live and replay: the ReplayEngine applies the same helper to the live handler result.
 */
export const isFailedResult = isFailedToolResult;

export const text = (v: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(v, null, 1) }],
  ...(isFailedResult(v) ? { isError: true } : {}),
});

/** The read tools a generation session's prompt relies on (prompts/generation/*.md name exactly these two). */
export const GENERATION_SHARED_TOOLS = ["describe_views", "query"] as const;

function registerSharedReadTools(s: McpServer, tools: Tools): void {
  s.registerTool("describe_views", { description: "The llm.* views you may query: columns with comments, 3 sample rows, licence class (output capped at 64 KB; samples drop first - pass sport to list fewer). Figures you use must cite '<fact_key>#<column>'.", inputSchema: toolShapes.describe_views }, async (i) => text(await tools.describe_views(i)));
  s.registerTool("query", { description: "Read-only SQL over llm.* views only (single SELECT, 10 s timeout). Returns at most 200 rows / 64 KB with a note when cut (narrow with WHERE, fewer columns, aggregates or LIMIT), and the licence class of what you read.", inputSchema: toolShapes.query }, async (i) => text(await tools.query(i)));
}

/** Co-pilot catalog (/mcp): no generation tools, so no download capability (fetch_asset) is reachable from it. */
export function buildMcpServer(tools: Tools): McpServer {
  const s = new McpServer({ name: "statreel", version: "0.1.0" });
  s.registerTool("list_use_cases", { description: "Use-case registry with current heatmap status per sport and mode.", inputSchema: toolShapes.list_use_cases }, async () => text(await tools.list_use_cases()));
  registerSharedReadTools(s, tools);
  s.registerTool("get_props_schema", { description: "JSON Schema and rules for a use case's props.", inputSchema: toolShapes.get_props_schema }, async (i) => text(await tools.get_props_schema(i)));
  s.registerTool("set_props", { description: "Validate and store props for a project. Returns validation errors verbatim; fix and call again.", inputSchema: toolShapes.set_props }, async (i) => text(await tools.set_props(i)));
  s.registerTool("write_script", { description: "Store narration per scene as tokens {display, spoken, fact_key?|literal?}. Returns fact/figure errors, word count and estimated duration range.", inputSchema: toolShapes.write_script }, async (i) => text(await tools.write_script(i)));
  s.registerTool("generate_audio", { description: "Queue voice (per scene) and music generation within the budget. Returns a job id.", inputSchema: toolShapes.generate_audio }, async (i) => text(await tools.generate_audio(i)));
  s.registerTool("render_keyframes", { description: `Render PNG stills at the given seconds for visual critique (1 to ${MAX_FRAMES} frames per call; more is an error, not a silent cut).`, inputSchema: toolShapes.render_keyframes }, async (i) => text(await tools.render_keyframes(i)));
  s.registerTool("get_render_report", { description: "ffprobe, loudness, caption and safe-zone checks of the latest render.", inputSchema: toolShapes.get_render_report }, async (i) => text(await tools.get_render_report(i)));
  s.registerTool("policy_check", { description: "Publish-gate verdict with reasons for a target.", inputSchema: toolShapes.policy_check }, async (i) => text(await tools.policy_check(i)));
  return s;
}

/** Generation catalog (/mcp/generation): its own four tools plus the two read tools in GENERATION_SHARED_TOOLS. No paid audio, no props/script writes. */
export function buildGenerationMcpServer(tools: Tools, gen: GenerationMcpTools): McpServer {
  const s = new McpServer({ name: "statreel", version: "0.1.0" });
  registerSharedReadTools(s, tools);
  registerGenerationTools(s, gen);
  return s;
}

/** Generation-session tools (ADR 010). Only offered on /mcp/generation, and only when the server has the generation queue. */
function registerGenerationTools(s: McpServer, gen: GenerationMcpTools): void {
  s.registerTool("fetch_asset", {
    description: "The ONLY way to save a file from the web. Server-side download of one image (logo, flag, emblem, icon) into the job folder: https, allowlisted hosts (Wikimedia), PNG/SVG/WEBP, size and count caps. For Commons files the licence and author are read from the Commons API. Returns {file, licence, trademark} or {error}.",
    inputSchema: {
      job_id: z.string(), url: z.string(), kind: z.enum(["logo", "flag", "emblem", "icon"]), entity: z.string(),
      source_page: z.string().optional(), licence: z.string().optional(), author: z.string().optional(),
    },
  }, async (i) => text(await gen.fetch_asset(i)));
  s.registerTool("get_generation_context", { description: "The case, the accepted visual, the props schema and the rules of a running generation job.", inputSchema: { job_id: z.string() } }, async (i) => text(await gen.get_generation_context(i)));
  s.registerTool("compute_timing_plan", { description: "Compute the timing plan (period-to-frame knots, event start frames) for a generation job; writes out/timing-plan.json and returns its sha256.", inputSchema: { job_id: z.string(), periods: z.any().optional(), entities: z.any().optional(), values: z.any().optional(), events: z.any().optional(), opts: z.any().optional() } }, async (i) => text(await gen.compute_timing_plan(i)));
  s.registerTool("validate_generation_output", { description: "Run exactly the finalize validation on the job's outputs (no render) and return the errors verbatim. Repeat until there are none, then stop.", inputSchema: { job_id: z.string() } }, async (i) => text(await gen.validate_generation_output(i)));
}

/** One transport per request (stateless mode); the caller builds the catalog-specific server. */
export async function handleMcp(server: McpServer, req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
