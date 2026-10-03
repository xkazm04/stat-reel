/**
 * M1 walking skeleton, end to end (DESIGN §8). One test drives the whole flow through the UI;
 * artifacts are then asserted from disk. Replay (`pnpm e2e`): LLM + audio from fixtures, publish dry.
 * Live (`pnpm e2e:live`): real Claude CLI and ElevenLabs (budgeted, cached), publish still dry until
 * the owner creates the Google Cloud app (packages/publish/SETUP.md).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const API = `http://127.0.0.1:${process.env.E2E_API_PORT ?? "8787"}`;
const ffprobe = (file: string) =>
  JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }));

test.describe.configure({ mode: "serial" });

let projectId = "";

test("heatmap: F1 x era-adjusted is Go in monetized mode", async ({ page }) => {
  await page.goto("/heatmap");
  await page.getByTestId("mode-monetized").click();
  const cell = page.getByTestId("cell-era-adjusted-rankings-F1");
  await expect(cell).toContainText(/GO/);
  // status is never colour-only: the glyph label is text
  await expect(page.getByTestId("cell-era-adjusted-rankings-NBA")).toContainText(/BLOCKED|READY|ASK/);
});

test("create a project from the Go cell and draft it with the co-pilot", async ({ page }) => {
  await page.goto("/heatmap");
  await page.getByTestId("mode-monetized").click();
  await page.getByTestId("cell-era-adjusted-rankings-F1").click();
  await page.getByTestId("create-project").click();
  await expect(page).toHaveURL(/\/studio\/p-/);
  projectId = page.url().split("/studio/")[1]!.split(/[?#]/)[0]!;

  await page.getByTestId("draft-with-claude").click();
  const log = page.getByTestId("llm-log");
  await expect(log).toContainText("describe_views", { timeout: 240_000 });
  await expect(log).toContainText("set_props", { timeout: 240_000 });
  await expect(log).toContainText("write_script", { timeout: 240_000 });

  const detail = await (await page.request.get(`${API}/api/projects/${projectId}`)).json();
  expect(detail.props?.props?.scenes?.[0]?.kind).toBe("hook");
  expect(detail.script?.version).toBeGreaterThanOrEqual(1);
  expect(detail.project.status).toBe("scripted");
  await expect(page.getByTestId("player")).toBeVisible();
});

test("produce: audio -> render -> checks -> manifest -> gate allows monetized", async ({ page }) => {
  test.setTimeout(30 * 60_000);
  await page.goto(`/studio/${projectId}`);
  await page.getByTestId("produce").click();
  const verdict = page.getByTestId("policy-verdict");
  await expect(verdict).toContainText(/ALLOW/i, { timeout: 25 * 60_000 });

  const detail = await (await page.request.get(`${API}/api/projects/${projectId}`)).json();
  const render = detail.renders[0];
  const dir = path.dirname(render.path);
  const video = ffprobe(render.path);
  const v = video.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  const a = video.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
  expect([v.width, v.height, v.codec_name, a?.codec_name]).toEqual([1080, 1920, "h264", "aac"]);
  expect(v.r_frame_rate).toBe("30/1");
  const duration = Number(video.format.duration);
  expect(duration).toBeGreaterThanOrEqual(45);
  expect(duration).toBeLessThanOrEqual(75);

  const manifest = JSON.parse(readFileSync(render.manifest_path, "utf8"));
  expect(Math.abs(manifest.checks.loudness_lufs + 14)).toBeLessThanOrEqual(1);
  expect(manifest.checks.true_peak_dbtp).toBeLessThanOrEqual(-2);
  expect(manifest.checks.safe_zone_violations).toBe(0);
  expect(manifest.checks.font_fallbacks).toBe(0);
  expect(manifest.captions.burned_in).toBe(true);
  expect(manifest.captions.max_cps).toBeLessThanOrEqual(20);
  expect(manifest.data.sources.map((s: { id: string }) => s.id)).toEqual(["f1db"]);
  expect(manifest.audio.every((x: { plan_tier: string }) => x.plan_tier && x.plan_tier !== "free")).toBe(true);
  for (const f of ["captions.srt", "captions.vtt", "thumb.png", "manifest.json"]) expect(existsSync(path.join(dir, f)), f).toBe(true);
  expect(readFileSync(path.join(dir, "captions.srt"), "utf8")).toMatch(/^1\r?\n\d\d:\d\d:\d\d,\d{3} --> /);
  expect(JSON.parse(render.policy_json).allow).toBe(true);
});

test("negative gate: a non-commercial source is refused on a monetized channel", async ({ request }) => {
  const res = await request.post(`${API}/api/projects/${projectId}/policy-probe`, {
    data: { target: { platform: "youtube", monetized: true, ai_disclosure: true }, with_source: { id: "openf1", license_class: "non_commercial", verdict: "non_commercial" } },
  });
  const verdict = await res.json();
  expect(verdict.allow).toBe(false);
  expect(verdict.deny).toContain("source openf1 is non_commercial: not allowed on a monetized channel");
});

test("calendar: schedule the composed video now on YouTube -> private upload (dry until the Google app exists)", async ({ page }) => {
  await page.goto("/calendar");
  await expect(page.getByTestId(`ready-${projectId}`)).toBeVisible();
  await page.getByTestId(`publish-now-${projectId}`).click();
  await expect(page.getByTestId(`slot-${projectId}`)).toContainText(/private/i, { timeout: 120_000 });
  const detail = await (await page.request.get(`${API}/api/projects/${projectId}`)).json();
  const pub = detail.publications[0];
  expect(pub.visibility).toBe("private");
  expect(pub.external_id).toBeTruthy();
  expect(detail.project.status).toBe("published");
  const cal = await (await page.request.get(`${API}/api/calendar`)).json();
  expect(cal.slots.find((s: { project_id: string }) => s.project_id === projectId).status).toBe("published");
});

test("board: the owner's gate records accept / reject style / reject case / reject both", async ({ page, request }) => {
  // a labelled e2e probe item (1x1 PNG) - the e2e app DB is fresh per run
  const dir = path.resolve("data", "board", "items");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "e2e-probe.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64"));
  const pending = await (await request.post(`${API}/api/board`, { data: {
    image: "items/e2e-probe.png", width: 1, height: 1, title: "e2e probe (not a design output)", use_case_id: "era-adjusted-rankings",
    style: { id: "e2e-probe", name: "e2e probe" }, source: { skill: "e2e" },
  } })).json();
  await page.goto("/board");
  await page.getByTestId(`board-item-${pending.id}`).click();
  await page.getByTestId("reject-style").click();
  await expect(page.getByTestId(`board-item-${pending.id}`)).toContainText(/rejected/i);
  const after = await (await request.get(`${API}/api/board/${pending.id}`)).json();
  expect(after.decision).toBe("reject_style");
});
