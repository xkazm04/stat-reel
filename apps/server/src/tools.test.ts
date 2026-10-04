import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { buildMcpServer, isFailedResult, text } from "./mcp";
import { capQueryResult, capViews, MAX_RESULT_BYTES, MAX_RESULT_ROWS } from "./tool-output";
import { toolShapes } from "./tool-schemas";
import { executor, makeTools, type ToolDeps } from "./tools";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ fact_key: `f:${i}`, v: i }));

function deps(over: { query?: unknown; views?: unknown[] } = {}) {
  const renderKeyframes = vi.fn(async (_p: string, f: number[]) => ({ stills: f.map((s) => `s${s}.png`) }));
  const setProps = vi.fn(async () => ({ version: 1, errors: [] as string[] }));
  const d = {
    wh: { query: async () => over.query ?? { columns: ["v"], rows: rows(3), truncated: false }, describeViews: async () => over.views ?? [] },
    projects: { get: (id: string) => (id === "p-1" || id === "p-2" ? { id } : undefined), list: () => [{ id: "p-1" }, { id: "p-2" }], setProps, writeScript: async () => ({ version: 1, errors: [] }) },
    heatmap: { usecases: () => [{ id: "era-adjusted-rankings" }, { id: "pit-stop-dna" }], current: async () => [] },
    pipeline: { renderKeyframes, generateAudio: async () => ({ job_id: "j" }), renderReport: async () => ({ error: "no render yet" }), policyCheck: async () => ({ allow: true }) },
  } as unknown as ToolDeps;
  return { d, tools: makeTools(d), renderKeyframes, setProps };
}

describe("tool output caps", () => {
  it("caps a query at 200 rows with a narrowing note", async () => {
    const { tools } = deps({ query: { columns: ["v"], rows: rows(5000), truncated: true } });
    const r = (await tools.query({ sql: "select 1" })) as { rows: unknown[]; truncated: boolean; note: string };
    expect(r.rows).toHaveLength(MAX_RESULT_ROWS);
    expect(r.truncated).toBe(true);
    expect(r.note).toMatch(/first 200 of at least 5000 rows.*WHERE.*LIMIT/);
  });

  it("caps by bytes too, and leaves a small result untouched", () => {
    const fat = Array.from({ length: 100 }, (_, i) => ({ i, blob: "x".repeat(2000) }));
    const capped = capQueryResult({ columns: [], rows: fat });
    expect(Buffer.byteLength(JSON.stringify(capped))).toBeLessThanOrEqual(MAX_RESULT_BYTES + 1024); // + the note itself
    expect(capped.rows.length).toBeLessThan(100);
    expect(capped.note).toBeTruthy();
    const small = { columns: [], rows: rows(3) };
    expect(capQueryResult(small)).toBe(small);
  });

  it("describe_views drops samples, then views, to fit", () => {
    const view = (i: number) => ({ name: `llm.v${i}`, columns: [{ name: "a" }], sample: Array.from({ length: 3 }, () => ({ blob: "y".repeat(8000) })) });
    const dropped = capViews(Array.from({ length: 4 }, (_, i) => view(i)));
    expect(dropped.views).toHaveLength(4);
    expect(dropped.views.every((v) => v.sample.length === 0)).toBe(true);
    expect(dropped.note).toMatch(/Sample rows were dropped/);
    const cols = (i: number) => ({ ...view(i), columns: Array.from({ length: 300 }, (_, c) => ({ name: `c${c}`, comment: "z".repeat(40) })) });
    const cut = capViews(Array.from({ length: 30 }, (_, i) => cols(i)));
    expect(cut.views.length).toBeLessThan(30);
    expect(cut.note).toMatch(/cut to \d+ of 30 views.*sport/);
    expect(capViews([view(0)].map((v) => ({ ...v, sample: [] }))).note).toBeUndefined();
  });
});

describe("unknown ids list the valid ones", () => {
  it("get_props_schema names the known use cases", async () => {
    const { tools } = deps();
    const r = (await tools.get_props_schema({ use_case: "nope" })) as { error: string };
    expect(r.error).toMatch(/era-adjusted-rankings, pit-stop-dna/);
  });

  it("every project tool names the valid projects for an unknown project", async () => {
    const { tools, setProps } = deps();
    const calls = [
      tools.set_props({ project: "zzz", props: {} }),
      tools.write_script({ project: "zzz", script: {} }),
      tools.generate_audio({ project: "zzz" }),
      tools.render_keyframes({ project: "zzz", frames_s: [1] }),
      tools.get_render_report({ project: "zzz" }),
      tools.policy_check({ project: "zzz", target: { platform: "youtube", monetized: false, ai_disclosure: true, visibility: "private" } }),
    ];
    for (const r of await Promise.all(calls)) expect((r as { error: string }).error).toMatch(/unknown project "zzz".*p-1, p-2/);
    expect(setProps).not.toHaveBeenCalled();
  });
});

describe("generate_audio kind (the audio job always makes voice AND music)", () => {
  it("a voice-only or music-only request is refused, not silently widened to a full (paid) audio run", async () => {
    const generateAudio = vi.fn(async () => ({ job_id: "j" }));
    const { d } = deps();
    const tools = makeTools({ ...d, pipeline: { ...d.pipeline, generateAudio } });
    for (const kind of ["tts", "music"] as const) {
      const r = (await tools.generate_audio({ project: "p-1", kind })) as { error: string };
      expect(r.error).toMatch(new RegExp(`kind "${kind}" is not supported.*voice and music together.*kind "all"`));
    }
    expect(generateAudio).not.toHaveBeenCalled();
    expect(await tools.generate_audio({ project: "p-1", kind: "all" })).toEqual({ job_id: "j" });
    expect(await tools.generate_audio({ project: "p-1" })).toEqual({ job_id: "j" });
    expect(generateAudio).toHaveBeenCalledTimes(2);
  });
});

describe("one schema for replay and live", () => {
  it("executor rejects what the MCP schema rejects: missing frames_s is an error, not a TypeError", async () => {
    const { tools, renderKeyframes } = deps();
    const run = executor(tools);
    const r = (await run("render_keyframes", { project: "p-1" })) as { error: string };
    expect(r.error).toMatch(/invalid input for render_keyframes: frames_s/);
    expect(renderKeyframes).not.toHaveBeenCalled();
  });

  it("over-limit frames are an error, not a silent slice (executor and handler)", async () => {
    const { tools, renderKeyframes } = deps();
    const r = (await executor(tools)("render_keyframes", { project: "p-1", frames_s: [1, 2, 3, 4, 5, 6, 7] })) as { error: string };
    expect(r.error).toMatch(/at most 6 frames/);
    expect(((await tools.render_keyframes({ project: "p-1", frames_s: [1, 2, 3, 4, 5, 6, 7] })) as { error: string }).error).toMatch(/at most 6 frames.*got 7/);
    expect(renderKeyframes).not.toHaveBeenCalled();
    expect(await executor(tools)("render_keyframes", { project: "p-1", frames_s: [1, 2, 3, 4, 5, 6] })).toEqual({ stills: ["s1.png", "s2.png", "s3.png", "s4.png", "s5.png", "s6.png"] });
  });

  it("applies schema defaults (policy_check visibility) and reports unknown tools with the list", async () => {
    const { tools } = deps();
    expect(await executor(tools)("policy_check", { project: "p-1", target: { platform: "youtube", monetized: true, ai_disclosure: true } })).toEqual({ allow: true });
    expect(((await executor(tools)("policy_check", { project: "p-1", target: { platform: "myspace" } })) as { error: string }).error).toMatch(/target\.platform/);
    expect(((await executor(tools)("nope", {})) as { error: string }).error).toMatch(/unknown tool nope\. Available tools: .*query/);
  });

  it("a handler that throws is a failed result in replay exactly as in live (the SDK turns a throw into isError)", async () => {
    const { d } = deps();
    const boom = { ...d, projects: { ...d.projects, setProps: async () => { throw new Error("warehouse is not built: run just transform"); } } } as unknown as ToolDeps;
    const tools = makeTools(boom);
    // live: the MCP SDK catches the throw and answers isError with the message
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([buildMcpServer(tools).connect(a), client.connect(b)]);
    const live = await client.callTool({ name: "set_props", arguments: { project: "p-1", props: {} } });
    expect(live.isError).toBe(true);
    expect(JSON.stringify(live.content)).toContain("warehouse is not built");
    // replay: the executor returns the same failure instead of rejecting the whole replayed session
    const replay = await executor(tools)("set_props", { project: "p-1", props: {} });
    expect(replay).toEqual({ error: "warehouse is not built: run just transform" });
  });

  it("every tool has a schema shape", () => {
    expect(Object.keys(toolShapes).sort()).toEqual(Object.keys(makeTools(deps().d)).sort());
  });
});

describe("MCP wrapper", () => {
  it("flags error and non-empty errors results as isError", () => {
    expect(isFailedResult({ error: "boom" })).toBe(true);
    expect(isFailedResult({ version: null, errors: ["bad"] })).toBe(true);
    expect(isFailedResult({ version: 2, errors: [] })).toBe(false);
    expect(isFailedResult([1, 2])).toBe(false);
    expect(isFailedResult(null)).toBe(false);
    expect(text({ error: "x" }).isError).toBe(true);
    expect("isError" in text({ ok: true })).toBe(false);
  });

  async function connect() {
    const { tools } = deps();
    const server = buildMcpServer(tools);
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }

  it("live path: tool errors come back isError, and the SDK enforces the same frame limit", async () => {
    const client = await connect();
    const bad = await client.callTool({ name: "get_render_report", arguments: { project: "p-1" } });
    expect(bad.isError).toBe(true);
    const unknown = await client.callTool({ name: "get_props_schema", arguments: { use_case: "nope" } });
    expect(unknown.isError).toBe(true);
    const ok = await client.callTool({ name: "render_keyframes", arguments: { project: "p-1", frames_s: [1, 2] } });
    expect(ok.isError).toBeFalsy();
    const tooMany = await client.callTool({ name: "render_keyframes", arguments: { project: "p-1", frames_s: [1, 2, 3, 4, 5, 6, 7] } });
    expect(tooMany.isError).toBe(true);
    expect(JSON.stringify(tooMany.content)).toMatch(/at most 6 frames/);
  });
});

describe("committed LLM fixture", () => {
  it("every recorded tool call still passes the shared schemas (replay re-executes them)", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { LLM_FIXTURES } = await import("./llm-service");
    const { parseToolInput } = await import("./tool-schemas");
    const files = readdirSync(LLM_FIXTURES).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBeGreaterThan(0);
    let calls = 0;
    for (const f of files) {
      for (const line of readFileSync(`${LLM_FIXTURES}/${f}`, "utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        for (const c of msg.type === "assistant" ? msg.message.content : []) {
          if (c.type !== "tool_use") continue;
          calls++;
          const r = parseToolInput(String(c.name).replace(/^mcp__statreel__/, ""), c.input);
          expect(r.ok, `${f}: ${c.name} ${JSON.stringify(c.input).slice(0, 80)}`).toBe(true);
        }
      }
    }
    expect(calls).toBeGreaterThan(0);
  });
});
