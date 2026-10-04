/**
 * The row schemas in @statreel/schemas are the single source for what the studio sees of `jobs` and
 * `generation_jobs`. Rows come from the real services over a real openDb (DDL + addColumn migrations), and the
 * column set is compared both ways, so a column added to one side only fails here instead of in the studio.
 */
import { GenerationJobSchema, JobRowSchema } from "@statreel/schemas";
import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { EventBus } from "./events";
import { GenerationQueue } from "./generation/queue";
import { JobRunner } from "./jobs";

const columns = (db: ReturnType<typeof openDb>, table: string) =>
  (db.$client.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name).sort();
const keysOf = (shape: object) => Object.keys(shape).sort();

describe("row schemas against the real DDL", () => {
  it("jobs: a row enqueued through JobRunner parses, and the column sets match both ways", () => {
    const db = openDb(":memory:");
    const runner = new JobRunner(db, new EventBus());
    const id = runner.enqueue("render", { project: "p" }, "pr-1");
    const row = runner.get(id);
    expect(row).toBeDefined();
    expect(JobRowSchema.parse(row)).toEqual(row);
    expect(keysOf(JobRowSchema.shape)).toEqual(columns(db, "jobs"));
  });

  it("generation_jobs: a queued row and a row carrying spend parse, and the column sets match both ways", () => {
    const db = openDb(":memory:");
    const queue = new GenerationQueue(db);
    const { job } = queue.enqueue({ type: "generate_video", case_id: "ci-0123abcd", board_item_id: "bd-0123abcd" });
    expect(GenerationJobSchema.parse(job)).toEqual(job);
    expect(job.cost_usd).toBeNull();

    db.$client
      .prepare("update generation_jobs set cost_usd = 0.42, turns = 7, status = 'done' where id = ?")
      .run(job.id);
    const spent = queue.get(job.id);
    expect(GenerationJobSchema.parse(spent)).toMatchObject({ cost_usd: 0.42, turns: 7 });

    expect(keysOf(GenerationJobSchema.shape)).toEqual(columns(db, "generation_jobs"));
  });

  it("a required field missing from a row is refused (null columns must stay nullable, not optional)", () => {
    const db = openDb(":memory:");
    const { job } = new GenerationQueue(db).enqueue({ type: "visual_options", case_id: "ci-0123abcd" });
    const { cost_usd: _drop, ...without } = job;
    expect(GenerationJobSchema.safeParse(without).success).toBe(false);
  });
});
