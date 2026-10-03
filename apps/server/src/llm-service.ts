/** LLM sessions: one at a time (job kind "llm"), events persisted and streamed, resumable. */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { ClaudeEngine, draftPrompt, type LlmEngine, type LlmEvent, type LlmLimits, llmLimitsFromEnv, ReplayEngine, type StopReason, stopMessage, stopReasonFromSubtype } from "@statreel/llm";
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

      // The CLI has no max-turns flag (verified), so the turn and wall-clock caps abort the run here.
      const limit = new AbortController();
      let stopped: StopReason | undefined;
      let turns = 0;
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
            if (e.type === "tool_call" && ++turns >= this.limits.maxTurns) stop("max_turns");
          },
        });
        this.db.update(llmSessions).set({ external_session_id: res.session_id || undefined }).where(eq(llmSessions.id, sessionId)).run();
        const last = res.events.at(-1);
        if (last?.type === "result" && last.refusal) throw new Refusal(engine.name, last.result.slice(0, 200));
        const reason = stopped ?? (last?.type === "result" ? stopReasonFromSubtype(last.subtype) : undefined);
        if (reason) throw new Error(stopMessage(reason, this.limits, last?.type === "result" ? last.turns : undefined));
        if (!res.ok) throw new Error(`LLM session ended without success: ${res.result.slice(0, 300)}`);
        return { session_id: res.session_id, result: res.result, cost_usd: res.cost_usd };
      } catch (err) {
        // our own cap aborted the run: report that, not the AbortError the engine surfaced
        if (stopped && !ctx.signal.aborted) throw new Error(stopMessage(stopped, this.limits, turns));
        throw err;
      } finally {
        clearTimeout(timer);
        this.db.update(llmSessions).set({ ended_at: now() }).where(eq(llmSessions.id, sessionId)).run();
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
      if (!prev.external_session_id) throw new Error(`co-pilot session ${sessionId} has no CLI session to resume (the run ended before it started) - start a new session instead`);
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
