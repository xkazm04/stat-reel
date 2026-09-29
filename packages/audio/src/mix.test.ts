import { describe, expect, it } from "vitest";
import { dbToLinear, mixPlan, volumeDbAt } from "./mix";
import type { MusicCue } from "./music";

const scenes = [
  { scene_id: "s1", start_s: 0, end_s: 4, voice_src: "s1.mp3", voice_duration_s: 3.2 },
  { scene_id: "s2", start_s: 4, end_s: 14, voice_src: "s2.mp3", voice_duration_s: 8 },
  { scene_id: "s3", start_s: 14, end_s: 30, voice_src: "s3.mp3", voice_duration_s: 15 },
];
const cue: MusicCue = {
  cue_id: "m1",
  start_s: 4,
  end_s: 30,
  lengthMs: 26_000,
  gainDb: -9,
  scenes: ["s2", "s3"],
  fadeInS: 0.5,
  fadeOutS: 1,
};

describe("mixPlan", () => {
  it("voice is the 0 dB anchor and leads picture by voiceLeadS at scene changes", () => {
    const plan = mixPlan({ scenes, cues: [{ ...cue, src: "m1.mp3" }] });
    expect(plan.voiceLeadS).toBe(0.5);
    expect(plan.voice.map((v) => [v.scene_id, v.start_s, v.end_s, v.volumeDb])).toEqual([
      ["s1", 0, 3.2, 0],
      ["s2", 3.5, 11.5, 0],
      ["s3", 13.5, 28.5, 0],
    ]);
    expect(plan.voice.map((v) => v.leadS)).toEqual([0, 0.5, 0.5]);
  });

  it("music sits at the duck gain while voice is active and opens up in gaps", () => {
    const plan = mixPlan({ scenes, cues: [{ ...cue, src: "m1.mp3" }], musicOpenDb: -3, rampS: 0.2 });
    const env = plan.music[0]?.envelope ?? [];
    expect(volumeDbAt(env, 6)).toBeCloseTo(-9); // under s2 voice
    expect(volumeDbAt(env, 12.5)).toBeCloseTo(-3); // gap between s2 voice end (11.5) and s3 voice (13.5)
    expect(volumeDbAt(env, 20)).toBeCloseTo(-9); // under s3 voice
    // fades at cue edges
    expect(volumeDbAt(env, 4)).toBe(Number.NEGATIVE_INFINITY);
    expect(volumeDbAt(env, 30)).toBe(Number.NEGATIVE_INFINITY);
    expect(volumeDbAt(env, 2)).toBe(Number.NEGATIVE_INFINITY); // before the cue
    // ducked level never goes above the open level, never below the duck (except fades)
    for (let t = 5; t < 29; t += 0.1) {
      const db = volumeDbAt(env, t);
      expect(db).toBeGreaterThanOrEqual(-9 - 1e-9);
      expect(db).toBeLessThanOrEqual(-3 + 1e-9);
    }
    expect(plan.timelineMusic).toEqual([{ src: "m1.mp3", start_s: 4, end_s: 30, gain_db: -9 }]);
  });

  it("clamps the lead so voices never overlap, and validates the 0.5-2 s range", () => {
    const tight = [
      { scene_id: "a", start_s: 0, end_s: 4, voice_duration_s: 3.9 },
      { scene_id: "b", start_s: 4, end_s: 8, voice_duration_s: 3 },
    ];
    const plan = mixPlan({ scenes: tight, cues: [], voiceLeadS: 1 });
    expect(plan.voice[1]?.start_s).toBeCloseTo(3.9);
    expect(plan.voice[1]?.leadS).toBeCloseTo(0.1);
    expect(() => mixPlan({ scenes: tight, cues: [], voiceLeadS: 0.2 })).toThrow(RangeError);
    expect(() => mixPlan({ scenes: tight, cues: [], voiceLeadS: 2.5 })).toThrow(RangeError);
  });

  it("dbToLinear converts for Remotion <Audio volume>", () => {
    expect(dbToLinear(0)).toBe(1);
    expect(dbToLinear(-6)).toBeCloseTo(0.501, 3);
    expect(dbToLinear(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});
