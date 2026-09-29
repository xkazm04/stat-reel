import { describe, expect, it } from "vitest";
import { Budget, estimateTtsSeconds } from "./budget";
import { BudgetExceeded, jobStatusFor } from "./errors";

describe("Budget", () => {
  it("defaults to the DESIGN §6.4 live test budget", () => {
    const b = new Budget();
    expect(b.limit("tts")).toBe(75);
    expect(b.limit("music")).toBe(75);
  });

  it("estimates TTS seconds from characters at ~15 chars/s", () => {
    expect(estimateTtsSeconds("x".repeat(150))).toBe(10);
    expect(estimateTtsSeconds("")).toBe(0);
  });

  it("reserves, settles to the measured value and refuses when over", () => {
    const b = new Budget({ ttsSeconds: 20, musicSeconds: 10 });
    const r = b.reserve("tts", 12);
    expect(b.used("tts")).toBe(12);
    b.settle(r, 9.5);
    expect(b.used("tts")).toBe(9.5);
    expect(b.remaining("tts")).toBe(10.5);
    expect(() => b.reserve("tts", 11)).toThrow(BudgetExceeded);
    const err = (() => {
      try {
        b.reserve("tts", 11);
      } catch (e) {
        return e;
      }
    })();
    expect(jobStatusFor(err)).toBe("refused");
    expect((err as BudgetExceeded).state).toBe("refused");
    b.reserve("tts", 10.5);
    expect(b.remaining("tts")).toBe(0);
    // music is a separate pool
    b.reserve("music", 10);
    expect(() => b.reserve("music", 0.01)).toThrow(BudgetExceeded);
  });

  it("releasing a reservation (failed call) gives the seconds back", () => {
    const b = new Budget({ ttsSeconds: 10, musicSeconds: 10 });
    const r = b.reserve("music", 8);
    b.release(r);
    expect(b.used("music")).toBe(0);
    expect(() => b.release(r)).toThrow(/settled/);
  });

  it("rejects negative or non-finite amounts", () => {
    const b = new Budget();
    expect(() => b.reserve("tts", -1)).toThrow(RangeError);
    expect(() => b.reserve("tts", Number.NaN)).toThrow(RangeError);
  });

  it("snapshot reports used, limit and generations", () => {
    const b = new Budget({ ttsSeconds: 30, musicSeconds: 30 });
    b.settle(b.reserve("tts", 5), 4);
    expect(b.snapshot()).toEqual({
      tts: { used: 4, limit: 30, generations: 1 },
      music: { used: 0, limit: 30, generations: 0 },
    });
  });
});
