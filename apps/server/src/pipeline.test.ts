import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { paths } from "./config";
import { openDb } from "./db";
import { EventBus } from "./events";
import { JobRunner } from "./jobs";

// no keychain, no ElevenLabs, no ffmpeg: the pipeline is driven with fakes against fixture tmp dirs
vi.mock("@napi-rs/keyring", () => ({ Entry: class { getPassword() { return "test"; } } }));
const tts = vi.fn();
vi.mock("@statreel/audio", async (orig) => ({
  ...(await orig<object>()),
  AudioCache: class {},
  ElevenLabsClient: class { async subscription() { return { tier: "starter" }; } },
  generateTts: (...a: unknown[]) => tts(...a),
}));
const runWorker = vi.fn();
vi.mock("./render-support", async (orig) => ({ ...(await orig<object>()), runWorker: (...a: unknown[]) => runWorker(...a) }));

const { Pipeline } = await import("./pipeline");

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
    get: () => ({ id: "p1", title: "t" }), latestProps: () => propsRow, attachTiming,
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
    const past = new Date(Date.now() - 60_000);
    utimesSync(old, past, past);
    runner.resume();
    expect(existsSync(partial)).toBe(false);
    expect(existsSync(done)).toBe(true);
    expect(existsSync(old)).toBe(false);
  });
});
