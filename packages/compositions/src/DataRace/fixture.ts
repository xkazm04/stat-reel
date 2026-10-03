/**
 * Sample-data fixture for DataRace: ten INVENTED apps (no real brands, no real numbers) so the
 * composition can be rendered, tested and previewed without any data source. `data_provenance` is
 * "sample", so the composition burns the SAMPLE DATA badge. Deterministic (seeded noise, no clock).
 * The same data is committed as JSON under packages/compositions/fixtures/ (kept in sync by a test).
 */
import {
  type AssetLedgerRow,
  type DataRacePropsInput,
  type TimingPlan,
  planSha256,
  sha256Hex,
} from "@statreel/schemas";
import { computeTimingPlan } from "../timing/index";

const SERIES = [
  // id, name, plateau (M users), midpoint (period), steepness, first period with data
  ["lumen", "Lumen", 82, 20, 0.12, 0],
  ["pixelo", "Pixelo", 70, 35, 0.1, 0],
  ["voxa", "Voxa", 64, 50, 0.11, 0],
  ["nimbus", "Nimbus", 58, 28, 0.09, 0],
  ["zephyr", "Zephyr", 95, 70, 0.13, 0],
  ["quill", "Quill", 40, 15, 0.15, 0],
  ["ember", "Ember", 52, 60, 0.1, 24],
  ["tango", "Tango", 33, 40, 0.14, 0],
  ["orbit", "Orbit", 47, 85, 0.2, 60],
  ["prism", "Prism", 120, 76, 0.12, 12],
] as const;

/** A distinct colour per entity; chosen for contrast on both a dark and a light ground. */
const COLORS = [
  "#e4432a",
  "#2f7de1",
  "#e0a100",
  "#1fa36b",
  "#8a4fd6",
  "#12a3b4",
  "#d6538a",
  "#6b7a89",
  "#c9692a",
  "#3a4bd1",
];

const PERIOD_COUNT = 96;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Invented geometric marks, drawn here (own work, sample only). Three entities get one; the rest use the wordmark. */
const LOGO_SVGS: Record<string, string> = {
  lumen:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="#e4432a"/><circle cx="32" cy="32" r="10" fill="#fff"/></svg>',
  zephyr:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M10 18h44L22 46h32v6H10v-6l32-28H10z" fill="#8a4fd6"/></svg>',
  prism:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 8 58 54H6z" fill="#3a4bd1"/><path d="M32 24 46 48H18z" fill="#fff"/></svg>',
};
const logoPath = (id: string) => `data/assets/logos/sample-${id}.svg`;
const dataUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

export const sampleDataRaceLedger = (): AssetLedgerRow[] =>
  Object.entries(LOGO_SVGS).map(([id, svg]) => ({
    path: logoPath(id),
    url: `https://statreel.invalid/sample-logos/${id}.svg`,
    source_page: "https://statreel.invalid/sample-logos",
    licence: "CC0-1.0 (invented sample mark, own work)",
    author: "StatReel",
    trademark: false,
    sha256: sha256Hex(svg),
  }));

export function sampleDataRaceValues(): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {};
  for (const [i, s] of SERIES.entries()) {
    const [id, , plateau, mid, steep, first] = s;
    const rnd = mulberry32(1000 + i);
    out[id] = Array.from({ length: PERIOD_COUNT }, (_, t) => {
      if (t < first) return null;
      const base = plateau / (1 + Math.exp(-steep * (t - mid)));
      const noise = (rnd() - 0.5) * 0.05 * plateau * (t > 0 ? 1 : 0);
      return Math.max(0.1, Math.round((base + noise) * 100) / 100);
    });
  }
  return out;
}

export const sampleDataRacePeriods = (): string[] =>
  Array.from({ length: PERIOD_COUNT }, (_, t) => `${MONTHS[t % 12]} ${2019 + Math.floor(t / 12)}`);

const EVENTS = [
  { id: "free-tier", period: 14, entity: "quill", title: "Quill opens a free tier", date: "MAR 2020", fact: ["Sign-ups triple in a month", "sample:event:free-tier#signups"] },
  { id: "merger", period: 38, entity: "pixelo", title: "Pixelo and Tango merge", date: "MAR 2022", fact: ["Two catalogues become one", "sample:event:merger#catalogues"] },
  { id: "outage", period: 55, entity: "voxa", title: "Voxa goes dark for a day", date: "AUG 2023", fact: ["A 19 h outage", "sample:event:outage#hours"] },
  { id: "launch", period: 57, entity: "ember", title: "Ember ships its mobile app", date: "OCT 2023", fact: ["1.2 M installs in week one", "sample:event:launch#installs"] },
  { id: "price-hike", period: 59, entity: "lumen", title: "Lumen raises its price", date: "DEC 2023", fact: ["Up 20 % for new users", "sample:event:price-hike#percent"] },
  { id: "rebrand", period: 78, entity: "zephyr", title: "Zephyr rebrands overnight", date: "JUL 2025", fact: ["New name, same service", "sample:event:rebrand#rename"] },
] as const;

export type SampleDataRace = {
  props: DataRacePropsInput;
  plan: TimingPlan;
  ledger: AssetLedgerRow[];
};

export function buildSampleDataRace(): SampleDataRace {
  const periods = sampleDataRacePeriods();
  const values = sampleDataRaceValues();
  const plan = computeTimingPlan({
    periods,
    entities: SERIES.map((s) => s[0]),
    values,
    events: EVENTS.map((e) => ({ id: e.id, period: e.period, label: e.title, dwell: 24, spread: 1.2 })),
    opts: { unit: "month", timelineFrames: 960, rankSmooth: 1, orderLabel: "ORDER: 3-MO AVG" },
  });
  const winnerId = plan.orders[plan.orders.length - 1]?.[0] ?? "prism";
  const last = values[winnerId]?.[PERIOD_COUNT - 1] ?? 0;
  const props: DataRacePropsInput = {
    data_provenance: "sample",
    title: "Which app rules the screen?",
    hook: "Whose app will lead in 2026?",
    unit_label: "Monthly active users",
    value_format: { decimals: 1, prefix: "", suffix: " M" },
    source_line: "Invented sample data for the design preview",
    periods,
    entities: SERIES.map((s, i) => ({
      id: s[0],
      name: s[1],
      aliases: [],
      color: COLORS[i] as string,
      logo: LOGO_SVGS[s[0]]
        ? { kind: "file" as const, path: logoPath(s[0]), src: dataUri(LOGO_SVGS[s[0]] as string) }
        : { kind: "wordmark" as const },
      values: values[s[0]] as (number | null)[],
      value_ref: `sample:app:${s[0]}#users`,
    })),
    missing_logos: SERIES.filter((s) => !LOGO_SVGS[s[0]]).map((s) => s[0]),
    events: EVENTS.map((e) => {
      const pe = plan.events.find((x) => x.id === e.id);
      return {
        id: e.id,
        entity_id: e.entity,
        title: e.title,
        date_label: e.date,
        facts: [{ text: e.fact[0], ref: e.fact[1] }],
        start_frame: pe?.frame ?? 0,
      };
    }),
    spotlight: {
      facts: [
        { label: "Monthly users", value_text: `${last.toFixed(1)} M`, ref: `sample:app:${winnerId}#users` },
        { label: "Months in the top 3", value_text: "41", ref: `sample:app:${winnerId}#months_in_top` },
      ],
    },
    timing_plan_sha256: planSha256(plan),
  };
  return { props, plan, ledger: sampleDataRaceLedger() };
}
