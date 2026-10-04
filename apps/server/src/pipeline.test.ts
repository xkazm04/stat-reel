import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { paths } from "./config";
import { openDb } from "./db";
import { EventBus } from "./events";
import { JobRunner } from "./jobs";
import { captionsBurnedIn, loadedFontFamilies, parseFontsReport } from "./render-support";

// no keychain, no ElevenLabs, no ffmpeg: the pipeline is driven with fakes against fixture tmp dirs
vi.mock("@napi-rs/keyring", () => ({ Entry: class { getPassword() { return "test"; } } }));
const tts = vi.fn();
vi.mock("@statreel/audio", async (orig) => ({
  ...(await orig<object>()),
  AudioCache: class {},
  ElevenLabsClient: class { async subscription() { return { tier: "starter" }; } },
  generateTts: (...a: unknown[]) => tts(...a),
}));
// the YouTube client is faked: publish jobs never touch the network, the tests drive uploadVideo directly
const ytUpload = vi.fn();
vi.mock("@statreel/publish", async (orig) => ({
  ...(await orig<object>()),
  evaluatePolicy: async () => ({ allow: true, deny: [], warn: [], checks_run: [] }),
  YouTubeClient: class { uploadVideo(...a: unknown[]) { return ytUpload(...a); } async insertCaptions() {} },
}));
const runWorker = vi.fn();
vi.mock("./render-support", async (orig) => ({ ...(await orig<object>()), runWorker: (...a: unknown[]) => runWorker(...a) }));

const { Pipeline, disclosureLine } = await import("./pipeline");

const tmp = () => mkdtempSync(path.join(tmpdir(), "statreel-pipeline-"));
const target = { platform: "youtube", monetized: true, ai_disclosure: true, visibility: "private" } as never;
const scene = (id: string) => ({ scene_id: id, tokens: [{ spoken: "hello", display: "hello" }] });
const timing = { duration_s: 5, scenes: [], words: [], cues: [], music: [], voice_lead_s: 0.5 };
const propsRow = { version: 1, props: { format: "vertical", scenes: [{ id: "a", kind: "hook" }, { id: "b", kind: "close" }], timing } };

function setup() {
  const root = tmp();
  Object.assign(paths, { data: root, audio: path.join(root, "audio"), renders: path.join(root, "renders") });
  const db = openDb(":memory:");
  const runner = new JobRunner(db, new EventBus());
  const attachTiming = vi.fn();
  const projects = {
    get: () => ({ id: "p1", title: "t" }), latestProps: () => propsRow, attachTiming, advance: vi.fn(),
    latestScript: () => ({ version: 1, script: { scenes: [scene("a"), scene("b")] } }),
  };
  const pipeline = new Pipeline({ db, bus: new EventBus(), runner, projects: projects as never, wh: {} as never });
  return { root, runner, pipeline, attachTiming };
}

describe("audio job cancellation (pipeline-real-cancel-cleanup)", () => {
  beforeEach(() => { tts.mockReset(); runWorker.mockReset(); });

  it("a cancel during provider calls stops the job and never enqueues the render", async () => {
    const { root, runner, pipeline, attachTiming } = setup();
    const file = path.join(root, "take.mp3");
    writeFileSync(file, "x");
    tts.mockImplementation(async () => {
      runner.cancel(runner.list()[0]!.id); // the owner hits cancel while the first scene is being voiced
      return { durationS: 2, audioPath: file, alignment: {}, asset: {} };
    });
    pipeline.produce("p1", target);
    await runner.idle();
    expect(runner.list().map((j) => [j.kind, j.status])).toEqual([["audio", "cancelled"]]);
    expect(tts).toHaveBeenCalledTimes(1); // the second scene's provider call was never made
    expect(attachTiming).not.toHaveBeenCalled();
  });
});

describe("render cleanup on failure / cancel", () => {
  beforeEach(() => runWorker.mockReset());

  it("removes the whole partial run dir when the worker fails, and keeps other projects' runs", async () => {
    const { root, runner, pipeline } = setup();
    const other = path.join(root, "renders", "other", "2026-01-01T00-00-00-000Z");
    mkdirSync(other, { recursive: true });
    writeFileSync(path.join(other, "video.mp4"), "kept");
    (pipeline as unknown as { worker: unknown }).worker = vi.fn(async (job: { output: string }) => {
      writeFileSync(job.output, "partial");
      throw new Error("boom");
    });
    const id = runner.enqueue("render", { projectId: "p1", target }, "p1");
    await runner.idle();
    expect(runner.get(id)?.status).toBe("failed");
    expect(readdirSync(path.join(root, "renders", "p1"))).toEqual([]);
    expect(existsSync(path.join(other, "video.mp4"))).toBe(true);
  });

  it("removes the run dir when the job is cancelled mid-render", async () => {
    const { root, runner, pipeline } = setup();
    (pipeline as unknown as { worker: unknown }).worker = vi.fn(async (job: { output: string }) => {
      writeFileSync(job.output, "partial");
      await new Promise((r) => setTimeout(r, 5)); // let the runner register the job as active
      runner.cancel(runner.list()[0]!.id);
      throw new Error("render cancelled");
    });
    const id = runner.enqueue("render", { projectId: "p1", target }, "p1");
    await runner.idle();
    expect(runner.get(id)?.status).toBe("cancelled");
    expect(readdirSync(path.join(root, "renders", "p1"))).toEqual([]);
  });

  it("deletes the worker job file on success and on failure", async () => {
    const { root, pipeline } = setup();
    const jobs = path.join(root, "cache", "jobs");
    const worker = (pipeline as unknown as { worker: (j: object, c: undefined) => Promise<unknown> }).worker.bind(pipeline);
    runWorker.mockResolvedValueOnce({ type: "done" });
    await worker({ mode: "stills" }, undefined);
    expect(readdirSync(jobs)).toEqual([]);
    runWorker.mockRejectedValueOnce(new Error("crash"));
    await expect(worker({ mode: "stills" }, undefined)).rejects.toThrow("crash");
    expect(readdirSync(jobs)).toEqual([]);
  });

  it("the startup sweep (run by resume) removes partial run dirs and orphan job files only", () => {
    const { root, runner } = setup();
    const partial = path.join(root, "renders", "p1", "2026-02-02T00-00-00-000Z");
    const done = path.join(root, "renders", "p1", "2026-02-03T00-00-00-000Z");
    mkdirSync(partial, { recursive: true });
    mkdirSync(done, { recursive: true });
    writeFileSync(path.join(partial, "raw.mp4"), "x");
    writeFileSync(path.join(done, "manifest.json"), "{}");
    const jobs = path.join(root, "cache", "jobs");
    mkdirSync(jobs, { recursive: true });
    const old = path.join(jobs, "old.json");
    writeFileSync(old, "{}");
    const fresh = path.join(jobs, "fresh.json"); // a live process's job file
    writeFileSync(fresh, "{}");
    const freshRun = path.join(root, "renders", "p1", "2026-02-04T00-00-00-000Z"); // a live process's render
    mkdirSync(freshRun, { recursive: true });
    writeFileSync(path.join(freshRun, "raw.mp4"), "x");
    const past = new Date(Date.now() - 86_400_000);
    for (const f of [old, partial, path.join(partial, "raw.mp4")]) utimesSync(f, past, past);
    runner.resume();
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(freshRun)).toBe(true);
    expect(existsSync(partial)).toBe(false);
    expect(existsSync(done)).toBe(true);
    expect(existsSync(old)).toBe(false);
  });
});

describe("provenance manifest (pipeline-honest-gate-inputs)", () => {
  it("derives build/views from the packages and lists only audio the current timing plays", async () => {
    const { root, pipeline } = setup();
    const dir = path.join(root, "audio", "p1");
    mkdirSync(dir, { recursive: true });
    const used = Buffer.from("current take");
    writeFileSync(path.join(dir, "k1.mp3"), used);
    writeFileSync(path.join(dir, "stale.mp3"), "an earlier take, no longer in the timing");
    const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
    const { db } = pipeline as unknown as { db: { $client: { prepare: (q: string) => { run: (...a: unknown[]) => void } } } };
    const ins = db.$client.prepare("insert into assets (id, project_id, kind, provider, plan_tier, path, sha256, generated_at) values (?, 'p1', 'tts', 'elevenlabs', 'starter', '', ?, '2026-01-01T00:00:00Z')");
    ins.run("a1", sha(used));
    ins.run("a2", sha("an earlier take, no longer in the timing"));
    const video = path.join(root, "video.mp4");
    writeFileSync(video, "v");
    const wh = { lineage: vi.fn(async () => ({ license_class: "legal", sources: [] })), rows: vi.fn(async () => []) };
    (pipeline as unknown as { wh: unknown }).wh = wh;
    const props = { ...propsRow.props, rows: [], timing: { ...timing, scenes: [{ scene_id: "a", start_s: 0, end_s: 5, voice_src: "http://127.0.0.1:8787/files/audio/p1/k1.mp3" }] } };
    const build = (pipeline as unknown as { buildManifest: (o: object) => Promise<{ build: { composition: string; renderer: string }; audio: { sha256: string }[]; disclosure: { ai_voice: boolean; ai_music: boolean }; data: { models: string[] } }> }).buildManifest;
    const m = await build.call(pipeline, { projectId: "p1", video, props, propsVersion: 1, checks: {}, maxCpsValue: 10 });
    expect(wh.lineage).toHaveBeenCalledWith(["f1_driver_era_adjusted"]);
    expect(m.data.models).toEqual(["mart_era_adjusted", "f1_driver_era_adjusted"]);
    expect(m.build.composition).toMatch(/^EraAdjustedSlope@\d+\.\d+\.\d+$/);
    expect(m.build.renderer).toMatch(/^remotion@\d/);
    expect(m.audio.map((a) => a.sha256)).toEqual([sha(used)]);
    expect(m.disclosure).toMatchObject({ ai_voice: true, ai_music: false });

    // the timing no longer plays any voice: the stale asset must not keep ai_voice true
    const m2 = await build.call(pipeline, { projectId: "p1", video, props: { ...props, timing }, propsVersion: 2, checks: {}, maxCpsValue: 10 });
    expect(m2.audio).toEqual([]);
    expect(m2.disclosure.ai_voice).toBe(false);
  });

  it("measures captions and fonts from the render and the real gate denies when they (or the disclosure) are off", async () => {
    const { root, pipeline } = setup();
    const dir = path.join(root, "audio", "p1");
    mkdirSync(dir, { recursive: true });
    const used = Buffer.from("current take");
    writeFileSync(path.join(dir, "k1.mp3"), used);
    const sha = createHash("sha256").update(used).digest("hex");
    const { db } = pipeline as unknown as { db: { $client: { prepare: (q: string) => { run: (...a: unknown[]) => void } } } };
    db.$client.prepare("insert into assets (id, project_id, kind, provider, plan_tier, path, sha256, generated_at) values ('a1', 'p1', 'tts', 'elevenlabs', 'starter', '', ?, '2026-01-01T00:00:00Z')").run(sha);
    const video = path.join(root, "video.mp4");
    writeFileSync(video, "v");
    (pipeline as unknown as { wh: unknown }).wh = { lineage: vi.fn(async () => ({ license_class: "legal", sources: [] })), rows: vi.fn(async () => []) };
    const props = { ...propsRow.props, rows: [], timing: { ...timing, scenes: [{ scene_id: "a", start_s: 0, end_s: 5, voice_src: "http://127.0.0.1:8787/files/audio/p1/k1.mp3" }] } };
    const build = (o: object) => (pipeline as unknown as { buildManifest: (o: object) => Promise<import("@statreel/schemas").ProvenanceManifest> }).buildManifest.call(pipeline, { projectId: "p1", video, props, propsVersion: 1, checks: {}, maxCpsValue: 10, ...o });

    // the font report names the families the browser loaded: only those are recorded
    const logs = [`[statreel-fonts]${JSON.stringify({ loaded: [], failed: [], check: { Inter: true, "JetBrains Mono": true }, fallbacks: 0 })}`];
    const measured = await build({ fonts: parseFontsReport(logs), fontFamilies: loadedFontFamilies(logs), burnedIn: captionsBurnedIn([{}]) });
    expect([...new Set(measured.fonts.map((f) => f.family))].sort()).toEqual(["Inter", "JetBrains Mono"]);
    expect(measured.captions.burned_in).toBe(true);
    expect((await build({ burnedIn: captionsBurnedIn([]) })).captions.burned_in).toBe(false);
    expect((await build({ onFrameDisclosure: false })).disclosure.on_frame).toBe(false);

    // the file mocks evaluatePolicy: this one goes to the real opa (skipped like packages/publish when there is no binary)
    const { evaluatePolicy, defaultOpaBin } = await vi.importActual<typeof import("@statreel/publish")>("@statreel/publish");
    if (process.env.OPA_BIN ? !existsSync(process.env.OPA_BIN) : process.platform === "win32" && !existsSync(defaultOpaBin())) return;
    const off = await evaluatePolicy(await build({ onFrameDisclosure: false }), target);
    expect(off.deny).toContain("AI audio used but disclosure not placed on the frame");
    const bare = await evaluatePolicy(await build({ burnedIn: false }), target);
    expect(bare.deny).toContain("captions not burned in");
  });
});

describe("skip unchanged (pipeline-skip-unchanged)", () => {
  it("a second produce with unchanged props + source reuses the render instead of rendering", async () => {
    const { root, runner, pipeline } = setup();
    const internals = pipeline as unknown as { hasher: { hash(): Promise<string> }; worker: unknown; db: { $client: { prepare: (q: string) => { run: (...a: unknown[]) => void } } } };
    const { propsSha256 } = await import("./bundle-support");
    const dir = path.join(root, "renders", "p1", "2026-04-01T00-00-00-000Z");
    mkdirSync(dir, { recursive: true });
    const video = path.join(dir, "video.mp4");
    writeFileSync(video, "video-bytes");
    for (const f of ["captions.srt", "captions.vtt", "thumb.png"]) writeFileSync(path.join(dir, f), "x");
    const manifest = {
      build: { props_sha256: propsSha256(propsRow.props), source_sha256: await internals.hasher.hash() },
      subject: { sha256: createHash("sha256").update("video-bytes").digest("hex") }, captions: { sidecar: ["captions.srt", "captions.vtt"] },
    };
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    internals.db.$client.prepare("insert into renders (id, project_id, job_id, format, path, manifest_path, checks_json, created_at) values ('r1', 'p1', 'j0', 'vertical', ?, ?, '{}', '2026-04-01T00:00:00Z')")
      .run(video, path.join(dir, "manifest.json"));
    const worker = vi.fn();
    internals.worker = worker;

    const id = runner.enqueue("render", { projectId: "p1", target }, "p1");
    await runner.idle();
    const job = runner.get(id)!;
    expect(job.status).toBe("succeeded");
    expect(worker).not.toHaveBeenCalled();
    expect(JSON.parse(job.result_json!)).toMatchObject({ reused: "r1", note: "reused render r1", policy: { allow: true } });
    const rows = pipeline.renders("p1");
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.id !== "r1")[0]).toMatchObject({ path: video, job_id: id });
  });
});

describe("publish job render pin + resumable upload (publish-job-render-pin-and-resume)", () => {
  const sha = createHash("sha256").update("video-bytes").digest("hex");
  beforeEach(() => ytUpload.mockReset());

  /** a gated render row with its own dir, manifest and video; created_at orders "latest" */
  function addRender(root: string, pipeline: unknown, id: string, createdAt: string, disclosure = { ai_voice: false, ai_music: false }) {
    const dir = path.join(root, "renders", "p1", id);
    mkdirSync(dir, { recursive: true });
    const video = path.join(dir, "video.mp4");
    writeFileSync(video, "video-bytes");
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ subject: { file: "video.mp4", sha256: sha }, data: { sources: [] }, disclosure: { ...disclosure, on_frame: true } }));
    const { db } = pipeline as { db: { $client: { prepare: (q: string) => { run: (...a: unknown[]) => void } } } };
    db.$client.prepare("insert into renders (id, project_id, job_id, format, path, manifest_path, checks_json, policy_json, created_at) values (?, 'p1', 'j0', 'vertical', ?, ?, '{}', ?, ?)")
      .run(id, video, path.join(dir, "manifest.json"), JSON.stringify({ allow: true, deny: [] }), createdAt);
    return dir;
  }
  function addSlot(pipeline: unknown, renderId: string) {
    const { db } = pipeline as { db: { $client: { prepare: (q: string) => { run: (...a: unknown[]) => void } } } };
    db.$client.prepare("insert into schedule (id, project_id, render_id, channel_id, publish_at, status, created_at) values ('sl1', 'p1', ?, 'ch-youtube', '2026-04-01T00:00:00Z', 'publishing', '2026-04-01T00:00:00Z')").run(renderId);
  }
  const publish = async (runner: InstanceType<typeof JobRunner>, params: object) => {
    const id = runner.enqueue("publish", { projectId: "p1", ...params }, "p1");
    await runner.idle();
    return runner.get(id)!;
  };

  it("resumes a crashed upload from the saved session instead of starting a second one", async () => {
    const { root, runner, pipeline } = setup();
    const dir = addRender(root, pipeline, "r1", "2026-04-01T00:00:00Z");
    // first run: the session is reported, then the process dies mid-upload
    ytUpload.mockImplementationOnce(async (_req: unknown, opts: { onSession: (s: string) => void }) => {
      opts.onSession("https://upload.example/session-1");
      throw new Error("crash mid-upload");
    });
    expect((await publish(runner, {})).status).toBe("failed");
    expect(JSON.parse(readFileSync(path.join(dir, "upload-session.json"), "utf8"))).toMatchObject({ sessionUri: "https://upload.example/session-1", sha256: sha });
    expect(ytUpload.mock.calls[0]?.[1]).toMatchObject({ resumeSessionUri: undefined, expectedSha256: sha });

    // second run: the saved session is passed back and the file is cleaned up after success
    ytUpload.mockResolvedValueOnce({ id: "vid1", privacyStatus: "private", mode: "dry" });
    const ok = await publish(runner, {});
    expect(ok.status).toBe("succeeded");
    expect(ytUpload.mock.calls[1]?.[1]).toMatchObject({ resumeSessionUri: "https://upload.example/session-1", expectedSha256: sha });
    expect(existsSync(path.join(dir, "upload-session.json"))).toBe(false);
  });

  it("ignores a saved session recorded for a different file", async () => {
    const { root, runner, pipeline } = setup();
    const dir = addRender(root, pipeline, "r1", "2026-04-01T00:00:00Z");
    writeFileSync(path.join(dir, "upload-session.json"), JSON.stringify({ sessionUri: "https://upload.example/old", sha256: "deadbeef" }));
    ytUpload.mockResolvedValueOnce({ id: "vid1", privacyStatus: "private", mode: "dry" });
    expect((await publish(runner, {})).status).toBe("succeeded");
    expect(ytUpload.mock.calls[0]?.[1].resumeSessionUri).toBeUndefined();
  });

  it("publishes the render the slot pinned, not a newer one; without a slot it takes the latest", async () => {
    const { root, runner, pipeline } = setup();
    addRender(root, pipeline, "r-old", "2026-04-01T00:00:00Z");
    addRender(root, pipeline, "r-new", "2026-04-02T00:00:00Z");
    addSlot(pipeline, "r-old");
    ytUpload.mockResolvedValue({ id: "vid1", privacyStatus: "private", mode: "dry" });
    expect((await publish(runner, { scheduleId: "sl1" })).status).toBe("succeeded");
    expect(ytUpload.mock.calls[0]?.[0].file).toContain("r-old");
    expect((await publish(runner, {})).status).toBe("succeeded");
    expect(ytUpload.mock.calls[1]?.[0].file).toContain("r-new");
  });

  it("fails with a named error when the pinned render no longer exists", async () => {
    const { root, runner, pipeline } = setup();
    addRender(root, pipeline, "r-new", "2026-04-02T00:00:00Z");
    addSlot(pipeline, "r-gone");
    const job = await publish(runner, { scheduleId: "sl1" });
    expect(job.status).toBe("failed");
    expect(job.error).toContain("pinned render r-gone");
    expect(ytUpload).not.toHaveBeenCalled();
  });
});

describe("publish description disclosure (publish-disclosure-from-manifest)", () => {
  it("builds the line from manifest.disclosure: voice+music, music only, voice only, none", () => {
    expect(disclosureLine({ ai_voice: true, ai_music: true })).toBe("Narration and music are AI-generated (ElevenLabs).");
    expect(disclosureLine({ ai_voice: false, ai_music: true })).toBe("Music is AI-generated (ElevenLabs).");
    expect(disclosureLine({ ai_voice: true, ai_music: false })).toBe("Narration is AI-generated (ElevenLabs).");
    expect(disclosureLine({ ai_voice: false, ai_music: false })).toBe("");
  });

  it.each([
    [{ ai_voice: false, ai_music: true }, "Music is AI-generated (ElevenLabs).", true],
    [{ ai_voice: false, ai_music: false }, undefined, false],
  ])("the uploaded description carries it (%j)", async (disclosure, line, synthetic) => {
    const { root, runner, pipeline } = setup();
    const dir = path.join(root, "renders", "p1", "r1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "video.mp4"), "v");
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ subject: { sha256: "x" }, data: { sources: [] }, disclosure: { ...disclosure, on_frame: true } }));
    (pipeline as unknown as { db: { $client: { prepare: (q: string) => { run: (...a: unknown[]) => void } } } }).db.$client
      .prepare("insert into renders (id, project_id, job_id, format, path, manifest_path, checks_json, policy_json, created_at) values ('r1', 'p1', 'j0', 'vertical', ?, ?, '{}', '{\"allow\":true}', '2026-04-01T00:00:00Z')")
      .run(path.join(dir, "video.mp4"), path.join(dir, "manifest.json"));
    ytUpload.mockReset();
    ytUpload.mockResolvedValueOnce({ id: "vid1", privacyStatus: "private", mode: "dry" });
    runner.enqueue("publish", { projectId: "p1" }, "p1");
    await runner.idle();
    const req = ytUpload.mock.calls[0]?.[0] as { description: string; containsSyntheticMedia: boolean };
    expect(req.containsSyntheticMedia).toBe(synthetic);
    if (line) expect(req.description).toContain(line);
    expect(req.description).not.toContain("Narration and music");
    if (!line) expect(req.description).not.toContain("AI-generated");
  });
});
