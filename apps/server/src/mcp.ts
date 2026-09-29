/** MCP server at /mcp (streamable HTTP, stateless, localhost only). Thin wrapper over tools.ts. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Tools } from "./tools";

const target = z.object({
  platform: z.enum(["youtube", "tiktok", "instagram"]),
  monetized: z.boolean(),
  ai_disclosure: z.boolean(),
  visibility: z.enum(["private", "unlisted", "draft"]).default("private"),
});

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 1) }] });

export function buildMcpServer(tools: Tools): McpServer {
  const s = new McpServer({ name: "statreel", version: "0.1.0" });
  s.registerTool("list_use_cases", { description: "Use-case registry with current heatmap status per sport and mode." }, async () => text(await tools.list_use_cases()));
  s.registerTool("describe_views", { description: "The llm.* views you may query: columns with comments, 3 sample rows, licence class. Figures you use must cite '<fact_key>#<column>'.", inputSchema: { sport: z.string().optional() } }, async (i) => text(await tools.describe_views(i)));
  s.registerTool("query", { description: "Read-only SQL over llm.* views only (single SELECT, 5000-row cap, 10 s timeout). Returns rows and the licence class of what you read.", inputSchema: { sql: z.string() } }, async (i) => text(await tools.query(i)));
  s.registerTool("get_props_schema", { description: "JSON Schema and rules for a use case's props.", inputSchema: { use_case: z.string() } }, async (i) => text(await tools.get_props_schema(i)));
  s.registerTool("set_props", { description: "Validate and store props for a project. Returns validation errors verbatim; fix and call again.", inputSchema: { project: z.string(), props: z.any() } }, async (i) => text(await tools.set_props(i)));
  s.registerTool("write_script", { description: "Store narration per scene as tokens {display, spoken, fact_key?|literal?}. Returns fact/figure errors, word count and estimated duration range.", inputSchema: { project: z.string(), script: z.any() } }, async (i) => text(await tools.write_script(i)));
  s.registerTool("generate_audio", { description: "Queue voice (per scene) and music generation within the budget. Returns a job id.", inputSchema: { project: z.string(), kind: z.enum(["tts", "music", "all"]).optional() } }, async (i) => text(await tools.generate_audio(i)));
  s.registerTool("render_keyframes", { description: "Render PNG stills at the given seconds for visual critique.", inputSchema: { project: z.string(), frames_s: z.array(z.number()).max(6) } }, async (i) => text(await tools.render_keyframes(i)));
  s.registerTool("get_render_report", { description: "ffprobe, loudness, caption and safe-zone checks of the latest render.", inputSchema: { project: z.string() } }, async (i) => text(await tools.get_render_report(i)));
  s.registerTool("policy_check", { description: "Publish-gate verdict with reasons for a target.", inputSchema: { project: z.string(), target } }, async (i) => text(await tools.policy_check({ project: i.project, target: target.parse(i.target) })));
  return s;
}

/** One server + transport per request (stateless mode). */
export async function handleMcp(tools: Tools, req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const server = buildMcpServer(tools);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
