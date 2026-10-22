// The case rules in scripts/lib.mjs are hand copies (this harness runs on Node builtins and cannot
// import the TypeScript sources). These tests read the sources as text and fail when a copy drifts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CASE_DOMAINS, CASE_KINDS, CASE_TOPICS, DATA_STATUSES, FEASIBILITY, MAX_CAST, MIN_BEATS, MIN_CAST, MAX_PROJECTION_YEAR, MAX_REACH_RATIO, MIN_BASELINE_YEARS, MIN_BASELINE_YEARS_FINE, MIN_SERIES_INSTANCES, MIN_SPAN_YEARS } from "../scripts/lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
// strip block comments and whole-line // comments before matching (a comment must not satisfy a check)
const source = (rel) => readFileSync(path.join(REPO, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const constArray = (src, name) => {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*(\\[[^\\]]*\\])`));
  assert.ok(m, `${name} not found`);
  return JSON.parse(m[1]);
};
const constNumber = (src, name) => {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)\\s*;`));
  assert.ok(m, `${name} not found`);
  return Number(m[1]);
};

test("case enums and floors match apps/server/src/library.ts (the server re-validates every posted case)", () => {
  const lib = source("apps/server/src/library.ts");
  assert.deepEqual(CASE_DOMAINS, constArray(lib, "CASE_DOMAINS"));
  assert.deepEqual(DATA_STATUSES, constArray(lib, "DATA_STATUSES"));
  assert.deepEqual(CASE_KINDS, constArray(lib, "CASE_KINDS"));
  assert.deepEqual(FEASIBILITY, constArray(lib, "FEASIBILITY"));
  assert.equal(MIN_SPAN_YEARS, constNumber(lib, "MIN_SPAN_YEARS"));
  assert.equal(MIN_BEATS, constNumber(lib, "MIN_BEATS"));
  assert.equal(MIN_CAST, constNumber(lib, "MIN_CAST"));
  assert.equal(MAX_CAST, constNumber(lib, "MAX_CAST"));
  assert.equal(MIN_SERIES_INSTANCES, constNumber(lib, "MIN_SERIES_INSTANCES"));
  for (const [v, n] of [[MIN_BASELINE_YEARS, "MIN_BASELINE_YEARS"], [MIN_BASELINE_YEARS_FINE, "MIN_BASELINE_YEARS_FINE"], [MAX_REACH_RATIO, "MAX_REACH_RATIO"], [MAX_PROJECTION_YEAR, "MAX_PROJECTION_YEAR"]]) assert.equal(v, constNumber(lib, n));
});

/** Topic keys of TOPIC_SEED in seed order: `["key", "Label"]` entries and `{ key: "x"` literals (the reserved fallback is a constant, not a literal). */
function seedKeys() {
  const src = source("packages/schemas/src/topics.ts");
  const start = src.indexOf("export const TOPIC_SEED");
  const end = src.indexOf("];", start);
  assert.ok(start >= 0 && end > start, "TOPIC_SEED not found");
  return [...src.slice(start, end).matchAll(/\[\s*"([a-z0-9-]+)"\s*,\s*"|\bkey:\s*"([a-z0-9-]+)"/g)].map((m) => m[1] ?? m[2]);
}

test("CASE_TOPICS is TOPIC_SEED without the reserved fallback, in order", () => {
  const keys = seedKeys();
  assert.ok(keys.length >= 20, `only ${keys.length} seed keys parsed`);
  assert.deepEqual(CASE_TOPICS, keys);
});

test("the case brief lists exactly CASE_TOPICS (seats copy their topic from it)", () => {
  const brief = readFileSync(path.join(HERE, "../references/case-brief.md"), "utf8");
  const listed = brief.split("\n").filter((l) => /^- \*\*(Sports|Geo-economy|Broad families):\*\*/.test(l)).flatMap((l) => [...l.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]));
  assert.deepEqual(listed, CASE_TOPICS);
});
