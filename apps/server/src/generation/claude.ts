/**
 * Claude Code CLI runner (ADR 010, SPEC D.5). Every flag below was verified against
 * `claude --version` 2.1.288 (`--help` plus probe runs, docs/specs/2026-10-03-app-refresh/T8-probe-results.md).
 *
 * - `spawn(bin, args[], {shell:false})`; the prompt travels on stdin, so no case text is ever on argv.
 * - `--restricted` + `--tools <list>`: confines the file tools to the working directory, ignores the
 *   user's/project's settings and CLAUDE.md, and keeps WebSearch/WebFetch because `--tools` names them (O1, O3).
 * - `--permission-mode dontAsk --permission-prompts none`: nothing can prompt; whatever is not allowed is denied.
 * - Bash and PowerShell are not in `--tools` and are also in `--disallowedTools`.
 * - No `--max-budget-usd` and no timer unless configured (Q7).
 */
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type GenerationConfig, type GenerationJobType, DOMAIN_RE, dataRacePropsJsonSchema, MODEL_ID_RE, extraArgsProblem, perTypeValue } from "@statreel/schemas";
import { parseStreamLine, resolveClaudeBin, type LlmEvent } from "@statreel/llm";
import { killTree } from "../proc";
import { type GenerationEngine, GenerationError, type RunContext } from "./engine";
import { type JobPaths, jobPaths } from "./paths";
import type { RunSpend } from "./queue";
import { renderPrompt, writePrompt } from "./prompt";
import { stageRefs } from "./refs";
import { repoRoot } from "../config";

/** Fixed text (no case content): appended to the CLI's own system prompt. */
export const APPEND_SYSTEM_PROMPT =
  "You are a StatReel generation job. Write only inside the working directory. Data values only through mcp__statreel__ tools; the web is for finding assets only. Save files from the web only with mcp__statreel__fetch_asset. When validate_generation_output returns no errors, stop.";

/** The CLI keeps running briefly after `result`; past this we kill the tree (O4 safety net, not a time limit). */
export const POST_RESULT_GRACE_MS = 30_000;

export type ClaudeArgsInput = {
  config: GenerationConfig;
  type: GenerationJobType;
  /** absolute path of the job's mcp.json */
  mcpConfigPath: string;
};

/** Asserts the invariants the spec lists (D.12) so a bad config can never reach argv. */
export function buildClaudeArgs(i: ClaudeArgsInput): string[] {
  const { config } = i;
  if (!MODEL_ID_RE.test(config.model)) throw new Error(`invalid model id: ${config.model}`);
  if (config.fallbackModel && !MODEL_ID_RE.test(config.fallbackModel)) throw new Error(`invalid fallback model id: ${config.fallbackModel}`);
  if ((config.permissionMode as string) === "bypassPermissions") throw new Error("bypassPermissions is never allowed");
  const bad = extraArgsProblem(config.cli.extraArgs);
  if (bad) throw new Error(bad);
  if (config.web.fetchDomains?.some((d) => !DOMAIN_RE.test(d))) throw new Error("web.fetchDomains has an invalid domain");

  const tools = ["Read", "Write", "Edit", "Glob", "Grep"];
  if (config.web.search) tools.push("WebSearch");
  if (config.web.fetch) tools.push("WebFetch");
  const allowed = ["Read", "Write", "Edit", "Glob", "Grep"];
  if (config.web.search) allowed.push("WebSearch");
  // a domain list turns the blanket WebFetch allow into per-domain rules (O2: verified to work under dontAsk)
  if (config.web.fetch) allowed.push(...(config.web.fetchDomains?.length ? config.web.fetchDomains.map((d) => `WebFetch(domain:${d})`) : ["WebFetch"]));
  allowed.push("mcp__statreel__*");

  const args = ["-p", "--restricted", "--output-format", "stream-json", "--verbose", "--model", config.model];
  if (config.fallbackModel) args.push("--fallback-model", config.fallbackModel);
  if (config.effort) args.push("--effort", config.effort);
  args.push("--permission-mode", config.permissionMode, "--permission-prompts", "none");
  args.push("--tools", tools.join(","));
  args.push("--allowedTools", ...allowed);
  args.push("--disallowedTools", "Bash", "PowerShell");
  args.push("--mcp-config", i.mcpConfigPath, "--strict-mcp-config");
  const budget = perTypeValue(config.budgetUsd, i.type);
  if (budget !== null) args.push("--max-budget-usd", String(budget));
  args.push("--no-session-persistence", "--append-system-prompt", APPEND_SYSTEM_PROMPT);
  args.push(...config.cli.extraArgs);
  return args;
}

export function writeJobMcpConfig(p: JobPaths, apiBase: string): string {
  writeFileSync(p.mcpJson, JSON.stringify({ mcpServers: { statreel: { type: "http", url: `${apiBase}/mcp/generation` } } }, null, 2));
  return p.mcpJson;
}

const clip = (s: string, n = 2048) => (s.length > n ? `${s.slice(0, n)}...` : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Readable run.log line for one stream event (and the tool name for `last_tool`). */
export function logLineFor(e: LlmEvent): { line: string; tool?: string } | null {
  switch (e.type) {
    case "session": return { line: `session ${e.session_id}` };
    case "text": return { line: `text: ${clip(oneLine(e.text))}` };
    case "tool_call": {
      const inp = e.input as Record<string, unknown> | undefined;
      // searches and fetches are logged with their query/URL so asset provenance is auditable
      const detail = inp ? clip(oneLine(JSON.stringify(inp)), 400) : "";
      return { line: `tool_call ${e.tool} ${detail}`, tool: e.tool };
    }
    case "tool_result": return { line: `tool_result${e.is_error ? " ERROR" : ""}: ${clip(oneLine(e.content))}` };
    case "result": return { line: `result ok=${e.ok} turns=${e.turns ?? "?"} cost=${e.cost_usd ?? "?"} ${clip(oneLine(e.result), 500)}` };
    case "stderr": return { line: `stderr: ${clip(e.text)}` };
  }
}

/** A GenerationError that also carries what the run cost: failed, budget and cancelled runs are billed too (cost ledger). */
export class CostedGenerationError extends GenerationError {
  constructor(kind: GenerationError["kind"], message: string, readonly spend: RunSpend) {
    super(kind, message);
  }
}

export type LiveEngineOptions = { config: GenerationConfig; dataRoot: string; apiBase: string; bin?: string };

export function createLiveEngine(o: LiveEngineOptions): GenerationEngine {
  const bin = o.bin ?? o.config.cli.bin ?? resolveClaudeBin();
  return {
    name: "claude",

    /** Reference docs + prompt.md + the job's mcp.json (SPEC D.5). A missing rule source fails the job. */
    async stage(job, p, caseData) {
      // the props schema is a file in refs/ as well as in get_generation_context (T9 landed; nothing is "pending")
      const manifest = stageRefs({ paths: p, repoRoot, dataRoot: o.dataRoot, propsJsonSchema: dataRacePropsJsonSchema });
      const prompt = renderPrompt(job, caseData, o.config.web);
      writePrompt(p, prompt);
      writeJobMcpConfig(p, o.apiBase);
      return { refs: { count: manifest.entries.length, golden_paths: manifest.golden_paths, pending: manifest.pending } };
    },

    run(ctx: RunContext) {
      const p = jobPaths(ctx.job.id, o.dataRoot);
      const args = buildClaudeArgs({ config: ctx.config, type: ctx.job.type, mcpConfigPath: p.mcpJson });
      const prompt = readFileSync(p.prompt, "utf8");
      ctx.log(`spawn ${path.basename(bin)} ${args.filter((a) => a !== APPEND_SYSTEM_PROMPT).join(" ")}`);
      return new Promise((resolve, reject) => {
        const child = spawn(bin, args, {
          cwd: p.work, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32",
          env: { ...process.env, STATREEL_GEN_JOB: ctx.job.id },
        });
        if (child.pid) ctx.setPid(child.pid);
        child.stdin.on("error", () => {}); // the CLI may exit before reading everything
        child.stdin.end(prompt, "utf8"); // never argv; stdin closed so nothing can wait for input

        let buf = "";
        let result: Extract<LlmEvent, { type: "result" }> | null = null;
        let resultSubtype = "";
        let graceTimer: NodeJS.Timeout | null = null;
        let stderrTail = "";
        let jsonlBroken = false;
        const onLine = (line: string) => {
          if (!line.trim()) return;
          // best effort like run.log and stderr.log: a throw here escapes the stream handler and kills the worker
          // (the CLI child keeps running and spending); say it once in run.log instead
          try {
            appendFileSync(p.runJsonl, `${line}\n`);
          } catch (e) {
            if (!jsonlBroken) ctx.log(`run.jsonl not written (${e instanceof Error ? e.message : String(e)}); the stream continues`);
            jsonlBroken = true;
          }
          try {
            const raw = JSON.parse(line) as { type?: string; subtype?: string };
            if (raw.type === "result") resultSubtype = String(raw.subtype ?? "");
          } catch { /* parseStreamLine reports non-JSON as stderr */ }
          for (const e of parseStreamLine(line)) {
            const l = logLineFor(e);
            if (l) ctx.log(l.line);
            if (l?.tool) ctx.note({ last_tool: l.tool, progress_note: l.line.slice(0, 160) });
            if (e.type === "result") {
              result = e;
              // the session should exit by itself; if it lingers, kill the tree after the grace period
              graceTimer = setTimeout(() => {
                ctx.log(`process still alive ${POST_RESULT_GRACE_MS / 1000} s after result: killing the tree`);
                if (child.pid) void killTree(child.pid);
              }, POST_RESULT_GRACE_MS);
              graceTimer.unref();
            }
          }
        };
        // setEncoding decodes across chunk boundaries (a per-chunk toString splits a multibyte character into U+FFFD)
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (d: string) => {
          buf += d;
          for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
            onLine(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
          }
        });
        child.stderr.on("data", (s: string) => {
          stderrTail = (stderrTail + s).slice(-2000);
          try { appendFileSync(p.stderrLog, s); } catch { /* best effort */ }
        });
        const abort = () => {
          if (child.pid) void killTree(child.pid);
        };
        if (ctx.signal.aborted) abort();
        else ctx.signal.addEventListener("abort", abort, { once: true });
        child.on("error", (err) => {
          if (graceTimer) clearTimeout(graceTimer);
          reject(new GenerationError("cli_exit", `could not start ${bin}: ${err.message}`));
        });
        child.on("close", (code) => {
          if (graceTimer) clearTimeout(graceTimer);
          ctx.signal.removeEventListener("abort", abort);
          if (buf.trim()) onLine(buf);
          ctx.setPid(null);
          const r = result as Extract<LlmEvent, { type: "result" }> | null;
          // the result event's cost is carried on every outcome; a run killed before its result reports none
          const spend: RunSpend = { cost_usd: r?.cost_usd ?? null, turns: r?.turns ?? null };
          const fail = (kind: GenerationError["kind"], message: string) => reject(new CostedGenerationError(kind, message, spend));
          if (ctx.signal.aborted) return fail("cancelled", "aborted");
          if (!r) return fail("cli_exit", `claude exited ${code} without a result event: ${oneLine(stderrTail).slice(-300)}`);
          if (r.refusal) return fail("cli_exit", `refused: ${clip(oneLine(r.result), 200)}`);
          if (/budget/i.test(resultSubtype)) return fail("budget", `budget cap reached (${resultSubtype})`);
          if (!r.ok) return fail("cli_exit", `session ended with ${resultSubtype || "an error"}: ${clip(oneLine(r.result), 200)}`);
          resolve({ result: { cost_usd: r.cost_usd ?? null, turns: r.turns ?? null, session_id: r.session_id, model: ctx.config.model, exit_code: code } });
        });
      });
    },
  };
}
