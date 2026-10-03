import { describe, expect, it } from "vitest";
import { cuesFromAnnotations, toSrt, toVtt } from "./index";

const FPS = 30;

describe("cuesFromAnnotations", () => {
  it("maps a card to a words-less cue at frame/fps and holds at least 2 s", () => {
    const cues = cuesFromAnnotations([{ id: "a", text: "Launch\n2007", frame: 300, dwell: 40 }], { fps: FPS });
    expect(cues).toEqual([{ start_s: 10, end_s: 12, lines: ["Launch", "2007"], words: [] }]);
  });

  it("keeps a dwell longer than the minimum hold", () => {
    const [c] = cuesFromAnnotations([{ id: "a", text: "X", frame: 0, dwell: 120 }], { fps: FPS });
    expect(c?.end_s).toBe(4);
  });

  it("is frame-aligned for non-integer-second fps", () => {
    const fps = 24;
    const cues = cuesFromAnnotations([{ id: "a", text: "X", frame: 37, dwell: 10 }], { fps });
    for (const c of cues) {
      expect(Number.isInteger(Math.round(c.start_s * fps * 1e6) / 1e6)).toBe(true);
      expect(Number.isInteger(Math.round(c.end_s * fps * 1e6) / 1e6)).toBe(true);
    }
    expect(cues[0]?.end_s).toBe((37 + 48) / fps);
  });

  it("trims an overlapped cue to leave a 2-frame gap when it still holds 2 s", () => {
    const cues = cuesFromAnnotations(
      [
        { id: "a", text: "First", frame: 0, dwell: 300 },
        { id: "b", text: "Second", frame: 120, dwell: 60 },
      ],
      { fps: FPS },
    );
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start_s: 0, end_s: 118 / FPS, lines: ["First"] });
    expect(cues[1]).toMatchObject({ start_s: 4, end_s: 6, lines: ["Second"] });
  });

  it("merges events too close to trim without breaking the minimum hold", () => {
    const cues = cuesFromAnnotations(
      [
        { id: "b", text: "Second", frame: 30, dwell: 0 },
        { id: "a", text: "First\n2001", frame: 0, dwell: 0 },
        { id: "c", text: "Third", frame: 50, dwell: 0 },
      ],
      { fps: FPS },
    );
    expect(cues).toEqual([{ start_s: 0, end_s: 110 / FPS, lines: ["First", "2001 / Second / Third"], words: [] }]);
  });

  it("never overlaps and keeps gaps >= 2 frames across many events", () => {
    const events = Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, text: `E${i}`, frame: i * 37, dwell: 24 }));
    const cues = cuesFromAnnotations(events, { fps: FPS });
    for (let i = 1; i < cues.length; i++) {
      const gap = ((cues[i]?.start_s ?? 0) - (cues[i - 1]?.end_s ?? 0)) * FPS;
      expect(gap).toBeGreaterThanOrEqual(2 - 1e-9);
    }
    for (const c of cues) expect(c.end_s - c.start_s).toBeGreaterThanOrEqual(2 - 1e-9);
  });

  it("honours minHoldS / gapFrames options, endFrame, and drops blank text", () => {
    const cues = cuesFromAnnotations(
      [
        { id: "a", text: "A", frame: 0, dwell: 0 },
        { id: "blank", text: " \n ", frame: 10, dwell: 0 },
        { id: "b", text: "B", frame: 100, dwell: 0 },
      ],
      { fps: FPS, minHoldS: 1, gapFrames: 4, endFrame: 120 },
    );
    expect(cues.map((c) => [c.start_s * FPS, c.end_s * FPS])).toEqual([
      [0, 30],
      [100, 120],
    ]);
  });

  it("round-trips through toVtt and toSrt, escaping annotation text", () => {
    const cues = cuesFromAnnotations(
      [
        { id: "a", text: "<5 points & rising", frame: 0, dwell: 60 },
        { id: "b", text: "Next", frame: 150, dwell: 60 },
      ],
      { fps: FPS },
    );
    expect(toVtt(cues)).toBe(
      "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n&lt;5 points &amp; rising\n\n00:00:05.000 --> 00:00:07.000\nNext\n",
    );
    expect(toSrt(cues)).toBe(
      "1\n00:00:00,000 --> 00:00:02,000\n<5 points & rising\n\n2\n00:00:05,000 --> 00:00:07,000\nNext\n",
    );
  });
});
