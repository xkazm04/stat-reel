import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { measureLoudness, normalizeTo, probeDurationS } from "./loudness";

let root: string;
let sine: string;
let quiet: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "statreel-audio-loud-"));
  sine = join(root, "sine.wav");
  quiet = join(root, "quiet.wav");
  const ff = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-ar", "48000", sine]);
  ff(["-i", sine, "-af", "volume=-10dB", quiet]);
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("loudness", () => {
  it("probeDurationS reads the container duration", async () => {
    expect(await probeDurationS(sine)).toBeCloseTo(3, 2);
  }, 30_000);

  it("measureLoudness returns integrated LUFS, true peak and loudness range", async () => {
    const a = await measureLoudness(sine);
    const b = await measureLoudness(quiet);
    // a full-scale/8 sine is ~-21.8 LUFS with a -18.1 dBTP peak
    expect(a.integratedLufs).toBeGreaterThan(-23);
    expect(a.integratedLufs).toBeLessThan(-20.5);
    expect(a.truePeakDbtp).toBeCloseTo(-18.1, 0);
    expect(Number.isFinite(a.loudnessRangeLu)).toBe(true);
    // the -10 dB copy measures 10 LU quieter
    expect(a.integratedLufs - b.integratedLufs).toBeCloseTo(10, 0);
  }, 30_000);

  it("normalizeTo reaches -14 LUFS ±1 with true peak ≤ -2 dBTP", async () => {
    const out = join(root, "norm.wav");
    const r = await normalizeTo({ input: quiet, output: out, targetLufs: -14, truePeak: -2 });
    expect(r.before.integratedLufs).toBeLessThan(-30);
    const m = await measureLoudness(out);
    expect(Math.abs(m.integratedLufs - -14)).toBeLessThanOrEqual(1);
    expect(m.truePeakDbtp).toBeLessThanOrEqual(-2 + 0.2);
    expect(r.after.integratedLufs).toBeCloseTo(m.integratedLufs, 1);
    expect(r.normalizationType).toBe("linear");
    // loudnorm resamples internally; the output keeps the input rate and length
    expect(await probeDurationS(out)).toBeCloseTo(3, 1);
  }, 60_000);

  it("fails loudly on a missing file", async () => {
    await expect(measureLoudness(join(root, "nope.wav"))).rejects.toThrow(/ffmpeg/);
    await expect(probeDurationS(join(root, "nope.wav"))).rejects.toThrow(/ffprobe/);
  }, 30_000);
});
