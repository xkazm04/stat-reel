import assert from "node:assert/strict";
import { test } from "node:test";
import { applyFeedback, emptyLedger, loopPhase, renderBrief, renderLedgerMarkdown, validateShot } from "../scripts/lib.mjs";

const item = (id, decision, style, useCase, note = null, proposed = null) => ({
  id, decision, note, decided_at: `2026-09-30T10:0${id.length}:00Z`, style: { id: style, name: style }, use_case_id: useCase, proposed_case: proposed,
});

test("feedback folds into per-style and per-case tallies; reject_both counts against both", () => {
  const l = applyFeedback(emptyLedger(), [
    item("a", "accept", "floodlit", "era-adjusted-rankings"),
    item("bb", "reject_style", "neon", "era-adjusted-rankings", "too busy"),
    item("ccc", "reject_case", "floodlit", "metric-explainer-shorts"),
    item("dddd", "reject_both", "neon", "similarity-dna", "no"),
  ]);
  assert.deepEqual(l.styles.floodlit, { name: "floodlit", accepts: 1, style_rejects: 0, notes: [], last: "2026-09-30T10:03:00Z" });
  assert.equal(l.styles.neon.style_rejects, 2);
  assert.deepEqual(l.styles.neon.notes, ["too busy", "no"]);
  assert.equal(l.cases["era-adjusted-rankings"].accepts, 1);
  assert.equal(l.cases["metric-explainer-shorts"].case_rejects, 1);
  assert.equal(l.cases["similarity-dna"].case_rejects, 1);
  assert.equal(l.cursor, "2026-09-30T10:04:00Z");
});

test("a proposed case is keyed by its name and keeps its pitch", () => {
  const l = applyFeedback(emptyLedger(), [item("a", "accept", "s", null, null, { name: "Pit-stop DNA", pitch: "Every stop as a fingerprint" })]);
  assert.equal(l.cases["proposed:pit-stop-dna"].name, "Pit-stop DNA");
  assert.equal(l.cases["proposed:pit-stop-dna"].pitch, "Every stop as a fingerprint");
});

test("applying the same feedback twice changes nothing (idempotent by item id)", () => {
  const fb = [item("a", "accept", "s", "era-adjusted-rankings")];
  const once = applyFeedback(emptyLedger(), fb);
  assert.deepEqual(applyFeedback(once, fb), once);
});

test("discovery until enough decisions and at least one accepted style, then exploit", () => {
  assert.equal(loopPhase(emptyLedger()), "discovery");
  const l = applyFeedback(emptyLedger(), Array.from({ length: 12 }, (_, i) => item("x".repeat(i + 1), i % 3 ? "reject_style" : "accept", `s${i}`, "era-adjusted-rankings")));
  assert.equal(loopPhase(l), "exploit");
});

test("the brief quotes accepted styles as the floor and rejected ones as anti-patterns, with owner notes", () => {
  const l = applyFeedback(emptyLedger(), [item("a", "accept", "floodlit", "era-adjusted-rankings"), item("bb", "reject_style", "neon", "similarity-dna", "too busy")]);
  const b = renderBrief({ template: "{{phase}}|{{shots}}|{{styles_accepted}}|{{styles_rejected}}|{{cases}}", ledger: l, shots: 3 });
  assert.match(b, /^discovery\|3\|/);
  assert.match(b, /floodlit/);
  assert.match(b, /neon.*too busy/);
});

test("shot metadata: needs title, style, format, and a use case or a proposed case; figures need fact refs", () => {
  assert.deepEqual(validateShot({ title: "T", format: "vertical", style: { id: "s", name: "S" }, use_case_id: "era-adjusted-rankings", facts: ["f1db:driver:x:era-adjusted#rank_raw"] }), []);
  assert.match(validateShot({ title: "T", format: "square", style: { id: "s", name: "S" }, use_case_id: "x" }).join(), /format/);
  assert.match(validateShot({ title: "T", format: "vertical", style: { id: "s", name: "S" } }).join(), /use_case_id or proposed_case/);
  assert.match(validateShot({ title: "T", format: "vertical", style: { id: "s", name: "S" }, use_case_id: "x", facts: ["hamilton wins"] }).join(), /fact ref/);
});

test("the ledger renders as Obsidian-readable markdown tables", () => {
  const md = renderLedgerMarkdown(applyFeedback(emptyLedger(), [item("a", "accept", "floodlit", "era-adjusted-rankings")]));
  assert.match(md, /\| floodlit \| 1 \| 0 \|/);
  assert.match(md, /## Cases/);
});
