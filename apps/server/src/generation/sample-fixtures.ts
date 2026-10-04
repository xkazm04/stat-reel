/**
 * The fake-mode generation fixtures (`GEN_MODE=fake`, SPEC D.5): REAL, valid DataRace outputs built from
 * the T9 sample builder (ten invented apps, invented numbers). `e2e/fixtures/generation/<type>/` holds
 * their committed copy; `sample-fixtures.test.ts` keeps the two in sync and proves that every file
 * passes the finalize validation. Regenerate with:
 *
 *   WRITE_FIXTURES=1 npx vitest run apps/server/src/generation/sample-fixtures.test.ts
 *
 * visual_options: three variants of the same data that differ in the entity colour set (the only look
 * the props schema carries). Invented figures, `data_provenance: "sample"`.
 * generate_video: `data_provenance: "real"` built from a snapshot of REAL warehouse rows (fixture-rows.ts:
 * F1 driver seasons, F1DB), so the fixture passes the finalize fact verification (facts.ts) and no longer
 * claims "real" over invented figures. Every ref, figure and series value is a warehouse row.
 */
import { buildSampleDataRace } from "@statreel/compositions/fixture";
import { computeTimingPlan, renderTimingMd } from "@statreel/compositions/timing";
import { type DataRacePropsInput, planSha256, sha256Hex } from "@statreel/schemas";
import { F1_DRIVERS, F1_SEASONS, seasonFactKey } from "./fixture-rows";

export type FixtureFile = { path: string; content: string };

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const DATA_URI = "data:image/svg+xml;utf8,";

/** Ten distinct colours per look. */
const PALETTES = {
  "photo-finish": ["#e4432a", "#2f7de1", "#e0a100", "#1fa36b", "#8a4fd6", "#12a3b4", "#d6538a", "#6b7a89", "#c9692a", "#3a4bd1"],
  "slate-night": ["#1d4e89", "#00a6a6", "#5f7a99", "#3d348b", "#118ab2", "#7a9e9f", "#46494c", "#2a9d8f", "#264653", "#6c91bf"],
  "warm-paper": ["#b8321a", "#c28e0e", "#8d5524", "#d1495b", "#6a994e", "#a47148", "#e07a5f", "#7f5539", "#bc6c25", "#9c6644"],
} as const;

export const VARIANTS = [
  { n: 1, key: "photo-finish" as const, name: "Photo finish", note: "Sheet-white ground, graphite type and the clay-red signal on the leader. The house look." },
  { n: 2, key: "slate-night" as const, name: "Slate night", note: "A cool blue-teal set. Fixture text for the fake generation mode: same data, another colour set." },
  { n: 3, key: "warm-paper" as const, name: "Warm paper", note: "Earthy reds and ochres, close to print. Fixture text for the fake generation mode." },
];

type Entity = NonNullable<DataRacePropsInput["entities"]>[number];

function build() {
  const sample = buildSampleDataRace();
  const files: FixtureFile[] = [];
  const logos = new Map<string, string>();
  const entities = sample.props.entities.map((e) => {
    const logo = e.logo as { kind: string; path?: string; src?: string };
    if (logo.kind !== "file" || !logo.src?.startsWith(DATA_URI)) return e;
    const svg = decodeURIComponent(logo.src.slice(DATA_URI.length));
    const rel = `assets/logos/sample-${e.id}.svg`;
    logos.set(rel, svg);
    // authors never write `src` (the server stages it at render time); the path is relative to the job's work folder
    return { ...e, logo: { kind: "file" as const, path: rel } } as Entity;
  });
  for (const [rel, svg] of logos) files.push({ path: rel, content: svg });
  const ledger = [...logos].map(([rel, svg]) => {
    const id = /sample-(.+)\.svg$/.exec(rel)?.[1] ?? rel;
    return {
      entity: id, kind: "logo", file: rel, sha256: sha256Hex(svg), bytes: Buffer.byteLength(svg), url: `https://statreel.invalid/sample-logos/${id}.svg`,
      source_page: "https://statreel.invalid/sample-logos", licence: "CC0-1.0 (invented sample mark, own work)", licence_url: null, author: "StatReel", credit: null,
      trademark: false, fetched_at: "2026-10-03T00:00:00.000Z", verified_by: "model-declared",
    };
  });
  return { sample, entities, files, ledger };
}

const recolour = (entities: Entity[], key: keyof typeof PALETTES): Entity[] => entities.map((e, i) => ({ ...e, color: PALETTES[key][i] as string }));

const POINTS = "points_current_system";

/** The real-data video: ten drivers, season points re-scored to the current system, one period per season. */
export function realVideoProps(): { props: DataRacePropsInput; plan: ReturnType<typeof computeTimingPlan> } {
  const periods = F1_SEASONS.map(String);
  const values = Object.fromEntries(F1_DRIVERS.map((d) => [d.id, d.points]));
  const at = (season: number) => F1_SEASONS.indexOf(season);
  const driver = (id: string) => F1_DRIVERS.find((d) => d.id === id) as (typeof F1_DRIVERS)[number];
  // season rows the cards cite: [driver, season, title]
  const CARDS = [
    ["michael-schumacher", 2004, "Schumacher's 13-win season"],
    ["jenson-button", 2009, "Button's 6-win season"],
    ["sebastian-vettel", 2013, "Vettel's 13-win season"],
    ["nico-rosberg", 2016, "Rosberg's best season"],
    ["max-verstappen", 2023, "Verstappen's 19-win season"],
  ] as const;
  const plan = computeTimingPlan({
    periods,
    entities: F1_DRIVERS.map((d) => d.id),
    values,
    events: CARDS.map(([id, season, title]) => ({ id: `${id}-${season}`, period: at(season), label: title, dwell: 24, spread: 1.2 })),
    opts: { unit: "season", timelineFrames: 960, rankSmooth: 1, orderLabel: "ORDER: 3-SEASON AVG" },
  });
  const cell = (id: string, season: number, col: "points" | "wins") => driver(id)[col][at(season)] as number;
  const winnerId = plan.orders[plan.orders.length - 1]?.[0] ?? "max-verstappen";
  const w = driver(winnerId);
  const wLast = w.points.findLastIndex((v) => v !== null);
  const wSeason = F1_SEASONS[wLast] as number;
  const colors = PALETTES["photo-finish"];
  const props: DataRacePropsInput = {
    data_provenance: "real",
    title: "F1 points per season, 2000-2024",
    hook: "Which season scored the most points?",
    unit_label: "Points, current scoring system",
    value_format: { decimals: 0, prefix: "", suffix: "" },
    source_line: "F1DB (CC-BY-4.0), re-scored to the current points system",
    periods,
    entities: F1_DRIVERS.map((d, i) => {
      const peak = d.points.reduce<number>((best, v, k) => ((v ?? -1) > (d.points[best] ?? -1) ? k : best), 0);
      return {
        id: d.id, name: d.name, aliases: [], color: colors[i] as string, logo: { kind: "wordmark" as const },
        values: d.points, value_ref: `${seasonFactKey(d.id, F1_SEASONS[peak] as number)}#${POINTS}`,
      };
    }),
    missing_logos: F1_DRIVERS.map((d) => d.id),
    events: CARDS.map(([id, season, title]) => {
      const pe = plan.events.find((x) => x.id === `${id}-${season}`);
      const key = seasonFactKey(id, season);
      return {
        id: `${id}-${season}`, entity_id: id, title, date_label: String(season),
        facts: [
          { text: `${cell(id, season, "wins")} wins in ${season}`, ref: `${key}#wins` },
          { text: `${cell(id, season, "points")} points`, ref: `${key}#${POINTS}` },
        ],
        start_frame: pe?.frame ?? 0,
      };
    }),
    spotlight: {
      facts: [
        { label: `Points in ${wSeason}`, value_text: `${w.points[wLast]}`, ref: `${seasonFactKey(w.id, wSeason)}#${POINTS}` },
        { label: `Wins in ${wSeason}`, value_text: `${w.wins[wLast]}`, ref: `${seasonFactKey(w.id, wSeason)}#wins` },
      ],
    },
    timing_plan_sha256: planSha256(plan),
  };
  return { props, plan };
}

/** The warehouse facts of the snapshot (`<fact_key>#<column>` -> value): a `FactResolver` for tests without a warehouse. */
export async function snapshotFacts(refs: string[]): Promise<Map<string, number | string>> {
  const out = new Map<string, number | string>();
  for (const d of F1_DRIVERS)
    F1_SEASONS.forEach((season, i) => {
      for (const [col, v] of [[POINTS, d.points[i]], ["wins", d.wins[i]]] as const)
        if (v !== null && v !== undefined && refs.includes(`${seasonFactKey(d.id, season)}#${col}`)) out.set(`${seasonFactKey(d.id, season)}#${col}`, v);
    });
  return out;
}

/** Fixture files per job type, relative to `e2e/fixtures/generation/<type>/`. */
export function sampleGenerationFixtures(): Record<"visual_options" | "generate_video", FixtureFile[]> {
  const { sample, entities, files: logoFiles, ledger } = build();
  const plan = json(sample.plan);
  const timing = renderTimingMd(sample.plan, { title: "sample-data-race" });
  const common: FixtureFile[] = [
    { path: "out/timing-plan.json", content: plan },
    { path: "out/TIMING.md", content: timing },
    { path: "out/assets.json", content: json(ledger) },
    ...logoFiles,
  ];
  const visual: FixtureFile[] = [
    ...common,
    ...VARIANTS.flatMap((v) => [
      { path: `out/variants/v${v.n}.props.json`, content: json({ ...sample.props, entities: recolour(entities, v.key) }) },
      { path: `out/variants/v${v.n}.md`, content: `# ${v.name}\n\n${v.note}\n` },
    ]),
  ];
  const real = realVideoProps();
  const video: FixtureFile[] = [
    { path: "out/timing-plan.json", content: json(real.plan) },
    { path: "out/TIMING.md", content: renderTimingMd(real.plan, { title: "f1-points-per-season" }) },
    { path: "out/assets.json", content: json([]) },
    { path: "out/props.json", content: json(real.props) },
  ];
  return { visual_options: visual, generate_video: video };
}
