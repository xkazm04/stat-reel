import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { LlmEngine, LlmEvent, RunOptions, RunResult } from "@statreel/llm";
import { llmEvents, llmSessions, openDb } from "./db";
import { EventBus } from "./events";
import { JobRunner } from "./jobs";
import { LlmService } from "./llm-service";
import type { ProjectService } from "./projects";
import type { Tools } from "./tools";

const project = { id: "p1", title: "T", sport: "F1", use_case_id: "era-adjusted-rankings", format: "vertical", mode: "monetized" };
const result = (o: Partial<Extract<LlmEvent, { type: "result" }>> = {}): LlmEvent => ({ type: "result", ok: true, result: "done", session_id: "ext-1", ...o });

type Script = (o: RunOptions) => Promise<LlmEvent[]>;
const DEFAULT_LIMITS = { maxTurns: 40, maxBudgetUsd: 3, timeoutMs: 60_000 };
function setup(script: Script, limits = DEFAULT_LIMITS, projects: Record<string, typeof project> = { p1: project }) {
  const db = openDb(":memory:");
  const bus = new EventBus();
  const runner = new JobRunner(db, bus);
  const runs: RunOptions[] = [];
  const engine: LlmEngine = {
    name: "claude-code",
    async run(o): Promise<RunResult> {
      runs.push(o);
      const events = await script(o);
      for (const e of events) o.onEvent(e);
      const r = events.findLast((e) => e.type === "result") as Extract<LlmEvent, { type: "result" }> | undefined;
      return { ok: !!r?.ok, session_id: r?.session_id ?? "", result: r?.result ?? "", events };
    },
  };
  const svc = new LlmService(db, bus, runner, { get: (id: string) => projects[id] } as unknown as ProjectService, {} as Tools, () => engine, limits);
  return { db, runner, svc, runs };
}
const sessionRow = (db: ReturnType<typeof openDb>, id: string) => {
  const row = db.select().from(llmSessions).where(eq(llmSessions.id, id)).get();
  if (!row) throw new Error(`no session ${id}`);
  return row;
};
const happy: Script = async () => [{ type: "session", session_id: "ext-1" }, { type: "text", text: "hi" }, result()];
const untilAborted: Script = (o) => new Promise((_, rej) => o.signal?.addEventListener("abort", () => rej(new Error("aborted"))));

describe("LlmService session lifecycle", () => {
  it("passes the budget cap to the engine and stamps ended_at on success", async () => {
    const { db, runner, svc, runs } = setup(happy);
    const { session_id, job_id } = svc.start("p1");
    await runner.idle();
    expect(runner.get(job_id)?.status).toBe("succeeded");
    expect(runs[0]?.maxBudgetUsd).toBe(3);
    expect(sessionRow(db, session_id)).toMatchObject({ external_session_id: "ext-1" });
    expect(sessionRow(db, session_id).ended_at).not.toBeNull();
  });

  it("sets ended_at even when the engine rejects (spawn error)", async () => {
    const { db, runner, svc } = setup(async () => {
      throw new Error("spawn claude ENOENT");
    });
    const { session_id, job_id } = svc.start("p1");
    await runner.idle();
    expect(runner.get(job_id)).toMatchObject({ status: "failed", error: "spawn claude ENOENT" });
    expect(sessionRow(db, session_id).ended_at).not.toBeNull();
  });

  it("maps the CLI max-turns and max-budget subtypes to actionable messages", async () => {
    for (const [subtype, re] of [["error_max_turns", /stopped at 31 turns .*continue the session/], ["error_max_budget_usd", /\$3 budget cap .*continue the session/]] as const) {
      const { runner, svc } = setup(async () => [{ type: "session", session_id: "ext-1" }, result({ ok: false, subtype, turns: 31, result: "" })]);
      const { job_id } = svc.start("p1");
      await runner.idle();
      expect(runner.get(job_id)?.status).toBe("failed");
      expect(runner.get(job_id)?.error).toMatch(re);
    }
  });

  it("enforces the turn cap itself (the CLI has no max-turns flag) by aborting the run", async () => {
    const { runner, svc } = setup(async (o) => {
      for (let i = 0; i < 10; i++) {
        o.onEvent({ type: "tool_call", id: `t${i}`, tool: "query", input: {} });
        if (o.signal?.aborted) throw new Error("aborted");
      }
      return [];
    }, { ...DEFAULT_LIMITS, maxTurns: 3 });
    const { job_id } = svc.start("p1");
    await runner.idle();
    expect(runner.get(job_id)?.status).toBe("failed");
    expect(runner.get(job_id)?.error).toMatch(/stopped at 3 turns .*continue the session/);
  });

  it("enforces the wall-clock cap through the abort signal", async () => {
    const { db, runner, svc } = setup(untilAborted, { ...DEFAULT_LIMITS, timeoutMs: 20 });
    const { session_id, job_id } = svc.start("p1");
    await runner.idle();
    expect(runner.get(job_id)?.error).toMatch(/wall-clock .*continue the session/);
    expect(sessionRow(db, session_id).ended_at).not.toBeNull();
  });

  it("an owner cancel stays a cancel, not a limit message", async () => {
    const { runner, svc } = setup(untilAborted);
    const { job_id } = svc.start("p1");
    await new Promise((r) => setTimeout(r, 5));
    runner.cancel(job_id);
    await runner.idle();
    expect(runner.get(job_id)?.status).toBe("cancelled");
  });

  it("refuses a follow-up whose session never got a CLI session id", async () => {
    const { runner, svc } = setup(async () => {
      throw new Error("died before init");
    });
    const { session_id } = svc.start("p1");
    await runner.idle();
    expect(() => svc.start("p1", "more", session_id)).toThrow(/no CLI session to resume/);
  });

  it("refuses a follow-up for an unknown session or another project's session", async () => {
    const other = { ...project, id: "p2" };
    const { runner, svc } = setup(happy, DEFAULT_LIMITS, { p1: project, p2: other });
    const { session_id } = svc.start("p1");
    await runner.idle();
    expect(() => svc.start("p2", "more", session_id)).toThrow(/belongs to another project/);
    expect(() => svc.start("p1", "more", "nope")).toThrow(/unknown co-pilot session/);
    expect(() => svc.start("p1", "more", session_id)).not.toThrow();
  });

  it("a follow-up resumes the CLI session and appends events after the first transcript", async () => {
    const { db, runner, svc, runs } = setup(happy);
    const { session_id } = svc.start("p1");
    await runner.idle();
    svc.start("p1", "more", session_id);
    await runner.idle();
    expect(runs[1]?.resume).toBe("ext-1");
    const seqs = db.select().from(llmEvents).where(eq(llmEvents.session_id, session_id)).all().map((e) => e.seq);
    expect(seqs).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("does not replay a transcript a crash cut off: marks the re-queued job interrupted", async () => {
    const { db, runner, svc, runs } = setup(happy);
    const { session_id } = svc.start("p1");
    await runner.idle();
    // simulate a crash mid-run: events exist, ended_at never written
    db.update(llmSessions).set({ ended_at: null }).where(eq(llmSessions.id, session_id)).run();
    const job_id = runner.enqueue("llm", { sessionId: session_id, projectId: "p1", prompt: "x" }, "p1");
    await runner.idle();
    expect(runner.get(job_id)?.status).toBe("failed");
    expect(runner.get(job_id)?.error).toMatch(/Interrupted by a server restart/);
    expect(runs).toHaveLength(1); // the engine was not run again
    expect(db.select().from(llmEvents).where(eq(llmEvents.session_id, session_id)).all()).toHaveLength(4); // 3 + the note
    expect(sessionRow(db, session_id).ended_at).not.toBeNull();
  });

  it("fails clearly, before spawning, when the use case has no system prompt", async () => {
    const { runner, svc, runs } = setup(happy, DEFAULT_LIMITS, { p1: { ...project, use_case_id: "no-such-case" } });
    const { job_id } = svc.start("p1");
    await runner.idle();
    expect(runner.get(job_id)?.error).toMatch(/no co-pilot system prompt for use case "no-such-case"/);
    expect(runs).toHaveLength(0);
  });
});
