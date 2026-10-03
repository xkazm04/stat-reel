/** Entry point: `pnpm dev` (tsx watch) and `pnpm start` both run this file, which always serves. */
import { serve } from "@hono/node-server";
import { modes, server } from "./config";
import { guard } from "./http-guard";
import { createServer } from "./main";

const s = await createServer();
serve({ fetch: guard(s.app.fetch, { port: server.port }), hostname: server.host, port: server.port }, (info) => {
  console.log(`statreel server http://${info.address}:${info.port}  llm=${modes.llm} audio=${modes.audio} publish=${modes.publish}`);
});
