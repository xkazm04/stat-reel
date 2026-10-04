/**
 * The Board's generation flow in fake mode (GEN_MODE=fake; ADR 010, T10 + T11). The worker process runs the
 * fixture outputs for real: the server renders the 45 % stills and the video through the render lane.
 *
 *   1. accept a case idea -> Queued/Running -> "3 visuals ready" -> 3 tiles labelled SAMPLE DATA
 *      -> accepting one archives its siblings, undo restores them -> rejecting a tile hides it
 *      -> the case's data is a new source, so the accepted design is "Data blocked" and no video job exists
 *   2. a staged case with an approved source and a real visual: accepting the design runs the gate, the worker
 *      renders the video, a videos row appears and the topics heatmap shows cell 1 as "today"
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { e2eModes } from "../scripts/e2e-preflight.mjs";

const API = `http://127.0.0.1:${process.env.E2E_API_PORT ?? "8787"}`;
// fake-mode only: a live worker would hand these jobs to the real Claude CLI
test.skip(!!process.env.E2E_LIVE || e2eModes().GEN_MODE !== "fake", "fake-mode generation test");
test.describe.configure({ mode: "serial" });

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");

const caseBody = (title: string, o: { data_status: string; sources: object[]; topic?: string }) => ({
  title, pitch: "A decade-long e2e probe", domain: "f1", arc: "rise and fall", insight: "probe", why_lasts: "probe",
  tension: { expectation: "steady", reality: "volatile", strength: "moderate" },
  beats: [1, 2, 3, 4].map((n) => ({ at: `20${10 + n}`, what: `turn ${n}` })),
  timeline: { unit: "year", from: 2010, to: 2024, years_from: 2010, years_to: 2024 },
  data_status: o.data_status, sources: o.sources, ...(o.topic ? { topic: o.topic } : {}),
});

let caseId = "";
let variantIds: string[] = [];

test("accept a case idea: Queued/Running, then 3 visuals ready, then 3 tiles labelled SAMPLE DATA", async ({ page, request }) => {
  test.setTimeout(10 * 60_000);
  await expect.poll(async () => (await (await request.get(`${API}/api/generation/worker`)).json()).online, { timeout: 30_000 }).toBe(true);
  const idea = await (await request.post(`${API}/api/cases`, { data: caseBody("e2e visuals probe", { data_status: "new-source", sources: [{ name: "U.S. EIA", url: "https://www.eia.gov/", license: "public domain" }] }) })).json();
  caseId = idea.id;

  await page.goto("/board?tab=cases");
  await page.getByTestId(`title-${caseId}`).click();
  await page.getByTestId(`idea-${caseId}-accept`).click();

  const badge = page.getByTestId(`job-badge-${caseId}`);
  await expect(badge).toContainText(/Queued|Running/);
  await expect(page.getByTestId("queue-strip")).toContainText(/Generating|queued/);
  await expect(badge).toContainText("3 visuals ready", { timeout: 8 * 60_000 });

  const board = await (await request.get(`${API}/api/board`)).json();
  const items = board.items.filter((i: { case_idea_id: string | null }) => i.case_idea_id === caseId) as { id: string; source: Record<string, unknown>; image: string; width: number; height: number }[];
  expect(items).toHaveLength(3);
  variantIds = items.map((i) => i.id);
  for (const i of items) {
    expect(i.source).toMatchObject({ skill: "generation", data_provenance: "sample" });
    expect([i.width, i.height]).toEqual([1080, 1920]);
    expect(existsSync(path.resolve("data", "board", i.image))).toBe(true);
  }
  // the still is a real render of the sample race (a 1x1 placeholder would be a few dozen bytes)
  expect(readFileSync(path.resolve("data", "board", items[0]!.image)).length).toBeGreaterThan(20_000);

  await page.goto("/board");
  for (const id of variantIds) {
    await expect(page.getByTestId(`board-item-${id}`)).toBeVisible();
    await expect(page.getByTestId(`sample-label-${id}`)).toContainText("SAMPLE DATA");
  }
});

test("accepting one variant archives the other two, undo restores them, rejecting a tile hides it", async ({ page, request }) => {
  const [v1, v2, v3] = variantIds as [string, string, string];
  await page.goto("/board");
  await page.getByTestId(`board-item-${v2}`).click();
  await page.getByTestId("accept").click();
  await page.keyboard.press("Escape");
  // the Board is pending-first: the accepted design and its archived siblings leave the grid
  await expect(page.getByTestId(`board-item-${v2}`)).toBeHidden();
  await expect(page.getByTestId(`board-item-${v1}`)).toBeHidden();
  await expect(page.getByTestId(`board-item-${v3}`)).toBeHidden();
  const archived = await (await request.get(`${API}/api/board?status=archived`)).json();
  expect(archived.items.filter((i: { decision: string }) => i.decision === "superseded").map((i: { id: string }) => i.id).sort()).toEqual([v1, v3].sort());

  // the case's data is a new source: the accepted design is data-blocked, with the reason, and no video job exists
  const jobs = await (await request.get(`${API}/api/generation/jobs?case_id=${caseId}`)).json();
  expect(jobs.jobs.map((j: { type: string }) => j.type)).toEqual(["visual_options"]);
  await page.goto("/board?tab=cases");
  const badge = page.getByTestId(`job-badge-${caseId}`);
  await expect(badge).toContainText("Data blocked");
  await expect(page.getByTestId(`job-detail-${caseId}`)).toContainText(/new source/i);
  await expect(page.getByTestId(`job-sources-${caseId}`)).toHaveAttribute("href", "/sources");

  // undo the accept from the accepted design's gate: both siblings are back
  await page.goto("/board");
  await page.getByTestId("board-filter-accepted").click();
  await page.getByTestId(`board-item-${v2}`).click();
  await page.getByTestId("undo-decision").click();
  await expect.poll(async () => (await (await request.get(`${API}/api/board/${v2}`)).json()).decision).toBeNull();
  await page.keyboard.press("Escape");
  await page.getByTestId("board-filter-pending").click();
  await expect(page.getByTestId(`board-item-${v1}`)).toBeVisible();
  await expect(page.getByTestId(`board-item-${v3}`)).toBeVisible();

  // rejecting a tile hides it
  await page.getByTestId(`board-item-${v1}`).click();
  await page.getByTestId("reject-style").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId(`board-item-${v1}`)).toBeHidden();
  expect((await (await request.get(`${API}/api/board/${v1}`)).json()).decision).toBe("reject_style");
});

test("a passing case: accepting its real visual runs the gate, renders the video and fills heatmap cell 1 with today", async ({ page, request }) => {
  test.setTimeout(20 * 60_000);
  const idea = await (await request.post(`${API}/api/cases`, { data: caseBody("e2e video probe", { data_status: "staged", topic: "energy", sources: [{ name: "F1DB", url: "https://github.com/f1db/f1db", license: "CC-BY-4.0", registry_id: "f1db" }] }) })).json();
  const accepted = await (await request.post(`${API}/api/cases/${idea.id}/decision`, { data: { decision: "accept" } })).json();
  expect(accepted.job).toMatchObject({ type: "visual_options", status: "queued" });
  // this test brings its own design, so the visuals job is not needed
  await request.post(`${API}/api/generation/jobs/${accepted.job.id}/cancel`);

  mkdirSync(path.resolve("data", "board", "items"), { recursive: true });
  writeFileSync(path.resolve("data", "board", "items", "e2e-gen-real.png"), PNG_1X1);
  const item = await (await request.post(`${API}/api/board`, { data: {
    image: "items/e2e-gen-real.png", width: 1, height: 1, title: "e2e real design", proposed_case: { name: "e2e video probe", pitch: "p" }, case_idea_id: idea.id,
    style: { id: "e2e-real", name: "e2e real" }, source: { skill: "e2e", job_id: "gj-e2e00001", variant: 1, data_provenance: "real" },
  } })).json();
  expect(item.case_idea_id).toBe(idea.id);

  const decided = await (await request.post(`${API}/api/board/${item.id}/decision`, { data: { decision: "accept" } })).json();
  expect(decided.gate).toBeUndefined();
  expect(decided.job).toMatchObject({ type: "generate_video", case_id: idea.id, board_item_id: item.id });
  // a second accept does not queue a second video
  const again = await (await request.post(`${API}/api/board/${item.id}/decision`, { data: { decision: "accept" } })).json();
  expect(again.job.id).toBe(decided.job.id);

  await expect.poll(async () => (await (await request.get(`${API}/api/generation/jobs/${decided.job.id}`)).json()).job.status, { timeout: 18 * 60_000, intervals: [2000] }).toBe("done");
  const detail = await (await request.get(`${API}/api/generation/jobs/${decided.job.id}`)).json();
  expect(detail.stage).toBe("video_ready");
  const result = JSON.parse(detail.job.result_json);

  const dir = path.resolve("data", result.path.replace(/\/video\.mp4$/, ""));
  for (const f of ["video.mp4", "manifest.json", "timing-plan.json", "TIMING.md", "thumb.png"]) expect(existsSync(path.join(dir, f)), f).toBe(true);
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path.join(dir, "video.mp4")], { encoding: "utf8" }));
  const v = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  expect([v.width, v.height, v.codec_name, v.r_frame_rate]).toEqual([1080, 1920, "h264", "30/1"]);
  const duration = Number(probe.format.duration);
  expect(duration).toBeGreaterThanOrEqual(30);
  expect(duration).toBeLessThanOrEqual(90);
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  expect(manifest.checks).toMatchObject({ width: 1080, height: 1920, fps: 30, video_codec: "h264" });
  expect(manifest.composition).toBe("DataRace-vertical");

  const h = await (await request.get(`${API}/api/heatmap/topics`)).json();
  const energy = h.topics.find((t: { key: string }) => t.key === "energy");
  expect(energy.videos).toHaveLength(1);
  expect(energy.videos[0]).toMatchObject({ n: 1, bucket: "fresh", age_days: 0, case_id: idea.id });

  await page.goto("/heatmap");
  await expect(page.getByTestId("topic-row-energy")).toBeVisible();
  await expect(page.getByTestId("topic-cell-energy-1")).toContainText(/today/i);
  await page.goto("/board?tab=cases");
  await expect(page.getByTestId(`job-badge-${idea.id}`)).toContainText("Video ready");
});
