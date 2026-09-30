/** Hono app: /api (studio), /events (SSE), /mcp (LLM tools), /files (renders & audio, sandboxed). */
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { PublishTargetSchema } from "@statreel/schemas";
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
import type { Db } from "./db";

export type AppDeps = {
  db: Db; bus: EventBus; runner: JobRunner; projects: ProjectService; heatmap: HeatmapService; llm: LlmService; tools: Tools; pipeline: Pipeline;
};

const SERVABLE = [paths.renders, paths.audio, path.join(paths.fixtures, "audio")].map((p) => path.resolve(p));
const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".png": "image/png", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".srt": "text/plain", ".vtt": "text/vtt", ".json": "application/json" };

export function buildApp(d: AppDeps) {
  const app = new Hono<{ Bindings: HttpBindings }>();

  app.get("/api/health", (c) => c.json({ ok: true, at: new Date().toISOString() }));

  // ---- heatmap, registry
  app.get("/api/heatmap", async (c) => c.json({ cells: await d.heatmap.current(), usecases: d.heatmap.usecases(), trend: d.heatmap.trend() }));
  app.post("/api/heatmap/recompute", async (c) => c.json({ cells: await d.heatmap.recompute() }));
  app.get("/api/sources", async (c) => c.json({ sources: d.heatmap.sources(), capabilities: await d.heatmap.capabilities() }));

  // ---- projects
  app.get("/api/projects", (c) => c.json({ projects: d.projects.list().map((p) => ({ ...p, jobs: d.runner.list(p.id).slice(0, 5) })) }));
  app.post("/api/projects", async (c) => c.json(d.projects.create(await c.req.json()), 201));
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

  // ---- metrics (cross-channel)
  app.get("/api/metrics", (c) => c.json(metricsOverview(d.db)));
  app.post("/api/metrics/refresh", (c) => c.json(d.pipeline.refreshMetrics()));

  // ---- jobs
  app.get("/api/jobs", (c) => c.json({ jobs: d.runner.list().slice(0, 50) }));
  app.post("/api/jobs/:id/cancel", (c) => {
    d.runner.cancel(c.req.param("id"));
    return c.json({ ok: true });
  });

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
    await handleMcp(d.tools, c.env.incoming, c.env.outgoing, body);
    return new Response(null, { headers: { "x-hono-already-sent": "1" } });
  });

  return app;
}
