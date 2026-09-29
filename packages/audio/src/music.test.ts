import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TakeRejected } from "./errors";
import { acceptTake, planMusicCues, type SceneSpan } from "./music";

const scenes: SceneSpan[] = [
  { scene_id: "s1", kind: "hook", start_s: 0, end_s: 4 },
  { scene_id: "s2", kind: "context", start_s: 4, end_s: 14 },
  { scene_id: "s3", kind: "reveal", start_s: 14, end_s: 30 },
  { scene_id: "s4", kind: "payoff", start_s: 30, end_s: 42 },
  { scene_id: "s5", kind: "close", start_s: 42, end_s: 48 },
];

describe("planMusicCues", () => {
  it("spots music under context+reveal+payoff with silence on the hook and a drop before the payoff", () => {
    const plan = planMusicCues(scenes);
    expect(plan.totalS).toBe(48);
    expect(plan.cues).toHaveLength(2);
    const [a, b] = plan.cues;
    expect(a).toMatchObject({ start_s: 4, end_s: 29.25, lengthMs: 25_250, scenes: ["s2", "s3"], gainDb: -9 });
    expect(b).toMatchObject({ start_s: 30, end_s: 42, lengthMs: 12_000, scenes: ["s4"], gainDb: -9 });
    // silences: hook, pre-payoff drop, close
    expect(plan.silences.map((s) => s.reason)).toEqual(["hook", "pre-payoff drop", "close"]);
    expect(plan.silences[0]).toMatchObject({ start_s: 0, end_s: 4 });
    expect(plan.silences[1]).toMatchObject({ start_s: 29.25, end_s: 30 });
    expect(plan.silences[2]).toMatchObject({ start_s: 42, end_s: 48 });
  });

  it("lengthMs is exact integer milliseconds equal to the cue span", () => {
    const plan = planMusicCues(scenes, { preDropS: 0.333 });
    for (const c of plan.cues) {
      expect(Number.isInteger(c.lengthMs)).toBe(true);
      expect(c.lengthMs).toBe(Math.round((c.end_s - c.start_s) * 1000));
    }
  });

  it("keeps the hook's first beat silent even when music is allowed under the hook", () => {
    const plan = planMusicCues(scenes, { musicKinds: ["hook", "context", "reveal", "payoff"], hookBeatS: 1.5 });
    expect(plan.cues[0]).toMatchObject({ start_s: 1.5, scenes: ["s1", "s2", "s3"] });
    expect(plan.silences[0]).toMatchObject({ start_s: 0, end_s: 1.5, reason: "hook first beat" });
  });

  it("clamps the duck to the 6-12 dB range", () => {
    expect(planMusicCues(scenes, { duckDb: 20 }).cues.every((c) => c.gainDb === -12)).toBe(true);
    expect(planMusicCues(scenes, { duckDb: 2 }).cues.every((c) => c.gainDb === -6)).toBe(true);
    for (const d of [0, 6, 7.5, 9, 12, 40]) {
      for (const c of planMusicCues(scenes, { duckDb: d }).cues) {
        expect(-c.gainDb).toBeGreaterThanOrEqual(6);
        expect(-c.gainDb).toBeLessThanOrEqual(12);
      }
    }
  });

  it("drops cues shorter than the provider minimum (3 s) into silence", () => {
    const short: SceneSpan[] = [
      { scene_id: "h", kind: "hook", start_s: 0, end_s: 3 },
      { scene_id: "c", kind: "context", start_s: 3, end_s: 5 },
      { scene_id: "p", kind: "payoff", start_s: 5, end_s: 12 },
    ];
    const plan = planMusicCues(short);
    expect(plan.cues.map((c) => c.scenes)).toEqual([["p"]]);
    expect(plan.silences.some((s) => s.reason === "cue shorter than 3000 ms")).toBe(true);
  });

  it("rejects unordered or overlapping scenes", () => {
    expect(() =>
      planMusicCues([
        { scene_id: "a", kind: "hook", start_s: 0, end_s: 5 },
        { scene_id: "b", kind: "context", start_s: 4, end_s: 9 },
      ]),
    ).toThrow(/overlap/);
  });
});

describe("acceptTake", () => {
  let root: string;
  let exact: string;
  let long: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "statreel-audio-take-"));
    exact = join(root, "exact.wav");
    long = join(root, "long.wav");
    const ff = (d: number, out: string) =>
      execFileSync("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=220:duration=${d}`,
        "-ar",
        "48000",
        out,
      ]);
    ff(5, exact);
    ff(5.2, long);
  }, 60_000);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("accepts a take within 60 ms of the expected length", async () => {
    const r = await acceptTake(exact, 5000);
    expect(Math.abs(r.durationMs - 5000)).toBeLessThanOrEqual(60);
    expect((await acceptTake(exact, 5050)).deltaMs).toBeCloseTo(-50, -1);
  }, 30_000);

  it("rejects an off-length take and never stretches it", async () => {
    const err = await acceptTake(long, 5000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TakeRejected);
    expect((err as TakeRejected).expectedMs).toBe(5000);
    expect((err as TakeRejected).actualMs).toBeCloseTo(5200, -1);
    await expect(acceptTake(exact, 5061)).rejects.toBeInstanceOf(TakeRejected);
  }, 30_000);
});
