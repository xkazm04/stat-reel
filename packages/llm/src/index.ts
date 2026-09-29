/**
 * LLM engines as interchangeable MCP clients (DESIGN §6.6). The LLM works only through StatReel's
 * MCP tools: validated props, read-only SQL on llm.* views, narration. It never writes code.
 *
 * - ClaudeEngine: `claude -p ... --output-format stream-json --verbose --mcp-config <file>
 *   --strict-mcp-config --allowedTools "mcp__statreel__*"` (flags verified with `claude --help`,
 *   2026-09-29), resumable with `--resume <session_id>`. Records a fixture when LLM_RECORD=1.
 * - ReplayEngine: replays a recorded stream and RE-EXECUTES each recorded tool call against the
 *   app's own tool handlers, so a replay run stores the same props/scripts a live run did.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type LlmEvent =
  | { type: "session"; session_id: string; tools?: string[] }
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; tool: string; input: unknown }
  | { type: "tool_result"; id: string; content: string; is_error?: boolean }
  | { type: "result"; ok: boolean; result: string; session_id: string; cost_usd?: number; turns?: number; refusal?: boolean }
  | { type: "stderr"; text: string };

export type RunOptions = {
  prompt: string;
  mcpConfigPath: string;
  systemPrompt?: string;
  resume?: string;
  cwd?: string;
  model?: string;
  signal?: AbortSignal;
  onEvent: (e: LlmEvent) => void;
};
export type RunResult = { ok: boolean; session_id: string; result: string; cost_usd?: number; events: LlmEvent[] };
export interface LlmEngine {
  readonly name: "claude-code" | "codex";
  run(opts: RunOptions): Promise<RunResult>;
}
export type ToolExecutor = (tool: string, input: unknown) => Promise<unknown>;

export const stripMcpPrefix = (name: string) => name.replace(/^mcp__statreel__/, "");

const REFUSAL = /\b(I can(?:'|no)t help with|I won't|I'm not able to (?:help|assist))\b/i;

export function parseStreamLine(line: string): LlmEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let msg: Record<string, any>;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return [{ type: "stderr", text: trimmed }];
  }
  if (msg.type === "system" && msg.subtype === "init") return [{ type: "session", session_id: msg.session_id, tools: msg.tools }];
  if (msg.type === "assistant") {
    return (msg.message?.content ?? []).flatMap((c: any): LlmEvent[] => {
      if (c.type === "text" && c.text) return [{ type: "text", text: c.text }];
      if (c.type === "tool_use") return [{ type: "tool_call", id: c.id, tool: stripMcpPrefix(c.name), input: c.input }];
      return [];
    });
  }
  if (msg.type === "user") {
    return (msg.message?.content ?? []).flatMap((c: any): LlmEvent[] => {
      if (c.type !== "tool_result") return [];
      const content = typeof c.content === "string" ? c.content : (c.content ?? []).map((p: any) => p.text ?? "").join("");
      return [{ type: "tool_result", id: c.tool_use_id, content, is_error: !!c.is_error }];
    });
  }
  if (msg.type === "result") {
    const text = String(msg.result ?? "");
    return [{ type: "result", ok: msg.subtype === "success" && !msg.is_error, result: text, session_id: msg.session_id,
      cost_usd: msg.total_cost_usd, turns: msg.num_turns, refusal: REFUSAL.test(text) }];
  }
  return [];
}

export function claudeArgs(o: { prompt: string; mcpConfigPath: string; systemPrompt?: string; resume?: string; model?: string }): string[] {
  const args = ["-p", o.prompt, "--output-format", "stream-json", "--verbose", "--mcp-config", o.mcpConfigPath, "--strict-mcp-config",
    "--allowedTools", "mcp__statreel__*", "--permission-mode", "default", "--setting-sources", "project,local"];
  if (o.systemPrompt) args.push("--append-system-prompt", o.systemPrompt);
  if (o.resume) args.push("--resume", o.resume);
  if (o.model) args.push("--model", o.model);
  return args;
}

export const fixtureKey = (engine: string, prompt: string, resume: string | undefined) =>
  createHash("sha256").update(JSON.stringify({ engine, prompt, resume: resume ? "resumed" : null })).digest("hex").slice(0, 24);

function collect(events: LlmEvent[], opts: RunOptions): RunResult {
  const result = [...events].reverse().find((e) => e.type === "result") as Extract<LlmEvent, { type: "result" }> | undefined;
  const session = events.find((e) => e.type === "session") as Extract<LlmEvent, { type: "session" }> | undefined;
  return { ok: !!result?.ok && !result.refusal, session_id: result?.session_id ?? session?.session_id ?? opts.resume ?? "", result: result?.result ?? "", cost_usd: result?.cost_usd, events };
}

export class ClaudeEngine implements LlmEngine {
  readonly name = "claude-code" as const;
  constructor(private readonly bin = process.env.CLAUDE_BIN ?? "claude", private readonly fixturesDir?: string) {}

  run(opts: RunOptions): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, claudeArgs(opts), { cwd: opts.cwd, signal: opts.signal, shell: process.platform === "win32", windowsHide: true });
      const raw: string[] = [];
      const events: LlmEvent[] = [];
      let buf = "";
      child.stdout.on("data", (d: Buffer) => {
        buf += d.toString("utf8");
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.trim()) raw.push(line);
          for (const e of parseStreamLine(line)) {
            events.push(e);
            opts.onEvent(e);
          }
        }
      });
      let stderr = "";
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
      child.on("error", reject);
      child.on("close", (code) => {
        for (const e of parseStreamLine(buf)) events.push(e);
        if (buf.trim()) raw.push(buf);
        const res = collect(events, opts);
        if (this.fixturesDir && process.env.LLM_RECORD === "1") {
          mkdirSync(this.fixturesDir, { recursive: true });
          writeFileSync(path.join(this.fixturesDir, `${fixtureKey(this.name, opts.prompt, opts.resume)}.jsonl`), raw.join("\n"));
        }
        if (code !== 0 && !res.result) reject(new Error(`claude exited ${code}: ${stderr.slice(-800)}`));
        else resolve(res);
      });
    });
  }
}

export class ReplayEngine implements LlmEngine {
  constructor(readonly name: "claude-code" | "codex", private readonly fixturesDir: string, private readonly execute: ToolExecutor) {}

  async run(opts: RunOptions): Promise<RunResult> {
    const file = path.join(this.fixturesDir, `${fixtureKey(this.name, opts.prompt, opts.resume)}.jsonl`);
    if (!existsSync(file)) throw new Error(`LLM replay fixture missing: ${file} (record with LLM_MODE=live LLM_RECORD=1)`);
    const events: LlmEvent[] = [];
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      for (const e of parseStreamLine(line)) {
        if (opts.signal?.aborted) throw new Error("aborted");
        if (e.type === "tool_result") {
          // the app's own result replaces the recorded one: replay exercises the real handlers
          const call = events.find((x) => x.type === "tool_call" && x.id === e.id) as Extract<LlmEvent, { type: "tool_call" }> | undefined;
          const live = call ? await this.execute(call.tool, call.input) : undefined;
          const replaced: LlmEvent = { ...e, content: live === undefined ? e.content : JSON.stringify(live) };
          events.push(replaced);
          opts.onEvent(replaced);
          continue;
        }
        events.push(e);
        opts.onEvent(e);
      }
    }
    return collect(events, opts);
  }
}
