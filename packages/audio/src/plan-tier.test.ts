import { PlanTier } from "@statreel/schemas";
import { describe, expect, it } from "vitest";
import { UnknownPlanTier } from "./errors";
import { planTierFromSubscription } from "./plan-tier";

describe("planTierFromSubscription", () => {
  it("maps every schema tier", () => {
    for (const t of PlanTier.options) expect(planTierFromSubscription(t)).toBe(t);
  });

  it("is case/whitespace tolerant and maps the provider's growing_business alias", () => {
    expect(planTierFromSubscription(" Creator ")).toBe("creator");
    expect(planTierFromSubscription("growing_business")).toBe("business");
  });

  it("throws on unknown tiers (e.g. trial) instead of guessing", () => {
    expect(() => planTierFromSubscription("trial")).toThrow(UnknownPlanTier);
    expect(() => planTierFromSubscription("")).toThrow(UnknownPlanTier);
  });
});
