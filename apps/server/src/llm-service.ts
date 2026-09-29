/** LLM sessions: one at a time (job kind "llm"), events persisted and streamed, resumable. */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { ClaudeEngine, type LlmEngine, type LlmEvent, ReplayEngine } from "@statreel/llm";
import { modes, paths, repoRoot, server } from "./config";
import { type Db, llmEvents, llmSessions, now } from "./db";
import type { EventBus } from "./events";
import { type JobRunner, Refusal } from "./jobs";
import type { ProjectService } from "./projects";
import { executor, type Tools } from "./tools";

const PROMPTS = path.join(repoRoot, "packages", "llm", "prompts");
export const LLM_FIXTURES = path.join(paths.fixtures, "llm");

export function writeMcpConfig(): string {
  mkdirSync(paths.statreelLocal, { recursive: true });
  const file = path.join(paths.statreelLocal, "mcp.json");
  writeFileSync(file, JSON.stringify({ mcpServers: { statreel: { type: "http", url: `http://${server.host}:${server.port}/mcp` } } }, null, 2));
  return file;
}

/** The standard first prompt for a project: deterministic text, so replay fixtures key on it. */
export function draftPrompt(p: { id: string; title: string; sport: string; use_case_id: string; format: string; mode: string }): string {
  return [
    `Project ${p.id}: "${p.title}".`,
    `Use case ${p.use_case_id}, sport ${p.sport}, format ${p.format}, mode ${p.mode}.`,
    "Draft the props and the script for this video now, following your workflow. Use project id",
    `"${p.id}" in set_props and write_script. Finish with one sentence naming the angle.`,
  ].join(" ");
}

export class LlmService {
  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
    private readonly runner: JobRunner,
    private readonly projects: ProjectService,
    private readonly tools: Tools,
  ) {
    runner.register("llm", async (params, ctx) => {
      const { sessionId, projectId, prompt, resume } = params as { sessionId: string; projectId: string; prompt: string; resume?: string };
      const engine = this.engine();
      const project = this.projects.get(projectId);
      const systemPromptFile = path.join(PROMPTS, `${project?.use_case_id ?? "era-adjusted-rankings"}.md`);
      const cwd = path.join(tmpdir(), "statreel-llm"); // neutral: no repo CLAUDE.md, no git status in context
      mkdirSync(cwd, { recursive: true });
      let seq = this.db.select().from(llmEvents).where(eq(llmEvents.session_id, sessionId)).all().length;
      const res = await engine.run({
        prompt, resume, systemPromptFile, mcpConfigPath: writeMcpConfig(), cwd, signal: ctx.signal, vars: { PROJECT: projectId },
        onEvent: (e: LlmEvent) => {
          this.db.insert(llmEvents).values({ session_id: sessionId, seq: seq++, type: e.type, payload_json: JSON.stringify(e), at: now() }).run();
          if (e.type === "session") this.db.update(llmSessions).set({ external_session_id: e.session_id }).where(eq(llmSessions.id, sessionId)).run();
          this.bus.emit({ type: "llm.event", session_id: sessionId, project_id: projectId, event: e });
        },
      });
      this.db.update(llmSessions).set({ ended_at: now(), external_session_id: res.session_id || undefined }).where(eq(llmSessions.id, sessionId)).run();
      const last = res.events.at(-1);
      if (last?.type === "result" && last.refusal) throw new Refusal(engine.name, last.result.slice(0, 200));
      if (!res.ok) throw new Error(`LLM session ended without success: ${res.result.slice(0, 300)}`);
      return { session_id: res.session_id, result: res.result, cost_usd: res.cost_usd };
    });
  }

  engine(): LlmEngine {
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
      resume = this.db.select().from(llmSessions).where(eq(llmSessions.id, sessionId)).get()?.external_session_id ?? undefined;
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
