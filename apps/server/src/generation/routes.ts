/**
 * `/api/generation/*` (SPEC D.9). Kept out of app.ts: `buildApp` makes one call to
 * `registerGenerationRoutes`. The server only writes the queue (enqueue / cancel / retry) and serves
 * reads and worker callbacks; it never runs a job.
 */
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import type { HttpBindings } from "@hono/node-server";
import type { Hono } from "hono";
import { z } from "zod";
import { caseStage, EnqueueGenerationSchema, type GenerationJob, type GenerationJobType } from "@statreel/schemas";
import type { Db } from "../db";
import type { EventBus } from "../events";
import type { JobRunner } from "../jobs";
import type { GenerationMcpTools } from "./mcp-tools";
import { loadGenerationConfig, type LoadedGenerationConfig, generationDataRoot } from "./config";
import { insideWork, jobPaths } from "./paths";
import { type GenerationQueue, QueueConflict } from "./queue";
import { leaseStatus } from "./lease";
import { FinalizeError, type GenerationFinalizer } from "./finalize";

export type GateVerdict = { ok: true } | { ok: false; reason: string };
export type GenerationRouteDeps = {
  db: Db;
  queue: GenerationQueue;
  bus: EventBus;
  runner: JobRunner;
  dataRoot?: string;
  /** MCP tools for generation sessions (fetch_asset etc.) */
  mcp?: GenerationMcpTools;
  config?: () => LoadedGenerationConfig;
  /** creates the board items / the videos row at finalize (T10/T11); absent = record only */
  finalizer?: GenerationFinalizer;
  /** data gate (D.6, T11). Until it exists, `generate_video` is refused: the ethics layer fails closed. */
  gate?: (req: { type: GenerationJobType; case_id: string; board_item_id?: string }) => GateVerdict;
};

export const defaultGate: NonNullable<GenerationRouteDeps["gate"]> = (req) =>
  req.type === "visual_options" ? { ok: true } : { ok: false, reason: "the data gate for generate_video is not implemented yet (T11); no video job is created" };

const RenderBody = z.object({ kind: z.enum(["stills", "video"]), props_path: z.string().min(1), frames: z.array(z.number().int().nonnegative()).max(12).optional() });
const FinalizeBody = z.object({ outputs: z.array(z.string()).max(500), result: z.record(z.unknown()).optional() });

const tail = (file: string, n: number): string[] => {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  return lines.slice(-n);
};

export function registerGenerationRoutes(app: Hono<{ Bindings: HttpBindings }>, d: GenerationRouteDeps): void {
  const root = d.dataRoot ?? generationDataRoot();
  const cfg = d.config ?? (() => loadGenerationConfig());
  const gate_ = d.gate ?? defaultGate;
  const gate = gate_;
  const c = () => d.db.$client;

  const stageFor = (caseId: string) => {
    const idea = c().prepare("select status from case_ideas where id = ?").get(caseId) as { status: string } | undefined;
    if (!idea) return null;
    const items = c().prepare("select id, status, case_idea_id from board_items where case_idea_id = ?").all(caseId) as { id: string; status: string; case_idea_id: string }[];
    const jobs = c().prepare("select id, type, status, created_at from generation_jobs where case_id = ?").all(caseId) as { id: string; type: string; status: string; created_at: string }[];
    let videos = 0;
    try { videos = (c().prepare("select count(*) n from videos where case_id = ?").get(caseId) as { n: number }).n; } catch { /* videos table arrives with the topic heatmap */ }
    // the data gate only matters while an accepted visual waits for its video
    const accepted = items.find((i) => i.status === "accepted");
    const waiting = accepted && !videos && !jobs.some((j) => j.type === "generate_video" && j.status !== "failed" && j.status !== "cancelled");
    const gate = waiting && accepted ? gate_({ type: "generate_video", case_id: caseId, board_item_id: accepted.id }) : undefined;
    return { stage: caseStage(idea, items, jobs, { videos, gateOk: gate ? gate.ok : undefined }), gate, items, jobs, videos, accepted_item_id: accepted?.id ?? null };
  };
  const stageOf = (job: GenerationJob) => stageFor(job.case_id)?.stage ?? null;

  app.get("/api/generation/jobs", (c2) =>
    c2.json({ jobs: d.queue.list({ status: c2.req.query("status"), case_id: c2.req.query("case_id"), limit: Number(c2.req.query("limit") ?? 50) || 50 }) }),
  );

  app.get("/api/generation/jobs/:id", (c2) => {
    const job = d.queue.get(c2.req.param("id"));
    if (!job) return c2.json({ error: "not found" }, 404);
    return c2.json({ job, stage: stageOf(job), log_tail: tail(jobPaths(job.id, root).runLog, 200), events: d.queue.events(job.id) });
  });

  app.get("/api/generation/jobs/:id/log", (c2) => {
    const job = d.queue.get(c2.req.param("id"));
    if (!job) return c2.json({ error: "not found" }, 404);
    const file = jobPaths(job.id, root).runLog;
    const offset = Math.max(0, Number(c2.req.query("offset") ?? 0) || 0);
    let body = "";
    let next = 0;
    if (existsSync(file)) {
      const fd = openSync(file, "r");
      try {
        const size = fstatSync(fd).size;
        const start = Math.min(offset, size);
        const buf = Buffer.alloc(Math.min(size - start, 1_000_000));
        readSync(fd, buf, 0, buf.length, start);
        body = buf.toString("utf8");
        next = start + buf.length;
      } finally {
        closeSync(fd);
      }
    }
    return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "x-next-offset": String(next), "cache-control": "no-cache" } });
  });

  app.post("/api/generation/jobs", async (c2) => {
    const parsed = EnqueueGenerationSchema.safeParse(await c2.req.json().catch(() => null));
    if (!parsed.success) return c2.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, 400);
    const req = parsed.data;
    if (!c().prepare("select 1 x from case_ideas where id = ?").get(req.case_id)) return c2.json({ error: `unknown case ${req.case_id}` }, 404);
    if (req.board_item_id && !c().prepare("select 1 x from board_items where id = ?").get(req.board_item_id)) return c2.json({ error: `unknown board item ${req.board_item_id}` }, 404);
    const g = gate(req);
    if (!g.ok) return c2.json({ gate: g, error: g.reason }, 409);
    try {
      const r = d.queue.enqueue(req);
      return c2.json(r.existing ? { job: r.job, existing: true } : { job: r.job }, r.existing ? 200 : 201);
    } catch (e) {
      if (e instanceof QueueConflict) return c2.json({ error: e.message, job: e.job }, 409);
      throw e;
    }
  });

  app.post("/api/generation/jobs/:id/retry", (c2) => {
    const id = c2.req.param("id");
    if (!d.queue.get(id)) return c2.json({ error: "not found" }, 404);
    try {
      return c2.json({ job: d.queue.retry(id) });
    } catch (e) {
      if (e instanceof QueueConflict) return c2.json({ error: e.message, job: e.job }, 409);
      throw e;
    }
  });

  app.post("/api/generation/jobs/:id/cancel", (c2) => {
    const job = d.queue.cancel(c2.req.param("id"));
    return job ? c2.json({ job }) : c2.json({ error: "not found" }, 404);
  });

  app.get("/api/generation/config", (c2) => {
    const { config, sources } = cfg();
    return c2.json({ config, sources });
  });

  /** One call for every badge: the worker, the active and recent jobs, and the derived stage of each accepted case (D.2). */
  app.get("/api/generation/overview", (c2) => {
    const jobs = d.queue.list({ limit: 150 });
    const ideas = c().prepare("select id, title from case_ideas where status = 'accepted'").all() as { id: string; title: string }[];
    const cases: Record<string, unknown> = {};
    for (const i of ideas) {
      const st = stageFor(i.id);
      if (!st) continue;
      const latest = (type: string) => st.jobs.filter((j) => j.type === type).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.id ?? null;
      cases[i.id] = { title: i.title, stage: st.stage, gate: st.gate ?? null, visual_job_id: latest("visual_options"), video_job_id: latest("generate_video"), accepted_item_id: st.accepted_item_id, videos: st.videos };
    }
    const run = jobs.find((j) => j.status === "running");
    const title = (id: string) => (c().prepare("select title from case_ideas where id = ?").get(id) as { title: string } | undefined)?.title ?? id;
    return c2.json({ worker: { ...leaseStatus(d.db), ...d.queue.counts() }, jobs, cases, running: run ? { job: run, title: title(run.case_id) } : null });
  });

  app.get("/api/generation/worker", (c2) => c2.json({ ...leaseStatus(d.db), ...d.queue.counts() }));

  // ---- worker callbacks: only a running job may call them
  const running = (id: string): GenerationJob | Response => {
    const job = d.queue.get(id);
    if (!job) return Response.json({ error: "not found" }, { status: 404 });
    if (job.status !== "running") return Response.json({ error: `job is ${job.status}, not running` }, { status: 409 });
    return job;
  };

  app.post("/api/generation/jobs/:id/render", async (c2) => {
    const job = running(c2.req.param("id"));
    if (job instanceof Response) return job;
    const body = RenderBody.safeParse(await c2.req.json().catch(() => null));
    if (!body.success) return c2.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
    let props: string;
    try { props = insideWork(jobPaths(job.id, root), body.data.props_path); } catch (e) { return c2.json({ error: (e as Error).message }, 400); }
    const render_job_id = d.runner.enqueue("gen_render", { generation_job_id: job.id, kind: body.data.kind, props_path: props, frames: body.data.frames ?? [] });
    return c2.json({ render_job_id });
  });

  // the worker polls ONE render job by id: /api/jobs is the newest 50 of every kind, a page and not a lookup
  app.get("/api/generation/renders/:renderId", (c2) => {
    const r = d.runner.get(c2.req.param("renderId"));
    if (r?.kind !== "gen_render") return c2.json({ error: "not found" }, 404);
    return c2.json({ status: r.status, error: r.error, result: r.result_json ? JSON.parse(r.result_json) : undefined });
  });

  // T7 stub: records what the worker validated. T10/T11 create the board items / the videos row here.
  app.post("/api/generation/jobs/:id/finalize", async (c2) => {
    const job = running(c2.req.param("id"));
    if (job instanceof Response) return job;
    const body = FinalizeBody.safeParse(await c2.req.json().catch(() => null));
    if (!body.success) return c2.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
    if (!d.finalizer) return c2.json({ recorded: body.data.outputs.length, stub: true });
    try {
      return c2.json(await d.finalizer.finalize(job, body.data));
    } catch (e) {
      if (e instanceof FinalizeError) return c2.json({ error: e.message }, e.status as 422);
      throw e;
    }
  });
}
