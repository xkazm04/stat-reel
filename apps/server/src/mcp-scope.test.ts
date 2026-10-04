import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { buildGenerationMcpServer, buildMcpServer, GENERATION_SHARED_TOOLS } from "./mcp";
import type { GenerationMcpTools } from "./generation/mcp-tools";
import type { Tools } from "./tools";

/** tools/list never calls a tool, so empty stubs are enough to compare the two catalogs. */
async function list(server: ReturnType<typeof buildMcpServer>): Promise<string[]> {
  const client = new Client({ name: "t", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return (await client.listTools()).tools.map((t) => t.name).sort();
}

describe("MCP catalogs are scoped per agent (least privilege)", () => {
  const copilot = () => list(buildMcpServer({} as Tools));
  const generation = () => list(buildGenerationMcpServer({} as Tools, {} as GenerationMcpTools));

  it("/mcp lists only co-pilot tools", async () => {
    const names = await copilot();
    expect(names).toEqual([
      "describe_views",
      "generate_audio",
      "get_props_schema",
      "get_render_report",
      "list_use_cases",
      "policy_check",
      "query",
      "render_keyframes",
      "set_props",
      "write_script",
    ]);
    for (const g of ["fetch_asset", "compute_timing_plan", "get_generation_context", "validate_generation_output"])
      expect(names).not.toContain(g);
  });

  it("/mcp/generation lists only generation tools plus the two read tools its prompts name", async () => {
    const names = await generation();
    expect(names).toEqual([
      "compute_timing_plan",
      "describe_views",
      "fetch_asset",
      "get_generation_context",
      "query",
      "validate_generation_output",
    ]);
    for (const c of ["set_props", "write_script", "generate_audio"]) expect(names).not.toContain(c);
  });

  it("the catalogs overlap only in the justified shared read tools", async () => {
    const [c, g] = [await copilot(), await generation()];
    expect(c.filter((n) => g.includes(n)).sort()).toEqual([...GENERATION_SHARED_TOOLS].sort());
  });
});
