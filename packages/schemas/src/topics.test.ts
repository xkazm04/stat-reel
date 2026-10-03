import { describe, expect, it } from "vitest";
import {
  ageDays,
  bucketForAge,
  DOMAIN_TOPIC,
  PICKABLE_TOPIC_KEYS,
  RECENCY_BUCKETS,
  SPORT_TOPIC,
  slug,
  TOPIC_SEED,
  TopicHeatmapSchema,
  TopicInputSchema,
  UNASSIGNED_TOPIC,
} from "./topics";

describe("topic seed (ADR 011)", () => {
  const keys = TOPIC_SEED.map((t) => t.key);
  it("has unique, slug-shaped keys and unique sort values", () => {
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toBe(slug(k));
    expect(new Set(TOPIC_SEED.map((t) => t.sort)).size).toBe(keys.length);
  });
  it("carries the reserved unassigned topic, which is not pickable", () => {
    expect(keys).toContain(UNASSIGNED_TOPIC);
    expect(PICKABLE_TOPIC_KEYS).not.toContain(UNASSIGNED_TOPIC);
  });
  it("maps domains and sports onto seeded topics only; sports and geoeconomy have no default", () => {
    for (const k of [...Object.values(DOMAIN_TOPIC), ...Object.values(SPORT_TOPIC)]) expect(keys).toContain(k);
    expect(DOMAIN_TOPIC.sports).toBeUndefined();
    expect(DOMAIN_TOPIC.geoeconomy).toBeUndefined();
    expect(DOMAIN_TOPIC.f1).toBe("formula-1");
    expect(SPORT_TOPIC).toEqual({ F1: "formula-1", NBA: "basketball", NHL: "ice-hockey", Soccer: "football" });
  });
});

describe("recency buckets (C.5): each includes its upper day", () => {
  it.each([
    [0, "fresh"], [7, "fresh"], [8, "recent"], [30, "recent"], [31, "cooling"], [90, "cooling"], [91, "cold"], [4000, "cold"],
  ])("age %i d is %s", (days, id) => expect(bucketForAge(days)).toBe(id));
  it("lists the buckets newest first, the last one open-ended", () => {
    expect(RECENCY_BUCKETS.map((b) => b.id)).toEqual(["fresh", "recent", "cooling", "cold"]);
    expect(RECENCY_BUCKETS.at(-1)?.max_days).toBeNull();
  });
  it("floors the age in whole days and never goes negative", () => {
    const now = "2026-10-10T12:00:00.000Z";
    expect(ageDays("2026-10-03T12:00:01.000Z", now)).toBe(6);
    expect(ageDays("2026-10-03T12:00:00.000Z", now)).toBe(7);
    expect(ageDays("2026-10-11T00:00:00.000Z", now)).toBe(0);
  });
});

describe("slug and contracts", () => {
  it("slugs labels", () => {
    expect(slug("Formula 1")).toBe("formula-1");
    expect(slug("  Prices & housing! ")).toBe("prices-housing");
    expect(slug("Český hokej")).toBe("cesky-hokej");
  });
  it("validates topic input and the heatmap payload", () => {
    expect(TopicInputSchema.safeParse({ label: "Surfing", family: "sport" }).success).toBe(true);
    expect(TopicInputSchema.safeParse({ key: "Bad Key", label: "x", family: "sport" }).success).toBe(false);
    expect(TopicInputSchema.safeParse({ label: "x", family: "weather" }).success).toBe(false);
    const ok = {
      generated_at: "2026-10-03T00:00:00.000Z", buckets: [...RECENCY_BUCKETS], max_videos: 1,
      topics: [{ key: "energy", label: "Energy", family: "geoeconomy", source: "case.topic", pending: { queued: 0, running: false },
        accepted_cases: 1, last_at: null, videos: [{ n: 1, id: "vd-1", title: "t", created_at: "2026-10-03T00:00:00.000Z", age_days: 0, bucket: "fresh", case_id: null, project_id: null, url: null }] }],
    };
    expect(TopicHeatmapSchema.safeParse(ok).success).toBe(true);
  });
});
