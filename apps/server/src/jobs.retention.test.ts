import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "./db";
import { EventBus } from "./events";
import { GenerationEventsRelay } from "./generation/relay";
import { JobRunner, RETENTION_INTERVAL_MS, startRetention } from "./jobs";

const DAY = 86_400_000;
const T0 = Date.parse("2026-06-01T00:00:00Z");
const iso = (daysAgo: number) => new Date(T0 - daysAgo * DAY).toISOString();

function setup() {
  const db = openDb(":memory:");
  const bus = new EventBus();
  const runner = new JobRunner(db, bus);
  const raw = db.$client;
  const session = (id: string, endedDaysAgo: number | null) => {
    raw
      .prepare("insert into llm_sessions (id, engine, started_at, ended_at) values (?, 'claude-code', ?, ?)")
      .run(id, iso(100), endedDaysAgo === null ? null : iso(endedDaysAgo));
    for (const seq of [1, 2])
      raw
        .prepare("insert into llm_events (session_id, seq, type, payload_json, at) values (?, ?, 'tool', '{}', ?)")
        .run(id, seq, iso(100));
  };
  const genJob = (id: string, status: string, finishedDaysAgo: number | null) => {
    raw
      .prepare(
        "insert into generation_jobs (id, type, case_id, dedupe_key, status, created_at, finished_at, updated_at) values (?, 'visual_options', 'c', ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        `k-${id}`,
        status,
        iso(100),
        finishedDaysAgo === null ? null : iso(finishedDaysAgo),
        iso(finishedDaysAgo ?? 100),
      );
    for (let i = 0; i < 2; i++)
      raw.prepare("insert into generation_job_events (job_id, at, type) values (?, ?, 'tool')").run(id, iso(100));
  };
  const count = (table: string, where = "1=1") =>
    (raw.prepare(`select count(*) n from ${table} where ${where}`).get() as { n: number }).n;
  return { db, bus, runner, session, genJob, count };
}

describe("event-table retention", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it("prunes events of terminal sessions and jobs past the cutoff, and only those", () => {
    const { runner, session, genJob, count } = setup();
    session("old-ended", 40);
    session("fresh-ended", 5);
    session("old-running", null);
    genJob("old-done", "done", 40);
    genJob("old-failed", "failed", 31);
    genJob("fresh-done", "done", 2);
    genJob("old-running", "running", null);
    genJob("old-queued", "queued", null);

    expect(runner.pruneEvents(30)).toEqual({ llm: 2, generation: 4 });
    expect(count("llm_events", "session_id = 'old-ended'")).toBe(0);
    expect(count("llm_events")).toBe(4);
    expect(count("generation_job_events", "job_id in ('old-done','old-failed')")).toBe(0);
    expect(count("generation_job_events")).toBe(6);
    // the session and job rows themselves are kept: videos and board items reference them
    expect(count("llm_sessions")).toBe(3);
    expect(count("generation_jobs")).toBe(5);
  });

  it("defaults to STATREEL_JOB_RETENTION_DAYS (30) and is idempotent", () => {
    const { runner, session, count } = setup();
    session("s29", 29);
    session("s31", 31);
    expect(runner.pruneEvents()).toEqual({ llm: 2, generation: 0 });
    expect(runner.pruneEvents()).toEqual({ llm: 0, generation: 0 });
    expect(count("llm_events", "session_id = 's29'")).toBe(2);
  });

  it("the daily timer sweeps again as the clock moves on", () => {
    const { runner, session, count } = setup();
    session("s", 29);
    startRetention(runner);
    vi.advanceTimersByTime(RETENTION_INTERVAL_MS - 1);
    expect(count("llm_events")).toBe(2);
    vi.advanceTimersByTime(1); // a day later the session is 30 days past its end
    expect(count("llm_events")).toBe(2);
    vi.advanceTimersByTime(RETENTION_INTERVAL_MS);
    expect(count("llm_events")).toBe(0);
  });

  it("resume() sweeps at boot too", () => {
    const { runner, session, count } = setup();
    session("old", 90);
    runner.resume();
    expect(count("llm_events")).toBe(0);
  });

  it("pruning old rows never makes the generation relay replay or skip an event", () => {
    const { db, bus, runner, genJob } = setup();
    genJob("old-done", "done", 40);
    const relay = new GenerationEventsRelay(db, bus);
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(`${e.type}:${e.job_id}`));
    runner.pruneEvents(30);
    db.$client.prepare("insert into generation_job_events (job_id, at, type) values ('live', ?, 'phase')").run(iso(0));
    expect(relay.poll()).toBe(1);
    expect(seen).toEqual(["gen.phase:live"]);
    // ids are AUTOINCREMENT: deleting the highest row cannot hand its id out again
    db.$client.prepare("delete from generation_job_events").run();
    db.$client.prepare("insert into generation_job_events (job_id, at, type) values ('live', ?, 'done')").run(iso(0));
    expect(relay.poll()).toBe(1);
  });
});
