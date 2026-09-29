import { PlanTier } from "@statreel/schemas";
import { UnknownPlanTier } from "./errors";

export type PlanTierValue = (typeof PlanTier.options)[number];

/** Provider spellings that differ from the schema enum. Anything else unknown throws. */
const ALIASES: Record<string, PlanTierValue> = {
  growing_business: "business",
};

/** ElevenLabs `GET /v1/user/subscription` `tier` → schemas PlanTier. Unknown (incl. "trial") throws. */
export function planTierFromSubscription(tier: string): PlanTierValue {
  const t = tier.trim().toLowerCase();
  const alias = ALIASES[t];
  if (alias) return alias;
  const parsed = PlanTier.safeParse(t);
  if (parsed.success) return parsed.data;
  throw new UnknownPlanTier(tier);
}
