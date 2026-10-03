/** Hono app: /api (studio), /events (SSE), /mcp (LLM tools), /files (renders & audio, sandboxed). */
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { etag } from "hono/etag";
import { streamSSE } from "hono/streaming";
import { PublishTargetSchema, TopicInputSchema, TopicPatchSchema } from "@statreel/schemas";
import { paths } from "./config";
import type { EventBus } from "./events";
import type { HeatmapService } from "./heatmap-service";
import type { JobRunner } from "./jobs";
import type { LlmService } from "./llm-service";
import { handleMcp } from "./mcp";
import type { Pipeline } from "./pipeline";
import type { ProjectService } from "./projects";
import type { Tools } from "./tools";
import { metricsOverview } from "./metrics";
import type { CalendarService } from "./calendar";
import { type BoardService, DECISIONS, type Decision } from "./board";
import { CASE_DECISIONS, type CaseDecision, type CaseIdeas, MIN_SPAN_YEARS, type StyleLibrary, type StyleOverride } from "./library";
import type { Db } from "./db";
import { TopicService } from "./topics";
import { type GenerationGuard, noGenerationJobs } from "./generation-guard";
import { GenerationFlow } from "./generation/flow";
import { defaultGate, type GenerationRouteDeps, registerGenerationRoutes } from "./generation/routes";

export type AppDeps = {
  db: Db; calendar: CalendarService; board: BoardService; styles: StyleLibrary; cases: CaseIdeas; bus: EventBus; runner: JobRunner; projects: ProjectService; heatmap: HeatmapService; llm: LlmService; tools: Tools; pipeline: Pipeline;
  /** generation queue API (ADR 010); optional so lighter test apps need not build it */
  generation?: GenerationRouteDeps;
  /** what Board undo asks about background generation (D.1); main.ts derives it from the queue, default = no jobs */
  generationGuard?: GenerationGuard;
  /** controlled topics + the videos ledger (ADR 011); built from `db` when omitted */
  topics?: TopicService;
};

const SERVABLE = [paths.renders, paths.audio, paths.board, path.join(paths.fixtures, "audio")].map((p) => path.resolve(p));
const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".png": "image/png", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".srt": "text/plain", ".vtt": "text/vtt", ".json": "application/json" };

export function buildApp(d: AppDeps) {
  const app = new Hono<{ Bindings: HttpBindings }>();

  // Reads revalidate instead of re-downloading: gzip, a strong ETag (a matching If-None-Match gets a
  // bodyless 304) and `no-cache`, so a screen always sees fresh data but unchanged JSON costs no bytes.
  // GET /api only: SSE (/events), /files (ranges, media) and /mcp are never compressed or buffered.
  app.use("/api/*", async (c, next) => {
    if (c.req.method !== "GET") {
      await next();
      return;
    }
    c.header("cache-control", "no-cache");
    await compress()(c, async () => {
      await etag()(c, next);
    });
  });

  app.get("/api/health", (c) => c.json({ ok: true, at: new Date().toISOString() }));

  // ---- heatmap, registry
  app.get("/api/heatmap", async (c) => c.json({ cells: await d.heatmap.current(), usecases: d.heatmap.usecases(), trend: d.heatmap.trend() }));
  const topics = d.topics ?? new TopicService(d.db);
  app.get("/api/heatmap/topics", (c) => c.json(topics.heatmap({ include_empty: c.req.query("include_empty") })));
  app.post("/api/heatmap/recompute", async (c) => c.json({ cells: await d.heatmap.recompute() }));
  app.get("/api/sources", async (c) => c.json({ sources: d.heatmap.sources(), capabilities: await d.heatmap.capabilities() }));

  // ---- projects
  app.get("/api/projects", (c) => c.json({ projects: d.projects.list().map((p) => ({ ...p, jobs: d.runner.list(p.id).slice(0, 5) })) }));
  app.post("/api/projects", async (c) => {
    try { return c.json(d.projects.create(await c.req.json()), 201); } catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 400); }
  });
  app.get("/api/projects/:id", (c) => {
    const id = c.req.param("id");
    const project = d.projects.get(id);
    if (!project) return c.json({ error: "not found" }, 404);
    return c.json({
      project,
      props: d.projects.latestProps(id) ?? null,
      props_history: d.projects.propsHistory(id).map(({ version, created_by, created_at }) => ({ version, created_by, created_at })),
      script: d.projects.latestScript(id) ?? null,
      jobs: d.runner.list(id),
      sessions: d.llm.sessions(id),
      renders: d.pipeline.renders(id),
      publications: d.pipeline.publications(id),
    });
  });
  app.post("/api/projects/:id/props", async (c) => c.json(await d.projects.setProps(c.req.param("id"), await c.req.json(), "user")));

  // ---- LLM co-pilot
  app.post("/api/projects/:id/llm", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { prompt?: string; session?: string };
    return c.json(d.llm.start(c.req.param("id"), body.prompt, body.session));
  });
  app.get("/api/llm/:session/events", (c) => c.json({ events: d.llm.events(c.req.param("session")) }));

  // ---- produce (audio -> render -> checks -> gate) and publish
  app.post("/api/projects/:id/produce", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { target?: unknown };
    return c.json(d.pipeline.produce(c.req.param("id"), PublishTargetSchema.parse(body.target ?? { platform: "youtube", monetized: true, ai_disclosure: true })));
  });
  app.post("/api/projects/:id/publish", async (c) => {
    const body = await c.req.json();
    return c.json(d.pipeline.publish(c.req.param("id"), body));
  });
  app.post("/api/projects/:id/policy-probe", async (c) => {
    const body = (await c.req.json()) as { target: unknown; with_source: { id: string; license_class: string; verdict: string } };
    return c.json(await d.pipeline.policyProbe(c.req.param("id"), PublishTargetSchema.parse(body.target), body.with_source));
  });
  app.post("/api/projects/:id/keyframes", async (c) => {
    const body = (await c.req.json()) as { frames_s: number[] };
    return c.json(await d.pipeline.renderKeyframes(c.req.param("id"), body.frames_s));
  });

  // ---- calendar (channels + scheduling of composed videos; ADR 006)
  const bad = (c: { json: (b: unknown, s: 400) => Response }, e: unknown) => c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  app.get("/api/calendar", (c) => {
    const titles = new Map(d.projects.list().map((p) => [p.id, p]));
    const slots = d.calendar.list({ from: c.req.query("from"), to: c.req.query("to") }).map((s) => ({ ...s, project: titles.get(s.project_id) ?? null }));
    return c.json({ channels: d.calendar.channels(), ready: d.calendar.ready(), slots, now: new Date().toISOString() });
  });
  app.post("/api/calendar", async (c) => {
    try {
      const slot = d.calendar.schedule(await c.req.json());
      d.calendar.tick(); // "publish now" = scheduled at or before now
      return c.json(d.calendar.get(slot.id), 201);
    } catch (e) { return bad(c, e); }
  });
  app.patch("/api/calendar/:id", async (c) => {
    try { return c.json(d.calendar.reschedule(c.req.param("id"), ((await c.req.json()) as { publish_at: string }).publish_at)); } catch (e) { return bad(c, e); }
  });
  app.delete("/api/calendar/:id", (c) => {
    try { return c.json(d.calendar.cancel(c.req.param("id"))); } catch (e) { return bad(c, e); }
  });

  // board and case decisions go through the generation flow when the queue is wired (D.2)
  const flow = d.generation ? new GenerationFlow({ db: d.db, board: d.board, cases: d.cases, queue: d.generation.queue, gate: (r) => (d.generation?.gate ?? defaultGate)({ type: "generate_video", ...r }) }) : undefined;

  // ---- board (design outputs + use-case backlog behind the owner's gate; ADR 006)
  const withUrls = <T extends { image: string; video: string | null }>(i: T) => ({ ...i, image_url: `/files/board/${i.image}`, video_url: i.video ? `/files/board/${i.video}` : null });
  app.get("/api/board", (c) => c.json({ items: d.board.list({ status: c.req.query("status") }).map(withUrls), decisions: DECISIONS }));
  app.get("/api/board/feedback", (c) => c.json({ items: d.board.feedback(c.req.query("since")) }));
  app.get("/api/board/:id", (c) => {
    const i = d.board.get(c.req.param("id"));
    return i ? c.json(withUrls(i)) : c.json({ error: "not found" }, 404);
  });
  app.post("/api/board", async (c) => {
    try { return c.json(d.board.create(await c.req.json()), 201); } catch (e) { return bad(c, e); }
  });
  app.post("/api/board/archive", async (c) => {
    try {
      const b = (await c.req.json()) as { ids: string[]; reason: string };
      if (!b.reason?.trim()) throw new Error("archiving needs a reason");
      return c.json({ archived: d.board.archive(b.ids ?? [], b.reason.trim()) });
    } catch (e) { return bad(c, e); }
  });
  app.post("/api/board/:id/decision", async (c) => {
    try {
      const b = (await c.req.json()) as { decision: Decision; note?: string };
      const res = flow ? flow.decideItem(c.req.param("id"), b.decision, b.note) : { item: d.board.decide(c.req.param("id"), b.decision, b.note) };
      d.bus.emit({ type: "board.decided", id: res.item.id, decision: res.item.decision });
      return c.json({ ...res, item: withUrls(res.item) });
    } catch (e) { return bad(c, e); }
  });

  app.delete("/api/board/:id/decision", (c) => {
    const id = c.req.param("id");
    if (!d.board.get(id)) return c.json({ error: "not found" }, 404);
    const gen = d.generationGuard ?? noGenerationJobs;
    if (gen.hasRunning({ kind: "item", id })) return c.json({ error: "a generation job for this item is running; cancel it first" }, 409);
    try {
      gen.cancelQueued({ kind: "item", id });
      const { item, restored_ids } = d.board.undoDecision(id);
      d.bus.emit({ type: "board.decided", id: item.id, decision: null });
      return c.json({ ...item, restored_ids });
    } catch (e) { return bad(c, e); }
  });

  // ---- style library: verdicts from the gate + the owner's lock / retire / note / hero (ADR 008)
  app.get("/api/styles", (c) => c.json({ styles: d.styles.list(d.board.list({ status: "all" })) }));
  app.patch("/api/styles/:id", async (c) => {
    try {
      const b = (await c.req.json()) as { status?: StyleOverride | null; note?: string | null; hero_item_id?: string | null };
      const s = d.styles.update(c.req.param("id"), d.board.list({ status: "all" }), b);
      d.bus.emit({ type: "styles.updated", id: s.id, status: s.status });
      return c.json(s);
    } catch (e) { return bad(c, e); }
  });

  // ---- case ideas: use cases proposed as text by the case loop, behind the owner's gate (ADR 008)
  app.get("/api/cases", (c) => c.json({ ideas: d.cases.list({ status: c.req.query("status") }), decisions: CASE_DECISIONS, min_span_years: MIN_SPAN_YEARS }));
  app.get("/api/cases/feedback", (c) => c.json({ ideas: d.cases.feedback(c.req.query("since")) }));
  app.post("/api/cases", async (c) => {
    try { return c.json(d.cases.create(await c.req.json()), 201); } catch (e) { return bad(c, e); }
  });
  app.post("/api/cases/archive", async (c) => {
    try {
      const b = (await c.req.json()) as { ids: string[]; reason: string };
      if (!b.reason?.trim()) throw new Error("archiving needs a reason");
      return c.json({ archived: d.cases.archive(b.ids ?? [], b.reason.trim()) });
    } catch (e) { return bad(c, e); }
  });
  app.post("/api/cases/:id/decision", async (c) => {
    try {
      const b = (await c.req.json()) as { decision: CaseDecision; note?: string };
      const res = flow ? flow.decideCase(c.req.param("id"), b.decision, b.note) : { idea: d.cases.decide(c.req.param("id"), b.decision, b.note) };
      d.bus.emit({ type: "cases.decided", id: res.idea.id, decision: res.idea.decision });
      return c.json(res);
    } catch (e) { return bad(c, e); }
  });

  app.delete("/api/cases/:id/decision", (c) => {
    const id = c.req.param("id");
    if (!d.cases.get(id)) return c.json({ error: "not found" }, 404);
    const gen = d.generationGuard ?? noGenerationJobs;
    if (gen.hasRunning({ kind: "case", id })) return c.json({ error: "a generation job for this case is running; cancel it first" }, 409);
    try {
      gen.cancelQueued({ kind: "case", id });
      const idea = d.cases.undo(id);
      d.bus.emit({ type: "cases.decided", id: idea.id, decision: null });
      return c.json(idea);
    } catch (e) { return bad(c, e); }
  });

  app.patch("/api/cases/:id", async (c) => {
    const id = c.req.param("id");
    if (!d.cases.get(id)) return c.json({ error: "not found" }, 404);
    try {
      const b = (await c.req.json()) as { topic?: string | null };
      if (b.topic === undefined) throw new Error("nothing to update: send {topic: <key>|null}");
      return c.json(d.cases.setTopic(id, b.topic));
    } catch (e) { return bad(c, e); }
  });

  // ---- topics: the controlled list (ADR 011)
  app.get("/api/topics", (c) => c.json({ topics: topics.list({ all: c.req.query("all") === "1" }) }));
  app.post("/api/topics", async (c) => {
    try { return c.json({ topic: topics.create(TopicInputSchema.parse(await c.req.json())) }, 201); } catch (e) { return bad(c, e); }
  });
  app.patch("/api/topics/:key", async (c) => {
    try { return c.json({ topic: topics.patch(c.req.param("key"), TopicPatchSchema.parse(await c.req.json())) }); } catch (e) { return bad(c, e); }
  });

  // ---- metrics (cross-channel)
  app.get("/api/metrics", (c) => c.json(metricsOverview(d.db)));
  app.post("/api/metrics/refresh", (c) => c.json(d.pipeline.refreshMetrics()));

  // ---- jobs
  app.get("/api/jobs", (c) => c.json({ jobs: d.runner.list().slice(0, 50) }));
  app.post("/api/jobs/:id/cancel", (c) => {
    d.runner.cancel(c.req.param("id"));
    return c.json({ ok: true });
  });

  // ---- generation queue (ADR 010): enqueue/cancel/retry/log/config/worker + worker callbacks
  if (d.generation) registerGenerationRoutes(app, d.generation);

  // ---- files (only under renders/audio)
  app.get("/files/*", (c) => {
    const rel = decodeURIComponent(c.req.path.replace(/^\/files\//, ""));
    const abs = path.resolve(paths.data, rel);
    if (!SERVABLE.some((root) => abs.startsWith(root + path.sep)) || !existsSync(abs)) return c.json({ error: "not found" }, 404);
    const size = statSync(abs).size;
    const type = TYPES[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
    const range = c.req.header("range");
    if (range) {
      const [s, e] = range.replace("bytes=", "").split("-");
      const start = Number(s);
      const end = e ? Number(e) : size - 1;
      return new Response(Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream, {
        status: 206, headers: { "content-type": type, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "content-length": String(end - start + 1) },
      });
    }
    return new Response(Readable.toWeb(createReadStream(abs)) as ReadableStream, { headers: { "content-type": type, "content-length": String(size), "accept-ranges": "bytes" } });
  });

  // ---- SSE
  app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const off = d.bus.subscribe((e) => void stream.writeSSE({ event: e.type, data: JSON.stringify(e) }));
      const ping = setInterval(() => void stream.writeSSE({ event: "ping", data: "{}" }), 15_000);
      await new Promise<void>((resolve) => stream.onAbort(() => resolve()));
      clearInterval(ping);
      off();
    }),
  );

  // ---- MCP (streamable HTTP, stateless)
  app.all("/mcp", async (c) => {
    const body = c.req.method === "POST" ? await c.req.json().catch(() => undefined) : undefined;
    await handleMcp(d.tools, c.env.incoming, c.env.outgoing, body, d.generation?.mcp);
    return new Response(null, { headers: { "x-hono-already-sent": "1" } });
  });

  return app;
}
