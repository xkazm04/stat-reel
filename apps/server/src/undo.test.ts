import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type AppDeps, buildApp } from "./app";
import { BoardService } from "./board";
import { openDb } from "./db";
import { EventBus } from "./events";
import type { GenerationGuard } from "./generation-guard";
import { CaseIdeas, type NewCaseIdea } from "./library";

const idea: NewCaseIdea = {
  title: "The wins record changes hands", pitch: "Who held the all-time wins record", domain: "f1", arc: "six holders in 75 years",
  insight: "Records last longer each time", why_lasts: "Fangio leads until 1957, Clark passes him in 1968, Prost collapses in 1987",
  tension: { expectation: "records fall often", reality: "only six holders since 1950", strength: "strong" },
  beats: [{ at: "1957", what: "a" }, { at: "1968", what: "b" }, { at: "1987", what: "c" }, { at: "2001", what: "d" }],
  timeline: { unit: "race", from: 1, to: 1150, years_from: 1950, years_to: 2026 },
  sources: [{ name: "F1DB", url: "https://github.com/f1db/f1db", license: "CC-BY-4.0" }], data_status: "staged",
};

const setup = (generation?: GenerationGuard) => {
  const root = mkdtempSync(path.join(tmpdir(), "undo-"));
  mkdirSync(path.join(root, "items"), { recursive: true });
  writeFileSync(path.join(root, "items", "a.png"), "png");
  const db = openDb(":memory:");
  const board = new BoardService(db, root);
  const cases = new CaseIdeas(db);
  const app = buildApp({ db, board, cases, bus: new EventBus(), generationGuard: generation } as unknown as AppDeps);
  const item = board.create({ image: "items/a.png", title: "t", use_case_id: "x", style: { id: "s", name: "S" } });
  return { app, board, cases, item, c: cases.create(idea) };
};
const del = (app: ReturnType<typeof buildApp>, url: string) => app.request(url, { method: "DELETE" });

describe("undo a decision (D.1)", () => {
  it("DELETE /api/board/:id/decision puts a rejected item back to pending and clears decision, note, decided_at", async () => {
    const { app, board, item } = setup();
    board.decide(item.id, "reject_style", "too cold");
    const r = await del(app, `/api/board/${item.id}/decision`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: "pending", decision: null, note: null, decided_at: null });
    expect(board.feedback()).toEqual([]);
  });

  it("DELETE /api/cases/:id/decision does the same for a case idea", async () => {
    const { app, cases, c } = setup();
    cases.decide(c.id, "reject_short", "x");
    const r = await del(app, `/api/cases/${c.id}/decision`);
    expect(await r.json()).toMatchObject({ status: "pending", decision: null, note: null, decided_at: null });
  });

  it("404 for unknown ids, 409 (archived) for archived ones", async () => {
    const { app, board, item } = setup();
    expect((await del(app, "/api/board/nope/decision")).status).toBe(404);
    expect((await del(app, "/api/cases/nope/decision")).status).toBe(404);
    board.archive([item.id], "off brief");
    expect((await del(app, `/api/board/${item.id}/decision`)).status).toBe(409);
  });

  it("409 while a generation job for the item or case is running; queued jobs are cancelled first", async () => {
    const cancelled: string[] = [];
    let running = true;
    const guard: GenerationGuard = {
      hasRunning: () => running,
      cancelQueued: (t) => (cancelled.push(`${t.kind}:${t.id}`), 1),
    };
    const { app, board, cases, item, c } = setup(guard);
    board.decide(item.id, "accept");
    cases.decide(c.id, "accept");
    expect((await del(app, `/api/board/${item.id}/decision`)).status).toBe(409);
    expect((await del(app, `/api/cases/${c.id}/decision`)).status).toBe(409);
    expect(board.get(item.id)?.status).toBe("accepted");
    running = false;
    expect((await del(app, `/api/board/${item.id}/decision`)).status).toBe(200);
    expect((await del(app, `/api/cases/${c.id}/decision`)).status).toBe(200);
    expect(cancelled).toEqual([`item:${item.id}`, `case:${c.id}`]);
  });

  it("with no queue wired (default) undo is never blocked", async () => {
    const { app, board, item } = setup();
    board.decide(item.id, "accept");
    expect((await del(app, `/api/board/${item.id}/decision`)).status).toBe(200);
  });
});
