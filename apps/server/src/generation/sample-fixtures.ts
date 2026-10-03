/**
 * The fake-mode generation fixtures (`GEN_MODE=fake`, SPEC D.5): REAL, valid DataRace outputs built from
 * the T9 sample builder (ten invented apps, invented numbers). `e2e/fixtures/generation/<type>/` holds
 * their committed copy; `sample-fixtures.test.ts` keeps the two in sync and proves that every file
 * passes the finalize validation. Regenerate with:
 *
 *   WRITE_FIXTURES=1 npx vitest run apps/server/src/generation/sample-fixtures.test.ts
 *
 * visual_options: three variants of the same data that differ in the entity colour set (the only look
 * the props schema carries). generate_video: one props file with `data_provenance: "real"`, because a
 * video requires real data; the figures are the invented sample ones, so this is a TEST DOUBLE that is
 * only ever rendered inside the e2e data folder, never a real video.
 */
import { buildSampleDataRace } from "@statreel/compositions/fixture";
import { renderTimingMd } from "@statreel/compositions/timing";
import { type DataRacePropsInput, sha256Hex } from "@statreel/schemas";

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
  const video: FixtureFile[] = [
    ...common,
    {
      path: "out/props.json",
      content: json({ ...sample.props, entities: recolour(entities, "photo-finish"), data_provenance: "real", source_line: "E2E fixture, fake mode: invented figures, not real data" }),
    },
  ];
  return { visual_options: visual, generate_video: video };
}
