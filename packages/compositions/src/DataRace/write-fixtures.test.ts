/**
 * Regenerates packages/compositions/fixtures/sample-data-race.* from the builder:
 *   WRITE_FIXTURES=1 npx vitest run packages/compositions/src/DataRace/write-fixtures.test.ts
 * Without the env var this test does nothing (DataRace.test.tsx asserts the files are in sync).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataRacePropsJsonSchema } from "@statreel/schemas";
import { it } from "vitest";
import { renderTimingMd } from "../timing/index";
import { buildSampleDataRace } from "./fixture";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

it.runIf(process.env.WRITE_FIXTURES === "1")("writes the sample fixtures", () => {
  const s = buildSampleDataRace();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "sample-data-race.props.json"), json(s.props));
  writeFileSync(path.join(dir, "sample-data-race.timing-plan.json"), json(s.plan));
  writeFileSync(path.join(dir, "sample-data-race.assets.json"), json(s.ledger));
  writeFileSync(path.join(dir, "sample-data-race.TIMING.md"), renderTimingMd(s.plan, { title: "sample-data-race" }));
  writeFileSync(path.join(dir, "data-race-props.schema.json"), json(dataRacePropsJsonSchema()));
});
