/**
 * Generation worker process (ADR 010): `pnpm worker` (tsx, no watch, so server restarts never touch it).
 * Separate from the Hono server and the co-pilot. One instance at a time (lease); a second one exits.
 * Needs the server only for health, renders and finalize callbacks; the queue lives in app.sqlite.
 */
import path from "node:path";
import { openDb, type Db } from "../db";
import { paths, server } from "../config";
import { killTreeIfNamed } from "../proc";
import { httpCallbacks, serverHealthy } from "./callbacks";
import { generationDataRoot, loadGenerationConfig } from "./config";
import type { GenerationEngine } from "./engine";
import { fakeEngine } from "./fake";
import { GenerationQueue } from "./queue";
import { makeRenderStep } from "./render-steps";
import { dataRaceValidator } from "./validate-data-race";
import { GenerationWorker } from "./worker";
import { createLiveEngine } from "./claude";

const log = (m: string) => console.log(`[gen-worker ${new Date().toISOString()}] ${m}`);

/** Two processes opening a brand-new DB can race on `alter table`; the loser retries. */
async function openDbRetry(file: string): Promise<Db> {
  for (let i = 1; ; i++) {
    try {
      return openDb(file);
    } catch (e) {
      if (i >= 5) throw e;
      log(`db open failed (${e instanceof Error ? e.message : e}); retrying`);
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
}

async function main() {
  const { config } = loadGenerationConfig();
  if (config.worker === "off" || !config.enabled) {
    log("generation worker is off (STATREEL_GEN_WORKER=off / enabled=false): idling, no jobs are claimed");
    setInterval(() => {}, 1 << 30);
    return;
  }
  const dataRoot = generationDataRoot();
  const db = await openDbRetry(paths.appDb);
  const queue = new GenerationQueue(db, { maxAttempts: config.maxAttempts });
  const base = `http://${server.host}:${server.port}`;
  const engine: GenerationEngine = config.mode === "fake" ? fakeEngine() : createLiveEngine({ config, dataRoot, apiBase: base });
  // a stale row's recorded pid is killed only when it is still the CLI we spawned (pids are reused)
  const expectedImage = path.parse(config.cli.bin ?? process.env.CLAUDE_BIN ?? "claude").name;
  const callbacks = httpCallbacks(base);
  const worker = new GenerationWorker({
    db, queue, config, engine, dataRoot,
    callbacks,
    validator: dataRaceValidator,
    renderStep: makeRenderStep(callbacks),
    health: () => serverHealthy(base),
    kill: (job) => (job.pid ? killTreeIfNamed(job.pid, expectedImage) : Promise.resolve(false)),
    stage: engine.stage?.bind(engine),
    onLeaseLost: () => process.exit(1),
    log,
  });
  const started = await worker.start();
  if (!started.ok) {
    log(`generation worker already running (pid ${started.pid}); exiting`);
    process.exit(0);
  }
  log(`generation worker ready pid=${process.pid} mode=${config.mode} model=${config.model} api=${base} recovered: requeued=${started.requeued.length} failed=${started.failed.length}`);
  // close is a controlled crash: abort the job (kills the CLI tree), re-queue it without burning an attempt,
  // release the lease; a hard timer guarantees the process exits even if something hangs
  let leaving = false;
  const bye = () => {
    if (leaving) return;
    leaving = true;
    setTimeout(() => process.exit(1), 6000).unref();
    worker.shutdown(4000).then((r) => {
      log(`shutdown: ${r.requeued ? `job ${r.requeued} re-queued` : "no running job"}${r.timedOut ? " (timed out)" : ""}`);
      process.exit(0);
    }, () => process.exit(1));
  };
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);
  await worker.loop();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
