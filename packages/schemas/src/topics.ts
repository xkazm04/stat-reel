/**
 * Topics (ADR 011): the controlled list of broad domains a video belongs to (a type of sport or a
 * geo-economic discipline), the mappings that resolve a topic from a case domain or a project
 * sport, the recency buckets that colour the topic heatmap, and the endpoint contract.
 *
 * The seed is a PROPOSAL for the owner to review (SPEC C.3); the server seeds it idempotently
 * (`insert or ignore`), the case brief and the Use cases picker read it, so there is one list.
 */
import { z } from "zod";

export const TopicFamily = z.enum(["sport", "geoeconomy", "culture", "science", "games", "music", "other"]);
export type TopicFamily = z.infer<typeof TopicFamily>;

export type TopicSeed = { key: string; label: string; family: TopicFamily; sort: number };

/** The reserved fallback: a video whose topic cannot be resolved. Seeded, never picked by hand. */
export const UNASSIGNED_TOPIC = "unassigned";

const seed = (family: TopicFamily, entries: readonly (readonly [string, string])[], from: number): TopicSeed[] =>
  entries.map(([key, label], i) => ({ key, label, family, sort: from + i }));

export const TOPIC_SEED: readonly TopicSeed[] = [
  ...seed(
    "sport",
    [
      ["formula-1", "Formula 1"],
      ["football", "Football"],
      ["basketball", "Basketball"],
      ["ice-hockey", "Ice hockey"],
      ["tennis", "Tennis"],
      ["cycling", "Cycling"],
      ["motorsport-endurance", "Endurance racing"],
      ["motorcycle-racing", "Motorcycle racing"],
      ["athletics", "Athletics"],
      ["baseball", "Baseball"],
      ["american-football", "American football"],
      ["boxing", "Boxing"],
      ["golf", "Golf"],
      ["cricket", "Cricket"],
      ["rugby", "Rugby"],
    ],
    0,
  ),
  ...seed(
    "geoeconomy",
    [
      ["energy", "Energy"],
      ["trade", "Trade"],
      ["markets", "Markets"],
      ["demographics", "Demographics"],
      ["labour", "Labour"],
      ["growth-income", "Growth and income"],
      ["prices-housing", "Prices and housing"],
      ["debt-finance", "Debt and finance"],
      ["agriculture-food", "Agriculture and food"],
      ["migration", "Migration"],
    ],
    100,
  ),
  { key: "culture", label: "Culture", family: "culture", sort: 200 },
  { key: "science", label: "Science", family: "science", sort: 210 },
  { key: "games", label: "Games", family: "games", sort: 220 },
  { key: "music", label: "Music", family: "music", sort: 230 },
  { key: "other", label: "Other", family: "other", sort: 240 },
  { key: UNASSIGNED_TOPIC, label: "Unassigned", family: "other", sort: 999 },
];

/** Topic keys an owner or a loop may choose (everything but the reserved fallback). */
export const PICKABLE_TOPIC_KEYS: readonly string[] = TOPIC_SEED.filter((t) => t.key !== UNASSIGNED_TOPIC).map((t) => t.key);

/**
 * Case domain -> topic, ONLY where unambiguous. `sports` and `geoeconomy` have no default: an idea
 * in them needs a specific topic (SPEC C.3), so they are absent on purpose.
 */
export const DOMAIN_TOPIC: Readonly<Record<string, string>> = {
  f1: "formula-1",
  culture: "culture",
  science: "science",
  games: "games",
  music: "music",
  other: "other",
};

/** Project sport (registry sports) -> topic. */
export const SPORT_TOPIC: Readonly<Record<string, string>> = {
  F1: "formula-1",
  NBA: "basketball",
  NHL: "ice-hockey",
  Soccer: "football",
};

/** Lower-case kebab slug used for topic keys. */
export const slug = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const TopicSource = z.enum(["case.topic", "case.domain", "project.topic", "project.sport", "unassigned"]);
export type TopicSource = z.infer<typeof TopicSource>;

// ------------------------------------------------------------------ recency buckets (C.5)

export const BucketId = z.enum(["fresh", "recent", "cooling", "cold"]);
export type BucketId = z.infer<typeof BucketId>;
export type RecencyBucket = { id: BucketId; max_days: number | null; label: string };

/** Each bucket includes its upper day; `max_days: null` is open-ended. Ordered newest first. */
export const RECENCY_BUCKETS: readonly RecencyBucket[] = [
  { id: "fresh", max_days: 7, label: "0-7 days" },
  { id: "recent", max_days: 30, label: "8-30 days" },
  { id: "cooling", max_days: 90, label: "31-90 days" },
  { id: "cold", max_days: null, label: "over 90 days" },
];

/** `age_days = floor((now - created_at) / 86 400 000 ms)`; a negative age (clock skew) counts as 0. */
export const ageDays = (createdAt: string | number | Date, now: string | number | Date = Date.now()): number =>
  Math.max(0, Math.floor((new Date(now).getTime() - new Date(createdAt).getTime()) / 86_400_000));

export function bucketForAge(days: number): BucketId {
  for (const b of RECENCY_BUCKETS) if (b.max_days === null || days <= b.max_days) return b.id;
  return "cold";
}

// ------------------------------------------------------------------ endpoint contract (C.4)

export const TopicInputSchema = z.object({
  key: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).optional(),
  label: z.string().trim().min(1).max(60),
  family: TopicFamily,
});
export type TopicInput = z.infer<typeof TopicInputSchema>;

export const TopicPatchSchema = z
  .object({ label: z.string().trim().min(1).max(60), family: TopicFamily, active: z.boolean(), sort: z.number().int() })
  .partial();
export type TopicPatch = z.infer<typeof TopicPatchSchema>;

export const TopicSchema = z.object({
  key: z.string(),
  label: z.string(),
  family: TopicFamily,
  sort: z.number().int(),
  active: z.boolean(),
});
export type Topic = z.infer<typeof TopicSchema>;

export const TopicVideoSchema = z.object({
  n: z.number().int().min(1),
  id: z.string(),
  title: z.string(),
  created_at: z.string(),
  age_days: z.number().int().min(0),
  bucket: BucketId,
  case_id: z.string().nullable(),
  project_id: z.string().nullable(),
  /** /files/... when the file lives under a served folder, else null */
  url: z.string().nullable(),
});
export type TopicVideo = z.infer<typeof TopicVideoSchema>;

export const TopicHeatmapSchema = z.object({
  generated_at: z.string(),
  buckets: z.array(z.object({ id: BucketId, max_days: z.number().nullable(), label: z.string() })),
  max_videos: z.number().int().min(0),
  topics: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      family: TopicFamily,
      source: TopicSource,
      videos: z.array(TopicVideoSchema),
      pending: z.object({ queued: z.number().int().min(0), running: z.boolean() }),
      accepted_cases: z.number().int().min(0),
      last_at: z.string().nullable(),
    }),
  ),
});
export type TopicHeatmap = z.infer<typeof TopicHeatmapSchema>;
