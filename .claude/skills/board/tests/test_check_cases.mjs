import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCases } from "../scripts/check-cases.mjs";

const ok = {
  title: "Who rules the hardwood", pitch: "p", arc: "a", insight: "i", why_lasts: "Fangio leads until 1957, Clark passes him in 1968, Prost collapses in 1987", domain: "sports", topic: "basketball", data_status: "guess",
  tension: { expectation: "e", reality: "r", strength: "moderate" },
  beats: [{ at: "1960", what: "a" }, { at: "1970", what: "b" }, { at: "1985", what: "c" }, { at: "2005", what: "d" }],
  timeline: { unit: "year", from: 1960, to: 2020, years_from: 1960, years_to: 2020 },
  data_guess: "league records", feasibility: "likely", sources: [],
};
const ctx = { avoidIds: ["basketball-reference"], avoidHosts: ["basketball-reference.com", "formula1.com"] };

test("a source on an avoid host is refused whether or not the seat names its registry_id", () => {
  const bad = (src) => checkCases([{ ...ok, sources: [src] }], ctx).cases[0].errors.join();
  assert.match(bad({ name: "BBRef", url: "https://www.basketball-reference.com/leagues/" }), /basketball-reference\.com.*avoid/);
  assert.match(bad({ name: "F1", url: "https://formula1.com/en/results" }), /formula1\.com.*avoid/);
  assert.match(bad({ name: "BBRef", registry_id: "basketball-reference" }), /marked avoid/);
  assert.deepEqual(checkCases([{ ...ok, sources: [{ name: "NBA stats", url: "https://www.nba.com/stats" }] }], ctx).cases[0].errors, []);
  assert.deepEqual(checkCases([{ ...ok, sources: [{ name: "not a url", url: "somewhere" }] }], ctx).cases[0].errors, []);
});
