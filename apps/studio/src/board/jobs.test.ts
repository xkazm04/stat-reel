import { describe, expect, it } from "vitest";
import type { GenerationOverview } from "../api";
import {
  badgeForCase,
  canCancel,
  elapsed,
  errorWords,
  formatSpend,
  hasActiveJobs,
  type JobRow,
  type OverviewCase,
  stripState,
  WORKER_OFFLINE_RUNNING,
} from "./jobs";

const job = (o: Partial<JobRow>): JobRow =>
  ({
    id: "gj-00000001",
    type: "visual_options",
    case_id: "ci-00000001",
    board_item_id: null,
    dedupe_key: "k",
    status: "queued",
    attempts: 0,
    max_attempts: 2,
    params_json: "{}",
    result_json: null,
    error: null,
    error_kind: null,
    log_path: null,
    output_dir: null,
    pid: null,
    phase: null,
    progress_note: null,
    last_tool: null,
    cancel_requested_at: null,
    heartbeat_at: null,
    created_at: "2026-10-03T10:00:00.000Z",
    started_at: null,
    finished_at: null,
    updated_at: "2026-10-03T10:00:00.000Z",
    ...o,
  }) as JobRow;
const entry = (o: Partial<OverviewCase>): OverviewCase => ({
  title: "Case",
  stage: "visuals_queued",
  gate: null,
  visual_job_id: "gj-00000001",
  video_job_id: null,
  accepted_item_id: null,
  videos: 0,
  ...o,
});
const badge = (e: Partial<OverviewCase>, jobs: JobRow[], o: { online?: boolean; now?: number; n?: number } = {}) =>
  badgeForCase({
    entry: entry(e),
    jobs: new Map(jobs.map((j) => [j.id, j])),
    workerOnline: o.online ?? true,
    now: o.now ?? Date.parse("2026-10-03T10:03:12.000Z"),
    pendingVariants: o.n,
  });

describe("badgeForCase (D.11)", () => {
  it("queued shows its place; with the worker offline it says it is waiting", () => {
    expect(badge({}, [job({ queue_position: 2 })])).toMatchObject({
      kind: "queued",
      label: "Queued · #2",
      detail: undefined,
    });
    expect(badge({}, [job({ queue_position: 1 })], { online: false })).toMatchObject({
      label: "Queued · #1",
      detail: "waiting for worker",
    });
  });

  it("running shows the clock and the current tool", () => {
    const b = badge({ stage: "visuals_running" }, [
      job({
        status: "running",
        started_at: "2026-10-03T10:00:00.000Z",
        last_tool: "Write",
        progress_note: "writing variants",
      }),
    ]);
    expect(b).toMatchObject({ kind: "running", label: "Running · 03:12 · Write", detail: "writing variants" });
    expect(b?.actions).toEqual(["cancel", "log"]);
  });

  it("queued and running offer Cancel; finished jobs do not", () => {
    expect(badge({}, [job({})])?.actions).toEqual(["cancel", "log"]);
    expect(badge({}, [job({ status: "failed" })])?.actions).not.toContain("cancel");
    expect(badge({}, [job({ status: "cancelled" })])?.actions).not.toContain("cancel");
    expect(canCancel(job({ status: "queued" }))).toBe(true);
    expect(canCancel(job({ status: "running" }))).toBe(true);
    expect(canCancel(job({ status: "done" }))).toBe(false);
    expect(canCancel(undefined)).toBe(false);
  });

  it("a running job with the worker offline says so instead of showing live progress", () => {
    const running = job({
      status: "running",
      started_at: "2026-10-03T10:00:00.000Z",
      progress_note: "writing variants",
    });
    expect(badge({ stage: "visuals_running" }, [running], { online: false })).toMatchObject({
      kind: "running",
      detail: WORKER_OFFLINE_RUNNING,
      actions: ["cancel", "log"],
    });
  });

  it("visuals ready counts the pending variants; an accepted design offers Generate video", () => {
    // an unknown pending count (board not loaded, or a stale cache saying 0) is not a number to invent
    expect(badge({ stage: "visuals_ready" }, [job({ status: "done" })])).toMatchObject({
      kind: "ready",
      label: "Visuals ready",
      actions: ["variants"],
    });
    expect(badge({ stage: "visuals_ready" }, [job({ status: "done" })])?.label).not.toMatch(/\d/);
    expect(badge({ stage: "visuals_ready" }, [], { n: 3 })?.label).toBe("3 visuals ready");
    expect(badge({ stage: "visuals_ready" }, [], { n: 1 })?.label).toBe("1 visual ready");
    expect(badge({ stage: "visuals_ready", accepted_item_id: "bd-00000001" }, [])).toMatchObject({
      label: "Design accepted",
      actions: ["generate", "variants"],
    });
  });

  it("failed names the kind in plain words and offers retry and the log", () => {
    const b = badge({ stage: "visuals_failed" }, [
      job({ status: "failed", error_kind: "timeout", error: "no result within 30 min" }),
    ]);
    expect(b).toMatchObject({
      kind: "failed",
      label: "Failed · timeout",
      actions: ["retry", "log"],
      jobId: "gj-00000001",
    });
    expect(errorWords("validation")).toBe("output did not validate");
    expect(errorWords(null)).toBe("error");
  });

  it("cancelled offers retry", () => {
    expect(badge({ stage: "visuals_failed" }, [job({ status: "cancelled" })])).toMatchObject({
      kind: "cancelled",
      label: "Cancelled",
      actions: ["retry"],
    });
  });

  it("data blocked carries the gate's reason and a link to Sources", () => {
    const b = badge({ stage: "data_blocked", gate: { ok: false, reason: "source 'X' is not in the registry" } }, []);
    expect(b).toMatchObject({ kind: "blocked", label: "Data blocked", detail: "source 'X' is not in the registry" });
    expect(b?.actions).toContain("sources");
  });

  it("the video states use the video job; video ready links to the video", () => {
    const video = job({
      id: "gj-00000002",
      type: "generate_video",
      status: "running",
      started_at: "2026-10-03T10:00:00.000Z",
    });
    expect(badge({ stage: "video_running", video_job_id: "gj-00000002" }, [video])?.label).toBe("Running · 03:12");
    expect(badge({ stage: "video_ready" }, [])).toMatchObject({
      kind: "done",
      label: "Video ready",
      actions: ["video"],
    });
  });

  it("proposed and rejected cases show no badge", () => {
    expect(badge({ stage: "proposed" }, [])).toBeNull();
    expect(badge({ stage: "rejected" }, [])).toBeNull();
  });
});

describe("elapsed", () => {
  it("formats mm:ss and h:mm:ss, and is 00:00 before the start", () => {
    const t0 = "2026-10-03T10:00:00.000Z";
    expect(elapsed(t0, Date.parse(t0) + 5_000)).toBe("00:05");
    expect(elapsed(t0, Date.parse(t0) + 192_000)).toBe("03:12");
    expect(elapsed(t0, Date.parse(t0) + 3_723_000)).toBe("1:02:03");
    expect(elapsed(null, 1e12)).toBe("00:00");
  });
});

describe("queue strip and polling", () => {
  const o = (p: Partial<GenerationOverview>): GenerationOverview => ({
    worker: { online: true, pid: 1, heartbeat_at: null, queued: 0, running: 0 },
    jobs: [],
    cases: {},
    running: null,
    ...p,
  });
  it("names the running case and the queue", () => {
    expect(
      stripState(
        o({
          running: { job: job({ status: "running" }), title: "Search box wars" },
          worker: { online: true, pid: 1, heartbeat_at: null, queued: 2, running: 1 },
        }),
      ),
    ).toEqual({
      text: "Generating: Search box wars · 2 queued",
      offline: false,
      active: true,
    });
  });
  it("says so when the worker is offline", () => {
    expect(
      stripState(o({ worker: { online: false, pid: null, heartbeat_at: null, queued: 0, running: 0 } })),
    ).toMatchObject({ text: "Generation worker offline", offline: true });
    expect(
      stripState(o({ worker: { online: false, pid: null, heartbeat_at: null, queued: 1, running: 0 } })).text,
    ).toBe("1 queued · waiting for the worker");
  });
  it("a running job with the worker offline reads as stalled, not Generating", () => {
    const running = { job: job({ status: "running" }), title: "Search box wars" };
    const s = stripState(
      o({ running, worker: { online: false, pid: null, heartbeat_at: null, queued: 1, running: 1 } }),
    );
    expect(s).toEqual({ text: `Search box wars: ${WORKER_OFFLINE_RUNNING} · 1 queued`, offline: true, active: true });
    expect(s.text).not.toMatch(/Generating/);
  });
  it("polls only while a job is queued or running", () => {
    expect(hasActiveJobs(o({ jobs: [job({ status: "done" })] }))).toBe(false);
    expect(hasActiveJobs(o({ jobs: [job({ status: "queued" })] }))).toBe(true);
    expect(hasActiveJobs(undefined)).toBe(false);
  });
});

describe("job cost (generation cost ledger)", () => {
  it("formats cost and turns; unknown shows nothing, never $0", () => {
    expect(formatSpend({ cost_usd: 0.42, turns: 17 })).toBe("$0.42 · 17 turns");
    expect(formatSpend({ cost_usd: 1, turns: 1 })).toBe("$1.00 · 1 turn");
    expect(formatSpend({ cost_usd: 0, turns: null })).toBe("$0.00"); // the engine reported 0 (fake engine)
    expect(formatSpend({ cost_usd: null, turns: null })).toBeNull();
    expect(formatSpend({})).toBeNull();
    expect(formatSpend(undefined)).toBeNull();
  });

  it("finished badges carry the cost; an unknown cost leaves it off", () => {
    expect(
      badge({ stage: "visuals_failed" }, [job({ status: "failed", error_kind: "budget", cost_usd: 0.42, turns: 17 })])
        ?.cost,
    ).toBe("$0.42 · 17 turns");
    expect(
      badge({ stage: "visuals_failed" }, [job({ status: "failed", error_kind: "cli_exit" })])?.cost,
    ).toBeUndefined();
    expect(badge({ stage: "visuals_ready" }, [job({ status: "done", cost_usd: 0.1, turns: 3 })])?.cost).toBe(
      "$0.10 · 3 turns",
    );
    expect(
      badge({ stage: "video_ready", video_job_id: "gj-00000002" }, [
        job({ id: "gj-00000002", type: "generate_video", status: "done", cost_usd: 2.5 }),
      ])?.cost,
    ).toBe("$2.50");
    expect(badge({ stage: "visuals_queued" }, [job({ cost_usd: 0.3 })])?.cost).toBeUndefined();
  });
});
