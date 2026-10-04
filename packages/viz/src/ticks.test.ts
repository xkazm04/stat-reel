import { describe, expect, it } from "vitest";
import { niceStep, niceTicks } from "./ticks";

describe("niceTicks parametrised to a 2-4 tick density (DataRace gridlines)", () => {
  /** DataRace draws the positive ticks of an axis that starts at 0: count 4 gives 2, 3 or 4 of them, always. */
  const positive = (max: number): number[] => niceTicks(0, max, 4).filter((v) => v > 0);

  it("count 4 over [0, max] yields 2, 3 or 4 positive ticks for any max (the step never exceeds max / 2)", () => {
    for (let max = 0.001; max < 1e7; max *= 1.007) {
      const n = positive(max).length;
      expect(n, `max ${max}`).toBeGreaterThanOrEqual(2);
      expect(n, `max ${max}`).toBeLessThanOrEqual(4);
    }
  });

  it("is deterministic and ascending, on steps of 1 / 2 / 2.5 / 5 x 10^n", () => {
    expect(positive(20)).toEqual([5, 10, 15, 20]);
    expect(positive(20.4)).toEqual([10, 20]);
    expect(positive(9.3)).toEqual([2.5, 5, 7.5]);
    expect(positive(1)).toEqual([0.25, 0.5, 0.75, 1]);
    for (const max of [0.7, 3, 47.7, 1234]) expect(positive(max)).toEqual(positive(max));
    expect(niceStep(20.4, 4)).toBe(10);
    expect(niceStep(20, 4)).toBe(5);
  });

  it("keeps 0 in the list (the caller decides whether the baseline is a gridline)", () => {
    expect(niceTicks(0, 20, 4)[0]).toBe(0);
  });
});
