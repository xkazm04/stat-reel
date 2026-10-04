import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DATA_RACE_LIMITS } from "@statreel/schemas";
import { describe, expect, it } from "vitest";
import { ASSET_KINDS } from "./generation/assets";
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

  it("generation tools publish the schema their handlers enforce (registry mcp-tools/tool-schema-design)", async () => {
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([buildGenerationMcpServer({} as Tools, {} as GenerationMcpTools).connect(a), client.connect(b)]);
    const tools = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t.inputSchema as { properties: Record<string, Record<string, unknown>>; required?: string[] }]));
    const timing = tools.compute_timing_plan;
    expect(timing?.required).toEqual(expect.arrayContaining(["job_id", "periods", "entities", "values"]));
    expect(timing?.properties.periods).toMatchObject({ type: "array", minItems: 2, maxItems: DATA_RACE_LIMITS.maxPeriods });
    expect(timing?.properties.entities).toMatchObject({ type: "array", minItems: 2, maxItems: DATA_RACE_LIMITS.maxEntities });
    expect(timing?.properties.events).toMatchObject({ type: "array", maxItems: DATA_RACE_LIMITS.maxEvents });
    expect(timing?.properties.opts).toMatchObject({ type: "object", additionalProperties: false });
    for (const k of ["periods", "entities", "values", "events", "opts"]) expect(Object.keys(timing?.properties[k] ?? {})).not.toEqual([]);
    const fetch = tools.fetch_asset;
    expect(fetch?.properties.kind).toMatchObject({ enum: [...ASSET_KINDS] });
    expect(fetch?.properties.url).toMatchObject({ minLength: 1, maxLength: 2000 });
    expect(fetch?.properties.entity).toMatchObject({ minLength: 1, maxLength: 80 });
  });

  it("a call outside the published schema is a readable tool error; a valid one reaches the handler", async () => {
    const seen: unknown[] = [];
    const gen = {
      compute_timing_plan: async (i: unknown) => {
        seen.push(i);
        return { ok: true };
      },
    } as unknown as GenerationMcpTools;
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([buildGenerationMcpServer({} as Tools, gen).connect(a), client.connect(b)]);
    const entities = Array.from({ length: 11 }, (_, i) => `e${i}`);
    const bad = await client.callTool({ name: "compute_timing_plan", arguments: { job_id: "gj-0123abcd", periods: ["a", "b"], entities, values: {} } });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toMatch(/entities/);
    const ok = await client.callTool({ name: "compute_timing_plan", arguments: { job_id: "gj-0123abcd", periods: ["a", "b"], entities: ["x", "y"], values: { x: [1, 2], y: [2, 1] } } });
    expect(ok.isError).toBeFalsy();
    expect(seen).toHaveLength(1);
  });

  it("the catalogs overlap only in the justified shared read tools", async () => {
    const [c, g] = [await copilot(), await generation()];
    expect(c.filter((n) => g.includes(n)).sort()).toEqual([...GENERATION_SHARED_TOOLS].sort());
  });
});
