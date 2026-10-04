/** LLM sessions: one at a time (job kind "llm"), events persisted and streamed, resumable. */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { ClaudeEngine, draftPrompt, isRefusal, type LlmEngine, type LlmEvent, type LlmLimits, llmLimitsFromEnv, ReplayEngine, type StopReason, stopMessage, stopReasonFromSubtype } from "@statreel/llm";
import { modes, paths, repoRoot, server } from "./config";
import { type Db, llmEvents, llmSessions, now } from "./db";
import type { EventBus } from "./events";
import { type JobRunner, Refusal } from "./jobs";
import type { ProjectService } from "./projects";
import { executor, type Tools } from "./tools";

const PROMPTS = path.join(repoRoot, "packages", "llm", "prompts");
export { draftPrompt }; // moved to @statreel/llm so the fixture drift test can reach it
export const LLM_FIXTURES = path.join(paths.fixtures, "llm");

export function writeMcpConfig(): string {
  mkdirSync(paths.statreelLocal, { recursive: true });
  const file = path.join(paths.statreelLocal, "mcp.json");
  writeFileSync(file, JSON.stringify({ mcpServers: { statreel: { type: "http", url: `http://${server.host}:${server.port}/mcp` } } }, null, 2));
  return file;
}

/**
 * Add one run's reported cost/turns to the session row (a follow-up resumes the same row, so runs sum). A null part
 * adds nothing: an unreported cost stays null, never 0.
 */
export function recordSessionSpend(db: Db, sessionId: string, s: { cost_usd: number | null; turns: number | null } | null): void {
  if (!s || (s.cost_usd === null && s.turns === null)) return;
  db.$client.prepare(
    `update llm_sessions set cost_usd = case when ? is null then cost_usd else coalesce(cost_usd, 0) + ? end,
       turns = case when ? is null then turns else coalesce(turns, 0) + ? end where id = ?`,
  ).run(s.cost_usd, s.cost_usd, s.turns, s.turns, sessionId);
}

export class LlmService {
  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
    private readonly runner: JobRunner,
    private readonly projects: ProjectService,
    private readonly tools: Tools,
    /** injectable for tests (fake engine); defaults to replay/live by LLM_MODE */
    private readonly makeEngine?: () => LlmEngine,
    private readonly limits: LlmLimits = llmLimitsFromEnv(),
  ) {
    runner.register("llm", async (params, ctx) => {
      const { sessionId, projectId, prompt, resume } = params as { sessionId: string; projectId: string; prompt: string; resume?: string };
      const session = this.db.select().from(llmSessions).where(eq(llmSessions.id, sessionId)).get();
      let seq = this.db.select().from(llmEvents).where(eq(llmEvents.session_id, sessionId)).all().length;
      const emit = (e: LlmEvent) => {
        this.db.insert(llmEvents).values({ session_id: sessionId, seq: seq++, type: e.type, payload_json: JSON.stringify(e), at: now() }).run();
        if (e.type === "session") this.db.update(llmSessions).set({ external_session_id: e.session_id }).where(eq(llmSessions.id, sessionId)).run();
        this.bus.emit({ type: "llm.event", session_id: sessionId, project_id: projectId, event: e });
      };
      // A run that was `running` when the process died is re-queued by JobRunner.resume(). Every run
      // clears ended_at below, so "events but no ended_at" at start means a previous attempt of THIS
      // job was cut off: re-running would append a second transcript and redo tool calls.
      if (session && !session.ended_at && seq > 0) {
        const note = "Interrupted by a server restart - not replayed (it would duplicate the transcript and redo tool calls). Send a follow-up to continue the session.";
        emit({ type: "stderr", text: note });
        this.db.update(llmSessions).set({ ended_at: now() }).where(eq(llmSessions.id, sessionId)).run();
        throw new Error(note);
      }
      const engine = this.engine();
      const project = this.projects.get(projectId);
      const systemPromptFile = path.join(PROMPTS, `${project?.use_case_id ?? "era-adjusted-rankings"}.md`);
      if (!existsSync(systemPromptFile)) throw new Error(`no co-pilot system prompt for use case "${project?.use_case_id}": expected ${systemPromptFile}`);
      const cwd = path.join(tmpdir(), "statreel-llm"); // neutral: no repo CLAUDE.md, no git status in context
      mkdirSync(cwd, { recursive: true });
      this.db.update(llmSessions).set({ ended_at: null }).where(eq(llmSessions.id, sessionId)).run();

      // The CLI has no max-turns flag (verified), so the tool-call cap (LLM_MAX_TURNS) and the wall-clock cap abort the run here.
      const limit = new AbortController();
      let stopped: StopReason | undefined;
      let toolCalls = 0;
      // the CLI's own result event (cost, turns) of this run: kept for the session ledger even when the run then fails or hits a cap
      let spend: { cost_usd: number | null; turns: number | null } | null = null;
      const stop = (r: StopReason) => {
        stopped ??= r;
        limit.abort();
      };
      const timer = setTimeout(() => stop("timeout"), this.limits.timeoutMs);
      const signal = AbortSignal.any([ctx.signal, limit.signal]);
      try {
        const res = await engine.run({
          prompt, resume, systemPromptFile, mcpConfigPath: writeMcpConfig(), cwd, signal, vars: { PROJECT: projectId }, maxBudgetUsd: this.limits.maxBudgetUsd,
          onEvent: (e: LlmEvent) => {
            emit(e);
            if (e.type === "result") spend = { cost_usd: e.cost_usd ?? null, turns: e.turns ?? null };
            // the cap ALLOWS maxTurns calls: abort on the first call beyond it (">=" killed the last allowed one mid-flight)
            if (e.type === "tool_call" && ++toolCalls > this.limits.maxTurns) stop("max_tool_calls");
          },
        });
        this.db.update(llmSessions).set({ external_session_id: res.session_id || undefined }).where(eq(llmSessions.id, sessionId)).run();
        // the engine may append a stderr event after the result, so look for the result, not the last event
        const last = res.events.findLast((e) => e.type === "result");
        if (last?.type === "result" && isRefusal(res.events)) throw new Refusal(engine.name, last.result.slice(0, 200));
        const reason = stopped ?? (last?.type === "result" ? stopReasonFromSubtype(last.subtype) : undefined);
        if (reason) throw new Error(stopMessage(reason, this.limits, reason === "max_tool_calls" ? this.limits.maxTurns : last?.type === "result" ? last.turns : undefined));
        if (!res.ok) throw new Error(`LLM session ended without success: ${res.result.slice(0, 300)}${res.stderr ? ` | CLI stderr: ${res.stderr}` : ""}`);
        return { session_id: res.session_id, result: res.result, cost_usd: res.cost_usd };
      } catch (err) {
        // our own cap aborted the run: report that, not the AbortError the engine surfaced
        if (stopped && !ctx.signal.aborted) throw new Error(stopMessage(stopped, this.limits, stopped === "max_tool_calls" ? this.limits.maxTurns : undefined));
        throw err;
      } finally {
        clearTimeout(timer);
        this.db.update(llmSessions).set({ ended_at: now() }).where(eq(llmSessions.id, sessionId)).run();
        recordSessionSpend(this.db, sessionId, spend);
      }
    });
  }

  engine(): LlmEngine {
    if (this.makeEngine) return this.makeEngine();
    return modes.llm === "replay"
      ? new ReplayEngine("claude-code", LLM_FIXTURES, executor(this.tools))
      : new ClaudeEngine(undefined, LLM_FIXTURES);
  }

  /** Start (or continue) a session for a project. Returns the app session id and job id. */
  start(projectId: string, prompt?: string, continueSession?: string): { session_id: string; job_id: string } {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`unknown project ${projectId}`);
    const text = prompt ?? draftPrompt(project);
    let sessionId = continueSession;
    let resume: string | undefined;
    if (sessionId) {
      const prev = this.db.select().from(llmSessions).where(eq(llmSessions.id, sessionId)).get();
      if (!prev) throw new Error(`unknown co-pilot session ${sessionId}`);
      if (prev.project_id !== projectId) throw new Error(`co-pilot session ${sessionId} belongs to another project, not ${projectId}`);
      // without the CLI's own id the follow-up would silently open a brand-new CLI session (no memory of this one)
      if (!prev.external_session_id) {
        // no ended_at yet = the first run is queued or still starting: telling the owner it "ended" sends them away from a live run
        if (!prev.ended_at) throw new Error(`co-pilot session ${sessionId} is still running and has not reported its CLI session yet - wait for it to finish, then send the follow-up`);
        throw new Error(`co-pilot session ${sessionId} has no CLI session to resume (the run ended before it started) - start a new session instead`);
      }
      resume = prev.external_session_id;
    } else {
      sessionId = randomUUID();
      this.db.insert(llmSessions).values({ id: sessionId, engine: "claude-code", project_id: projectId, started_at: now(), fixture_path: modes.llm === "replay" ? LLM_FIXTURES : null }).run();
    }
    const job_id = this.runner.enqueue("llm", { sessionId, projectId, prompt: text, resume }, projectId);
    return { session_id: sessionId, job_id };
  }

  sessions(projectId: string) {
    return this.db.select().from(llmSessions).where(eq(llmSessions.project_id, projectId)).all();
  }

  events(sessionId: string) {
    return this.db.select().from(llmEvents).where(eq(llmEvents.session_id, sessionId)).all().map((e) => JSON.parse(e.payload_json));
  }
}
