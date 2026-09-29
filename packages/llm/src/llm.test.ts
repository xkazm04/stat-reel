import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { claudeArgs, fixtureKey, parseStreamLine, ReplayEngine, stripMcpPrefix, templateOut } from "./index";

const lines = [
  { type: "system", subtype: "init", session_id: "s-123", tools: ["mcp__statreel__query"] },
  { type: "assistant", message: { content: [{ type: "text", text: "Looking at the views." }, { type: "tool_use", id: "t1", name: "mcp__statreel__describe_views", input: { sport: "F1" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "{\"views\":[]}" }] }] } },
  { type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "mcp__statreel__set_props", input: { project: "p-1", props: { a: 1 } } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: "{\"version\":1}" }] } },
  { type: "result", subtype: "success", is_error: false, result: "Done.", session_id: "s-123", total_cost_usd: 0.12, num_turns: 3 },
];

describe("stream-json parsing", () => {
  it("normalises CLI events into app events", () => {
    const evs = lines.flatMap((l) => parseStreamLine(JSON.stringify(l)));
    expect(evs.map((e) => e.type)).toEqual(["session", "text", "tool_call", "tool_result", "tool_call", "tool_result", "result"]);
    expect(evs[2]).toMatchObject({ type: "tool_call", tool: "describe_views", input: { sport: "F1" } });
    expect(evs.at(-1)).toMatchObject({ type: "result", ok: true, session_id: "s-123", cost_usd: 0.12 });
  });

  it("ignores blank and non-JSON lines", () => {
    expect(parseStreamLine("")).toEqual([]);
    expect(parseStreamLine("warning: something")).toEqual([{ type: "stderr", text: "warning: something" }]);
  });

  it("strips the MCP server prefix", () => {
    expect(stripMcpPrefix("mcp__statreel__set_props")).toBe("set_props");
    expect(stripMcpPrefix("Bash")).toBe("Bash");
  });
});

describe("claude invocation", () => {
  it("builds the verified headless flags: MCP tools only, prompt on stdin, own system prompt", () => {
    const args = claudeArgs({ mcpConfigPath: "/x/mcp.json", systemPromptFile: "/x/sys.md" });
    expect(args).toEqual(expect.arrayContaining(["-p", "--output-format", "stream-json", "--verbose", "--mcp-config", "/x/mcp.json", "--strict-mcp-config", "--allowedTools", "mcp__statreel__*"]));
    const tools = args.indexOf("--tools");
    expect(args[tools + 1]).toBe(""); // no built-in tools (Bash, Read, Edit...) at all
    expect(args).toEqual(expect.arrayContaining(["--system-prompt-file", "/x/sys.md"]));
    expect(args.some((a) => a.includes(" "))).toBe(false); // nothing a Windows shell could split
    expect(claudeArgs({ mcpConfigPath: "m", resume: "s-1" })).toEqual(expect.arrayContaining(["--resume", "s-1"]));
  });
});

describe("replay engine", () => {
  it("re-executes recorded tool calls against the app and emits the same events", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "llm-"));
    const key = fixtureKey("claude-code", "make the video", undefined);
    writeFileSync(path.join(dir, `${key}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n"));
    const calls: [string, unknown][] = [];
    const engine = new ReplayEngine("claude-code", dir, async (tool, input) => {
      calls.push([tool, input]);
      return { ok: true };
    });
    const seen: string[] = [];
    const res = await engine.run({ prompt: "make the video", mcpConfigPath: "unused", onEvent: (e) => seen.push(e.type) });
    expect(calls).toEqual([["describe_views", { sport: "F1" }], ["set_props", { project: "p-1", props: { a: 1 } }]]);
    expect(res).toMatchObject({ ok: true, session_id: "s-123", result: "Done." });
    expect(seen).toContain("tool_result");
  });

  it("fails loudly when the fixture is missing", async () => {
    const engine = new ReplayEngine("claude-code", mkdtempSync(path.join(tmpdir(), "llm-")), async () => ({}));
    await expect(engine.run({ prompt: "unknown", mcpConfigPath: "m", onEvent: () => {} })).rejects.toThrow(/fixture missing/);
  });
});

describe("templated fixtures (project ids differ between runs)", () => {
  it("keys on the prompt with variables templated out and substitutes them back on replay", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "llm-"));
    const recorded = [
      { type: "system", subtype: "init", session_id: "s-9" },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "mcp__statreel__set_props", input: { project: "{{PROJECT}}", props: {} } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "{}" }] } },
      { type: "result", subtype: "success", result: "ok", session_id: "s-9" },
    ];
    const key = fixtureKey("claude-code", "Draft project {{PROJECT}} now", undefined);
    writeFileSync(path.join(dir, `${key}.jsonl`), recorded.map((l) => JSON.stringify(l)).join("\n"));
    const calls: unknown[] = [];
    const engine = new ReplayEngine("claude-code", dir, async (_t, input) => (calls.push(input), {}));
    await engine.run({ prompt: "Draft project p-77aa now", vars: { PROJECT: "p-77aa" }, mcpConfigPath: "m", onEvent: () => {} });
    expect(calls).toEqual([{ project: "p-77aa", props: {} }]);
  });

  it("templates values out of what it records", () => {
    expect(templateOut('{"project":"p-1"} p-1', { PROJECT: "p-1" })).toBe('{"project":"{{PROJECT}}"} {{PROJECT}}');
  });
});
