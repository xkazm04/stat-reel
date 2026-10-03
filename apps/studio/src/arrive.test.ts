import { describe, expect, it } from "vitest";
import { MAX_DELAY_MS, STAGGER_MS, tierDelay } from "./components/arrive";

describe("tierDelay", () => {
  it("tier 0 is immediate and each tier adds one step", () => {
    expect(tierDelay(0)).toBe(0);
    expect(tierDelay(1)).toBe(STAGGER_MS);
    expect(tierDelay(3)).toBe(3 * STAGGER_MS);
  });
  it("never waits longer than the cap, and ignores nonsense", () => {
    expect(tierDelay(99)).toBe(MAX_DELAY_MS);
    expect(tierDelay(-2)).toBe(0);
    expect(tierDelay(1.6)).toBe(2 * STAGGER_MS);
  });
});
