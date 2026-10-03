/**
 * `GEN_MODE=fake` executor (SPEC D.5): no CLI. Copies `e2e/fixtures/generation/<type>/{out,assets}/**`
 * into the job's work folder, after a short abortable pause so "Running" is observable. Used by
 * vitest and by `pnpm e2e`.
 */
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { paths as appPaths } from "../config";
import { GenerationError, type GenerationEngine } from "./engine";

export const FAKE_FIXTURES = path.join(appPaths.fixtures, "generation");

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

export function fakeEngine(o: { fixtures?: string; delayMs?: number } = {}): GenerationEngine {
  const fixtures = o.fixtures ?? FAKE_FIXTURES;
  return {
    name: "fake",
    async run(ctx) {
      const delay = o.delayMs ?? Number(process.env.GEN_FAKE_DELAY_MS ?? 800);
      const src = path.join(fixtures, ctx.job.type);
      if (!existsSync(src)) throw new GenerationError("validation", `no fake fixture for ${ctx.job.type} at ${src}`);
      ctx.note({ phase: "run", progress_note: "fake mode: fixture outputs", last_tool: "fixture" });
      ctx.log(`fake engine: fixtures ${src}`);
      await sleep(delay, ctx.signal);
      if (ctx.signal.aborted) throw new GenerationError("cancelled", "aborted");
      for (const part of ["out", "assets"] as const) {
        const from = path.join(src, part);
        if (existsSync(from)) cpSync(from, part === "out" ? ctx.paths.out : ctx.paths.assets, { recursive: true });
      }
      ctx.log("fake engine: outputs copied");
      return { result: { engine: "fake", cost_usd: 0 } };
    },
  };
}
