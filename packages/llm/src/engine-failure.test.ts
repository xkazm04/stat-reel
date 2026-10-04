import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeEngine, fixtureFile, type LlmEvent } from "./index";
import { stopMessage } from "./limits";

/** A stand-in `claude`: `node fake.cjs` prints a result on stdout and a diagnosis on stderr. No real claude, no network. */
function fakeClaude(script: string): ClaudeEngine {
  const dir = mkdtempSync(path.join(tmpdir(), "llm-fake-"));
  const js = path.join(dir, "fake.cjs");
  writeFileSync(js, script);
  return new ClaudeEngine(process.execPath, undefined, [js]);
}

const run = (engine: ClaudeEngine, events: LlmEvent[]) =>
  engine.run({ prompt: "x", mcpConfigPath: "m", onEvent: (e) => events.push(e) });

describe("ClaudeEngine failure legibility", () => {
  it("attaches the stderr tail to a failed run that still emitted a result, as an event and on the result", async () => {
    const engine = fakeClaude(`console.error("auth expired: run claude login");
console.log(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "Execution error", session_id: "s" }));
process.exit(1);`);
    const seen: LlmEvent[] = [];
    const res = await run(engine, seen);
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain("auth expired: run claude login");
    expect(seen).toContainEqual({ type: "stderr", text: expect.stringContaining("auth expired") });
  });

  it("a crash with no result still rejects with the stderr tail, and the transcript event was emitted first", async () => {
    const engine = fakeClaude(`console.error("segfault in mcp client");
process.exit(3);`);
    const seen: LlmEvent[] = [];
    await expect(run(engine, seen)).rejects.toThrow(/claude exited 3: segfault in mcp client/);
    expect(seen).toContainEqual({ type: "stderr", text: "segfault in mcp client" });
  });

  it("stays quiet on stderr when the run succeeded", async () => {
    const engine = fakeClaude(`console.error("deprecation warning");
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "done", session_id: "s" }));
process.exit(0);`);
    const seen: LlmEvent[] = [];
    const res = await run(engine, seen);
    expect(res.ok).toBe(true);
    expect(res.stderr).toBeUndefined();
    expect(seen.some((e) => e.type === "stderr")).toBe(false);
  });
});

describe("LLM_RECORD keeps only a successful run (a failed one must not overwrite the committed fixture)", () => {
  const recording = (script: string) => {
    const dir = mkdtempSync(path.join(tmpdir(), "llm-rec-"));
    const js = path.join(dir, "fake.cjs");
    writeFileSync(js, script);
    const fixtures = path.join(dir, "fixtures");
    const engine = new ClaudeEngine(process.execPath, fixtures, [js]);
    const file = fixtureFile(fixtures, "claude-code", { prompt: "x" });
    mkdirSync(fixtures, { recursive: true });
    writeFileSync(file, "GOOD RECORDING");
    return { engine, file };
  };
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["a failed result", `console.log(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "Execution error", session_id: "s" })); process.exit(1);`],
    ["a crash with no result", `console.error("auth expired"); process.exit(3);`],
  ])("%s leaves the existing fixture untouched and says it was not recorded", async (_name, script) => {
    vi.stubEnv("LLM_RECORD", "1");
    const { engine, file } = recording(script);
    const seen: LlmEvent[] = [];
    await run(engine, seen).catch(() => undefined);
    expect(readFileSync(file, "utf8")).toBe("GOOD RECORDING");
    expect(seen).toContainEqual({ type: "stderr", text: expect.stringMatching(/not recorded/) });
  });

  it("an aborted run (a cap or a cancel) is not recorded either", async () => {
    vi.stubEnv("LLM_RECORD", "1");
    const { engine, file } = recording(`console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "s" })); setTimeout(() => {}, 10000);`);
    const ac = new AbortController();
    const p = engine.run({ prompt: "x", mcpConfigPath: "m", signal: ac.signal, onEvent: () => ac.abort() }).catch(() => undefined);
    await p;
    await new Promise((r) => setTimeout(r, 100));
    expect(readFileSync(file, "utf8")).toBe("GOOD RECORDING");
  });

  it("a successful run is recorded", async () => {
    vi.stubEnv("LLM_RECORD", "1");
    const { engine, file } = recording(`console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "done", session_id: "s" })); process.exit(0);`);
    await run(engine, []);
    expect(readFileSync(file, "utf8")).toContain('"subtype":"success"');
  });
});

describe("tool-call cap message", () => {
  const limits = { maxTurns: 40, maxBudgetUsd: 3, timeoutMs: 1000 };
  it("names the unit (tool calls) and keeps the env var name", () => {
    expect(stopMessage("max_tool_calls", limits, 7)).toMatch(/stopped at 7 tool calls \(limit 40\).*LLM_MAX_TURNS/);
  });
  it("keeps 'turns' for the CLI's own error_max_turns", () => {
    expect(stopMessage("max_turns", limits, 31)).toMatch(/stopped at 31 turns/);
  });
});
