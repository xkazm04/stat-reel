/** Entry point: `pnpm dev` (tsx watch) and `pnpm start` both run this file, which always serves. */
import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { modes, server } from "./config";
import { closeDb } from "./db";
import { guard } from "./http-guard";
import { createServer } from "./main";
import { installProcessHandlers, makeShutdown } from "./shutdown";

const s = await createServer();
const http = serve({ fetch: guard(s.app.fetch, { port: server.port }), hostname: server.host, port: server.port }, (info) => {
  console.log(`statreel server http://${info.address}:${info.port}  llm=${modes.llm} audio=${modes.audio} publish=${modes.publish}`);
}) as Server;

const shutdown = makeShutdown({
  stoppers: [() => s.relay.stop()],
  closeServer: () => new Promise<void>((resolve) => {
    http.close(() => resolve());
    http.closeIdleConnections();
    // SSE (/events) streams never go idle: drop them once jobs have been told to stop
    setTimeout(() => http.closeAllConnections(), 1500).unref();
  }),
  stopJobs: () => s.runner.shutdown(),
  closeDb: () => closeDb(s.db),
});
installProcessHandlers(shutdown);
