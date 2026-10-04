/**
 * Produce pipeline (DESIGN §6.3-6.8, ADR 003): audio -> render -> master -> checks -> manifest -> gate,
 * then publish (private only). Every stage is a job in the single-slot runner.
 *
 * audio:  per-scene TTS (spoken text) -> measured timeline (voice leads picture) -> words -> cues ->
 *         music cues planned on the measured timeline at exact lengths -> mix plan -> props.timing
 * render: x64 worker (ADR 004) -> loudness mastering (-14 LUFS, <= -2 dBTP) -> ffprobe/blackdetect ->
 *         SRT/VTT, thumbnail -> provenance manifest -> OPA gate
 */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { desc, eq } from "drizzle-orm";
import { Entry } from "@napi-rs/keyring";
import {
  AudioCache, Budget, ElevenLabsClient, generateMusic, generateTts, jobStatusFor, measureLoudness, mixPlan, normalizeTo,
  planMusicCues, planTierFromSubscription,
} from "@statreel/audio";
import { buildCues, captionSafeZoneViolations, maxCps, toSrt, toVtt, wordsFromAlignment } from "@statreel/captions";
import { emptyMetricsRow, evaluatePolicy, normalizeYouTubeStatistics, YouTubeClient } from "@statreel/publish";
import {
  type AudioAsset, type EraAdjustedProps, type PlanTier, type ProvenanceManifest, type PublishTarget,
  sceneSpokenText, type Timeline, type WordTiming,
} from "@statreel/schemas";
import { modes, paths, renderNode, repoRoot, server } from "./config";
import { assets, type Db, metricsDaily, now, publications, renders, schedule } from "./db";
import { TopicService } from "./topics";
import type { EventBus } from "./events";
import { type JobContext, type JobRunner, Refusal } from "./jobs";
import type { ProjectService } from "./projects";
import type { PipelineApi } from "./tools";
import { createSourceHasher, findReusableRender, gcBundles, propsSha256, type SourceHasher } from "./bundle-support";
import { referencedAudioFiles, manifestBuildInfo } from "./manifest-support";
import { captionsBurnedIn, type FontsReport, fontsUsedByRender, loadedFontFamilies, parseFontsReport, renderTimeoutMs, runWorker, staleCutoffMs, sweepJobFiles, sweepPartialRuns } from "./render-support";
import type { Warehouse } from "./warehouse";

const execFileP = promisify(execFile);
const COMPOSITIONS_DIR = path.join(repoRoot, "packages", "compositions");
const ENTRY = path.join(COMPOSITIONS_DIR, "src", "entry.ts");
const WORKER = path.join(repoRoot, "apps", "server", "src", "render-worker.mjs");

/** Compositions that exist in code (the heatmap's "implemented" input). */
export const IMPLEMENTED_COMPOSITIONS = new Set(existsSync(ENTRY) ? ["EraAdjustedSlope"] : []);

export const AUDIO_DEFAULTS = {
  voiceId: process.env.STATREEL_VOICE_ID ?? "onwK4e9ZLuTAKqWW03F9", // ElevenLabs premade "Daniel - Steady Broadcaster"
  ttsModel: "eleven_multilingual_v2",
  sceneGapS: 0.35,
  voiceLeadS: 0.5,
  tailS: 1.2,
  musicPrompt:
    "Instrumental modern sports-analytics documentary bed, minimal electronic pulse, warm synth pads, restrained percussion, confident and curious, no vocals, clean mix leaving room for narration",
};
/** Remotion bundles kept on disk besides the current one (newest first). */
const BUNDLES_KEPT = 2;
const FIXTURES_AUDIO = path.join(paths.fixtures, "audio");
const secret = (key: string): string => {
  const v = new Entry("statreel", key).getPassword();
  if (!v) throw new Error(`no '${key}' secret in the OS keychain (service 'statreel'); run \`just secrets-set ${key}\``);
  return v;
};
const fileUrl = (abs: string) => `http://${server.host}:${server.port}/files/${path.relative(paths.data, abs).split(path.sep).join("/")}`;
const sha256File = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");

/** Publish job params; `scheduleId` is set by the calendar tick and pins the render the slot was scheduled with (ADR 006). */
type PublishJobParams = { projectId: string; title?: string; description?: string; tags?: string[]; scheduleId?: string };
/** Per-render upload session record, beside the render so a crashed upload resumes instead of starting a second video. */
const UPLOAD_SESSION_FILE = "upload-session.json";

export class Pipeline implements PipelineApi {
  private readonly db: Db;
  private readonly bus: EventBus;
  private readonly runner: JobRunner;
  private readonly projects: ProjectService;
  private readonly wh: Warehouse;
  /** bundle key, hashed once and re-read only when a source file's mtime/size changes */
  private readonly hasher = createSourceHasher(repoRoot);

  constructor(d: { db: Db; bus: EventBus; runner: JobRunner; projects: ProjectService; wh: Warehouse }) {
    ({ db: this.db, bus: this.bus, runner: this.runner, projects: this.projects, wh: this.wh } = d);
    this.runner.register("audio", async (p, ctx) => {
      try {
        return await this.audioJob(p as { projectId: string; target?: PublishTarget; chain?: boolean }, ctx);
      } catch (e) {
        // AudioRefused / BudgetExceeded are labelled refusals, not failures (ADR 003)
        if (jobStatusFor(e) === "refused") throw new Refusal("audio", e instanceof Error ? e.message : String(e));
        throw e;
      }
    });
    this.runner.register("render", (p, ctx) => this.renderJob(p as { projectId: string; target: PublishTarget }, ctx));
    this.runner.register("publish", (p, ctx) => this.publishJob(p as PublishJobParams, ctx));
    this.runner.register("metrics", (_p, ctx) => this.metricsJob(ctx));
    // a crash or kill leaves partial run dirs and worker job files; other server processes share these dirs,
    // so only leftovers older than the render timeout (+ margin) are removed
    this.runner.onStartup(() => {
      const cutoff = staleCutoffMs();
      sweepPartialRuns(paths.renders, cutoff);
      sweepJobFiles(path.join(paths.data, "cache", "jobs"), cutoff);
    });
  }

  // ------------------------------------------------------------------ public API

  produce(projectId: string, target: PublishTarget): { job_id: string } {
    return { job_id: this.runner.enqueue("audio", { projectId, target, chain: true }, projectId) };
  }

  async generateAudio(projectId: string): Promise<{ job_id: string }> {
    return { job_id: this.runner.enqueue("audio", { projectId, chain: false }, projectId) };
  }

  publish(projectId: string, body: { title?: string; description?: string; tags?: string[] }): { job_id: string } {
    return { job_id: this.runner.enqueue("publish", { projectId, ...body }, projectId) };
  }

  renders(projectId: string) {
    return this.db.select().from(renders).where(eq(renders.project_id, projectId)).orderBy(desc(renders.created_at)).all()
      .map((r) => ({ ...r, url: fileUrl(r.path), dir_url: fileUrl(path.dirname(r.path)) }));
  }

  publications(projectId: string) {
    const ids = new Set(this.renders(projectId).map((r) => r.id));
    return this.db.select().from(publications).all().filter((p) => ids.has(p.render_id));
  }

  async renderReport(projectId: string) {
    const r = this.renders(projectId)[0];
    if (!r) return { error: "no render yet" };
    return { render_id: r.id, checks: JSON.parse(r.checks_json), policy: r.policy_json ? JSON.parse(r.policy_json) : null, manifest: JSON.parse(readFileSync(r.manifest_path, "utf8")) };
  }

  async policyCheck(projectId: string, target: PublishTarget) {
    const r = this.renders(projectId)[0];
    if (!r) return { allow: false, deny: ["no render yet: produce the video first"], warn: [], checks_run: [] };
    return evaluatePolicy(JSON.parse(readFileSync(r.manifest_path, "utf8")), target, this.opaOpts());
  }

  /** Negative e2e: the latest manifest plus one extra source (e.g. a non-commercial one). */
  async policyProbe(projectId: string, target: PublishTarget, extra: { id: string; license_class: string; verdict: string }) {
    const r = this.renders(projectId)[0];
    if (!r) throw new Error("no render yet");
    const m = JSON.parse(readFileSync(r.manifest_path, "utf8")) as ProvenanceManifest;
    m.data.sources.push({ id: extra.id, snapshot: "probe", license: "probe", license_class: extra.license_class, verdict: extra.verdict, attribution: null });
    return evaluatePolicy(m, target, this.opaOpts());
  }

  async renderKeyframes(projectId: string, frames_s: number[]): Promise<{ stills: string[] }> {
    const props = this.projects.latestProps(projectId)?.props;
    if (!props) return { stills: [] };
    const outDir = path.join(paths.renders, projectId, `stills-${Date.now()}`);
    const res = await this.worker({ mode: "stills", compositionId: compositionId(props), props, frames: frames_s, outDir }, undefined);
    return { stills: (res.stills as string[]).map(fileUrl) };
  }

  // ------------------------------------------------------------------ audio

  private async audioJob(p: { projectId: string; target?: PublishTarget; chain?: boolean }, ctx: JobContext) {
    // a cancelled audio job must stop spending provider credits and must never chain into a render
    const stop = () => ctx.signal.throwIfAborted();
    stop();
    const project = this.projects.get(p.projectId);
    const propsRow = this.projects.latestProps(p.projectId);
    const scriptRow = this.projects.latestScript(p.projectId);
    if (!project || !propsRow || !scriptRow) throw new Error("props and script are required before audio (draft with the co-pilot first)");
    const props = propsRow.props;
    const script = scriptRow.script;
    const client = new ElevenLabsClient({ apiKey: async () => secret("elevenlabs"), signal: ctx.signal });
    const cache = new AudioCache({ dir: path.join(paths.audio, "cache"), mode: modes.audio, fixturesDir: FIXTURES_AUDIO });
    const budget = new Budget({ ttsSeconds: 75, musicSeconds: 75 });
    const planTier = await this.planTier(client);
    const deps = { client, cache, budget, planTier };
    const projectAudio = path.join(paths.audio, p.projectId);
    mkdirSync(projectAudio, { recursive: true });
    const keep = (src: string) => {
      const dst = path.join(projectAudio, path.basename(src));
      if (!existsSync(dst)) copyFileSync(src, dst);
      return dst;
    };

    // 1. voice per scene, in props scene order
    const kinds = new Map(props.scenes.map((s) => [s.id, s.kind]));
    const scenes = props.scenes.map((s) => {
      const sc = script.scenes.find((x) => x.scene_id === s.id);
      if (!sc) throw new Error(`script has no narration for scene ${s.id}`);
      return sc;
    });
    const voiced: { scene_id: string; voiceStart: number; duration: number; file: string; alignment: Parameters<typeof wordsFromAlignment>[1]; asset: Partial<AudioAsset> }[] = [];
    let cursor = 0;
    for (const [i, sc] of scenes.entries()) {
      stop();
      ctx.progress((i / scenes.length) * 0.6, `voice ${sc.scene_id}`);
      const g = await generateTts(deps, { voiceId: AUDIO_DEFAULTS.voiceId, text: sceneSpokenText(sc), modelId: AUDIO_DEFAULTS.ttsModel, sceneId: sc.scene_id });
      voiced.push({ scene_id: sc.scene_id, voiceStart: cursor, duration: g.durationS, file: keep(g.audioPath), alignment: g.alignment, asset: g.asset });
      cursor += g.durationS + AUDIO_DEFAULTS.sceneGapS;
    }
    stop();
    const duration = Math.round((voiced.at(-1)!.voiceStart + voiced.at(-1)!.duration + AUDIO_DEFAULTS.tailS) * 30) / 30;

    // 2. scene timeline in AUDIO time (voice starts). The composition cuts the picture voice_lead_s
    //    after each voice start (scene 0 at 0), so audio leads picture at every change (ADR 003).
    const lead = AUDIO_DEFAULTS.voiceLeadS;
    const timelineScenes = voiced.map((v, i) => ({
      scene_id: v.scene_id, start_s: v.voiceStart, end_s: voiced[i + 1]?.voiceStart ?? duration, voice_src: fileUrl(v.file),
    }));

    // 3. words and cues (align on spoken, show display)
    const words: WordTiming[] = voiced.flatMap((v, i) => wordsFromAlignment(scenes[i]!, v.alignment, v.voiceStart));
    const cues = buildCues(words, { format: props.format, fps: 30, endLimit_s: duration });

    // 4. music: planned on the measured timeline, exact lengths, off-length takes rejected
    ctx.progress(0.65, "music");
    const plan = planMusicCues(timelineScenes.map((s) => ({ scene_id: s.scene_id, kind: kinds.get(s.scene_id)!, start_s: s.start_s, end_s: s.end_s })));
    const musicAssets: Partial<AudioAsset>[] = [];
    for (const cue of plan.cues) {
      stop();
      const m = await generateMusic(deps, { prompt: AUDIO_DEFAULTS.musicPrompt, musicLengthMs: cue.lengthMs, forceInstrumental: true });
      cue.src = fileUrl(keep(m.audioPath));
      musicAssets.push(m.asset);
    }
    const mix = mixPlan({
      scenes: timelineScenes.map((s, i) => ({ scene_id: s.scene_id, start_s: s.start_s, end_s: s.end_s, voice_src: s.voice_src, voice_duration_s: voiced[i]!.duration })),
      cues: plan.cues,
      voiceLeadS: lead,
    });
    const timing: Timeline = { duration_s: duration, scenes: timelineScenes, words, cues, music: mix.timelineMusic, voice_lead_s: lead };

    // 5. record assets (plan tier per asset) and attach timing
    stop();
    for (const a of [...voiced.map((v) => v.asset), ...musicAssets]) {
      this.db.insert(assets).values({
        id: randomUUID(), project_id: p.projectId, kind: a.kind!, provider: "elevenlabs", request_id: a.request_id ?? null, model_id: a.model_id ?? null,
        voice_id: a.voice_id ?? null, plan_tier: planTier ?? null, prompt_sha256: a.prompt_sha256 ?? null, scene_id: a.scene_id ?? null,
        path: "", sha256: a.sha256!, generated_at: a.generated_at ?? now(),
      }).run();
    }
    this.projects.attachTiming(p.projectId, timing, propsRow.version);
    ctx.progress(1, "audio ready");
    if (p.chain && p.target && !ctx.signal.aborted) this.runner.enqueue("render", { projectId: p.projectId, target: p.target }, p.projectId);
    return { duration_s: duration, cues: cues.length, max_cps: maxCps(cues), music_cues: plan.cues.length, budget: budget.snapshot() };
  }

  private async planTier(client: ElevenLabsClient): Promise<PlanTier | undefined> {
    const file = path.join(FIXTURES_AUDIO, "plan-tier.json");
    if (modes.audio === "replay") return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")).plan_tier as PlanTier) : undefined;
    const tier = planTierFromSubscription((await client.subscription()).tier) as PlanTier;
    if (process.env.AUDIO_RECORD === "1") {
      mkdirSync(FIXTURES_AUDIO, { recursive: true });
      writeFileSync(file, JSON.stringify({ plan_tier: tier, recorded_at: now() }));
    }
    return tier;
  }

  // ------------------------------------------------------------------ render

  private async renderJob(p: { projectId: string; target: PublishTarget }, ctx: JobContext) {
    const project = this.projects.get(p.projectId)!;
    const propsRow = this.projects.latestProps(p.projectId);
    const props = propsRow?.props;
    if (!props?.timing) throw new Error("no timing: generate audio first");
    // same props + same source + same format as the latest render, files intact: reuse it (still gated below)
    const prev = this.renders(p.projectId)[0];
    const reusable = await findReusableRender(prev, { propsSha: propsSha256(props), sourceHash: await this.hasher.hash(), format: props.format });
    if (prev && reusable) return this.reuseRender(p, ctx, project, props.format, prev, reusable);
    const run = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(paths.renders, p.projectId, run);
    mkdirSync(dir, { recursive: true });
    // the run dir is created by this job, so until its row is committed everything in it is partial
    let committed = false;
    try {
      return await this.renderRun(p, ctx, { project, propsRow: propsRow!, props: props as EraAdjustedProps & { timing: Timeline }, dir }, () => (committed = true));
    } finally {
      if (!committed) rmSync(dir, { recursive: true, force: true });
    }
  }

  private async renderRun(p: { projectId: string; target: PublishTarget }, ctx: JobContext,
    r: { project: NonNullable<ReturnType<ProjectService["get"]>>; propsRow: NonNullable<ReturnType<ProjectService["latestProps"]>>; props: EraAdjustedProps & { timing: Timeline }; dir: string },
    commit: () => void) {
    const { project, propsRow, props, dir } = r;
    const signal = ctx.signal;
    const raw = path.join(dir, "raw.mp4");
    const video = path.join(dir, "video.mp4");

    const rendered = await this.worker({ mode: "video", compositionId: compositionId(props), props, output: raw }, ctx, 0.85);
    // DESIGN §6.3: the browser's font report is the evidence; without one the field is left out and the gate denies it
    const fonts = parseFontsReport(rendered.fontLogs);
    if (!fonts.measured) ctx.progress(0.86, "no font report from the render: font_fallbacks unmeasured");

    // master the audio to -14 LUFS / <= -2 dBTP, keep the video stream untouched
    signal.throwIfAborted();
    ctx.progress(0.87, "mastering");
    const mixWav = path.join(dir, "mix.wav");
    const masterWav = path.join(dir, "master.wav");
    await execFileP("ffmpeg", ["-hide_banner", "-y", "-i", raw, "-vn", "-ac", "2", "-ar", "48000", mixWav], { signal });
    await normalizeTo({ input: mixWav, output: masterWav, targetLufs: -14, truePeak: -2.3, signal });
    signal.throwIfAborted();
    await execFileP("ffmpeg", ["-hide_banner", "-y", "-i", raw, "-i", masterWav, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", video], { signal });

    signal.throwIfAborted();
    ctx.progress(0.92, "checks");
    const loud = await measureLoudness(video, { signal });
    const probe = JSON.parse((await execFileP("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", video], { signal })).stdout);
    const v = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
    const a = probe.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
    const [num, den] = String(v.r_frame_rate).split("/").map(Number);
    const black = await blackSeconds(video, signal);
    const cues = props.timing.cues;
    writeFileSync(path.join(dir, "captions.srt"), toSrt(cues));
    writeFileSync(path.join(dir, "captions.vtt"), toVtt(cues));
    const payoff = props.timing.scenes.find((s) => s.scene_id === props.scenes.find((x) => x.kind === "payoff")?.id) ?? props.timing.scenes[0]!;
    const still = await this.worker({ mode: "stills", compositionId: compositionId(props), props, frames: [(payoff.start_s + payoff.end_s) / 2], outDir: path.join(dir, "thumb") }, undefined, 1, signal);
    copyFileSync((still.stills as string[])[0]!, path.join(dir, "thumb.png"));

    const checks = {
      loudness_lufs: round(loud.integratedLufs, 2), true_peak_dbtp: round(loud.truePeakDbtp, 2), loudness_range_lu: round(loud.loudnessRangeLu, 2),
      safe_zone_violations: captionSafeZoneViolations(cues, props.format), ...(fonts.measured ? { font_fallbacks: fonts.fallbacks } : {}),
      width: v.width, height: v.height, fps: num! / (den || 1), duration_s: round(Number(probe.format.duration), 2),
      video_codec: v.codec_name, audio_codec: a?.codec_name ?? "none", black_frames_s: black,
    };
    const manifest = await this.buildManifest({ projectId: p.projectId, video, props, propsVersion: propsRow!.version, checks, maxCpsValue: maxCps(cues), fonts, fontFamilies: loadedFontFamilies(rendered.fontLogs), burnedIn: captionsBurnedIn(cues) });
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

    signal.throwIfAborted();
    ctx.progress(0.97, "gate");
    const verdict = await evaluatePolicy(manifest, p.target, this.opaOpts());
    const id = randomUUID();
    const renderedAt = now();
    this.db.insert(renders).values({ id, project_id: p.projectId, job_id: ctx.id, format: props.format, path: video, manifest_path: path.join(dir, "manifest.json"),
      checks_json: JSON.stringify(checks), policy_json: JSON.stringify({ ...verdict, target: p.target }), created_at: renderedAt }).run();
    commit();
    // the videos ledger behind the topic heatmap (ADR 011): one row per finished render, topic resolved from the project
    new TopicService(this.db).recordRender({ render_id: id, project_id: p.projectId, title: project.title, format: props.format,
      path: path.relative(paths.data, video).split(path.sep).join("/"), duration_s: checks.duration_s, created_at: renderedAt });
    this.projects.advance(p.projectId, "rendered");
    if (verdict.allow) this.projects.advance(p.projectId, "gated");
    // disposable intermediates go; the deliverables (video, captions, thumb, manifest) stay (ADR 003)
    for (const f of [raw, mixWav, masterWav]) rmSync(f, { force: true });
    rmSync(path.join(dir, "thumb"), { recursive: true, force: true });
    this.bus.emit({ type: "render.done", project_id: project.id, render_id: id, allow: verdict.allow });
    return { render_id: id, video: fileUrl(video), checks, policy: verdict };
  }

  /** Skip-unchanged: a new render row over the previous deliverables, with the gate evaluated again for this target. */
  private async reuseRender(p: { projectId: string; target: PublishTarget }, ctx: JobContext, project: { id: string }, format: string,
    prev: ReturnType<Pipeline["renders"]>[number], manifest: unknown) {
    ctx.progress(0.97, `reused render ${prev.id}`);
    const verdict = await evaluatePolicy(manifest as ProvenanceManifest, p.target, this.opaOpts());
    const id = randomUUID();
    this.db.insert(renders).values({ id, project_id: p.projectId, job_id: ctx.id, format, path: prev.path, manifest_path: prev.manifest_path,
      checks_json: prev.checks_json, policy_json: JSON.stringify({ ...verdict, target: p.target }), created_at: now() }).run();
    this.projects.advance(p.projectId, "rendered");
    if (verdict.allow) this.projects.advance(p.projectId, "gated");
    this.bus.emit({ type: "render.done", project_id: project.id, render_id: id, allow: verdict.allow });
    return { render_id: id, reused: prev.id, video: fileUrl(prev.path), checks: JSON.parse(prev.checks_json), policy: verdict, note: `reused render ${prev.id}` };
  }

  private async buildManifest(o: { projectId: string; video: string; props: EraAdjustedProps; propsVersion: number; checks: ProvenanceManifest["checks"]; maxCpsValue: number;
    /** the render's font report (render-support parseFontsReport); absent = unmeasured */ fonts?: FontsReport; fontFamilies?: string[]; burnedIn?: boolean;
    /** ATTESTED: no render step reports whether the on-frame disclosure drew (see buildManifest) */ onFrameDisclosure?: boolean }): Promise<ProvenanceManifest> {
    const info = manifestBuildInfo(compositionId(o.props), repoRoot);
    const { views, models } = info;
    const lineage = await this.wh.lineage(views);
    const snaps = await this.wh.rows(
      `select source_id, snapshot, license, license_class, attribution from meta.source_snapshots
       qualify row_number() over (partition by source_id order by built_at desc) = 1`);
    const sources = snaps.filter((s) => lineage.sources.includes(String(s.source_id))).map((s) => ({
      id: String(s.source_id), snapshot: String(s.snapshot), license: String(s.license), license_class: String(s.license_class),
      verdict: String(s.license_class), attribution: (s.attribution as string) ?? null,
    }));
    const assetRows = this.db.select().from(assets).where(eq(assets.project_id, o.projectId)).all();
    const latestBySha = new Map(assetRows.map((r) => [r.sha256, r]));
    // only what the current timing plays: an asset from an earlier take must not keep disclosure.ai_voice true
    const played = new Set(referencedAudioFiles(o.props.timing).map((f) => path.join(paths.audio, o.projectId, f)).filter((f) => existsSync(f)).map(sha256File));
    const audio = [...latestBySha.values()].filter((r) => played.has(r.sha256)).map((r) => ({
      kind: r.kind as "tts" | "music", provider: "elevenlabs" as const, request_id: r.request_id, model_id: r.model_id ?? "unknown",
      voice_id: r.voice_id, prompt_sha256: r.prompt_sha256, plan_tier: r.plan_tier as PlanTier, generated_at: r.generated_at, sha256: r.sha256,
      scene_id: r.scene_id, c2pa: "unknown" as const, // provider marks may not survive AAC re-encode; never claimed (ADR 003)
    }));
    const fontManifest = JSON.parse(readFileSync(path.join(paths.fonts, "fonts.manifest.json"), "utf8")) as { fonts: { family: string; license: string; sha256: string }[] };
    const facts = o.props.rows.flatMap((r) => [r.raw_fact_key, r.adjusted_fact_key, r.raw_rank_fact_key, r.adjusted_rank_fact_key]);
    const script = this.projects.latestScript(o.projectId)?.script;
    for (const s of script?.scenes ?? []) for (const t of s.tokens) if (t.fact_key) facts.push(t.fact_key);
    const session = this.db.$client.prepare("select engine, external_session_id from llm_sessions where project_id = ? order by started_at desc limit 1").get(o.projectId) as { engine: string; external_session_id: string | null } | undefined;
    return {
      subject: { file: "video.mp4", sha256: sha256File(o.video) },
      build: { git_sha: gitSha(), composition: info.composition, props_sha256: propsSha256(o.props), renderer: info.renderer, source_sha256: await this.hasher.hash() },
      data: { models, license_class: lineage.license_class, sources, facts_cited: [...new Set(facts)] },
      audio,
      // MEASURED when the render reported its fonts (only the families it loaded); else the shipped list, ATTESTED
      fonts: fontsUsedByRender(fontManifest.fonts, o.fonts ?? { measured: false, fallbacks: 0 }, o.fontFamilies ?? []).map((f) => ({ family: f.family, license: f.license, sha256: f.sha256 })),
      // DERIVED from the render input (cues handed to BurnedCaptions); a render with no cues burned nothing
      captions: { burned_in: o.burnedIn ?? true, sidecar: ["captions.srt", "captions.vtt"], max_cps: round(o.maxCpsValue, 2) },
      checks: o.checks,
      llm: session ? { engine: session.engine, session_id: session.external_session_id } : null,
      disclosure: { ai_voice: audio.some((x) => x.kind === "tts"), ai_music: audio.some((x) => x.kind === "music"),
        // ATTESTED, not measured: EraAdjustedFrame draws data-disclosure unconditionally and no render step reports it
        // back. Callers that can probe it pass onFrameDisclosure; the gate denies a false value.
        on_frame: o.onFrameDisclosure ?? true },
    };
  }

  // ------------------------------------------------------------------ publish

  private async publishJob(p: PublishJobParams, ctx: JobContext) {
    const project = this.projects.get(p.projectId)!;
    const all = this.renders(p.projectId);
    let render = all[0];
    if (p.scheduleId) {
      // the slot pinned a render: publish exactly that one, never whatever is latest now
      const slot = this.db.select().from(schedule).where(eq(schedule.id, p.scheduleId)).get();
      if (!slot) throw new Error(`schedule slot ${p.scheduleId} no longer exists`);
      render = all.find((r) => r.id === slot.render_id) as (typeof all)[number];
      if (!render) throw new Error(`pinned render ${slot.render_id} (slot ${slot.id}) no longer exists`);
    }
    if (!render) throw new Error("no render to publish");
    // one upload per render and publish mode: a second click, or a slot firing after a direct publish, must not
    // create a second private video (a dry run does not block the live upload that follows the Google app)
    const done = this.db.select().from(publications).where(eq(publications.render_id, render.id)).all().find((x) => x.mode === modes.publish);
    if (done) throw new Refusal("publish", `render ${render.id} is already published (${done.platform}, ${done.visibility}, publication ${done.id}); render again to publish a new video`);
    const policy = render.policy_json ? JSON.parse(render.policy_json) : null;
    if (!policy?.allow) throw new Refusal("publish gate", (policy?.deny ?? ["not gated"]).join("; "));
    const manifest = JSON.parse(readFileSync(render.manifest_path, "utf8")) as ProvenanceManifest;
    const attribution = [...new Set(manifest.data.sources.map((s) => s.attribution).filter(Boolean))].join(" · ");
    const props = this.projects.latestProps(p.projectId)?.props;
    const description = [p.description ?? project.title, props?.method_note, attribution, disclosureLine(manifest.disclosure)].filter(Boolean).join("\n\n");
    const dir = path.dirname(render.path);
    const yt = new YouTubeClient({ mode: modes.publish, planFile: path.join(dir, "publish-plan.json") });
    ctx.progress(0.1, "uploading");
    // idempotent upload (API-NOTES "Idempotent uploads"): persist the session per render, resume it after a crash
    const sessionFile = path.join(dir, UPLOAD_SESSION_FILE);
    const resumeSessionUri = readUploadSession(sessionFile, manifest.subject.sha256);
    const up = await yt.uploadVideo({ file: render.path, title: (p.title ?? project.title).slice(0, 100), description, tags: p.tags ?? ["F1", "data"],
      privacyStatus: "private", containsSyntheticMedia: manifest.disclosure.ai_voice || manifest.disclosure.ai_music, categoryId: "17" },
    { resumeSessionUri, expectedSha256: manifest.subject.sha256,
      onSession: (sessionUri) => writeFileSync(sessionFile, JSON.stringify({ sessionUri, sha256: manifest.subject.sha256 })) });
    ctx.progress(0.7, "captions");
    await yt.insertCaptions(up.id, path.join(dir, "captions.srt"), "en", "English");
    const pubId = randomUUID();
    this.db.insert(publications).values({ id: pubId, render_id: render.id, platform: "youtube", external_id: up.id, visibility: "private",
      url: modes.publish === "live" ? `https://youtu.be/${up.id}` : null, published_at: now(), status: "private", mode: modes.publish }).run();
    const today = now().slice(0, 10);
    const row = modes.publish === "live" ? null : emptyMetricsRow(pubId, today);
    if (row) this.db.insert(metricsDaily).values({ ...row, retention_json: null }).onConflictDoNothing().run();
    rmSync(sessionFile, { force: true }); // the video exists and is recorded: nothing left to resume
    this.projects.advance(p.projectId, "published");
    return { publication_id: pubId, external_id: up.id, visibility: "private", mode: modes.publish };
  }

  refreshMetrics(): { job_id: string } {
    return { job_id: this.runner.enqueue("metrics", {}) };
  }

  /** Daily stats for live publications; dry-run publications have nothing to pull (DESIGN §6.7). */
  private async metricsJob(ctx: JobContext) {
    const live = this.db.select().from(publications).all().filter((p) => p.mode === "live" && p.external_id);
    if (!live.length) return { pulled: 0, note: "no live publications yet (publishing runs dry until the Google app exists)" };
    const yt = new YouTubeClient({ mode: "live" });
    const stats = await yt.fetchStats(live.map((p) => p.external_id!));
    const today = now().slice(0, 10);
    for (const s of stats) {
      const pub = live.find((p) => p.external_id === s.videoId);
      if (!pub) continue;
      const row = normalizeYouTubeStatistics(pub.id, today, s);
      this.db.insert(metricsDaily).values({ ...row, retention_json: null }).onConflictDoUpdate({ target: [metricsDaily.publication_id, metricsDaily.date], set: { ...row } }).run();
    }
    ctx.progress(1);
    return { pulled: stats.length };
  }

  // ------------------------------------------------------------------ worker

  private opaOpts() {
    return { policyDir: paths.policy, opaBin: process.env.OPA_BIN ?? (process.platform === "win32" ? path.join(repoRoot, ".tools", "opa.exe") : "opa") };
  }

  private worker(job: Record<string, unknown>, ctx: JobContext | undefined, scale = 1, signal: AbortSignal | undefined = ctx?.signal): Promise<Record<string, unknown>> {
    return runRenderWorker(job, ctx, scale, signal, this.hasher);
  }
}

const defaultHasher = createSourceHasher(repoRoot);

/**
 * Runs one render job in the x64 render worker child process (ADR 004) and resolves with its `done`
 * message. Shared by the produce pipeline and the generation `gen_render` handler.
 */
export async function runRenderWorker(
  job: Record<string, unknown>,
  ctx: JobContext | undefined,
  scale = 1,
  signal: AbortSignal | undefined = ctx?.signal,
  hasher: SourceHasher = defaultHasher,
): Promise<Record<string, unknown>> {
  const bundleRoot = path.join(paths.data, "cache", "bundle");
  const hash = await hasher.hash();
  const full = { ...job, entry: ENTRY, bundleDir: path.join(bundleRoot, hash) };
  // props with word timings exceed the Windows command-line limit (32K): pass the job as a file
  const jobFile = path.join(paths.data, "cache", "jobs", `${randomUUID()}.json`);
  mkdirSync(path.dirname(jobFile), { recursive: true });
  writeFileSync(jobFile, JSON.stringify(full));
  let last = 0;
  try {
    const res = await runWorker({
      cmd: renderNode(), args: [WORKER, jobFile], cwd: path.join(repoRoot, "apps", "server"), signal, timeoutMs: renderTimeoutMs(),
      onNote: (note) => ctx?.progress(last, note),
      onMessage: (msg) => {
        if (msg.type !== "progress" || !ctx) return;
        last = Math.min(scale, (msg.stage === "bundle" ? 0.05 : 0.05 + 0.95 * (msg.progress ?? 0)) * scale);
        ctx.progress(last, msg.stage);
      },
    });
    // the bundle exists now: old code versions' bundles (~30 MB each) are garbage
    await gcBundles(bundleRoot, BUNDLES_KEPT, hash).catch(() => {});
    return res;
  } finally {
    rmSync(jobFile, { force: true });
  }
}

/**
 * The AI-disclosure sentence for a description, from what the manifest says was actually generated (ADR 007:
 * the format has no narration, so a fixed "narration and music" line would state something false). "" when none.
 */
export function disclosureLine(d: { ai_voice: boolean; ai_music: boolean }): string {
  if (d.ai_voice && d.ai_music) return "Narration and music are AI-generated (ElevenLabs).";
  if (d.ai_music) return "Music is AI-generated (ElevenLabs).";
  if (d.ai_voice) return "Narration is AI-generated (ElevenLabs).";
  return "";
}

/** The saved session URI for this render's file, or undefined when absent, unreadable or for a different file. */
function readUploadSession(file: string, sha256: string): string | undefined {
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as { sessionUri?: unknown; sha256?: unknown };
    return typeof j.sessionUri === "string" && j.sha256 === sha256 ? j.sessionUri : undefined;
  } catch {
    return undefined;
  }
}

export const compositionId = (props: EraAdjustedProps) => `EraAdjustedSlope-${props.format}`;
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

function gitSha(): string {
  try {
    const head = readFileSync(path.join(repoRoot, ".git", "HEAD"), "utf8").trim();
    return head.startsWith("ref:") ? readFileSync(path.join(repoRoot, ".git", head.slice(5).trim()), "utf8").trim() : head;
  } catch {
    return "unknown";
  }
}

async function blackSeconds(file: string, signal?: AbortSignal): Promise<number> {
  const { stderr } = await execFileP("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vf", "blackdetect=d=0.5:pix_th=0.05", "-an", "-f", "null", "-"], { maxBuffer: 64 * 1024 * 1024, signal });
  return round([...stderr.matchAll(/black_duration:([\d.]+)/g)].reduce((s, m) => s + Number(m[1]), 0), 2);
}
