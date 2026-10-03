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
  fin = new GenerationFinalizer({ db, board, dataRoot: dir, boardRoot: path.join(dir, "board") });
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
