import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BoardService } from "../board";
import { type Db, openDb } from "../db";
import { CaseIdeas } from "../library";
import { GenerationFlow } from "./flow";
import { GenerationQueue } from "./queue";
import { CASE_A, insertCase } from "./testing";

let dir: string;
let db: Db;
let queue: GenerationQueue;
let flow: GenerationFlow;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "statreel-flow-"));
  db = openDb(path.join(dir, "app.sqlite"));
  queue = new GenerationQueue(db);
  flow = new GenerationFlow({ db, board: new BoardService(db, dir), cases: new CaseIdeas(db), queue, gate: () => ({ ok: true }) });
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

/** `n` finished jobs of other cases, all newer than everything enqueued before (history only grows: no retention). */
function history(n: number): void {
  const ins = db.$client.prepare(
    `insert into generation_jobs (id, type, case_id, board_item_id, dedupe_key, status, attempts, max_attempts, params_json, log_path, output_dir, created_at, updated_at)
     values (?, 'visual_options', ?, null, ?, 'done', 1, 2, '{}', 'x', 'x', ?, ?)`,
  );
  const at = new Date(Date.now() + 60_000).toISOString();
  for (let i = 0; i < n; i++) {
    const id = `gj-${i.toString(16).padStart(8, "0")}`;
    ins.run(id, `ci-h${i.toString(16).padStart(6, "0")}`, `visual_options|ci-h${i}|-`, at, at);
  }
}

describe("GenerationFlow (SPEC D.2)", () => {
  it("rejecting an accepted case cancels its queued job, however long the job history is", () => {
    insertCase(db, CASE_A, { status: "accepted" });
    const job = queue.enqueue({ type: "visual_options", case_id: CASE_A }).job;
    queue.claim();
    queue.finish(job.id, "failed", { error: "x", error_kind: "cli_exit" });
    history(600);
    // the owner retries the old failed job: it is queued again with its ORIGINAL created_at
    queue.retry(job.id);
    flow.decideCase(CASE_A, "reject_not_interesting");
    expect(queue.get(job.id)?.status).toBe("cancelled");
  });

  it("rejecting a case with a running job requests its cancel", () => {
    insertCase(db, CASE_A, { status: "accepted" });
    const job = queue.enqueue({ type: "visual_options", case_id: CASE_A }).job;
    queue.claim();
    history(600);
    flow.decideCase(CASE_A, "reject_not_interesting");
    expect(queue.get(job.id)?.cancel_requested_at).toBeTruthy();
  });
});
