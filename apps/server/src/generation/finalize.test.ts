import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BoardService } from "../board";
import { paths as appPaths } from "../config";
import { type Db, openDb } from "../db";
import { FinalizeError, GenerationFinalizer } from "./finalize";
import { jobPaths } from "./paths";
import { GenerationQueue } from "./queue";
import { snapshotFacts } from "./sample-fixtures";
import { CASE_A, insertCase } from "./testing";

let dir: string;
let db: Db;
let board: BoardService;
let fin: GenerationFinalizer;
let queue: GenerationQueue;
const fixtures = path.join(appPaths.fixtures, "generation");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("fake still")]);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "statreel-fin-"));
  db = openDb(path.join(dir, "app.sqlite"));
  board = new BoardService(db, path.join(dir, "board"));
  mkdirSync(path.join(dir, "board"), { recursive: true });
  queue = new GenerationQueue(db);
  fin = new GenerationFinalizer({ db, board, dataRoot: dir, boardRoot: path.join(dir, "board"), facts: snapshotFacts });
  insertCase(db, CASE_A, { data_status: "new-source" });
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A running visual_options job whose folder holds the fake-mode fixture and three rendered stills. */
function runningJob() {
  const job = (queue.enqueue({ type: "visual_options", case_id: CASE_A }), queue.claim())!;
  const p = jobPaths(job.id, dir);
  mkdirSync(p.out, { recursive: true });
  cpSync(path.join(fixtures, "visual_options"), p.work, { recursive: true });
  writeFileSync(p.caseJson, JSON.stringify({ data_status: "new-source" }));
  const stills: Record<string, string> = {};
  for (const n of [1, 2, 3]) {
    const f = path.join(p.dir, "render", `v${n}-stills`, "still-00554.png");
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, PNG);
    stills[String(n)] = f;
  }
  return { job, p, body: { outputs: [], result: { renders: { stills } } } };
}

describe("finalize visual_options", () => {
  it("creates 3 board items with case_idea_id, source generation and the sample label data", async () => {
    const { job, body } = runningJob();
    const r = (await fin.finalize(job, body)) as { board_item_ids: string[] };
    expect(r.board_item_ids).toHaveLength(3);
    const items = r.board_item_ids.map((id) => board.get(id)!);
    expect(items.map((i) => i.case_idea_id)).toEqual([CASE_A, CASE_A, CASE_A]);
    expect(items[0]).toMatchObject({ width: 1080, height: 1920, status: "pending", image: `items/gen/${CASE_A}/${job.id}-v1.png` });
    expect(items[1]?.source).toMatchObject({ skill: "generation", job_id: job.id, variant: 2, data_provenance: "sample" });
    expect(items.map((i) => i.style?.name)).toEqual(["Photo finish", "Slate night", "Warm paper"]);
    expect(items[0]?.proposed_case).toMatchObject({ name: `Case ${CASE_A}` });
    expect(existsSync(path.join(dir, "board", items[2]!.image))).toBe(true);
  });

  it("finalize twice gives no duplicates", async () => {
    const { job, body } = runningJob();
    const a = (await fin.finalize(job, body)) as { board_item_ids: string[] };
    const b = (await fin.finalize(job, body)) as { board_item_ids: string[] };
    expect(b.board_item_ids).toEqual(a.board_item_ids);
    expect(board.list({ status: "all" })).toHaveLength(3);
  });

  it("invalid props fail validation and create nothing", async () => {
    const { job, p, body } = runningJob();
    const f = path.join(p.out, "variants", "v2.props.json");
    writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), transition: "wipe" }));
    await expect(fin.finalize(job, body)).rejects.toThrow(/rule 1 \[transition-key\]/);
    expect(board.list({ status: "all" })).toHaveLength(0);
  });

  it("a logo without an assets.json row is a validation error", async () => {
    const { job, p, body } = runningJob();
    writeFileSync(path.join(p.out, "assets.json"), "[]");
    await expect(fin.finalize(job, body)).rejects.toThrow(/logo-no-ledger-row/);
  });

  it("refuses a still outside the job folder or one that is not a PNG", async () => {
    const { job, p, body } = runningJob();
    const outside = path.join(dir, "elsewhere.png");
    writeFileSync(outside, PNG);
    await expect(fin.finalize(job, { ...body, result: { renders: { stills: { ...body.result.renders.stills, "2": outside } } } })).rejects.toThrow(FinalizeError);
    writeFileSync(body.result.renders.stills["3"] as string, "not a png");
    await expect(fin.finalize(job, body)).rejects.toThrow(/not a PNG/);
    void p;
  });
});

describe("finalize generate_video", () => {
  const ffmpeg = (out: string, size: string, seconds: number) =>
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=black:s=${size}:r=30`, "-t", String(seconds), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", out]);

  /** A running generate_video job with the video fixture and a (black) rendered video of the plan's length. */
  function videoJob(size = "1080x1920", seconds = 41) {
    insertCase(db, "ci-ddddddd4", { data_status: "staged" });
    db.$client.prepare("update case_ideas set topic = 'energy' where id = 'ci-ddddddd4'").run();
    const job = (queue.enqueue({ type: "generate_video", case_id: "ci-ddddddd4" }), queue.claim())!;
    const p = jobPaths(job.id, dir);
    mkdirSync(p.out, { recursive: true });
    cpSync(path.join(fixtures, "generate_video"), p.work, { recursive: true });
    writeFileSync(p.caseJson, JSON.stringify({ data_status: "staged" }));
    const raw = path.join(p.dir, "render", "props.raw.mp4");
    mkdirSync(path.dirname(raw), { recursive: true });
    ffmpeg(raw, size, seconds);
    const thumb = path.join(p.dir, "render", "props-stills", "still-00554.png");
    mkdirSync(path.dirname(thumb), { recursive: true });
    writeFileSync(thumb, PNG);
    return { job, p, body: { outputs: [], result: { renders: { video: raw, thumb } } } };
  }

  it("copies the video, checks it with ffprobe, writes the manifest and the videos row under the case topic", async () => {
    const { job, body } = videoJob();
    const r = (await fin.finalize(job, body)) as { video_id: string };
    const out = path.join(dir, "renders", "gen", "ci-ddddddd4", job.id);
    for (const f of ["video.mp4", "manifest.json", "timing-plan.json", "TIMING.md", "thumb.png", "props.json"]) expect(existsSync(path.join(out, f)), f).toBe(true);
    const m = JSON.parse(readFileSync(path.join(out, "manifest.json"), "utf8"));
    expect(m.checks).toMatchObject({ width: 1080, height: 1920, fps: 30, video_codec: "h264", audio_codec: "none" });
    expect(m.checks.duration_s).toBeGreaterThanOrEqual(30);
    expect(m.composition).toBe("DataRace-vertical");
    expect(m.data.data_provenance).toBe("real");
    const row = db.$client.prepare("select * from videos where id = ?").get(r.video_id) as Record<string, unknown>;
    expect(row).toMatchObject({ topic_key: "energy", topic_source: "case.topic", case_id: "ci-ddddddd4", generation_job_id: job.id, format: "vertical", path: `renders/gen/ci-ddddddd4/${job.id}/video.mp4` });
  }, 60_000);

  it("the manifest and the videos row carry the job's total cost; an unknown cost stays null", async () => {
    const { job, body } = videoJob();
    queue.addSpend(job.id, { cost_usd: 0.4, turns: 10 });
    queue.addSpend(job.id, { cost_usd: 0.2, turns: 7 });
    const total = queue.spend(job.id);
    const r = (await fin.finalize(job, { ...body, result: { ...body.result, cost_usd: total.cost_usd, turns: total.turns } })) as { video_id: string };
    const m = JSON.parse(readFileSync(path.join(dir, "renders", "gen", "ci-ddddddd4", job.id, "manifest.json"), "utf8"));
    expect(m).toMatchObject({ turns: 17 });
    expect(m.cost_usd).toBeCloseTo(0.6, 6);
    const row = db.$client.prepare("select cost_usd from videos where id = ?").get(r.video_id) as { cost_usd: number | null };
    expect(row.cost_usd).toBeCloseTo(0.6, 6);
  }, 60_000);

  it("a video without any reported cost records null, not 0", async () => {
    const { job, body } = videoJob();
    const r = (await fin.finalize(job, body)) as { video_id: string };
    const m = JSON.parse(readFileSync(path.join(dir, "renders", "gen", "ci-ddddddd4", job.id, "manifest.json"), "utf8"));
    expect(m.cost_usd).toBeNull();
    expect((db.$client.prepare("select cost_usd from videos where id = ?").get(r.video_id) as { cost_usd: number | null }).cost_usd).toBeNull();
  }, 60_000);

  it("finalize twice gives one videos row", async () => {
    const { job, body } = videoJob();
    const a = (await fin.finalize(job, body)) as { video_id: string };
    const b = (await fin.finalize(job, body)) as { video_id: string };
    expect(b.video_id).toBe(a.video_id);
    expect((db.$client.prepare("select count(*) n from videos").get() as { n: number }).n).toBe(1);
  }, 60_000);

  it("a render of the wrong size fails the ffprobe checks and records nothing", async () => {
    const wrong = videoJob("540x960", 41);
    await expect(fin.finalize(wrong.job, wrong.body)).rejects.toThrow(/resolution 540x960/);
    expect((db.$client.prepare("select count(*) n from videos").get() as { n: number }).n).toBe(0);
  }, 60_000);

  it("a video needs real data: sample props are refused before anything is copied", async () => {
    const { job, p, body } = videoJob();
    const f = path.join(p.out, "props.json");
    writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), data_provenance: "sample" }));
    await expect(fin.finalize(job, body)).rejects.toThrow(/needs data_provenance "real"/);
  }, 60_000);

  describe("the data gate: fact verification of a real video", () => {
    type EditableProps = { entities: [{ value_ref: string }, { value_ref: string }]; events: [{ facts: [{ text: string; ref: string }] }]; spotlight: { facts: [{ value_text: string }] } };
    const editProps = (p: ReturnType<typeof videoJob>["p"], fn: (o: EditableProps) => void) => {
      const f = path.join(p.out, "props.json");
      const o = JSON.parse(readFileSync(f, "utf8"));
      fn(o);
      writeFileSync(f, JSON.stringify(o));
    };
    const none = (job: ReturnType<typeof videoJob>["job"]) => (db.$client.prepare("select count(*) n from videos where generation_job_id = ?").get(job.id) as { n: number }).n;

    it("resolves every ref (entities, events, spotlight) and records the video", async () => {
      const v = videoJob();
      const seen: string[][] = [];
      const spy = new GenerationFinalizer({ db, board, dataRoot: dir, boardRoot: path.join(dir, "board"), facts: async (refs) => {
        seen.push(refs);
        return snapshotFacts(refs);
      } });
      await expect(spy.finalize(v.job, v.body)).resolves.toMatchObject({ video_id: expect.any(String) });
      expect(seen[0]).toHaveLength(19); // 22 refs, three of them shared (an entity's peak season is also a card or the spotlight)
      expect(seen[0]?.every((r) => r.startsWith("f1db:driver:"))).toBe(true);
    }, 60_000);

    it("an unresolved ref is refused, naming it, and records nothing", async () => {
      const v = videoJob();
      editProps(v.p, (o) => { o.events[0].facts[0].ref = "f1db:driver:nobody:season:1999#wins"; });
      await expect(fin.finalize(v.job, v.body)).rejects.toThrow(/fact verification failed.*unknown fact f1db:driver:nobody:season:1999#wins/);
      expect(none(v.job)).toBe(0);
    }, 60_000);

    it("a figure in an event card that differs from its fact is refused", async () => {
      const a = videoJob();
      editProps(a.p, (o) => { o.events[0].facts[0].text = "14 wins in 2004"; });
      await expect(fin.finalize(a.job, a.body)).rejects.toThrow(/'14' in "14 wins in 2004" != fact .*#wins = 13/);
    }, 60_000);

    it("a spotlight value that differs from its fact is refused", async () => {
      const b = videoJob();
      editProps(b.p, (o) => { o.spotlight.facts[0].value_text = "999"; });
      await expect(fin.finalize(b.job, b.body)).rejects.toThrow(/spotlight .*'999'/);
    }, 60_000);

    it("an entity ref whose value is not in its values series is refused", async () => {
      const v = videoJob();
      editProps(v.p, (o) => { o.entities[0].value_ref = o.entities[1].value_ref; });
      await expect(fin.finalize(v.job, v.body)).rejects.toThrow(/does not appear in its values series/);
    }, 60_000);

    it("a sample: ref under real is refused without asking the warehouse", async () => {
      const v = videoJob();
      editProps(v.p, (o) => { o.entities[0].value_ref = "sample:app:ember#users"; });
      await expect(fin.finalize(v.job, v.body)).rejects.toThrow(/sample: namespace is invented data/);
    }, 60_000);

    it("no resolver fails closed with a named error", async () => {
      const v = videoJob();
      const bare = new GenerationFinalizer({ db, board, dataRoot: dir, boardRoot: path.join(dir, "board") });
      await expect(bare.finalize(v.job, v.body)).rejects.toThrow(/fact verification unavailable: no fact resolver/);
      expect(none(v.job)).toBe(0);
    }, 60_000);

    it("a resolver that throws is a named unavailable error, not a pass", async () => {
      const v = videoJob();
      const down = new GenerationFinalizer({ db, board, dataRoot: dir, boardRoot: path.join(dir, "board"), facts: async () => { throw new Error("warehouse closed"); } });
      await expect(down.finalize(v.job, v.body)).rejects.toThrow(/fact verification unavailable.*warehouse closed/);
    }, 60_000);

    it("visual_options with sample provenance stays allowed without a resolver", async () => {
      const bare = new GenerationFinalizer({ db, board, dataRoot: dir, boardRoot: path.join(dir, "board") });
      const { job, body } = runningJob();
      await expect(bare.finalize(job, body)).resolves.toHaveProperty("board_item_ids");
    });
  });
});
