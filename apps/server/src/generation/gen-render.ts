/**
 * The `gen_render` job (SPEC D.4): renders DataRace props of a generation job on the shared render lane
 * (one render at a time, ADR 004). The worker process asks for it through `POST .../render`; the server
 * resolves the render props here: the timing plan whose sha256 the props name is embedded, and every logo
 * file is staged as a data URI, because the Remotion bundle cannot read the job folder.
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DATA_RACE_FPS, DataRacePropsSchema, resolveDataRaceRenderProps } from "@statreel/schemas";
import type { Handler } from "../jobs";
import { runRenderWorker } from "../pipeline";
import { insideWork, jobPaths } from "./paths";
import { readPlan, resolveLogoPath } from "./validate-data-race";

export const DATA_RACE_COMPOSITION = "DataRace-vertical";
export type GenRenderParams = { generation_job_id: string; kind: "stills" | "video"; props_path: string; frames?: number[] };

const MIME: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };

/** Render props for Remotion: the plan embedded and logos inlined. Throws with a readable message. */
export function resolveRenderProps(jobId: string, propsAbs: string, dataRoot: string): Record<string, unknown> {
  const jp = jobPaths(jobId, dataRoot);
  const parsed = DataRacePropsSchema.safeParse(JSON.parse(readFileSync(propsAbs, "utf8")));
  if (!parsed.success) throw new Error(`invalid DataRaceProps: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const props = resolveDataRaceRenderProps(parsed.data, readPlan(jp));
  const entities = props.entities.map((e) => {
    if (e.logo.kind !== "file") return e;
    const abs = resolveLogoPath(jp, e.logo.path);
    if (!abs) throw new Error(`logo of '${e.id}' is not under assets/ or data/assets/logos/: ${e.logo.path}`);
    const mime = MIME[path.extname(abs).toLowerCase()];
    if (!mime) throw new Error(`logo of '${e.id}' has an unsupported type: ${e.logo.path}`);
    return { ...e, logo: { ...e.logo, src: `data:${mime};base64,${readFileSync(abs).toString("base64")}` } };
  });
  return { ...props, entities };
}

export function makeGenRenderHandler(d: { dataRoot: string; render?: typeof runRenderWorker }): Handler {
  const render = d.render ?? runRenderWorker;
  return async (params, ctx) => {
    const p = params as GenRenderParams;
    const jp = jobPaths(p.generation_job_id, d.dataRoot);
    const propsAbs = insideWork(jp, path.relative(jp.work, p.props_path));
    const props = resolveRenderProps(p.generation_job_id, propsAbs, d.dataRoot);
    const dir = path.join(jp.dir, "render");
    mkdirSync(dir, { recursive: true });
    const label = path.basename(propsAbs).replace(/\.props\.json$|\.json$/, "");
    if (p.kind === "stills") {
      // `frames` are frame numbers; the render worker takes seconds
      const seconds = (p.frames ?? []).map((f) => f / DATA_RACE_FPS);
      if (!seconds.length) throw new Error("a stills render needs at least one frame");
      const res = await render({ mode: "stills", compositionId: DATA_RACE_COMPOSITION, props, frames: seconds, outDir: path.join(dir, `${label}-stills`) }, ctx);
      return { stills: res.stills as string[] };
    }
    const output = path.join(dir, `${label}.raw.mp4`);
    const res = await render({ mode: "video", compositionId: DATA_RACE_COMPOSITION, props, output }, ctx);
    return { output, durationInFrames: res.durationInFrames, fps: res.fps, width: res.width, height: res.height };
  };
}
