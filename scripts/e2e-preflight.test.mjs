import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { audioFixturesMessage, chromeCandidates, portCollisionMessage, preflightProblems, pruneCandidates, warehouseMessage, warehousePath } from "./e2e-preflight.mjs";

const run = (ts) => [`app-${ts}.sqlite`, `app-${ts}.sqlite-shm`, `app-${ts}.sqlite-wal`];

test("port collision message names the port, the likely cause and both remedies", () => {
  const m = portCollisionMessage(8787);
  assert.match(m, /port 8787 is in use \(probably your pnpm dev\)/);
  assert.match(m, /E2E_API_PORT=8797 E2E_STUDIO_PORT=5183 or stop the dev server/);
});

test("prune keeps the newest 5 runs including the current one and drops -shm/-wal with their DB", () => {
  const stamps = [1, 2, 3, 4, 5, 6, 7].map((d) => `2026-01-0${d}T00-00-00-000Z`);
  const files = ["app.sqlite", "app.sqlite-wal", "notes.txt", ...stamps.flatMap(run)];
  const doomed = pruneCandidates(files, `C:/x/data/e2e/app-${stamps[6]}.sqlite`);
  assert.deepEqual(doomed.sort(), [...run(stamps[0]), ...run(stamps[1])].sort());
});

test("prune never touches the current run even when it is not the newest, nor unrelated files", () => {
  const stamps = [1, 2, 3].map((d) => `2026-02-0${d}T00-00-00-000Z`);
  const files = ["app.sqlite", ...stamps.flatMap(run)];
  assert.deepEqual(pruneCandidates(files, `app-${stamps[0]}.sqlite`, 1), run(stamps[1]).concat(run(stamps[2])));
  assert.deepEqual(pruneCandidates(files, "app-2099.sqlite", 5), []);
});

test("preflight collects every problem, and is empty when all is well", () => {
  const ok = { portInUse: () => false, ffprobeOk: () => true, exists: () => true, candidates: ["c"], warehouse: "w", audioDir: "a", audioMode: "replay", audioFiles: () => ["x.mp3", "x.json"] };
  assert.deepEqual(preflightProblems({ apiPort: 1, studioPort: 2 }, ok), []);
  const bad = { ...ok, portInUse: (p) => p === 1, ffprobeOk: () => false, exists: (f) => f === "w", candidates: ["/x/chrome"] };
  const p = preflightProblems({ apiPort: 1, studioPort: 2 }, bad);
  assert.equal(p.length, 3);
  assert.match(p[0], /API port 1 is in use/);
  assert.match(p[1], /ffprobe not found/);
  assert.match(p[2], /Chrome not found.*\/x\/chrome/);
});

test("chrome candidates per platform", () => {
  assert.ok(chromeCandidates("win32", { PROGRAMFILES: "C:\\PF" })[0].endsWith("chrome.exe"));
  assert.match(chromeCandidates("darwin")[0], /Google Chrome\.app/);
});

test("a missing warehouse is one named problem with the build command", () => {
  const base = { portInUse: () => false, ffprobeOk: () => true, candidates: ["c"], audioDir: "a", audioMode: "replay", audioFiles: () => ["x.mp3"] };
  const p = preflightProblems({ apiPort: 1, studioPort: 2 }, { ...base, warehouse: "/d/warehouse.duckdb", exists: (f) => f === "c" });
  assert.deepEqual(p, [warehouseMessage("/d/warehouse.duckdb")]);
  assert.match(p[0], /\/d\/warehouse\.duckdb/);
  assert.match(p[0], /just ingest f1db && just transform/);
});

test("missing or mp3-less audio fixtures are named as local-only and owner-gated, not 'record them'", () => {
  const base = { portInUse: () => false, ffprobeOk: () => true, exists: () => true, candidates: ["c"], warehouse: "w", audioDir: "/e2e/fixtures/audio", audioMode: "replay" };
  for (const files of [[], ["notes.json"]]) {
    const p = preflightProblems({ apiPort: 1, studioPort: 2 }, { ...base, audioFiles: () => files });
    assert.deepEqual(p, [audioFixturesMessage("/e2e/fixtures/audio")]);
    assert.match(p[0], /\/e2e\/fixtures\/audio/);
    assert.match(p[0], /local-only by policy/);
    assert.match(p[0], /owner-gated/);
  }
});

test("live audio mode does not need replay fixtures; AUDIO_MODE unset means replay", () => {
  const base = { portInUse: () => false, ffprobeOk: () => true, exists: () => true, candidates: ["c"], warehouse: "w", audioDir: "a", audioFiles: () => [] };
  assert.deepEqual(preflightProblems({ apiPort: 1, studioPort: 2 }, { ...base, audioMode: "live" }), []);
  assert.equal(preflightProblems({ apiPort: 1, studioPort: 2 }, { ...base, audioMode: "replay" }).length, 1);
});

test("warehouse path honours STATREEL_WAREHOUSE like config.ts and defaults to data/warehouse.duckdb", () => {
  assert.equal(warehousePath({}, "/r"), path.resolve("/r", "data", "warehouse.duckdb"));
  assert.equal(warehousePath({ STATREEL_WAREHOUSE: "x/w.duckdb" }, "/r"), path.resolve("/r", "x/w.duckdb"));
});
