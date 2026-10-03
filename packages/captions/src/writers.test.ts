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

  describe("text hazards", () => {
    const one = (lines: string[]): Cue[] => [{ start_s: 0, end_s: 2, lines, words: [] }];
    const T = "00:00:00,000 --> 00:00:02,000";
    const V = "00:00:00.000 --> 00:00:02.000";

    it("VTT escapes & < >", () => {
      expect(toVtt(one(["<5 points & A&B >"]))).toBe(`WEBVTT\n\n${V}\n&lt;5 points &amp; A&amp;B &gt;\n`);
    });

    it("SRT leaves & < > alone", () => {
      expect(toSrt(one(["<5 points & A&B"]))).toBe(`1\n${T}\n<5 points & A&B\n`);
    });

    it("neutralises --> to an arrow in both formats (never --&gt; in VTT)", () => {
      expect(toSrt(one(["a --> b"]))).toBe(`1\n${T}\na \u2192 b\n`);
      expect(toVtt(one(["a --> b"]))).toBe(`WEBVTT\n\n${V}\na \u2192 b\n`);
    });

    it("collapses blank lines and embedded newlines inside a cue", () => {
      const c = one(["first", "", "  ", "second\n\nthird\r\nfourth"]);
      expect(toSrt(c)).toBe(`1\n${T}\nfirst\nsecond\nthird\nfourth\n`);
      expect(toVtt(c)).toBe(`WEBVTT\n\n${V}\nfirst\nsecond\nthird\nfourth\n`);
    });

    it("drops a cue with no text and keeps SRT numbering contiguous", () => {
      const c = [...one([""]), { start_s: 3, end_s: 4, lines: ["ok"], words: [] }];
      expect(toSrt(c)).toBe("1\n00:00:03,000 --> 00:00:04,000\nok\n");
      expect(toVtt(one([" "]))).toBe("WEBVTT\n");
      expect(toSrt(one([""]))).toBe("");
    });
  });
});
