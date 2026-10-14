import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppDeps, buildApp } from "./app";
import { BoardService } from "./board";
import { type Db, openDb } from "./db";
import { EventBus } from "./events";
import { queueGuard } from "./generation-guard";
import { GenerationQueue } from "./generation/queue";
import type { GateVerdict } from "./generation/routes";
import { CaseIdeas, type NewCaseIdea } from "./library";
import { JobRunner } from "./jobs";

const idea: NewCaseIdea = {
  title: "The wins record changes hands", pitch: "Who held the all-time wins record", domain: "f1", arc: "six holders in 75 years",
  insight: "Records last longer each time", why_lasts: "Fangio leads until 1957, Clark passes him in 1968, Prost collapses in 1987",
  tension: { expectation: "records fall often", reality: "only six holders since 1950", strength: "strong", counter: { provenance: "constructed", case: "records fall often because rules change" } },
  beats: [{ at: "1957", what: "a" }, { at: "1968", what: "b" }, { at: "1987", what: "c" }, { at: "2001", what: "d" }],
  timeline: { unit: "race", from: 1, to: 1150, years_from: 1950, years_to: 2026 },
  sources: [{ name: "F1DB", url: "https://github.com/f1db/f1db", license: "CC-BY-4.0" }], data_status: "staged",
};

let dir: string;
let db: Db;
let board: BoardService;
let cases: CaseIdeas;
let queue: GenerationQueue;
let gate: GateVerdict;
let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "statreel-appgen-"));
  mkdirSync(path.join(dir, "items"), { recursive: true });
  writeFileSync(path.join(dir, "items", "a.png"), "png");
  db = openDb(path.join(dir, "app.sqlite"));
  board = new BoardService(db, dir);
  cases = new CaseIdeas(db);
  queue = new GenerationQueue(db);
  gate = { ok: true };
  const bus = new EventBus();
  const runner = new JobRunner(db, bus);
  app = buildApp({
    db, board, cases, bus, runner, generationGuard: queueGuard(queue),
    generation: { db, queue, bus, runner, dataRoot: dir, gate: () => gate },
  } as unknown as AppDeps);
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = (method: string, url: string, body?: unknown) =>
  app.request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
// biome-ignore lint/suspicious/noExplicitAny: loosely typed JSON bodies in assertions
const j = async (r: Response) => (await r.json()) as Record<string, any>;
const accept = (id: string) => call("POST", `/api/cases/${id}/decision`, { decision: "accept" });

/** Three pending variants of one visuals job, as finalize leaves them. */
function variants(caseId: string, jobId = "gj-00000001") {
  return [1, 2, 3].map((n) =>
    board.create({ image: "items/a.png", title: "t", proposed_case: { name: "t", pitch: "p" }, case_idea_id: caseId, style: { id: `gen-${jobId}-v${n}`, name: `S${n}` }, source: { skill: "generation", job_id: jobId, variant: n } }),
  );
}

describe("accepting a case (D.2 transition 1)", () => {
  it("returns the idea and the visual_options job; posting again returns the same job", async () => {
    const c = cases.create(idea);
    const a = await j(await accept(c.id));
    expect(a.idea).toMatchObject({ id: c.id, status: "accepted" });
    expect(a.job).toMatchObject({ type: "visual_options", case_id: c.id, status: "queued" });
    const b = await j(await accept(c.id));
    expect(b.job.id).toBe(a.job.id);
    expect(queue.list()).toHaveLength(1);
  });

  it("rejecting is not a job", async () => {
    const c = cases.create(idea);
    const r = await j(await call("POST", `/api/cases/${c.id}/decision`, { decision: "reject_short" }));
    expect(r.job).toBeUndefined();
    expect(queue.list()).toHaveLength(0);
  });

  it("rejecting an accepted case cancels its job (queued here)", async () => {
    const c = cases.create(idea);
    const a = await j(await accept(c.id));
    await call("POST", `/api/cases/${c.id}/decision`, { decision: "reject_no_insight" });
    expect(queue.get(a.job.id)?.status).toBe("cancelled");
  });

  it("a running job gets a cancel request instead", async () => {
    const c = cases.create(idea);
    await accept(c.id);
    const running = queue.claim()!;
    await call("POST", `/api/cases/${c.id}/decision`, { decision: "reject_duplicate" });
    expect(queue.get(running.id)?.cancel_requested_at).toBeTruthy();
  });

  it("accept, undo, accept again does not generate a second set (the done job is handed back)", async () => {
    const c = cases.create(idea);
    const a = await j(await accept(c.id));
    queue.claim();
    queue.finish(a.job.id, "done", { result: {} });
    await call("DELETE", `/api/cases/${c.id}/decision`);
    const again = await j(await accept(c.id));
    expect(again.job.id).toBe(a.job.id);
    expect(queue.list()).toHaveLength(1);
  });
});

describe("accepting a variant (D.2 transitions 3 and 5)", () => {
  it("archives the two siblings, reports archived_ids, and undo restores exactly them", async () => {
    const c = cases.create(idea);
    await accept(c.id);
    const [v1, v2, v3] = variants(c.id);
    const r = await j(await call("POST", `/api/board/${v2!.id}/decision`, { decision: "accept" }));
    expect(r.item).toMatchObject({ id: v2!.id, status: "accepted", image_url: expect.stringContaining("/files/board/") });
    expect(r.archived_ids.sort()).toEqual([v1!.id, v3!.id].sort());
    expect(board.get(v1!.id)).toMatchObject({ status: "archived", decision: "superseded", note: null, archive_reason: `superseded by ${v2!.id}` });
    expect((await j(await call("GET", "/api/board"))).items.map((i: { id: string }) => i.id)).toEqual([v2!.id]);

    const undo = await j(await call("DELETE", `/api/board/${v2!.id}/decision`));
    expect(undo).toMatchObject({ status: "pending" });
    expect(undo.restored_ids.sort()).toEqual([v1!.id, v3!.id].sort());
    expect(board.get(v3!.id)).toMatchObject({ status: "pending", decision: null, note: null });
  });

  it("a decision POSTed to an archived sibling is a 409 and does not strand the superseded marker", async () => {
    const c = cases.create(idea);
    await accept(c.id);
    const [i1, i2] = variants(c.id).map((v) => v.id) as [string, string];
    await call("POST", `/api/board/${i2}/decision`, { decision: "accept" });
    const r = await call("POST", `/api/board/${i1}/decision`, { decision: "reject_style" });
    expect(r.status).toBe(409);
    expect(board.get(i1)).toMatchObject({ status: "archived", decision: "superseded" });
  });

  it("restoring a superseded sibling by hand returns it to pending; undoing the winner then leaves it alone", async () => {
    const c = cases.create(idea);
    await accept(c.id);
    const [i1, i2, i3] = variants(c.id).map((v) => v.id) as [string, string, string];
    await call("POST", `/api/board/${i2}/decision`, { decision: "accept" });
    const r = await call("POST", `/api/board/${i1}/restore`);
    expect(r.status).toBe(200);
    expect(board.get(i1)).toMatchObject({ status: "pending", decision: null, archive_reason: null });
    const undo = await j(await call("DELETE", `/api/board/${i2}/decision`));
    expect(undo.restored_ids).toEqual([i3]);
    expect((await call("POST", `/api/board/${i2}/restore`)).status).toBe(409);
    expect((await call("POST", "/api/board/bd-nope/restore")).status).toBe(404);
  });

  it("an archived sibling of another job or another case is left alone", async () => {
    const c = cases.create(idea);
    await accept(c.id);
    const [a] = variants(c.id);
    const [other] = variants(c.id, "gj-00000002");
    await call("POST", `/api/board/${a!.id}/decision`, { decision: "accept" });
    expect(board.get(other!.id)?.status).toBe("pending");
  });

  it("with the gate open it enqueues generate_video for the accepted visual", async () => {
    const c = cases.create(idea);
    await accept(c.id);
    const [v1] = variants(c.id);
    const r = await j(await call("POST", `/api/board/${v1!.id}/decision`, { decision: "accept" }));
    expect(r.job).toMatchObject({ type: "generate_video", case_id: c.id, board_item_id: v1!.id });
    expect(r.gate).toBeUndefined();
  });

  it("while data is gated it answers gate.ok=false and creates no job", async () => {
    gate = { ok: false, reason: "source 'X' is not in the registry" };
    const c = cases.create(idea);
    await accept(c.id);
    const [v1] = variants(c.id);
    const r = await j(await call("POST", `/api/board/${v1!.id}/decision`, { decision: "accept" }));
    expect(r.gate).toEqual({ ok: false, reason: "source 'X' is not in the registry" });
    expect(r.job).toBeUndefined();
    expect(queue.list().filter((x) => x.type === "generate_video")).toHaveLength(0);
  });

  it("a legacy item (no case idea) never enqueues", async () => {
    const legacy = board.create({ image: "items/a.png", title: "t", use_case_id: "era-adjusted-rankings" });
    const r = await j(await call("POST", `/api/board/${legacy.id}/decision`, { decision: "accept" }));
    expect(r.item.status).toBe("accepted");
    expect(r.job).toBeUndefined();
    expect(r.gate).toBeUndefined();
  });

  it("variants of a case that is not accepted do not enqueue", async () => {
    const c = cases.create(idea);
    const [v1] = variants(c.id);
    const r = await j(await call("POST", `/api/board/${v1!.id}/decision`, { decision: "accept" }));
    expect(r.job).toBeUndefined();
  });

  it("rejecting a tile hides it; rejecting the accepted variant brings its siblings back", async () => {
    const c = cases.create(idea);
    await accept(c.id);
    const [v1, v2, v3] = variants(c.id);
    await call("POST", `/api/board/${v1!.id}/decision`, { decision: "accept" });
    const r = await j(await call("POST", `/api/board/${v1!.id}/decision`, { decision: "reject_style" }));
    expect(r.restored_ids.sort()).toEqual([v2!.id, v3!.id].sort());
    expect(board.get(v2!.id)?.status).toBe("pending");
  });
});

describe("the generation overview", () => {
  it("derives the stage of each accepted case", async () => {
    const c = cases.create(idea);
    await accept(c.id);
    const o1 = await j(await call("GET", "/api/generation/overview"));
    expect(o1.cases[c.id]).toMatchObject({ stage: "visuals_queued" });
    expect(o1.worker).toMatchObject({ queued: 1 });
    queue.claim();
    expect((await j(await call("GET", "/api/generation/overview"))).cases[c.id].stage).toBe("visuals_running");
    expect((await j(await call("GET", "/api/generation/overview"))).running.title).toBe(idea.title);
  });

  it("is visuals_ready with pending variants and data_blocked after accepting one while gated", async () => {
    gate = { ok: false, reason: "no source" };
    const c = cases.create(idea);
    await accept(c.id);
    queue.claim();
    queue.finish(queue.list()[0]!.id, "done", { result: {} });
    const [v1] = variants(c.id);
    expect((await j(await call("GET", "/api/generation/overview"))).cases[c.id].stage).toBe("visuals_ready");
    await call("POST", `/api/board/${v1!.id}/decision`, { decision: "accept" });
    const o = await j(await call("GET", "/api/generation/overview"));
    expect(o.cases[c.id]).toMatchObject({ stage: "data_blocked", gate: { ok: false, reason: "no source" }, accepted_item_id: v1!.id });
  });
});
