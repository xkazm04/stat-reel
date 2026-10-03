import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../db";
import { type AppEvent, EventBus } from "../events";
import { GenerationQueue } from "./queue";
import { GenerationEventsRelay } from "./relay";
import { CASE_A, CASE_B, insertCase } from "./testing";

let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "statreel-relay-"));
  db = openDb(path.join(dir, "app.sqlite"));
  insertCase(db, CASE_A);
  insertCase(db, CASE_B);
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GenerationEventsRelay", () => {
  it("turns event rows into gen.* bus events exactly once and in order", () => {
    const queue = new GenerationQueue(db);
    const bus = new EventBus();
    const seen: AppEvent[] = [];
    bus.subscribe((e) => seen.push(e));
    const relay = new GenerationEventsRelay(db, bus, 1000, true);
    const j = queue.enqueue({ type: "visual_options", case_id: CASE_A }).job;
    queue.claim();
    queue.update(j.id, { phase: "run", last_tool: "Write" });
    queue.finish(j.id, "done", { result: {} });
    expect(relay.poll()).toBe(4);
    expect(seen.map((e) => e.type)).toEqual(["gen.queued", "gen.started", "gen.progress", "gen.done"]);
    expect(seen.every((e) => e.job_id === j.id)).toBe(true);
    expect(seen[2]).toMatchObject({ phase: "run", last_tool: "Write" });
    expect(relay.poll()).toBe(0); // nothing is re-emitted
    queue.enqueue({ type: "visual_options", case_id: CASE_B });
    expect(relay.poll()).toBe(1);
    expect(seen.at(-1)?.type).toBe("gen.queued");
  });

  it("does not replay events that predate the server start", () => {
    const queue = new GenerationQueue(db);
    queue.enqueue({ type: "visual_options", case_id: CASE_A });
    const bus = new EventBus();
    const seen: AppEvent[] = [];
    bus.subscribe((e) => seen.push(e));
    const relay = new GenerationEventsRelay(db, bus);
    expect(relay.poll()).toBe(0);
    queue.enqueue({ type: "visual_options", case_id: CASE_B });
    expect(relay.poll()).toBe(1);
    expect(seen).toHaveLength(1);
  });
});
