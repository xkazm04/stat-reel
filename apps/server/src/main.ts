/** StatReel server: http://127.0.0.1:8787 (api, events, mcp, files; serves the built studio in `pnpm start`). */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Context } from "hono";
import { compress } from "hono/compress";
import { buildApp } from "./app";
import { BoardService } from "./board";
import { CalendarService } from "./calendar";
import { modes, paths, repoRoot, server } from "./config";
import { openDb } from "./db";
import { EventBus } from "./events";
import { GenerationConfigSchema } from "@statreel/schemas";
import { AssetFetcher, ownerContact } from "./generation/assets";
import { generationDataRoot, loadGenerationConfig } from "./generation/config";
import { makeGate } from "./generation/gate";
import { GenerationFinalizer } from "./generation/finalize";
import { makeGenRenderHandler } from "./generation/gen-render";
import { makeGenerationMcpTools } from "./generation/mcp-tools";
import { GenerationQueue } from "./generation/queue";
import { queueGuard } from "./generation-guard";
import { GenerationEventsRelay } from "./generation/relay";
import { HeatmapService } from "./heatmap-service";
import { JobRunner } from "./jobs";
import { CaseIdeas, StyleLibrary } from "./library";
import { LlmService } from "./llm-service";
import { IMPLEMENTED_COMPOSITIONS, Pipeline } from "./pipeline";
import { ProjectService } from "./projects";
import { makeTools } from "./tools";
import { Warehouse } from "./warehouse";

export async function createServer() {
  mkdirSync(paths.data, { recursive: true });
  if (!existsSync(paths.warehouse)) throw new Error(`no warehouse at ${paths.warehouse}; run \`just ingest f1db && just transform\``);
  const db = openDb(paths.appDb);
  const bus = new EventBus();
  const wh = await Warehouse.open(paths.warehouse);
  const runner = new JobRunner(db, bus);
  const projects = new ProjectService(db, wh);
  const heatmap = new HeatmapService(db, wh, IMPLEMENTED_COMPOSITIONS);
  const pipeline = new Pipeline({ db, bus, runner, projects, wh });
  const tools = makeTools({ wh, projects, heatmap, pipeline });
  const llm = new LlmService(db, bus, runner, projects, tools);
  const calendar = new CalendarService(db, bus, (params, projectId) => runner.enqueue("publish", params, projectId), modes.publish);
  const board = new BoardService(db, paths.board);
  const styles = new StyleLibrary(db);
  const cases = new CaseIdeas(db);
  mkdirSync(path.join(paths.board, "items"), { recursive: true });
  runner.resume();
  // generation (ADR 010): the server only owns the queue API and relays worker events; `pnpm worker` runs the jobs
  const queue = new GenerationQueue(db);
  const genData = generationDataRoot();
  const assets = new AssetFetcher({ config: (() => { try { return loadGenerationConfig().config.web.download; } catch { return GenerationConfigSchema.parse({}).web.download; } })(), dataRoot: genData, getJob: (id) => queue.get(id), contact: ownerContact(paths.statreelLocal) });
  const relay = new GenerationEventsRelay(db, bus);
  relay.start();
  // renders requested by the worker share the render lane (one render at a time)
  runner.register("gen_render", makeGenRenderHandler({ dataRoot: genData }), { lane: "render" });
  const finalizer = new GenerationFinalizer({ db, board, dataRoot: genData, boardRoot: paths.board, bus, facts: (refs) => wh.facts(refs) });
  const scheduler = setInterval(() => calendar.tick(), 30_000);
  scheduler.unref();
  const app = buildApp({ generationGuard: queueGuard(queue), db, calendar, board, styles, cases, bus, runner, projects, heatmap, llm, tools, pipeline, generation: { db, queue, bus, runner, dataRoot: genData, finalizer, gate: makeGate(db), mcp: makeGenerationMcpTools({ queue, assets, dataRoot: genData }) } });
  const dist = path.join(repoRoot, "apps", "studio", "dist");
  if (existsSync(dist)) {
    const root = path.relative(process.cwd(), dist);
    // Built assets are content-hashed (vite emits /assets/<name>-<hash>.<ext>): cache them for a year.
    // Everything else (index.html, the SPA fallback, favicons) revalidates so a new build lands at once.
    const cacheHeaders = (file: string, c: Context) => {
      c.header("cache-control", /[\\/]assets[\\/]/.test(file) ? "public, max-age=31536000, immutable" : "no-cache");
    };
    // Text assets travel gzipped; the SPA is served only from here, never /api, /events, /files or /mcp.
    app.use("/*", async (c, next) => {
      const p = c.req.path;
      if (/^\/(api|events|files|mcp)(\/|$)/.test(p)) return next();
      return compress()(c, next);
    });
    app.use("/*", serveStatic({ root, onFound: cacheHeaders }));
    app.get(
      "*",
      serveStatic({ path: path.relative(process.cwd(), path.join(dist, "index.html")), onFound: cacheHeaders }),
    );
  }
  return { app, db, wh, runner, heatmap, projects, llm, pipeline, bus, calendar, board, styles, cases, queue, relay };
}
