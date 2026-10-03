import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sampleDataRacePeriods, sampleDataRaceValues } from "@statreel/compositions/fixture";
import { planSha256 } from "@statreel/schemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { paths as appPaths } from "../config";
import { type Db, openDb } from "../db";
import { makeGenerationMcpTools } from "./mcp-tools";
import { jobPaths } from "./paths";
import { GenerationQueue } from "./queue";
import { CASE_A, insertCase } from "./testing";
import type { AssetFetcher } from "./assets";

let dir: string;
let db: Db;
let queue: GenerationQueue;
let jobId: string;
const fixtures = path.join(appPaths.fixtures, "generation");

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "statreel-mcp-"));
  db = openDb(path.join(dir, "app.sqlite"));
  queue = new GenerationQueue(db);
  insertCase(db, CASE_A, { data_status: "staged" });
  jobId = queue.enqueue({ type: "visual_options", case_id: CASE_A }).job.id;
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const tools = () => makeGenerationMcpTools({ queue, assets: {} as AssetFetcher, dataRoot: dir });
const start = () => {
  const job = queue.claim();
  expect(job?.id).toBe(jobId);
  const p = jobPaths(jobId, dir);
  mkdirSync(p.out, { recursive: true });
  writeFileSync(p.caseJson, JSON.stringify({ title: "Case A", data_status: "staged", visual: null }));
  return p;
};
const input = () => {
  const values = sampleDataRaceValues();
  return {
    job_id: jobId,
    periods: sampleDataRacePeriods(),
    entities: Object.keys(values),
    values,
    events: [{ id: "launch", period: 57, label: "Ember ships its mobile app", dwell: 24 }],
    opts: { unit: "month", timelineFrames: 960, rankSmooth: 1 },
  };
};

describe("generation MCP tools", () => {
  it("every tool refuses a job that is not running", async () => {
    const t = tools();
    expect(await t.get_generation_context({ job_id: jobId })).toMatchObject({ error: expect.stringMatching(/not running/) });
    expect(await t.compute_timing_plan({ job_id: jobId })).toMatchObject({ ok: false });
    expect(await t.validate_generation_output({ job_id: jobId })).toMatchObject({ error: expect.stringMatching(/not running/) });
  });

  it("get_generation_context returns the case, the props JSON Schema and the rules", async () => {
    start();
    const c = (await tools().get_generation_context({ job_id: jobId })) as { case: { title: string }; props_schema: { definitions?: unknown }; rules: string[]; limits: { maxEntities: number } };
    expect(c.case.title).toBe("Case A");
    expect(JSON.stringify(c.props_schema)).toContain("timing_plan_sha256");
    expect(c.rules.join("\n")).toMatch(/side-reveal/);
    expect(c.limits.maxEntities).toBe(10);
  });

  it("compute_timing_plan writes out/timing-plan.json and TIMING.md and returns the sha256 of the written plan", async () => {
    const p = start();
    const r = (await tools().compute_timing_plan(input())) as { ok: boolean; sha256: string; events: { id: string; start_frame: number }[]; seconds: number };
    expect(r.ok).toBe(true);
    const plan = JSON.parse(readFileSync(path.join(p.out, "timing-plan.json"), "utf8"));
    expect(planSha256(plan)).toBe(r.sha256);
    expect(r.events[0]?.start_frame).toBe(plan.events[0].frame);
    expect(r.seconds).toBeGreaterThanOrEqual(30);
    expect(existsSync(path.join(p.out, "TIMING.md"))).toBe(true);
    expect(readFileSync(path.join(p.out, "TIMING.md"), "utf8")).toContain(r.sha256);
  });

  it("compute_timing_plan returns structured errors for bad input instead of throwing", async () => {
    start();
    const t = tools();
    expect(await t.compute_timing_plan({ job_id: jobId, periods: ["a"] })).toMatchObject({ ok: false });
    expect(await t.compute_timing_plan({ ...input(), events: [{ id: "x", period: 999, label: "x" }] })).toMatchObject({ ok: false, error: expect.stringMatching(/outside/) });
  });

  it("validate_generation_output is the finalize validation: errors verbatim, then clean on the fixture", async () => {
    const p = start();
    const t = tools();
    const empty = (await t.validate_generation_output({ job_id: jobId })) as { ok: boolean; errors: string[] };
    expect(empty.ok).toBe(false);
    expect(empty.errors.join("\n")).toMatch(/missing output: out\/variants\/v1\.props\.json/);
    cpSync(path.join(fixtures, "visual_options"), p.work, { recursive: true });
    const clean = (await t.validate_generation_output({ job_id: jobId })) as { ok: boolean; errors: string[]; outputs: string[] };
    expect(clean.errors).toEqual([]);
    expect(clean.ok).toBe(true);
  });
});
