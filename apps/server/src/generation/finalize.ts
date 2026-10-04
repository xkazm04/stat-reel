/**
 * Finalize of a running generation job (SPEC D.7, D.10): all domain writes stay in the server. The worker
 * has validated the outputs and requested the renders; this re-validates (the same function), copies the
 * rendered files into their homes and writes the rows. Idempotent: a finalize retried after a crash
 * creates no duplicates.
 *
 *   visual_options  3 stills -> data/board/items/gen/<case_id>/<job_id>-v{n}.png, 3 board items
 */
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { renderTimingMd } from "@statreel/compositions/timing";
import { DATA_RACE_DURATION_S, DATA_RACE_FPS, type GenerationJob, planSha256 } from "@statreel/schemas";
import type { BoardService } from "../board";
import { paths as appPaths } from "../config";
import type { Db } from "../db";
import type { EventBus } from "../events";
import { resolveTopic, TopicService } from "../topics";
import { type FactResolver, verifyRealFacts } from "./facts";
import { jobPaths, type JobPaths } from "./paths";
import { dataProvenanceOf, readPlan, styleNameOf, validateDataRaceOutputs } from "./validate-data-race";

const execFileP = promisify(execFile);

export class FinalizeError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
    this.name = "FinalizeError";
  }
}

/** The job's total spend: the worker's summed result, else the row's own ledger columns; null when never reported. */
function jobSpend(job: GenerationJob, body: FinalizeBody): { cost_usd: number | null; turns: number | null } {
  const row = job as GenerationJob & { cost_usd?: number | null; turns?: number | null };
  const r = body.result;
  return {
    cost_usd: typeof r?.cost_usd === "number" ? r.cost_usd : (row.cost_usd ?? null),
    turns: typeof r?.turns === "number" ? r.turns : (row.turns ?? null),
  };
}

export type FinalizeBody = { outputs: string[]; result?: Record<string, unknown> };
export type FinalizerDeps = { db: Db; board: BoardService; dataRoot: string; boardRoot: string; bus?: EventBus; fontsManifest?: string;
  /** `wh.facts`: resolves fact refs against the warehouse. Without it a "real" video is refused (fail closed). */
  facts?: FactResolver };

/** A render result path must be a file inside the job's own folder (the body comes over HTTP). */
export function insideJob(p: JobPaths, file: unknown, what: string): string {
  if (typeof file !== "string" || !file) throw new FinalizeError(`${what}: no file given`);
  const abs = path.resolve(file);
  if (!abs.startsWith(p.dir + path.sep)) throw new FinalizeError(`${what} is outside the job folder`);
  if (!existsSync(abs)) throw new FinalizeError(`${what} does not exist`);
  return abs;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const isPng = (f: string) => readFileSync(f).subarray(0, 4).equals(PNG);

export class GenerationFinalizer {
  constructor(protected readonly d: FinalizerDeps) {}

  async finalize(job: GenerationJob, body: FinalizeBody): Promise<Record<string, unknown>> {
    const p = jobPaths(job.id, this.d.dataRoot);
    const v = validateDataRaceOutputs(job.type, p);
    if (!v.ok) throw new FinalizeError(`validation failed: ${v.errors.slice(0, 5).join("; ")}`);
    if (job.type === "generate_video") await this.verifyFacts(p);
    this.promoteLogos(p);
    if (job.type === "visual_options") return this.visualOptions(job, p, body);
    return this.video(job, p, body);
  }

  /**
   * The data gate (DESIGN data gate): a video with data_provenance "real" is accepted only when every fact ref
   * resolves in the warehouse and every shown figure matches its fact. No resolver = no verification = refused.
   */
  private async verifyFacts(p: JobPaths): Promise<void> {
    const props = JSON.parse(readFileSync(path.join(p.out, "props.json"), "utf8")) as unknown;
    if (dataProvenanceOf(props) !== "real") return; // the validator already refused anything else for a video
    if (!this.d.facts) throw new FinalizeError("fact verification unavailable: no fact resolver (warehouse) is configured, so a video with real data cannot be verified and is refused", 503);
    let problems: string[];
    try {
      problems = await verifyRealFacts(props, this.d.facts);
    } catch (e) {
      throw new FinalizeError(`fact verification unavailable: the warehouse could not resolve facts (${e instanceof Error ? e.message : String(e)})`, 503);
    }
    if (problems.length) throw new FinalizeError(`fact verification failed: ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? `; and ${problems.length - 5} more` : ""}`);
  }

  /**
   * Logos fetched and verified against the Commons API join the shared library (data/assets/logos/ + LEDGER.json,
   * deduped by sha256) so later jobs reuse them. Model-declared rows are not promoted: they wait for owner review.
   */
  private promoteLogos(p: JobPaths): void {
    const ledgerFile = path.join(p.dir, "fetched-assets.json");
    if (!existsSync(ledgerFile)) return;
    let rows: { file: string; sha256: string; verified_by: string }[] = [];
    try { rows = JSON.parse(readFileSync(ledgerFile, "utf8")); } catch { return; }
    const lib = path.join(this.d.dataRoot, "assets", "logos");
    const libFile = path.join(lib, "LEDGER.json");
    let merged: { sha256: string }[] = [];
    try { merged = JSON.parse(readFileSync(libFile, "utf8")); } catch { /* first logo */ }
    let changed = false;
    for (const r of rows) {
      if (r.verified_by !== "commons-api" || merged.some((m) => m.sha256 === r.sha256)) continue;
      const src = path.resolve(p.work, r.file);
      if (!src.startsWith(p.work + path.sep) || !existsSync(src)) continue;
      mkdirSync(lib, { recursive: true });
      copyFileSync(src, path.join(lib, path.basename(src)));
      merged.push({ ...r, library_file: `data/assets/logos/${path.basename(src)}` } as never);
      changed = true;
    }
    if (changed) writeFileSync(libFile, `${JSON.stringify(merged, null, 2)}
`);
  }

  /** generate_video: the full render + thumbnail -> data/renders/gen/<case>/<job>/, ffprobe checks, manifest, the videos row. */
  private async video(job: GenerationJob, p: JobPaths, body: FinalizeBody): Promise<Record<string, unknown>> {
    const c = this.d.db.$client;
    const have = c.prepare("select id from videos where generation_job_id = ?").get(job.id) as { id: string } | undefined;
    if (have) return { video_id: have.id, existing: true };
    const idea = c.prepare("select title, topic, domain, sources_json, data_status from case_ideas where id = ?").get(job.case_id) as
      { title: string; topic: string | null; domain: string; sources_json: string; data_status: string } | undefined;
    if (!idea) throw new FinalizeError(`case ${job.case_id} no longer exists`, 404);
    const renders = (body.result?.renders ?? {}) as { video?: string; thumb?: string };
    const rawVideo = insideJob(p, renders.video, "the rendered video");
    const rawThumb = insideJob(p, renders.thumb, "the thumbnail");
    if (!isPng(rawThumb)) throw new FinalizeError("the thumbnail is not a PNG");

    const dir = path.join(this.d.dataRoot, "renders", "gen", job.case_id, job.id);
    mkdirSync(dir, { recursive: true });
    const video = path.join(dir, "video.mp4");
    await execFileP("ffmpeg", ["-hide_banner", "-y", "-i", rawVideo, "-c", "copy", "-movflags", "+faststart", video]);
    const probe = JSON.parse((await execFileP("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", video])).stdout) as {
      streams: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string }[];
      format: { duration: string };
    };
    const v = probe.streams.find((s) => s.codec_type === "video");
    const a = probe.streams.find((s) => s.codec_type === "audio");
    if (!v) throw new FinalizeError("the render has no video stream");
    const [num, den] = String(v.r_frame_rate).split("/").map(Number);
    const plan = readPlan(p);
    const checks = {
      width: v.width ?? 0,
      height: v.height ?? 0,
      fps: (num ?? 0) / (den || 1),
      duration_s: Math.round(Number(probe.format.duration) * 100) / 100,
      video_codec: v.codec_name,
      audio_codec: a?.codec_name ?? "none",
      plan_frames: plan.sections.total,
      plan_duration_s: plan.sections.total / DATA_RACE_FPS,
    };
    const problems: string[] = [];
    if (checks.width !== 1080 || checks.height !== 1920) problems.push(`resolution ${checks.width}x${checks.height}, expected 1080x1920`);
    if (Math.abs(checks.fps - DATA_RACE_FPS) > 0.01) problems.push(`${checks.fps} fps, expected ${DATA_RACE_FPS}`);
    if (checks.duration_s < DATA_RACE_DURATION_S.min || checks.duration_s > DATA_RACE_DURATION_S.max)
      problems.push(`duration ${checks.duration_s} s is outside ${DATA_RACE_DURATION_S.min}-${DATA_RACE_DURATION_S.max} s`);
    if (Math.abs(checks.duration_s - checks.plan_duration_s) > 0.6) problems.push(`duration ${checks.duration_s} s differs from the timing plan (${checks.plan_duration_s} s)`);
    if (checks.video_codec !== "h264") problems.push(`video codec ${checks.video_codec}, expected h264`);
    if (problems.length) throw new FinalizeError(`render checks failed: ${problems.join("; ")}`);

    copyFileSync(rawThumb, path.join(dir, "thumb.png"));
    copyFileSync(path.join(p.out, "props.json"), path.join(dir, "props.json"));
    copyFileSync(path.join(p.out, "timing-plan.json"), path.join(dir, "timing-plan.json"));
    writeFileSync(path.join(dir, "TIMING.md"), existsSync(path.join(p.out, "TIMING.md")) ? readFileSync(path.join(p.out, "TIMING.md"), "utf8") : renderTimingMd(plan, { title: idea.title }));

    const props = JSON.parse(readFileSync(path.join(p.out, "props.json"), "utf8")) as { timing_plan_sha256: string; entities: { logo: { kind: string; path?: string } }[] };
    const ledger = JSON.parse(readFileSync(path.join(p.out, "assets.json"), "utf8")) as { path?: string; file?: string }[];
    const usedLogos = new Set(props.entities.flatMap((e) => (e.logo.kind === "file" && e.logo.path ? [e.logo.path] : [])));
    let fonts: { family: string; license: string; sha256: string }[] = [];
    try {
      const m = JSON.parse(readFileSync(this.d.fontsManifest ?? path.join(appPaths.fonts, "fonts.manifest.json"), "utf8")) as { fonts: typeof fonts };
      fonts = m.fonts.map((f) => ({ family: f.family, license: f.license, sha256: f.sha256 }));
    } catch { /* the manifest is informational here */ }
    const params = JSON.parse(job.params_json || "{}") as { model?: string; engine?: string };
    const spend = jobSpend(job, body);
    const manifest = {
      schema: "statreel/generation-video@1",
      job_id: job.id,
      case_id: job.case_id,
      board_item_id: job.board_item_id,
      composition: "DataRace-vertical",
      model: params.model ?? null,
      engine: params.engine ?? null,
      /** the job's total CLI spend over all attempts; null = never reported (unmeasurable is not zero) */
      cost_usd: spend.cost_usd,
      turns: spend.turns,
      created_at: new Date().toISOString(),
      data: { data_provenance: dataProvenanceOf(props), data_status: idea.data_status, sources: JSON.parse(idea.sources_json || "[]") },
      props_sha256: planSha256(props),
      timing_plan_sha256: props.timing_plan_sha256,
      assets: ledger.filter((r) => usedLogos.has(String(r.path ?? r.file))),
      fonts,
      checks,
      note: "A generated video is a private draft. Publishing is a separate owner action through the Calendar and the OPA gate.",
    };
    writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    // the topic of the case (ADR 011): its own pick, else the unambiguous domain, else unassigned
    const topics = new TopicService(this.d.db);
    const t = resolveTopic({ caseTopic: idea.topic, caseDomain: idea.domain });
    const topic = topics.get(t.key)?.active ? t : { key: "unassigned", source: "unassigned" as const };
    const rel = path.relative(this.d.dataRoot, video).split(path.sep).join("/");
    const id = topics.recordVideo({
      topic_key: topic.key, topic_source: topic.source, case_id: job.case_id, generation_job_id: job.id, title: idea.title, format: "vertical",
      duration_s: checks.duration_s, path: rel,
    });
    if (spend.cost_usd !== null) c.prepare("update videos set cost_usd = ? where id = ?").run(spend.cost_usd, id);
    this.d.bus?.emit({ type: "heatmap.updated" });
    return { video_id: id, path: rel, checks, cost_usd: spend.cost_usd };
  }

  private visualOptions(job: GenerationJob, p: JobPaths, body: FinalizeBody): Record<string, unknown> {
    const idea = this.d.db.$client.prepare("select title, pitch from case_ideas where id = ?").get(job.case_id) as { title: string; pitch: string } | undefined;
    if (!idea) throw new FinalizeError(`case ${job.case_id} no longer exists`, 404);
    const stills = ((body.result?.renders as { stills?: Record<string, string> } | undefined)?.stills) ?? {};
    const params = JSON.parse(job.params_json || "{}") as { model?: string; engine?: string };
    const cost = jobSpend(job, body).cost_usd;
    const existing = new Map<number, string>();
    for (const i of this.d.board.list({ status: "all" })) {
      if (i.case_idea_id === job.case_id && i.source?.job_id === job.id) existing.set(Number(i.source.variant), i.id);
    }
    const ids: string[] = [];
    const tx = this.d.db.$client.transaction(() => {
      for (const n of [1, 2, 3]) {
        const have = existing.get(n);
        if (have) {
          ids.push(have);
          continue;
        }
        const still = insideJob(p, stills[String(n)], `the still of variant ${n}`);
        if (!isPng(still)) throw new FinalizeError(`the still of variant ${n} is not a PNG`);
        const rel = `items/gen/${job.case_id}/${job.id}-v${n}.png`;
        const dest = path.join(this.d.boardRoot, rel);
        mkdirSync(path.dirname(dest), { recursive: true });
        copyFileSync(still, dest);
        const props = JSON.parse(readFileSync(path.join(p.out, "variants", `v${n}.props.json`), "utf8"));
        const md = readFileSync(path.join(p.out, "variants", `v${n}.md`), "utf8");
        const item = this.d.board.create({
          image: rel, width: 1080, height: 1920, title: idea.title, summary: md.trim(),
          proposed_case: { name: idea.title, pitch: idea.pitch }, case_idea_id: job.case_id,
          style: { id: `gen-${job.id}-v${n}`, name: styleNameOf(md) },
          source: { skill: "generation", job_id: job.id, model: params.model ?? null, engine: params.engine ?? null, variant: n, data_provenance: dataProvenanceOf(props), cost_usd: cost },
        });
        ids.push(item.id);
      }
    });
    tx();
    return { board_item_ids: ids };
  }
}
