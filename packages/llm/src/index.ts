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
import { isFailedToolContent, isFailedToolResult } from "./tool-result";

export * from "./draft-prompt";
export * from "./limits";
export * from "./tool-result";

export type LlmEvent =
  | { type: "session"; session_id: string; tools?: string[] }
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; tool: string; input: unknown }
  | { type: "tool_result"; id: string; content: string; is_error?: boolean }
  | { type: "result"; ok: boolean; result: string; session_id: string; cost_usd?: number; turns?: number; refusal?: boolean;
      /** the CLI's result subtype (success | error_max_turns | error_max_budget_usd | error_during_execution) */
      subtype?: string;
      /** the CLI itself reported `stop_reason: "refusal"` (not inferred from the wording) */
      refusal_explicit?: boolean }
  | { type: "stderr"; text: string };

export type RunOptions = {
  prompt: string;
  mcpConfigPath: string;
  /** path to a system prompt file (replaces the coding-agent default) */
  systemPromptFile?: string;
  resume?: string;
  cwd?: string;
  model?: string;
  signal?: AbortSignal;
  /** `--max-budget-usd` (the CLI has no max-turns flag; turns and wall clock are the caller's, via `signal`) */
  maxBudgetUsd?: number;
  /** values that differ between runs (e.g. PROJECT id): templated out of fixture keys and files */
  vars?: Record<string, string>;
  onEvent: (e: LlmEvent) => void;
};
export type RunResult = {
  ok: boolean; session_id: string; result: string; cost_usd?: number; events: LlmEvent[];
  /** tail of the CLI's stderr, set only when the run did not succeed (the owner needs it to see why) */
  stderr?: string;
};
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
    const explicit = msg.stop_reason === "refusal" || msg.subtype === "refusal";
    return [{ type: "result", ok: msg.subtype === "success" && !msg.is_error, result: text, session_id: msg.session_id,
      cost_usd: msg.total_cost_usd, turns: msg.num_turns, refusal: explicit || REFUSAL.test(text), refusal_explicit: explicit || undefined, subtype: msg.subtype }];
  }
  return [];
}

/** Headless flags (verified with `claude --help`, 2026-09-29). The prompt goes on stdin. */
export function claudeArgs(o: { mcpConfigPath: string; systemPromptFile?: string; resume?: string; model?: string; maxBudgetUsd?: number }): string[] {
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--mcp-config", o.mcpConfigPath, "--strict-mcp-config",
    "--tools", "", "--allowedTools", "mcp__statreel__*"];
  if (o.systemPromptFile) args.push("--system-prompt-file", o.systemPromptFile);
  if (o.resume) args.push("--resume", o.resume);
  if (o.model) args.push("--model", o.model);
  if (o.maxBudgetUsd && o.maxBudgetUsd > 0) args.push("--max-budget-usd", String(o.maxBudgetUsd));
  return args;
}

/** The real claude executable (the npm shim can't be spawned without a shell on Windows). */
export function resolveClaudeBin(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  if (process.platform === "win32" && process.env.APPDATA) {
    const exe = path.join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (existsSync(exe)) return exe;
  }
  return "claude";
}

export function templateOut(text: string, vars: Record<string, string> = {}): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) if (v) out = out.split(v).join(`{{${k}}}`);
  return out;
}
export function templateIn(text: string, vars: Record<string, string> = {}): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{{${k}}}`).join(v);
  return out;
}

/** Fixture key: engine + templated prompt + system prompt content (editing a prompt pack re-keys). */
// The system prompt is hashed with LF line endings: a Windows checkout may hold CRLF while a fresh
// clone holds LF (.gitattributes eol=lf), and the key must not depend on which one recorded it.
export const fixtureKey = (engine: string, prompt: string, resume: string | undefined, systemPrompt?: string) =>
  createHash("sha256")
    .update(JSON.stringify({ engine, prompt, resume: resume ? "resumed" : null, ...(systemPrompt ? { system: createHash("sha256").update(systemPrompt.replace(/\r\n/g, "\n")).digest("hex") } : {}) }))
    .digest("hex").slice(0, 24);
type KeyOpts = Pick<RunOptions, "prompt" | "resume" | "vars" | "systemPromptFile">;

/** The single place a fixture path is derived; the recorder and the replayer both call it. */
export function fixtureFile(dir: string, engine: string, o: KeyOpts): string {
  return path.join(dir, `${fixtureKey(engine, templateOut(o.prompt, o.vars), o.resume, systemOf(o))}.jsonl`);
}

/** Write a recorded stream with run-specific values (project id) templated out. */
export function recordFixture(dir: string, engine: string, o: KeyOpts, rawLines: string[]): string {
  mkdirSync(dir, { recursive: true });
  const file = fixtureFile(dir, engine, o);
  writeFileSync(file, templateOut(rawLines.join("\n"), o.vars));
  return file;
}

const systemOf = (o: KeyOpts) => (o.systemPromptFile && existsSync(o.systemPromptFile) ? readFileSync(o.systemPromptFile, "utf8") : undefined);

/** Tools whose success means the co-pilot's work was stored (props or a script). */
const STORING_TOOLS = new Set(["set_props", "write_script"]);

/** True when a set_props / write_script call in the run came back without an error. */
export function storedSuccessfully(events: LlmEvent[]): boolean {
  const stored = new Set(events.flatMap((e) => (e.type === "tool_call" && STORING_TOOLS.has(e.tool) ? [e.id] : [])));
  return events.some((e) => e.type === "tool_result" && stored.has(e.id) && !e.is_error && !isFailedToolContent(e.content));
}

/**
 * Whether the run's final result is a refusal. The wording regex alone is not enough: a successful wrap-up that
 * says "I won't touch the other scenes" is not one. So: an explicit CLI refusal always counts; wording counts
 * only when the run stored nothing (no successful set_props / write_script).
 */
export function isRefusal(events: LlmEvent[]): boolean {
  const result = events.findLast((e) => e.type === "result") as Extract<LlmEvent, { type: "result" }> | undefined;
  if (!result) return false;
  if (result.refusal_explicit) return true;
  return !!result.refusal && !storedSuccessfully(events);
}

function collect(events: LlmEvent[], opts: RunOptions): RunResult {
  const result = [...events].reverse().find((e) => e.type === "result") as Extract<LlmEvent, { type: "result" }> | undefined;
  const session = events.find((e) => e.type === "session") as Extract<LlmEvent, { type: "session" }> | undefined;
  return { ok: !!result?.ok && !isRefusal(events), session_id: result?.session_id ?? session?.session_id ?? opts.resume ?? "", result: result?.result ?? "", cost_usd: result?.cost_usd, events };
}

const STDERR_TAIL = 800;
/** The last STDERR_TAIL chars of a CLI's stderr, trimmed ("" when it said nothing). */
export const stderrTail = (stderr: string): string => stderr.trim().slice(-STDERR_TAIL);

export class ClaudeEngine implements LlmEngine {
  readonly name = "claude-code" as const;
  /** `binArgs` go before the CLI flags (tests run a stand-in as `node fake.cjs`) */
  constructor(private readonly bin = resolveClaudeBin(), private readonly fixturesDir?: string, private readonly binArgs: string[] = []) {}

  run(opts: RunOptions): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, [...this.binArgs, ...claudeArgs(opts)], { cwd: opts.cwd, signal: opts.signal, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      child.stdin.end(opts.prompt, "utf8");
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
        for (const e of parseStreamLine(buf)) {
          events.push(e);
          opts.onEvent(e);
        }
        if (buf.trim()) raw.push(buf);
        const res = collect(events, opts);
        // A failed run keeps the CLI's stderr: as an event (the transcript shows it) and on the result (the job error).
        const tail = stderrTail(stderr);
        if (tail && (!res.ok || code !== 0)) {
          const e: LlmEvent = { type: "stderr", text: tail };
          events.push(e);
          opts.onEvent(e);
          res.stderr = tail;
        }
        if (this.fixturesDir && process.env.LLM_RECORD === "1") {
          // Only a clean run becomes a fixture: a failed, crashed or aborted (cap/cancel) run has the same key as the
          // committed recording and would overwrite a paid recording with a broken or partial stream.
          if (res.ok && code === 0 && !opts.signal?.aborted) recordFixture(this.fixturesDir, this.name, opts, raw);
          else {
            const e: LlmEvent = { type: "stderr", text: `LLM_RECORD: run not recorded (it did not succeed: exit ${code}${opts.signal?.aborted ? ", aborted" : ""}); the existing fixture is untouched` };
            events.push(e);
            opts.onEvent(e);
          }
        }
        if (code !== 0 && !res.result) reject(new Error(`claude exited ${code}: ${tail}`));
        else resolve(res);
      });
    });
  }
}

/**
 * A recorded call succeeded but the app's handler now fails it: the replay would otherwise carry on as if
 * the props/script were stored. Thrown by ReplayEngine unless `allowRegressions` is set.
 */
export class ReplayRegressionError extends Error {
  constructor(readonly tool: string, readonly detail: string) {
    super(`replay regression: ${tool} succeeded in the recording but now fails: ${detail}`);
    this.name = "ReplayRegressionError";
  }
}

export type ReplayOptions = {
  /** tests that expect a handler to fail where the recording succeeded; the failure is then reported as is_error */
  allowRegressions?: boolean;
};

export class ReplayEngine implements LlmEngine {
  constructor(
    readonly name: "claude-code" | "codex",
    private readonly fixturesDir: string,
    private readonly execute: ToolExecutor,
    private readonly options: ReplayOptions = {},
  ) {}

  async run(opts: RunOptions): Promise<RunResult> {
    const file = fixtureFile(this.fixturesDir, this.name, opts);
    if (!existsSync(file)) throw new Error(`LLM replay fixture missing: ${file} (record with LLM_MODE=live LLM_RECORD=1)`);
    const events: LlmEvent[] = [];
    for (const line of templateIn(readFileSync(file, "utf8"), opts.vars).split(/\r?\n/)) {
      for (const e of parseStreamLine(line)) {
        if (opts.signal?.aborted) throw new Error("aborted");
        if (e.type === "tool_result") {
          // the app's own result replaces the recorded one: replay exercises the real handlers
          const call = events.find((x) => x.type === "tool_call" && x.id === e.id) as Extract<LlmEvent, { type: "tool_call" }> | undefined;
          const live = call ? await this.execute(call.tool, call.input) : undefined;
          // is_error follows the LIVE result (same rule as the MCP wrapper), so a handler regression is not masked by the recorded flag
          const failed = live === undefined ? !!e.is_error : isFailedToolResult(live);
          if (call && live !== undefined && failed && !e.is_error && !this.options.allowRegressions) {
            throw new ReplayRegressionError(call.tool, JSON.stringify(live).slice(0, 300));
          }
          const replaced: LlmEvent = { ...e, content: live === undefined ? e.content : JSON.stringify(live), is_error: failed };
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
