import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { activeStageText, produceOutcome, produceStages } from "./produce-stages";

const states = (job: Parameters<typeof produceStages>[0], note?: string) =>
  produceStages(job, note)
    .map((s) => `${s.id}:${s.state}`)
    .join(" ");
const run = (kind: string, progress: number, status = "running") => ({ kind, status, progress });

const ALL_PENDING = "audio:pending render:pending checks:pending manifest:pending gate:pending";
const AUDIO = "audio:active render:pending checks:pending manifest:pending gate:pending";
const RENDER = "audio:done render:active checks:pending manifest:pending gate:pending";
const CHECKS = "audio:done render:done checks:active manifest:active gate:pending";
const GATE = "audio:done render:done checks:done manifest:done gate:active";

describe("produceStages", () => {
  it("is all pending without a produce job", () => {
    expect(states(null)).toBe(ALL_PENDING);
    expect(states(run("publish", 0.5))).toBe(ALL_PENDING);
  });

  it("keeps audio active through every voice and music note", () => {
    for (const [p, note] of [
      [0, "voice hook"],
      [0.3, "voice reveal"],
      [0.65, "music"],
      [1, "audio ready"],
    ] as const)
      expect(states(run("audio", p), note)).toBe(AUDIO);
  });

  it("is render while frames are rendered and mastered", () => {
    expect(states(run("render", 0))).toBe(RENDER);
    expect(states(run("render", 0.4), "bundle")).toBe(RENDER);
    expect(states(run("render", 0.87), "mastering")).toBe(RENDER);
  });

  it("runs checks and the manifest together (one progress mark covers both)", () => {
    expect(states(run("render", 0.92), "checks")).toBe(CHECKS);
    expect(states(run("render", 0.95))).toBe(CHECKS);
  });

  it("is gate at 0.97", () => {
    expect(states(run("render", 0.97), "gate")).toBe(GATE);
  });

  it("works from the stored snapshot alone (no note): opened mid-job", () => {
    expect(states(run("render", 0.92))).toBe(CHECKS);
    expect(states(run("render", 0.97))).toBe(GATE);
  });

  it("lets a later note refine a stale snapshot, never move it back", () => {
    expect(states(run("render", 0.5), "gate")).toBe(GATE);
    expect(states(run("render", 0.97), "mastering")).toBe(GATE);
  });

  it("jumps to the gate for a reused render", () => {
    expect(states(run("render", 0.97), "reused render 3f2a")).toBe(GATE);
  });

  it("marks a queued render as the chain's next step and a succeeded job done", () => {
    expect(states(run("render", 0, "queued"))).toBe(RENDER);
    expect(states(run("render", 1, "succeeded"))).toBe("audio:done render:done checks:done manifest:done gate:done");
  });
});

describe("activeStageText", () => {
  it("names the active stage(s)", () => {
    expect(activeStageText(produceStages(run("render", 0.4)))).toBe("Render");
    expect(activeStageText(produceStages(run("render", 0.93)))).toBe("Checks and manifest");
    expect(activeStageText(produceStages(null))).toBe("");
  });
});

const job = (id: string, kind: string, status: string, at: string, error: string | null = null) => ({
  id,
  kind,
  status,
  created_at: at,
  error,
});
const row = (job_id: string, allow: boolean) => ({ job_id, policy_json: JSON.stringify({ allow, deny: [] }) });

describe("produceOutcome", () => {
  it("announces the verdict of the render the finished job wrote", () => {
    const jobs = [
      job("a", "audio", "succeeded", "2026-10-04T10:00"),
      job("r", "render", "succeeded", "2026-10-04T10:02"),
    ];
    expect(produceOutcome(jobs, [row("r", true)])).toBe("Produce finished: ALLOW");
    expect(produceOutcome(jobs, [row("r", false), row("old", true)])).toBe("Produce finished: DENY");
    expect(produceOutcome(jobs, [])).toBe("Produce finished: no verdict");
    expect(produceOutcome(jobs, [{ job_id: "r", policy_json: "not json" }])).toBe("Produce finished: no verdict");
  });

  it("announces a failure with its error, a refusal and a cancel", () => {
    expect(produceOutcome([job("r", "render", "failed", "t", "ffmpeg exited 1")], [])).toBe(
      "Produce failed: ffmpeg exited 1",
    );
    expect(produceOutcome([job("a", "audio", "refused", "t", "budget")], [])).toBe("Produce refused: budget");
    expect(produceOutcome([job("a", "audio", "cancelled", "t")], [])).toBe("Produce cancelled");
    expect(produceOutcome([job("a", "audio", "failed", "t")], [])).toBe("Produce failed: no error text");
  });

  it("says nothing between audio and render, or without a produce job", () => {
    expect(produceOutcome([job("a", "audio", "succeeded", "t")], [])).toBeNull();
    expect(produceOutcome([job("l", "llm", "succeeded", "t")], [])).toBeNull();
    expect(produceOutcome([], [])).toBeNull();
  });

  it("looks only at the newest produce job", () => {
    const jobs = [
      job("old", "render", "failed", "2026-10-04T09:00", "x"),
      job("new", "render", "succeeded", "2026-10-04T10:00"),
    ];
    expect(produceOutcome(jobs, [row("new", true)])).toBe("Produce finished: ALLOW");
  });
});

describe("the stepper follows the marks the server actually writes (apps/server/src/pipeline.ts)", () => {
  // read from the producer, not copied: a moved mark in pipeline.ts turns this red
  const source = readFileSync(resolve(__dirname, "../../../server/src/pipeline.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const marks = new Map<string, number>();
  for (const m of source.matchAll(/ctx\.progress\(([\d.]+), "([a-z ]+)"\)/g)) marks.set(m[2] as string, Number(m[1]));
  const reused = source.match(/ctx\.progress\(([\d.]+), `reused render \$\{/);

  it("finds the render job's marks", () => {
    for (const k of ["mastering", "checks", "gate"]) expect(marks.has(k), k).toBe(true);
    expect(reused, "reused render mark").not.toBeNull();
  });
  it("puts each stored mark (no SSE note) on the stage the server is in", () => {
    expect(states(run("render", marks.get("mastering") as number))).toBe(RENDER);
    expect(states(run("render", marks.get("checks") as number))).toBe(CHECKS);
    expect(states(run("render", marks.get("gate") as number))).toBe(GATE);
    expect(states(run("render", Number(reused?.[1])))).toBe(GATE);
  });
});
