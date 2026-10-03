/**
 * The render part of a job's finalize phase, run by the worker process (SPEC D.4): ask the server for
 * `gen_render` jobs through the callbacks and wait for each to end; the server renders on the shared
 * render lane, so "one render at a time" holds. What it returns is handed to `finalize`, which only
 * copies files and writes rows.
 *
 *   visual_options  one still per variant at 45 % of the video (mid-race, never the finale)
 *   generate_video  the full video, plus a 45 % still for the thumbnail
 */
import { DATA_RACE_FPS, type GenerationJob } from "@statreel/schemas";
import type { ServerCallbacks } from "./callbacks";
import { GenerationError } from "./engine";
import type { JobPaths } from "./paths";
import { readPlan } from "./validate-data-race";

export const STILL_AT = 0.45;
/** The frame of the board still / thumbnail: round(0.45 x total frames). */
export const stillFrame = (totalFrames: number): number => Math.round(STILL_AT * totalFrames);

export type RenderStepContext = {
  job: GenerationJob;
  paths: JobPaths;
  signal: AbortSignal;
  note: (progressNote: string) => void;
  log: (line: string) => void;
};
export type RenderStep = (ctx: RenderStepContext) => Promise<Record<string, unknown>>;

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "refused"]);

export async function waitForRender(cb: ServerCallbacks, renderJobId: string, signal: AbortSignal, pollMs = 1000): Promise<Record<string, unknown>> {
  for (;;) {
    if (signal.aborted) {
      await cb.cancelRender?.(renderJobId).catch(() => {});
      throw new GenerationError("cancelled", "aborted while rendering");
    }
    const s = await cb.renderStatus(renderJobId);
    if (TERMINAL.has(s.status)) {
      if (s.status !== "succeeded") throw new GenerationError("render", `render ${s.status}: ${(s.error ?? "").slice(0, 300)}`);
      return (s.result ?? {}) as Record<string, unknown>;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export function makeRenderStep(cb: ServerCallbacks, o: { pollMs?: number } = {}): RenderStep {
  const render = async (ctx: RenderStepContext, req: { kind: "stills" | "video"; props_path: string; frames?: number[] }) => {
    const { render_job_id } = await cb.render(ctx.job.id, req);
    ctx.log(`render ${req.kind} ${req.props_path} -> ${render_job_id}`);
    return waitForRender(cb, render_job_id, ctx.signal, o.pollMs);
  };
  return async (ctx) => {
    const plan = readPlan(ctx.paths);
    const frame = stillFrame(plan.sections.total);
    if (ctx.job.type === "visual_options") {
      const stills: Record<string, string> = {};
      for (const n of [1, 2, 3]) {
        ctx.note(`rendering the still of variant ${n} of 3`);
        const r = await render(ctx, { kind: "stills", props_path: `out/variants/v${n}.props.json`, frames: [frame] });
        const file = (r.stills as string[] | undefined)?.[0];
        if (!file) throw new GenerationError("render", `render of variant ${n} returned no still`);
        stills[String(n)] = file;
      }
      return { renders: { stills, frame, total_frames: plan.sections.total, fps: DATA_RACE_FPS } };
    }
    ctx.note("rendering the video");
    const v = await render(ctx, { kind: "video", props_path: "out/props.json" });
    if (!v.output) throw new GenerationError("render", "the video render returned no file");
    ctx.note("rendering the thumbnail");
    const t = await render(ctx, { kind: "stills", props_path: "out/props.json", frames: [frame] });
    const thumb = (t.stills as string[] | undefined)?.[0];
    if (!thumb) throw new GenerationError("render", "the thumbnail render returned no still");
    return {
      renders: { video: String(v.output), thumb, frame, total_frames: plan.sections.total, fps: DATA_RACE_FPS, width: v.width ?? null, height: v.height ?? null },
    };
  };
}
