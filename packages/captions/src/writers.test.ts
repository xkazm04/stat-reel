import type { Cue } from "@statreel/schemas";
import { describe, expect, it } from "vitest";
import { toSrt, toVtt } from "./index";

const cues: Cue[] = [
  { start_s: 0, end_s: 1.5, lines: ["Hello there"], words: [] },
  { start_s: 1.6, end_s: 3.25, lines: ["Two", "lines"], words: [] },
];

describe("sidecar writers", () => {
  it("writes SRT with 1-based indices and HH:MM:SS,mmm", () => {
    expect(toSrt(cues)).toBe(
      "1\n00:00:00,000 --> 00:00:01,500\nHello there\n\n2\n00:00:01,600 --> 00:00:03,250\nTwo\nlines\n",
    );
  });

  it("writes WebVTT with header and HH:MM:SS.mmm", () => {
    expect(toVtt(cues)).toBe(
      "WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nHello there\n\n00:00:01.600 --> 00:00:03.250\nTwo\nlines\n",
    );
  });

  it("formats hours and rounds to milliseconds", () => {
    const c: Cue[] = [{ start_s: 3725.0416, end_s: 3726.0333333, lines: ["x"], words: [] }];
    expect(toSrt(c)).toBe("1\n01:02:05,042 --> 01:02:06,033\nx\n");
    expect(toVtt(c)).toBe("WEBVTT\n\n01:02:05.042 --> 01:02:06.033\nx\n");
  });

  it("handles no cues", () => {
    expect(toSrt([])).toBe("");
    expect(toVtt([])).toBe("WEBVTT\n");
  });
});
