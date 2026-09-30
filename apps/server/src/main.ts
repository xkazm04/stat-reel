/** StatReel server: http://127.0.0.1:8787 (api, events, mcp, files; serves the built studio in `pnpm start`). */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { buildApp } from "./app";
import { modes, paths, repoRoot, server } from "./config";
import { openDb } from "./db";
import { EventBus } from "./events";
import { HeatmapService } from "./heatmap-service";
import { JobRunner } from "./jobs";
import { LlmService } from "./llm-service";
import { IMPLEMENTED_COMPOSITIONS, Pipeline } from "./pipeline";
import { ProjectService } from "./projects";
import { makeTools } from "./tools";
import { CalendarService } from "./calendar";
import { BoardService } from "./board";
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
  mkdirSync(path.join(paths.board, "items"), { recursive: true });
  runner.resume();
  const scheduler = setInterval(() => calendar.tick(), 30_000);
  scheduler.unref();
  const app = buildApp({ db, calendar, board, bus, runner, projects, heatmap, llm, tools, pipeline });
  const dist = path.join(repoRoot, "apps", "studio", "dist");
  if (existsSync(dist)) {
    app.use("/*", serveStatic({ root: path.relative(process.cwd(), dist) }));
    app.get("*", serveStatic({ path: path.relative(process.cwd(), path.join(dist, "index.html")) }));
  }
  return { app, db, wh, runner, heatmap, projects, llm, pipeline, bus, calendar, board };
}
