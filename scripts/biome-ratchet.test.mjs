import assert from "node:assert/strict";
import { test } from "node:test";
import { compare, countByRule, formatReport } from "./biome-ratchet-core.mjs";

test("countByRule groups diagnostics by rule category, sorted", () => {
  const report = { diagnostics: [{ category: "format" }, { category: "lint/style/useConst" }, { category: "format" }, {}] };
  assert.deepEqual(countByRule(report), { format: 2, "lint/style/useConst": 1, unknown: 1 });
  assert.deepEqual(countByRule({}), {});
});

test("an increase fails, including a rule that was absent from the baseline", () => {
  const r = compare({ format: 10, a: 3 }, { format: 11, a: 3, brandNew: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.increases, [
    { rule: "brandNew", before: 0, after: 1 },
    { rule: "format", before: 10, after: 11 },
  ]);
  assert.deepEqual(r.decreases, []);
});

test("equal counts pass; decreases (and vanished rules) pass but are listed for re-baselining", () => {
  assert.equal(compare({ a: 2 }, { a: 2 }).ok, true);
  const r = compare({ a: 5, gone: 2 }, { a: 4 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.decreases, [
    { rule: "a", before: 5, after: 4 },
    { rule: "gone", before: 2, after: 0 },
  ]);
  assert.match(formatReport(r, 4), /--update/);
  assert.match(formatReport(r, 4), /ratchet ok/);
});

test("a failing report names the offending rule and counts", () => {
  const out = formatReport(compare({ a: 1 }, { a: 2 }), 2);
  assert.match(out, /INCREASED/);
  assert.match(out, /a: 1 -> 2/);
  assert.match(out, /ratchet FAILED/);
});
